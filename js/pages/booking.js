import { db } from '../db.js';
import { format } from '../format.js';
import { poll } from '../poll.js';
import { startPage } from '../router.js';
import { createModal } from '../ui/modal.js';
import { renderQr } from '../ui/qr.js';
import { toast } from '../ui/toast.js';

const STEPS = Object.freeze(['Load', 'Vehicle', 'Time', 'Contact', 'Confirm']);
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'no_show']);
const SLOT_SUSPENSION = 'booking-slot-picker';
const CUSTOMER_SLOT_PROJECTION = 'slot_start, slot_end, recommendation_rank, recommendation_score, capacity_warning, alternative_date';
const EXTERNAL_PARTIES = Object.freeze([
  { value: 'Customer', label: 'Customer' },
  { value: 'Vendor', label: 'Vendor' },
  { value: 'Carrier', label: 'Carrier / courier' },
]);

let context = null;
let state = null;
let hosts = null;
let sameDayModal = null;
let deleteTemplateModal = null;
let deleteTemplateId = null;
let shortcutModal = null;
let shortcutUrl = '';
let cleanup = [];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clean(value) {
  return String(value ?? '').trim();
}

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function isStaff() {
  return !context.customerShell;
}

function currentLocation() {
  if (context.customerShell && state?.form?.destination_location_id) {
    const chosen = context.locations.find(location => location.id === state.form.destination_location_id);
    if (chosen) return chosen;
  }
  return context.location;
}

// The counterpart can be any active Max Solutions site, so it is resolved from
// the directory first and only then from this account's own assignments. Getting
// this wrong meant the receiving site's timezone fell back to the booking site's
// and the confirmation named the counterpart "Max Solutions".
function counterpartLocation() {
  const id = state.form.requester_location_id;
  if (!id) return null;
  return (state.reference?.maxLocations || []).find(location => location.id === id)
    || context.locations.find(location => location.id === id)
    || null;
}

function receivingLocation() {
  if (state.form.movement_kind === 'max' && state.form.direction === 'outbound') {
    return counterpartLocation() || currentLocation();
  }
  return currentLocation();
}

function selectedDate() {
  if (state.form.after_hours) return state.form.date;
  return state.form.selected_slot
    ? format.inputDate(state.form.selected_slot.slot_start, receivingLocation())
    : state.form.date;
}

function selectedTime() {
  if (state.form.after_hours) return state.form.custom_time;
  return state.form.selected_slot
    ? format.inputTime(state.form.selected_slot.slot_start, receivingLocation())
    : '';
}

function createInitialForm() {
  const customer = context.customerShell;
  return {
    location_id: context.location.id,
    direction: 'inbound',
    movement_kind: 'external',
    destination_location_id: null,
    requester_type: customer ? clean(context.profile.external_party_type) || 'Customer' : 'Customer',
    company_name: customer ? clean(context.profile.organization_name) : '',
    requester_location_id: null,
    appointment_type_code: '',
    truck_type_code: '',
    skid_count: 0,
    handling_type_code: '',
    is_priority: false,
    external_reference: '',
    carrier_name: '',
    notes: '',
    date: format.inputDate(null, currentLocation()),
    preferred_start_time: '',
    preferred_end_time: '',
    selected_slot: null,
    after_hours: false,
    custom_time: '',
    after_hours_acknowledged: false,
    requester_name: clean(context.profile.full_name),
    requester_email: clean(context.profile.contact_email || context.user.email),
    template_name: '',
    template_shared: false,
    repeat_on: false,
    repeat_days: [],
    repeat_interval_weeks: 1,
    repeat_until: '',
  };
}

// extraColumns are read from the per-location mapping row and merged onto the
// master row, so a location's own settings (a trailer's skid capacity, say)
// travel with the option instead of needing a second round trip.
async function loadEnabledRows(mappingTable, codeColumn, masterTable, locationId, extraColumns = '') {
  const mappings = await db.select(mappingTable, query => query
    .select(extraColumns ? `${codeColumn}, ${extraColumns}` : codeColumn)
    .eq('location_id', locationId)
    .eq('is_active', true), {
    key: `booking:${mappingTable}:${locationId}${extraColumns ? ':full' : ''}`,
    cache: 300000,
    retry: 1,
    userMessage: 'The enabled booking options could not be loaded.',
  });
  const codes = (mappings || []).map(row => row[codeColumn]);
  if (!codes.length) return [];
  const rows = await db.select(masterTable, query => query
    .select('code, name, sort_order')
    .in('code', codes)
    .eq('is_active', true)
    .order('sort_order'), {
    key: `booking:${masterTable}:${locationId}`,
    cache: 300000,
    retry: 1,
    userMessage: 'The enabled booking options could not be loaded.',
  });
  if (!extraColumns) return rows;
  const byCode = new Map((mappings || []).map(row => [row[codeColumn], row]));
  return (rows || []).map(row => ({ ...byCode.get(row.code), ...row }));
}

// Your own templates and the shared ones for the sites you can see. The row-level
// policy decides which of those you are allowed to read; this asks for both and
// lets it answer, rather than trying to state the rule twice.
async function loadTemplates() {
  return db.select('booking_templates', query => query
    .select('id, owner_user_id, location_id, name, is_shared, direction, requester_type, company_name, appointment_type_code, truck_type_code, skid_count, handling_type_code, is_priority, carrier_name, preferred_start_time, preferred_end_time, created_at, updated_at')
    .order('updated_at', { ascending: false }), {
    key: `booking:templates:${context.user.id}`,
    cache: 30000,
    retry: 1,
    userMessage: 'Your booking templates could not be loaded.',
  });
}

async function loadReferenceData() {
  const locationId = currentLocation().id;
  const requests = [
    loadEnabledRows('location_appointment_types', 'appointment_type_code', 'appointment_types', locationId),
    loadEnabledRows('location_truck_types', 'truck_type_code', 'truck_types', locationId, 'skid_capacity'),
    loadEnabledRows('location_handling_types', 'handling_type_code', 'handling_types', locationId),
    db.select('location_settings', query => query
      .select('slot_interval_minutes, suggest_same_day_consolidation, consolidation_window_hours, maximum_advance_days')
      .eq('location_id', locationId)
      .single(), {
      key: `booking:settings:${locationId}`,
      cache: 300000,
      retry: 1,
      userMessage: 'This location’s booking settings could not be loaded.',
    }),
    loadTemplates(),
  ];

  if (isStaff()) {
    requests.push(
      db.rpc('list_external_company_directory', {}, {
        key: 'booking:external-company-directory',
        cache: 300000,
        retry: 1,
        userMessage: 'The external company directory could not be loaded.',
      }),
      db.select('location_operating_hours', query => query
        .select('day_of_week, is_open, open_time, close_time')
        .eq('location_id', locationId)
        .order('day_of_week'), {
        key: `booking:hours:${locationId}`,
        cache: 300000,
        retry: 1,
        userMessage: 'Operating hours could not be loaded.',
      }),
      // Every active Max Solutions site, not only the ones this account is
      // assigned to. A coordinator is assigned one site, so filtering the
      // counterpart picker by assignment left it with nothing to choose and
      // Max-to-Max could not be booked at all. The booking RPCs only ever
      // required access to the location being booked, never to the counterpart.
      db.rpc('list_active_location_directory', {}, {
        key: 'booking:location-directory',
        cache: 300000,
        retry: 1,
        userMessage: 'The Max Solutions location list could not be loaded.',
      }),
    );
  }

  const result = await Promise.all(requests);
  return {
    appointmentTypes: result[0] || [],
    truckTypes: result[1] || [],
    handlingTypes: result[2] || [],
    settings: result[3] || {},
    templates: result[4] || [],
    externalCompanies: isStaff() ? result[5] || [] : [],
    operatingHours: isStaff() ? result[6] || [] : [],
    maxLocations: isStaff() ? result[7] || [] : [],
  };
}

function buildShell() {
  const root = context.pageRoot;
  const customer = context.customerShell;
  root.innerHTML = `
    <div class="modal__head">
      <div>
        <h2 class="modal__title" id="booking-modal-title">${customer ? 'Book a shipment' : 'Book appointment'}</h2>
        <span class="modal__sub">${currentLocation().name}${customer ? ' · Sending to Max Solutions' : ''}</span>
      </div>
      <button class="modal__x" type="button" data-action="close-booking" aria-label="Close booking">×</button>
    </div>
    <nav class="steps" data-booking-steps aria-label="Booking progress"></nav>
    <div class="modal__body">
      <div data-booking-step></div>
      <p class="form-message" data-booking-message aria-live="polite"></p>
    </div>
    <div class="modal__foot" data-booking-actions></div>
    <div class="scrim" data-consolidation-modal hidden aria-hidden="true">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="consolidation-title">
        <div class="modal__head"><div><h2 class="modal__title" id="consolidation-title">Another appointment already exists that day</h2></div></div>
        <div class="modal__body">
          <p class="modal__message">Combining loads may reduce handling and truck movements. MaxDock will never combine them automatically.</p>
          <div data-consolidation-list></div>
        </div>
        <div class="modal__foot">
          <button class="btn btn--quiet" type="button" data-action="view-existing">View existing appointment</button>
          <button class="btn btn--quiet" type="button" data-action="combine-load">Choose loads to combine</button>
          <button class="btn btn--primary" type="button" data-action="continue-separately">Continue separately</button>
        </div>
      </section>
    </div>
    <div class="scrim" data-shortcut-modal hidden aria-hidden="true">
      <section class="modal modal--sm" role="dialog" aria-modal="true" aria-labelledby="shortcut-title">
        <div class="modal__head"><div><h2 class="modal__title" id="shortcut-title" data-shortcut-name>Shortcut</h2><p class="modal__sub" data-shortcut-sub></p></div><button class="modal__x" type="button" data-action="dismiss-shortcut" aria-label="Close">×</button></div>
        <div class="modal__body">
          <div class="shortcut" data-shortcut-card>
            <div class="qr-frame" data-shortcut-qr></div>
            <div class="shortcut__body">
              <div class="shortcut__title" data-shortcut-heading></div>
              <div class="shortcut__det" data-shortcut-detail></div>
              <p class="hint hint--flush">Scan to open MaxDock with this booking already filled in. Sign in once on the phone and it opens straight to the form.</p>
            </div>
          </div>
          <p class="hint hint--wide" data-shortcut-url></p>
        </div>
        <div class="modal__foot">
          <button class="btn btn--quiet" type="button" data-action="copy-shortcut">Copy link</button>
          <button class="btn btn--primary" type="button" data-action="print-shortcut">Print</button>
        </div>
      </section>
    </div>
    <div class="scrim" data-template-delete-modal hidden aria-hidden="true">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="template-delete-title">
        <div class="modal__head"><div><h2 class="modal__title" id="template-delete-title">Delete this booking template?</h2></div></div>
        <div class="modal__body"><p class="modal__message">The template will be removed. Existing appointments are not affected.</p></div>
        <div class="modal__foot">
          <button class="btn btn--quiet" type="button" data-action="dismiss-template-delete">Keep template</button>
          <button class="btn btn--danger" type="button" data-action="confirm-template-delete">Delete template</button>
        </div>
      </section>
    </div>`;

  hosts = {
    steps: root.querySelector('[data-booking-steps]'),
    step: root.querySelector('[data-booking-step]'),
    message: root.querySelector('[data-booking-message]'),
    actions: root.querySelector('[data-booking-actions]'),
    consolidationBackdrop: root.querySelector('[data-consolidation-modal]'),
    consolidationList: root.querySelector('[data-consolidation-list]'),
    deleteBackdrop: root.querySelector('[data-template-delete-modal]'),
    shortcutBackdrop: root.querySelector('[data-shortcut-modal]'),
  };

  root.querySelector('[data-action="close-booking"]').addEventListener('click', () => context.onClose?.());
  hosts.step.tabIndex = -1;

  sameDayModal = createModal(hosts.consolidationBackdrop, {
    initialFocus: '[data-action="view-existing"]',
    closeOnBackdrop: false,
  });
  deleteTemplateModal = createModal(hosts.deleteBackdrop, {
    initialFocus: '[data-action="dismiss-template-delete"]',
  });
  shortcutModal = createModal(hosts.shortcutBackdrop, {
    initialFocus: '[data-action="print-shortcut"]',
  });
}

function addOptions(select, rows, selected, placeholder) {
  select.replaceChildren();
  if (placeholder) {
    const empty = element('option', '', placeholder);
    empty.value = '';
    select.append(empty);
  }
  for (const row of rows) {
    const option = element('option', '', row.label || row.name);
    option.value = row.value || row.code || row.id;
    option.selected = option.value === clean(selected);
    select.append(option);
  }
}

function selectedName(rows, code, fallback = 'Not selected') {
  return rows.find(row => String(row.code || row.value || row.id) === String(code))?.name
    || rows.find(row => String(row.code || row.value || row.id) === String(code))?.label
    || fallback;
}

function renderSteps() {
  hosts.steps.replaceChildren();
  STEPS.forEach((label, index) => {
    const button = element('button', 'step', `${index + 1} · ${label}`);
    button.type = 'button';
    button.dataset.action = 'go-step';
    button.dataset.step = String(index);
    button.disabled = Boolean(state.confirmation) || index > state.maxStep;
    if (index === state.step) button.classList.add('step--now');
    else if (index < state.step) button.classList.add('step--done');
    button.setAttribute('aria-current', index === state.step ? 'step' : 'false');
    button.setAttribute('aria-label', `Step ${index + 1}: ${label}`);
    hosts.steps.append(button);
  });
}

// The QR is a link to Receiving carrying this appointment's own check-in token,
// so the phone's own camera app opens it — the only route that works on iOS,
// where the browser has no barcode reader at all. The booking reference is
// printed on every document in the load and could never be what checks a truck
// in, so it is deliberately not what the code carries.
async function renderCheckInCode(result) {
  const host = hosts.step.querySelector('[data-qr]');
  if (!host) return;
  // Through the RPC, not off the table. Reading the column directly needed
  // appointment.view, which a customer booking their own shipment does not have —
  // so the one account that most needs a code to hand a driver never got one.
  let token = null;
  try {
    token = await db.rpc('get_appointment_check_in_token', { p_appointment_id: result.appointment_id }, {
      key: `booking:token:${result.appointment_id}`, cache: 0, retry: 1,
    });
  } catch { token = null; }
  if (!token) {
    host.innerHTML = '<p class="hint">The check-in code is not available for this booking yet.</p>';
    return;
  }
  const url = new URL('receiving.html', globalThis.location.href);
  url.searchParams.set('t', token);
  renderQr(host, url.href, { label: `Check-in code for MaxDock appointment ${result.booking_reference}` });
}

function renderQuickRebook() {
  if (!state.reference.templates.length) return '';
  const items = state.reference.templates.slice(0, 6).map(template => {
    const location = context.locations.find(item => item.id === template.location_id);
    const mine = template.owner_user_id === context.user.id;
    return `<div class="rebook"><div class="integ__ico">${escapeHtml(template.name.slice(0, 1).toUpperCase())}</div>
      <div class="rebook__body"><div class="rebook__ref">${escapeHtml(template.name)}${template.is_shared ? ' <span class="tag tag--ok">Shared</span>' : ''}</div><div class="rebook__det">${escapeHtml(location?.name || 'Location')} · ${escapeHtml(selectedName(state.reference.truckTypes, template.truck_type_code, template.truck_type_code))} · ${Number(template.skid_count || 0)} skids</div></div>
      <button class="btn btn--primary btn--sm" type="button" data-action="use-template" data-template-id="${escapeHtml(template.id)}">Use</button>
      <button class="btn btn--quiet btn--sm" type="button" data-action="shortcut-template" data-template-id="${escapeHtml(template.id)}">Shortcut</button>
      ${mine ? `<button class="btn btn--quiet btn--sm" type="button" data-action="delete-template" data-template-id="${escapeHtml(template.id)}">Delete</button>` : ''}</div>`;
  }).join('');
  return `<div class="grouplabel">Quick book — saved shortcuts</div><div>${items}</div><p class="hint">Use fills this booking in from the shortcut. Shortcut prints a QR code to post by the shipping desk — scanning it opens this form already filled in.</p>`;
}

function renderLoadStep() {
  const customer = context.customerShell;
  const staff = isStaff();
  const maxToMax = !customer && state.form.movement_kind === 'max';
  // What you are asked for depends on who you are and what kind of movement it is.
  // A Max-to-Max transfer goes to another Max Solutions site, so it asks which one
  // and never asks for a company — there is no outside party. An external movement
  // is the opposite. A customer is already known, so it asks neither.
  // Two rows, each filling the twelve columns exactly. Who is sending decides the
  // first row; what is moving is always the second, so an operator books the same
  // way every time whatever kind of movement it is.
  hosts.step.innerHTML = `
    ${renderQuickRebook()}
    ${customer ? `<div class="frow">
      <div class="field field--full"><span class="field__label">Sending to<span class="field__req" aria-hidden="true">*</span></span><select class="select" data-field="destination_location_id"></select></div>
    </div>` : ''}
    ${customer ? '' : `<div class="frow">
      <div class="field field--${maxToMax ? 'md' : 'sm'}"><span class="field__label">Direction</span><select class="select" data-field="direction">
        <option value="inbound" ${state.form.direction === 'inbound' ? 'selected' : ''}>Inbound</option>
        <option value="outbound" ${state.form.direction === 'outbound' ? 'selected' : ''}>Outbound</option>
      </select></div>
      <div class="field field--${maxToMax ? 'md' : 'sm'}"><span class="field__label">Movement</span><select class="select" data-field="movement_kind">
        <option value="external" ${state.form.movement_kind === 'external' ? 'selected' : ''}>External</option>
        <option value="max" ${state.form.movement_kind === 'max' ? 'selected' : ''}>Max-to-Max</option>
      </select></div>
      ${maxToMax
        ? `<div class="field field--md"><span class="field__label">${state.form.direction === 'outbound' ? 'Sending to' : 'Receiving from'}<span class="field__req" aria-hidden="true">*</span></span><select class="select" data-field="requester_location_id"></select></div>`
        : `<div class="field field--sm"><span class="field__label">Party type<span class="field__req" aria-hidden="true">*</span></span><select class="select" data-field="requester_type"></select></div>
           <div class="field field--sm"><span class="field__label">Company</span><input class="input" data-field="company_name" list="company-directory" maxlength="120" autocomplete="organization"><datalist id="company-directory"></datalist></div>`}
    </div>`}
    <div class="frow">
      <div class="field field--${customer ? 'lg' : 'md'}"><span class="field__label">Appointment type<span class="field__req" aria-hidden="true">*</span></span><select class="select" data-field="appointment_type_code"></select></div>
      <div class="field field--num"><span class="field__label">Skids<span class="field__req" aria-hidden="true">*</span></span><input class="input" data-field="skid_count" type="number" min="0" max="9999" inputmode="numeric"></div>
      <div class="field field--md"><span class="field__label">PO / BOL / job<span class="field__req" aria-hidden="true">*</span></span><input class="input" data-field="external_reference" maxlength="20" autocomplete="off"></div>
      ${staff ? `<div class="field field--num"><span class="field__label">Priority</span><select class="select" data-field="is_priority"><option value="">No</option><option value="1" ${state.form.is_priority ? 'selected' : ''}>Yes</option></select></div>` : ''}
    </div>
    ${customer ? '<p class="hint">Your company and contact details are already on file.</p>' : ''}`;

  if (!customer && state.form.movement_kind === 'external') {
    addOptions(hosts.step.querySelector('[data-field="requester_type"]'), EXTERNAL_PARTIES, state.form.requester_type);
    const datalist = hosts.step.querySelector('#company-directory');
    for (const company of state.reference.externalCompanies) {
      const option = document.createElement('option');
      option.value = company.company_name;
      option.label = company.party_type || '';
      datalist.append(option);
    }
  }
  if (!customer && state.form.movement_kind === 'max') {
    addOptions(
      hosts.step.querySelector('[data-field="requester_location_id"]'),
      (state.reference.maxLocations || [])
        .filter(location => location.id !== currentLocation().id)
        .map(location => ({ value: location.id, label: location.name })),
      state.form.requester_location_id,
      'Choose a Max Solutions location',
    );
  }
  const destination = hosts.step.querySelector('[data-field="destination_location_id"]');
  if (destination) {
    addOptions(
      destination,
      context.locations.map(location => ({ value: location.id, label: location.name })),
      currentLocation().id,
      'Choose a Max Solutions location',
    );
  }
  addOptions(hosts.step.querySelector('[data-field="appointment_type_code"]'), state.reference.appointmentTypes, state.form.appointment_type_code, 'Choose an appointment type');
  const skids = hosts.step.querySelector('[data-field="skid_count"]');
  skids.value = String(state.form.skid_count ?? 0);
  const reference = hosts.step.querySelector('[data-field="external_reference"]');
  reference.value = state.form.external_reference;
  const company = hosts.step.querySelector('[data-field="company_name"]');
  if (company) company.value = state.form.company_name;
  const priority = hosts.step.querySelector('[data-field="is_priority"]');
  if (priority) priority.value = state.form.is_priority ? '1' : '';
}

// How full the trailer is, in the destination's own numbers. The skid capacity
// of a truck type is set per location under Settings › Locations and docks, so a
// site that double-stacks says so and its trailers hold more.
function trailerFullness() {
  const capacity = truckCapacity();
  if (!capacity) return '';
  const skids = combinedSkids();
  const free = capacity - skids;
  const truck = selectedName(state.reference.truckTypes, state.form.truck_type_code) || 'This truck';
  if (free < 0) return `${truck} holds ${capacity} skids · ${skids} booked · ${-free} over`;
  return `${truck} holds ${capacity} skids · ${skids} booked · room for ${free} more`;
}

function renderFullness() {
  const note = context.pageRoot.querySelector('[data-fullness]');
  if (!note) return;
  const text = trailerFullness();
  note.textContent = text;
  note.hidden = !text;
}

function renderVehicleStep() {
  hosts.step.innerHTML = `
    <div class="frow">
      <div class="field field--md"><span class="field__label">Truck type<span class="field__req" aria-hidden="true">*</span></span><select class="select" data-field="truck_type_code"></select></div>
      <div class="field field--md"><span class="field__label">Handling<span class="field__req" aria-hidden="true">*</span></span><select class="select" data-field="handling_type_code"></select></div>
      <div class="field field--md"><span class="field__label">Carrier or courier</span><input class="input" data-field="carrier_name" maxlength="120" autocomplete="organization"></div>
    </div>
    <p class="hint hint--flush hint--wide" data-fullness hidden></p>
`;
  addOptions(hosts.step.querySelector('[data-field="truck_type_code"]'), state.reference.truckTypes, state.form.truck_type_code, 'Choose a truck type');
  addOptions(hosts.step.querySelector('[data-field="handling_type_code"]'), state.reference.handlingTypes, state.form.handling_type_code, 'Choose a handling type');
  hosts.step.querySelector('[data-field="carrier_name"]').value = state.form.carrier_name;
  renderFullness();
}

function renderSlotCards() {
  const host = hosts.step.querySelector('[data-slot-list]');
  if (!host) return;
  host.replaceChildren();

  if (state.slotLoading) {
    host.append(element('p', 'hint', 'Finding capacity-ready times…'));
    return;
  }
  if (state.slotError) {
    const message = element('p', 'form-message', state.slotError);
    host.append(message);
    return;
  }
  if (!state.slots.length) {
    host.append(element('p', 'hint hint--wide', selectedMatches().length
      ? `Nothing at ${currentLocation().name} fits ${combinedSkids()} skids in one window. Untick a load to book it separately, or try another date.`
      : 'Choose a date and select “Find available times”.'));
    return;
  }

  // How long this load holds a door, in the destination's own words. The server
  // already worked it out — base plus minutes per skid, the truck's setup time,
  // the appointment and handling adjustments, the buffer, then any full-truck or
  // priority minimum, rounded up to the slot interval — and every slot below is
  // sized to it. Showing it is why a fifty-skid trailer sees fewer times than a
  // four-skid van, which otherwise looks like the list is broken.
  const first = state.slots[0];
  const minutes = format.minutesBetween(first.slot_start, first.slot_end);
  if (minutes > 0) {
    const note = element('p', 'hint hint--flush');
    note.append(
      `This load needs ${format.duration(minutes)} at the dock`,
      element('span', '', ` · ${combinedSkids()} skids · ${selectedName(state.reference.truckTypes, state.form.truck_type_code) || 'selected truck'}`),
      '. Every time below has that much room at ',
      element('strong', '', currentLocation().name),
      '.',
    );
    host.append(note);
  }

  const group = element('div', 'slotpick');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Available appointment times');
  for (const slot of state.slots) {
    const selected = state.form.selected_slot?.slot_start === slot.slot_start;
    const button = element('button', '', `${format.time(slot.slot_start, receivingLocation())}`);
    button.type = 'button';
    button.dataset.action = 'select-slot';
    button.dataset.slot = slot.slot_start;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(selected));
    button.setAttribute('aria-pressed', String(selected));
    const label = [format.date(slot.slot_start, receivingLocation())];
    if (!context.customerShell) {
      label.push(state.form.movement_kind === 'max'
        ? `${clean(slot.recommended_dock_name) || 'Origin dock'} / ${clean(slot.counterpart_dock_name) || 'Destination dock'}`
        : `${slot.available_docks || 1} compatible ${Number(slot.available_docks) === 1 ? 'dock' : 'docks'}`);
    }
    if (slot.capacity_warning) label.push('Capacity warning');
    button.title = label.join(' · ');
    group.append(button);
  }
  host.append(group);
  host.append(element('p', 'hint', 'Live refresh won\'t move this list while you\'re choosing a time.'));
}

function renderTimeStep() {
  const staff = isStaff();
  hosts.step.innerHTML = `
    <div class="frow">
      <div class="field field--md"><span class="field__label">Requested date<span class="field__req" aria-hidden="true">*</span></span><input class="input" data-field="date" type="date" min="${format.inputDate(null, receivingLocation())}"></div>
      <div class="field field--xl field-action"><p class="hint hint--flush">Pick a date, then choose one of the available times below.</p></div>
    </div>
    ${staff ? `
      <label class="check-row check-row--spaced"><input type="checkbox" data-field="after_hours"><span><strong>Request an after-hours time</strong><small>Staff only. The booking RPC verifies the time and records your confirmation.</small></span></label>
      ${state.form.after_hours ? `
        <div class="inline-note inline-note--warning">
          <div class="field field--sm"><span class="field__label">Custom start time</span><input class="input" data-field="custom_time" type="time" step="${Math.max(1, Number(state.reference.settings.slot_interval_minutes || 30)) * 60}"></div>
          <label class="check-row"><input type="checkbox" data-field="after_hours_acknowledged"><span><strong>I confirm this appointment may be outside operating hours</strong><small>This explicit acknowledgement is required before MaxDock sends the override to the booking RPC.</small></span></label>
        </div>` : ''}` : ''}
    <div data-combine-shelf></div>
    ${!state.form.after_hours ? `
      <div class="grouplabel">Available · ${state.form.date ? format.longDateInput(state.form.date, receivingLocation()) : 'choose a date'}</div>
      <div data-slot-list></div>` : ''}`;

  hosts.step.querySelector('[data-field="date"]').value = state.form.date;
  const afterHours = hosts.step.querySelector('[data-field="after_hours"]');
  if (afterHours) afterHours.checked = state.form.after_hours;
  const customTime = hosts.step.querySelector('[data-field="custom_time"]');
  if (customTime) customTime.value = state.form.custom_time;
  const acknowledged = hosts.step.querySelector('[data-field="after_hours_acknowledged"]');
  if (acknowledged) acknowledged.checked = state.form.after_hours_acknowledged;
  renderCombinePicker();
  renderSlotCards();
}

function renderContactStep() {
  // The row always totals twelve columns, and the email gets the larger share of
  // them either way — a work address runs past a field sized for a person's name.
  const external = state.form.movement_kind === 'external';
  hosts.step.innerHTML = `
    <p class="hint hint--lead">These details identify the requester and are included in the confirmation draft.</p>
    <div class="frow">
      <div class="field ${external ? 'field--sm' : 'field--md'}"><span class="field__label">Requester name<span class="field__req" aria-hidden="true">*</span></span><input class="input" data-field="requester_name" maxlength="120" autocomplete="name"></div>
      <div class="field ${external ? 'field--lg' : 'field--xl'}"><span class="field__label">Requester email<span class="field__req" aria-hidden="true">*</span></span><input class="input" data-field="requester_email" type="email" maxlength="180" autocomplete="email"></div>
      ${external ? '<div class="field field--sm"><span class="field__label">Company or organisation</span><input class="input" data-field="company_name" maxlength="120" autocomplete="organization"></div>' : ''}
    </div>`;
  hosts.step.querySelector('[data-field="requester_name"]').value = state.form.requester_name;
  hosts.step.querySelector('[data-field="requester_email"]').value = state.form.requester_email;
  const company = hosts.step.querySelector('[data-field="company_name"]');
  if (company) company.value = state.form.company_name;
}

function summaryRows() {
  const location = currentLocation();
  const counterpart = counterpartLocation();
  const type = selectedName(state.reference.appointmentTypes, state.form.appointment_type_code);
  const truck = selectedName(state.reference.truckTypes, state.form.truck_type_code);
  const handling = selectedName(state.reference.handlingTypes, state.form.handling_type_code);
  const route = state.form.movement_kind === 'max' && counterpart
    ? (state.form.direction === 'inbound' ? `${counterpart.name} → ${location.name}` : `${location.name} → ${counterpart.name}`)
    : (state.form.direction === 'inbound' ? `${clean(state.form.company_name) || state.form.requester_type} → ${location.name}` : `${location.name} → ${clean(state.form.company_name) || state.form.requester_type}`);
  const combined = selectedMatches();
  const capacity = truckCapacity();
  return [
    ['Route', route],
    ['Appointment type', type],
    ['Vehicle', truck + (capacity ? ` · ${capacity} skid trailer` : '')],
    ['Handling', handling],
    ['Skids', `${state.form.skid_count ?? 0} skids${combined.length ? ` · ${combinedSkids()} skids on the truck` : ''}`],
    ['PO / BOL / job', clean(state.form.external_reference) || 'Not entered'],
    ['Date', selectedDate() || 'Not selected'],
    ['Time', selectedTime() || 'Not selected'],
    ['Requester', clean(state.form.requester_name) || 'Not entered'],
    ...(combined.length
      ? [['Combined with', combined.map(match => clean(match.booking_reference) || 'Existing appointment').join(', ')]]
      : []),
  ];
}

// A repeating booking is a pattern, not a set of appointments. The pattern is
// declared once here and MaxDock generates ordinary appointments from it, each
// with its own reference and its own cancel button — because the truck changing
// on one Thursday is the normal case on a dock, not a break in the schedule.
const WEEKDAYS = Object.freeze([
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]);

function repeatDates() {
  return format.repeatingDates({
    from: selectedDate(),
    until: state.form.repeat_until,
    days: state.form.repeat_days,
    intervalWeeks: state.form.repeat_interval_weeks,
  });
}

// How far ahead this site will take a booking at all. Mississauga's window is ten
// days, so "every Wednesday until Christmas" books one Wednesday and the booking
// function refuses the rest — correctly, and until now silently. The repeat says
// so before anything is booked, and the date field will not go past it.
function bookingWindowEnd() {
  const days = Number(state.reference.settings.maximum_advance_days || 0);
  if (!days) return '';
  return format.addDaysInput(format.todayInput(receivingLocation()), days);
}

function renderRepeat() {
  const host = hosts.step.querySelector('[data-repeat]');
  if (!host) return;
  const on = state.form.repeat_on;
  const dates = on ? repeatDates() : [];
  const windowEnd = bookingWindowEnd();
  host.innerHTML = `
    <label class="check-row check-row--spaced"><input type="checkbox" data-field="repeat_on" ${on ? 'checked' : ''}><span><strong>Repeat this booking</strong><small>MaxDock books each date separately, so any one of them can be changed or cancelled on its own.</small></span></label>
    ${on ? `
      <div class="frow">
        <div class="field field--sm"><span class="field__label">Repeat</span><select class="select" data-field="repeat_interval_weeks">
          <option value="1" ${Number(state.form.repeat_interval_weeks) === 1 ? 'selected' : ''}>Every week</option>
          <option value="2" ${Number(state.form.repeat_interval_weeks) === 2 ? 'selected' : ''}>Every 2 weeks</option>
          <option value="3" ${Number(state.form.repeat_interval_weeks) === 3 ? 'selected' : ''}>Every 3 weeks</option>
          <option value="4" ${Number(state.form.repeat_interval_weeks) === 4 ? 'selected' : ''}>Every 4 weeks</option>
        </select></div>
        <div class="field field--md"><span class="field__label">Until<span class="field__req" aria-hidden="true">*</span></span><input class="input" type="date" data-field="repeat_until" min="${escapeHtml(selectedDate() || '')}" ${windowEnd ? `max="${escapeHtml(windowEnd)}"` : ''} value="${escapeHtml(state.form.repeat_until)}"></div>
      </div>
      <div class="grouplabel">On these days</div>
      <div class="daypick">${WEEKDAYS.map(day => `<label class="check-row"><input type="checkbox" data-repeat-day="${day.value}" ${state.form.repeat_days.includes(day.value) ? 'checked' : ''}><span>${day.label}</span></label>`).join('')}</div>
      <p class="hint hint--wide">${dates.length
        ? `${dates.length} appointment${dates.length === 1 ? '' : 's'} at ${escapeHtml(selectedTime() || 'the chosen time')}, first on ${escapeHtml(dates[0])}, last on ${escapeHtml(dates[dates.length - 1])}. Any date with no room is skipped and reported, the rest still book.`
        : 'Pick the days and a last date to see which appointments this will book.'}</p>
      ${windowEnd ? `<p class="inline-note${dates.some(date => date > windowEnd) ? ' inline-note--warning' : ''}">${escapeHtml(currentLocation().name)} takes bookings up to ${Number(state.reference.settings.maximum_advance_days)} days ahead — to ${escapeHtml(windowEnd)}.${dates.some(date => date > windowEnd) ? ' Dates after that will be skipped. Raise the booking window under Settings › Booking window &amp; notice to schedule further out.' : ''}</p>` : ''}` : ''}`;
}

function renderConfirmStep() {
  hosts.step.innerHTML = `
    <p class="hint hint--lead">Review the booking before reserving the dock${state.form.movement_kind === 'max' ? 's' : ''}.</p>
    <div class="card" data-confirm-grid></div>
    <div class="section-gap" data-repeat></div>
    ${state.form.after_hours ? '<div class="inline-note inline-note--warning"><strong>After-hours override</strong><span>Your acknowledgement will be recorded with the booking.</span></div>' : ''}
    <div class="frow">
      <label class="field field--full"><span class="field__label">Notes <span class="field__opt">optional</span></span><textarea class="input" data-field="notes" maxlength="1000" rows="2" placeholder="Handling instructions only — no passwords or personal information."></textarea></label>
    </div>
    <div class="frow">
      <label class="field field--full"><span class="field__label">Save as a shortcut <span class="field__opt">optional</span></span><input class="input" data-field="template_name" maxlength="80" placeholder="Name it — “Mississauga to Guelph”, “Weekly board run”"></label>
    </div>
    ${isStaff() ? `<label class="check-row"><input type="checkbox" data-field="template_shared" ${state.form.template_shared ? 'checked' : ''}><span><strong>Share it with everyone at this site</strong><small>A shared shortcut can be used by anyone here and printed as a QR code for the wall. Only you can change or delete it.</small></span></label>` : ''}`;

  const grid = hosts.step.querySelector('[data-confirm-grid]');
  // Two columns of label-and-value pairs rather than one full-width row each: the
  // summary was a tall ladder with the label at one edge and the value at the
  // other, which is the empty middle the owner objected to.
  grid.className = 'card confirmgrid';
  for (const [label, value] of summaryRows()) {
    const cell = element('div', 'confirmgrid__cell');
    cell.append(element('span', 'confirmgrid__l', label), element('strong', 'confirmgrid__v', value));
    grid.append(cell);
  }
  renderRepeat();
  hosts.step.querySelector('[data-field="notes"]').value = state.form.notes;
  // Naming it is what saves it — a separate checkbox asked the same question twice.
  const name = hosts.step.querySelector('[data-field="template_name"]');
  if (name) name.value = state.form.template_name;
}

function confirmationText(result) {
  const type = selectedName(state.reference.appointmentTypes, state.form.appointment_type_code);
  const truck = selectedName(state.reference.truckTypes, state.form.truck_type_code);
  return [
    `MaxDock appointment ${result.booking_reference}`,
    `${currentLocation().name} — ${format.timestamp(result.start_at, receivingLocation())}`,
    `${state.form.direction === 'inbound' ? 'Inbound' : 'Outbound'} · ${type} · ${truck} · ${state.form.skid_count} skids`,
    `PO / BOL / job: ${state.form.external_reference}`,
    `Requester: ${state.form.requester_name} <${state.form.requester_email}>`,
    `Carrier: ${clean(state.form.carrier_name) || 'Not provided'}`,
    `Status: Scheduled`,
  ].join('\n');
}

// A series confirms as a list of what was booked and what was not. There is no
// one reference to show and no one QR code to print, because there is no one
// appointment — every date is its own booking on My appointments.
function renderSeriesConfirmation() {
  const result = state.confirmation;
  const booked = result.booked || [];
  const skipped = result.skipped || [];
  hosts.step.innerHTML = `
    <div class="booked">
      <span class="tag ${skipped.length ? 'tag--warn' : 'tag--ok'}">✓ ${booked.length} appointment${booked.length === 1 ? '' : 's'} booked</span>
      <h3 class="booked__ref">${escapeHtml(currentLocation().name)}</h3>
      <p class="hint">${skipped.length ? `${skipped.length} date${skipped.length === 1 ? '' : 's'} had no room and ${skipped.length === 1 ? 'was' : 'were'} skipped. Book ${skipped.length === 1 ? 'it' : 'them'} separately at another time.` : 'Every date in the pattern was booked.'}</p>
    </div>
    <div class="card" data-series-list></div>
    <div class="booked__actions">
      <button class="btn btn--quiet" type="button" data-action="book-another">Book another</button>
      <a class="btn btn--primary" href="my-appointments.html">View my appointments</a>
    </div>`;
  const list = hosts.step.querySelector('[data-series-list]');
  for (const entry of booked) {
    const row = element('div', 'setrow');
    row.append(
      element('div', '', `${entry.date} · ${format.time(entry.start_at, receivingLocation())}`),
      element('strong', 'data', entry.booking_reference || ''),
    );
    list.append(row);
  }
  for (const entry of skipped) {
    const row = element('div', 'setrow');
    const left = element('div');
    left.append(element('div', '', entry.date), element('div', 'setrow__d', entry.reason || 'No room that day'));
    row.append(left, element('span', 'tag tag--warn', 'Skipped'));
    list.append(row);
  }
}

function renderConfirmation() {
  const result = state.confirmation;
  if (result?.series_id) { renderSeriesConfirmation(); return; }
  const text = confirmationText(result);
  hosts.step.innerHTML = `
    <div class="booked">
      <span class="tag tag--ok">✓ Appointment booked</span>
      <h3 class="booked__ref">${result.booking_reference}</h3>
      <p class="hint">${currentLocation().name} · ${format.timestamp(result.start_at, receivingLocation())}</p>
    </div>
    <div class="frow">
      <div class="card field--xl" data-confirmation-details></div>
      <div class="card field--md booked__qr">
        <div class="qr-frame" data-qr></div>
        <p class="hint">QR check-in code<br>Generated locally in this browser.</p>
      </div>
    </div>
    <div class="booked__actions">
      <button class="btn btn--quiet" type="button" data-action="copy-confirmation">Copy confirmation</button>
      <a class="btn btn--quiet" data-email-draft>Open email draft</a>
      <button class="btn btn--quiet" type="button" data-action="book-another">Book another</button>
      <a class="btn btn--primary" href="my-appointments.html">View my appointments</a>
    </div>`;

  const details = hosts.step.querySelector('[data-confirmation-details]');
  for (const [label, value] of summaryRows()) {
    const row = element('div', 'setrow');
    row.append(element('div', 'setrow__d', label), element('strong', '', value));
    details.append(row);
  }
  renderCheckInCode(result);
  const subject = encodeURIComponent(`MaxDock appointment ${result.booking_reference}`);
  const body = encodeURIComponent(text);
  hosts.step.querySelector('[data-email-draft]').href = `mailto:${encodeURIComponent(state.form.requester_email)}?subject=${subject}&body=${body}`;
  hosts.step.dataset.confirmationText = text;
}

function renderStep() {
  hosts.message.textContent = '';
  if (state.confirmation) {
    renderConfirmation();
    return;
  }
  switch (state.step) {
    case 0: renderLoadStep(); break;
    case 1: renderVehicleStep(); break;
    case 2: renderTimeStep(); break;
    case 3: renderContactStep(); break;
    default: renderConfirmStep(); break;
  }
}

function renderActions() {
  hosts.actions.replaceChildren();
  if (state.confirmation) return;
  const back = element('button', 'btn btn--quiet', state.step > 0 ? 'Back' : 'Cancel');
  back.type = 'button';
  back.dataset.action = state.step > 0 ? 'back' : 'close-booking';
  hosts.actions.append(back);
  // The button says how many bookings it is about to make. "Book appointment" on
  // a control that creates nine of them is the wrong promise.
  const repeatCount = state.form.repeat_on ? repeatDates().length : 0;
  const bookLabel = repeatCount > 1 ? `Book ${repeatCount} appointments` : 'Book appointment';
  const primary = element('button', 'btn btn--primary', state.step === STEPS.length - 1 ? bookLabel : 'Continue');
  primary.type = 'button';
  primary.dataset.action = state.step === STEPS.length - 1 ? 'book' : 'continue';
  primary.disabled = state.busy;
  hosts.actions.append(primary);
}

function renderAll() {
  renderSteps();
  renderStep();
  renderActions();
}

function setMessage(message) {
  hosts.message.textContent = message || '';
  if (message) hosts.message.scrollIntoView({ block: 'nearest' });
}

function clearSlotSelection() {
  state.slots = [];
  state.form.selected_slot = null;
  state.slotError = '';
  state.sameDayAccepted = false;
}

function validateStep(step = state.step) {
  const form = state.form;
  if (step === 0) {
    if (context.customerShell && context.locations.length > 1 && !form.destination_location_id) return 'Choose the Max Solutions location you are sending to.';
    if (!form.appointment_type_code) return 'Choose an appointment type.';
    if (!state.reference.appointmentTypes.some(item => item.code === form.appointment_type_code)) return 'Choose an appointment type enabled at this location.';
    if (!clean(String(form.skid_count ?? ''))) return 'Enter the skid count.';
    if (Number(form.skid_count) < 0 || !Number.isFinite(Number(form.skid_count))) return 'Enter a valid skid count.';
    if (!clean(form.external_reference)) return 'Enter the PO, BOL or job number.';
    if (form.movement_kind === 'max' && !form.requester_location_id) return 'Choose the other Max Solutions location.';
    if (form.movement_kind === 'external' && !clean(form.requester_type)) return 'Choose the external party type.';
  }
  if (step === 1) {
    if (!form.truck_type_code) return 'Choose a truck type.';
    if (!state.reference.truckTypes.some(item => item.code === form.truck_type_code)) return 'Choose a truck type enabled at this location.';
    if (!form.handling_type_code) return 'Choose a handling type.';
    if (!state.reference.handlingTypes.some(item => item.code === form.handling_type_code)) return 'Choose a handling type enabled at this location.';
  }
  if (step === 2) {
    if (!form.date) return 'Choose a requested date.';
    if (form.after_hours) {
      if (!isStaff()) return 'Customer appointments cannot be booked after hours.';
      if (!form.custom_time) return 'Choose the custom start time.';
      if (!form.after_hours_acknowledged) return 'Confirm the after-hours warning before continuing.';
    } else if (!form.selected_slot) {
      return 'Choose one available appointment time.';
    }
  }
  if (step === 3) {
    if (!clean(form.requester_name)) return 'Enter the requester name.';
    if (!clean(form.requester_email) || !form.requester_email.includes('@')) return 'Enter a valid requester email.';
  }
  if (step === 4 && form.repeat_on) {
    if (!form.repeat_days.length) return 'Choose at least one day for the repeat.';
    if (!form.repeat_until) return 'Choose the last date for the repeat.';
    if (form.after_hours) return 'A repeating booking cannot use an after-hours time.';
  }
  return '';
}

function setStep(next) {
  const target = Math.max(0, Math.min(STEPS.length - 1, Number(next)));
  if (state.step === 2 && target !== 2) poll.resume(SLOT_SUSPENSION);
  state.step = target;
  state.maxStep = Math.max(state.maxStep, target);
  if (target === 2) poll.suspend(SLOT_SUSPENSION);
  renderAll();
  hosts.step.focus();
  if (target !== 2) return;
  // An after-hours request never asks for slots, so it would never reach the
  // code that looks for loads to combine with. Ask for them directly.
  if (state.form.after_hours) loadCombinable().then(renderCombinePicker);
  else if (!state.slots.length) findSlots();
  else renderCombinePicker();
}

async function findSlots(options = {}) {
  const loadError = validateStep(0);
  const vehicleError = validateStep(1);
  if (loadError || vehicleError) {
    setMessage(loadError || vehicleError);
    return [];
  }
  state.slotLoading = true;
  state.slotError = '';
  if (!options.quiet) renderTimeStep();
  // Loads that could travel together are found before the times are, because a
  // combined load needs a longer window and the times have to reflect that.
  if (!options.keepCombinable) await loadCombinable();
  if (!options.quiet) renderCombinePicker();

  const routed = state.form.movement_kind === 'max';
  const rpcName = routed ? 'list_routed_appointment_slots' : 'list_capacity_aware_appointment_slots';
  const args = {
    p_location_id: currentLocation().id,
    ...(routed ? { p_requester_location_id: state.form.requester_location_id } : {}),
    p_date: state.form.date,
    p_direction: state.form.direction,
    p_appointment_type_code: state.form.appointment_type_code,
    p_truck_type_code: state.form.truck_type_code,
    p_skid_count: combinedSkids(),
    p_handling_type_code: state.form.handling_type_code,
    p_is_priority: isStaff() && Boolean(state.form.is_priority),
    p_preferred_start_time: state.form.preferred_start_time || null,
    p_preferred_end_time: state.form.preferred_end_time || null,
    p_search_days: 7,
  };

  try {
    const rows = await db.rpc(rpcName, args, {
      key: `booking:slots:${rpcName}:${crypto.randomUUID()}`,
      select: context.customerShell && !routed ? CUSTOMER_SLOT_PROJECTION : undefined,
      retry: 0,
      userMessage: 'Available appointment times could not be loaded.',
    });
    state.slots = Array.isArray(rows) ? rows : [];
    if (state.form.selected_slot && !state.slots.some(slot => slot.slot_start === state.form.selected_slot.slot_start)) {
      state.form.selected_slot = null;
    }
    return state.slots;
  } catch (error) {
    state.slots = [];
    state.form.selected_slot = null;
    state.slotError = error.userMessage || 'Available appointment times could not be loaded.';
    return [];
  } finally {
    state.slotLoading = false;
    if (!options.quiet && state.step === 2) renderTimeStep();
  }
}

async function slotStillAvailable() {
  if (state.form.after_hours || !state.form.selected_slot) return true;
  const selected = state.form.selected_slot.slot_start;
  const rows = await findSlots({ quiet: true });
  const match = rows.find(slot => slot.slot_start === selected);
  if (!match) {
    state.form.selected_slot = null;
    setStep(2);
    toast('That time was just taken. Choose another available time.', 'error');
    return false;
  }
  state.form.selected_slot = match;
  return true;
}

function partyMatches(record) {
  if (context.customerShell) return true;
  if (state.form.movement_kind === 'max') {
    return clean(record.requester_location_id) === clean(state.form.requester_location_id)
      || clean(record.display_counterpart_location_id) === clean(state.form.requester_location_id);
  }
  const company = clean(state.form.company_name).toLowerCase();
  if (!company) return true;
  return clean(record.company_name).toLowerCase() === company;
}

// Two loads are combinable if they land close enough together. "Close enough" is
// the same calendar day by default, or a window of N hours either side when the
// location has configured one.
function withinConsolidationWindow(startAt, targetDate, timezone, sameDayOnly) {
  const hours = Number(state.reference.settings.consolidation_window_hours || 0);
  // The picker runs before a time is chosen, so an hours-either-side window has
  // nothing to measure from. It offers the whole day and the narrower window
  // still applies to the guard that runs at submit.
  if (!hours || sameDayOnly) return format.sameLocalDate(startAt, targetDate, { timezone });
  const target = state.form.selected_slot?.slot_start || `${targetDate}T${selectedTime() || '00:00'}`;
  return Math.abs(format.minutesBetween(target, startAt)) <= hours * 60;
}

async function findSameDayAppointments(options = {}) {
  if (!state.reference.settings.suggest_same_day_consolidation) return [];
  const targetDate = selectedDate();
  if (!targetDate) return [];
  const sameDayOnly = Boolean(options.sameDayOnly);

  if (context.customerShell) {
    const rows = await db.rpc('list_my_appointments', {}, {
      key: `booking:consolidation:mine:${crypto.randomUUID()}`,
      retry: 0,
      userMessage: 'Existing appointments could not be checked.',
    });
    return (rows || []).filter(record =>
      !TERMINAL_STATUSES.has(clean(record.status).toLowerCase())
      && record.location_name === currentLocation().name
      && clean(record.direction).toLowerCase() === state.form.direction
      && withinConsolidationWindow(record.start_at, targetDate, record.location_timezone, sameDayOnly)
    );
  }

  const rows = await db.rpc('list_location_schedule', { p_location_id: currentLocation().id }, {
    key: `booking:consolidation:schedule:${currentLocation().id}:${crypto.randomUUID()}`,
    retry: 0,
    userMessage: 'Existing appointments could not be checked.',
  });
  return (rows || []).map(row => row.schedule_record || row).filter(record =>
    record.entry_kind === 'appointment'
    && !TERMINAL_STATUSES.has(clean(record.status).toLowerCase())
    && clean(record.display_direction || record.direction).toLowerCase() === state.form.direction
    && withinConsolidationWindow(record.start_at, targetDate, currentLocation().timezone, sameDayOnly)
    && partyMatches(record)
  );
}

function renderConsolidationMatches(matches) {
  hosts.consolidationList.replaceChildren();
  for (const match of matches.slice(0, 4)) {
    const row = element('div', 'setrow');
    const left = element('div');
    left.append(
      element('strong', 'data', match.booking_reference || 'Existing appointment'),
      element('div', 'setrow__d', `${format.date(match.start_at, currentLocation())} · ${format.time(match.start_at, currentLocation())}`),
    );
    const right = element('span', 'setrow__d', `${match.skid_count ?? 0} skids · ${clean(match.carrier_name) || 'Carrier not listed'}`);
    row.append(left, right);
    hosts.consolidationList.append(row);
  }
}

// ---------------------------------------------------------------------------
// Combining loads
//
// The same-day matches are offered on the Time step, where they can change the
// answer: ticking one adds its skids to this load, and the times below are
// re-fetched for the combined skid count. Nothing is merged in the database —
// MaxDock records which references travel together in the appointment notes and
// leaves the existing appointments exactly as they are.
// ---------------------------------------------------------------------------

function matchKey(record) {
  return String(record.id || record.appointment_id || record.booking_reference || '');
}

function selectedMatches() {
  return state.combineMatches.filter(match => state.combineSelected.includes(matchKey(match)));
}

function combinedSkids() {
  return Number(state.form.skid_count || 0)
    + selectedMatches().reduce((total, match) => total + Number(match.skid_count || 0), 0);
}

function truckCapacity() {
  const truck = (state.reference.truckTypes || []).find(row => row.code === state.form.truck_type_code);
  const capacity = Number(truck?.skid_capacity || 0);
  return capacity > 0 ? capacity : 0;
}

async function loadCombinable() {
  state.combineMatches = [];
  if (!state.form.date) {
    state.combineSelected = [];
    return;
  }
  state.combineLoading = true;
  try {
    state.combineMatches = await findSameDayAppointments({ sameDayOnly: true });
  } catch {
    state.combineMatches = [];
  } finally {
    state.combineLoading = false;
  }
  const live = new Set(state.combineMatches.map(matchKey));
  state.combineSelected = state.combineSelected.filter(key => live.has(key));
}

function combineSummary() {
  const chosen = selectedMatches();
  if (!chosen.length) return '';
  const capacity = truckCapacity();
  const total = combinedSkids();
  const parts = [`Combined load ${total} skids across ${chosen.length + 1} appointments`];
  if (capacity) {
    const free = capacity - total;
    parts.push(free >= 0
      ? `${total} of ${capacity} skids on the trailer · ${free} skid${free === 1 ? '' : 's'} free`
      : `${total - capacity} skid${total - capacity === 1 ? '' : 's'} over the ${capacity}-skid trailer`);
  }
  return parts.join(' · ');
}

function renderCombinePicker() {
  const shelf = hosts.step.querySelector('[data-combine-shelf]');
  if (!shelf) return;
  if (state.combineLoading) {
    shelf.innerHTML = '<p class="hint hint--flush">Checking that day for loads you could combine with…</p>';
    return;
  }
  if (!state.combineMatches.length) {
    shelf.replaceChildren();
    return;
  }
  const overCapacity = truckCapacity() && combinedSkids() > truckCapacity();
  shelf.innerHTML = `
    <div class="grouplabel">Combine with</div>
    <p class="hint hint--flush hint--wide">${state.combineMatches.length} other ${state.form.direction} load${state.combineMatches.length === 1 ? '' : 's'} already booked that day. Tick the ones travelling with this shipment and the times below are recalculated for the combined skid count.</p>
    <div class="pickgroup">
      ${state.combineMatches.map(match => {
        const key = matchKey(match);
        const checked = state.combineSelected.includes(key);
        return `<label class="check-row"><input type="checkbox" data-combine="${escapeHtml(key)}"${checked ? ' checked' : ''}><span><strong>${escapeHtml(match.booking_reference || 'Existing appointment')} · ${escapeHtml(format.time(match.start_at, currentLocation()))}</strong><small>${Number(match.skid_count || 0)} skids · ${escapeHtml(clean(match.carrier_name) || 'Carrier not listed')}${match.company_name ? ` · ${escapeHtml(match.company_name)}` : ''}</small></span></label>`;
      }).join('')}
    </div>
    ${selectedMatches().length ? `<p class="inline-note${overCapacity ? ' inline-note--warning' : ''}">${escapeHtml(combineSummary())}</p>` : ''}`;
}

async function toggleCombine(key, checked) {
  state.combineSelected = checked
    ? [...new Set([...state.combineSelected, key])]
    : state.combineSelected.filter(entry => entry !== key);
  // Ticking a load is a decision, and the wizard must not ask about these loads
  // again at the end. It used to, which put the user in a loop: choose loads,
  // come back, get asked the same question, choose loads again.
  state.combineReviewed = true;
  if (state.form.after_hours) {
    renderCombinePicker();
    return;
  }
  // The times are re-fetched for the combined load, so the chosen one has to be
  // re-checked rather than thrown away. Clearing it silently sent the user back
  // to the time step with nothing selected and no idea why.
  const wanted = state.form.selected_slot?.slot_start || null;
  clearSlotSelection();
  const slots = await findSlots({ keepCombinable: true });
  if (!wanted) return;
  const stillThere = slots.find(slot => slot.slot_start === wanted);
  if (stillThere) {
    state.form.selected_slot = stillThere;
    renderTimeStep();
  } else {
    setMessage(`${combinedSkids()} skids no longer fits at that time. Choose another time below.`);
  }
}

async function saveTemplate() {
  if (!clean(state.form.template_name)) return null;
  const values = {
    owner_user_id: context.user.id,
    location_id: currentLocation().id,
    name: clean(state.form.template_name),
    direction: state.form.direction,
    requester_type: state.form.movement_kind === 'max' ? counterpartLocation()?.name || 'Max Solutions' : state.form.requester_type,
    company_name: state.form.movement_kind === 'max' ? counterpartLocation()?.name || null : clean(state.form.company_name) || null,
    appointment_type_code: state.form.appointment_type_code,
    truck_type_code: state.form.truck_type_code,
    skid_count: Number(state.form.skid_count || 0),
    handling_type_code: state.form.handling_type_code,
    is_priority: isStaff() && Boolean(state.form.is_priority),
    carrier_name: clean(state.form.carrier_name) || null,
    preferred_start_time: state.form.preferred_start_time || null,
    preferred_end_time: state.form.preferred_end_time || null,
    is_shared: isStaff() && Boolean(state.form.template_shared),
  };
  const saved = await db.insert('booking_templates', values, {
    key: `booking:template:save:${crypto.randomUUID()}`,
    retry: 0,
    userMessage: 'The booking was created, but the template could not be saved.',
  });
  db.invalidate('booking:templates:');
  state.reference.templates = [saved, ...state.reference.templates];
  return saved;
}

// Nothing in the database merges two appointments, and nothing should — each one
// keeps its own reference, its own requester and its own audit trail. What the
// combined booking carries is the note that says which loads travel together, so
// the dock, the board and the confirmation all read the same thing.
function combinedNotes() {
  const notes = clean(state.form.notes);
  const references = selectedMatches()
    .map(match => clean(match.booking_reference))
    .filter(Boolean);
  if (!references.length) return notes || null;
  const line = `Combined load — travelling with ${references.join(', ')}.`;
  return notes ? `${notes}\n${line}` : line;
}

// The series carries the load details as defaults and the pattern beside them.
// The server books each date through the ordinary booking function, so the
// notice period, the capacity check, the direction windows and the dock
// selection all apply exactly as they would to a single booking.
function seriesArgs() {
  const routed = state.form.movement_kind === 'max';
  return {
    p_location_id: currentLocation().id,
    p_name: clean(state.form.template_name) || null,
    p_direction: state.form.direction,
    p_requester_type: routed ? counterpartLocation()?.name || 'Max Solutions' : state.form.requester_type,
    p_company_name: routed ? counterpartLocation()?.name || null : clean(state.form.company_name) || null,
    p_requester_location_id: routed ? state.form.requester_location_id : null,
    p_appointment_type_code: state.form.appointment_type_code,
    p_truck_type_code: state.form.truck_type_code,
    p_skid_count: Number(state.form.skid_count || 0),
    p_handling_type_code: state.form.handling_type_code,
    p_is_priority: isStaff() && Boolean(state.form.is_priority),
    p_requester_name: clean(state.form.requester_name),
    p_requester_email: clean(state.form.requester_email).toLowerCase(),
    p_external_reference: clean(state.form.external_reference),
    p_carrier_name: clean(state.form.carrier_name) || null,
    p_notes: combinedNotes(),
    p_start_time: selectedTime(),
    p_days_of_week: state.form.repeat_days,
    p_interval_weeks: Number(state.form.repeat_interval_weeks || 1),
    p_starts_on: selectedDate(),
    p_ends_on: state.form.repeat_until || null,
  };
}

function bookingArgs() {
  const routed = state.form.movement_kind === 'max';
  return {
    p_location_id: currentLocation().id,
    p_date: selectedDate(),
    p_start_time: selectedTime(),
    p_direction: state.form.direction,
    p_requester_type: routed ? counterpartLocation()?.name || 'Max Solutions' : state.form.requester_type,
    p_appointment_type_code: state.form.appointment_type_code,
    p_truck_type_code: state.form.truck_type_code,
    p_skid_count: Number(state.form.skid_count || 0),
    p_handling_type_code: state.form.handling_type_code,
    p_is_priority: isStaff() && Boolean(state.form.is_priority),
    p_requester_name: clean(state.form.requester_name),
    p_requester_email: clean(state.form.requester_email).toLowerCase(),
    p_external_reference: clean(state.form.external_reference),
    p_company_name: routed ? counterpartLocation()?.name || null : clean(state.form.company_name) || null,
    p_requester_location_id: routed ? state.form.requester_location_id : null,
    p_carrier_name: clean(state.form.carrier_name) || null,
    p_notes: combinedNotes(),
    p_after_hours_confirmed: isStaff() && state.form.after_hours && state.form.after_hours_acknowledged,
  };
}

async function submitBooking() {
  state.busy = true;
  renderActions();
  setMessage('');
  try {
    if (!(await slotStillAvailable())) return;
    const routed = state.form.movement_kind === 'max';
    const result = state.form.repeat_on
      ? await db.rpc('create_appointment_series', seriesArgs(), {
        key: `booking:series:${crypto.randomUUID()}`,
        retry: 0,
        userMessage: 'The repeating booking could not be created.',
      })
      : await db.rpc(routed ? 'book_routed_appointment' : 'book_appointment', bookingArgs(), {
        key: `booking:create:${crypto.randomUUID()}`,
        retry: 0,
        userMessage: 'The appointment could not be booked.',
      });
    try {
      await saveTemplate();
    } catch (templateError) {
      toast(templateError.userMessage || 'The appointment was booked, but the template could not be saved.', 'error');
    }
    state.confirmation = result;
    poll.resume(SLOT_SUSPENSION);
    renderAll();
    toast(result.series_id
      ? `${result.booked_count} appointment${result.booked_count === 1 ? '' : 's'} booked.`
      : `Appointment ${result.booking_reference} booked.`, 'success');
  } catch (error) {
    setMessage(error.userMessage || 'The appointment could not be booked. Review the details and try again.');
  } finally {
    state.busy = false;
    renderActions();
  }
}

async function attemptBooking() {
  const error = validateStep(4);
  if (error) {
    setMessage(error);
    return;
  }
  if (!state.sameDayAccepted && !state.combineReviewed) {
    try {
      // Loads already ticked on the Time step are a decision, not a surprise —
      // only the ones left unticked are worth stopping the booking for. And once
      // the picker has been opened at all, the question has been asked: coming
      // back to the end of the wizard must not ask it a second time.
      const chosen = new Set(state.combineSelected);
      const matches = (await findSameDayAppointments()).filter(match => !chosen.has(matchKey(match)));
      if (matches.length) {
        state.sameDayMatches = matches;
        renderConsolidationMatches(matches);
        sameDayModal.open({ trigger: hosts.actions.querySelector('[data-action="book"]') });
        return;
      }
    } catch (error) {
      toast(error.userMessage || 'MaxDock could not check same-day appointments. The booking has not been submitted.', 'error');
      return;
    }
  }
  await submitBooking();
}

function applyTemplate(template) {
  if (!template) return;
  if (template.location_id !== currentLocation().id) {
    const url = new URL(globalThis.location.href);
    url.searchParams.set('location', template.location_id);
    url.searchParams.set('template', template.id);
    globalThis.location.assign(url.href);
    return;
  }
  state.form.direction = context.customerShell ? 'inbound' : template.direction;
  const matchingLocation = context.locations.find(location => location.name === template.requester_type || location.name === template.company_name);
  state.form.movement_kind = !context.customerShell && matchingLocation && matchingLocation.id !== currentLocation().id ? 'max' : 'external';
  state.form.requester_location_id = state.form.movement_kind === 'max' ? matchingLocation.id : null;
  state.form.requester_type = template.requester_type;
  state.form.company_name = template.company_name || state.form.company_name;
  state.form.appointment_type_code = template.appointment_type_code;
  state.form.truck_type_code = template.truck_type_code;
  state.form.skid_count = Number(template.skid_count || 0);
  state.form.handling_type_code = template.handling_type_code;
  state.form.is_priority = isStaff() && Boolean(template.is_priority);
  state.form.carrier_name = template.carrier_name || '';
  state.form.preferred_start_time = clean(template.preferred_start_time).slice(0, 5);
  state.form.preferred_end_time = clean(template.preferred_end_time).slice(0, 5);
  clearSlotSelection();
  state.step = 0;
  state.maxStep = Math.max(state.maxStep, 1);
  renderAll();
  toast(`Template “${template.name}” loaded.`, 'success');
}

// A shortcut is a saved booking plus a way to reach it without a keyboard.
//
// The link is the booking page with the location and the template on it — the
// page has understood that pair since templates were built, so nothing new has
// to be trusted. The QR is drawn in this browser from that link; no appointment
// data and no identifier leaves the machine to make it.
function openShortcut(template, trigger) {
  if (!template) return;
  const location = context.locations.find(item => item.id === template.location_id);
  const url = new URL('book.html', globalThis.location.href);
  url.searchParams.set('location', template.location_id);
  url.searchParams.set('template', template.id);
  shortcutUrl = url.href;

  const truck = selectedName(state.reference.truckTypes, template.truck_type_code, template.truck_type_code);
  const type = selectedName(state.reference.appointmentTypes, template.appointment_type_code, template.appointment_type_code);
  const party = clean(template.company_name) || clean(template.requester_type) || 'Not named';
  const route = clean(template.direction).toLowerCase() === 'outbound'
    ? `${location?.name || 'Here'} → ${party}`
    : `${party} → ${location?.name || 'Here'}`;

  hosts.shortcutBackdrop.querySelector('[data-shortcut-name]').textContent = template.name;
  hosts.shortcutBackdrop.querySelector('[data-shortcut-sub]').textContent = template.is_shared
    ? 'Shared with everyone at this site'
    : 'Yours only — turn on sharing to let others use it';
  hosts.shortcutBackdrop.querySelector('[data-shortcut-heading]').textContent = route;
  hosts.shortcutBackdrop.querySelector('[data-shortcut-detail]').textContent =
    `${type} · ${truck} · ${Number(template.skid_count || 0)} skids`;
  hosts.shortcutBackdrop.querySelector('[data-shortcut-url]').textContent = shortcutUrl;
  renderQr(hosts.shortcutBackdrop.querySelector('[data-shortcut-qr]'), shortcutUrl, {
    label: `Quick book shortcut for ${template.name}`,
  });
  shortcutModal.open({ trigger });
}

// Printed from its own window rather than by printing the page behind it: the
// dock board is not what anybody is taping to a wall. The card carries the same
// markup and the same stylesheet, so what comes out of the printer is what was
// on screen.
function printShortcut() {
  const card = hosts.shortcutBackdrop.querySelector('[data-shortcut-card]');
  const popup = globalThis.open('', 'maxdock-shortcut', 'popup=yes,width=720,height=560');
  if (!popup) { toast('Allow pop-ups to print the shortcut.', 'error'); return; }
  const href = new URL('../assets/maxdock.css', import.meta.url).href;
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <title>MaxDock quick book shortcut</title>
    <link rel="stylesheet" href="${escapeHtml(href)}"></head>
    <body class="shortcut-print"><div class="shortcut">${card.innerHTML}</div></body></html>`);
  popup.document.close();
  popup.addEventListener('load', () => { popup.focus(); popup.print(); });
}

async function removeTemplate() {
  const id = deleteTemplateId;
  if (!id) return;
  try {
    await db.remove('booking_templates', query => query
      .eq('id', id)
      .eq('owner_user_id', context.user.id), {
      key: `booking:template:delete:${id}:${crypto.randomUUID()}`,
      retry: 0,
      userMessage: 'The booking template could not be deleted.',
    });
    state.reference.templates = state.reference.templates.filter(template => template.id !== id);
    db.invalidate('booking:templates:');
    deleteTemplateModal.close();
    deleteTemplateId = null;
    if (state.step === 0) renderStep();
    toast('Booking template deleted.', 'success');
  } catch (error) {
    toast(error.userMessage || 'The booking template could not be deleted.', 'error');
  }
}

async function reloadReferenceForLocation() {
  try {
    state.reference = await loadReferenceData();
  } catch (error) {
    toast(error.userMessage || 'This location’s booking options could not be loaded.', 'error');
  }
  renderStep();
}

function updateField(target) {
  const field = target.dataset.field;
  if (!field) return;
  const previous = state.form[field];
  let value = target.type === 'checkbox' ? target.checked : target.value;
  if (field === 'skid_count') value = Number(value || 0);
  // Priority is a yes/no select now rather than a checkbox, so an empty string
  // means no — without this the form would store "" and read it as truthy nowhere
  // but compare unequal on every re-render.
  if (field === 'is_priority') value = Boolean(value);
  state.form[field] = value;

  const slotFields = new Set([
    'date', 'after_hours', 'custom_time',
    'appointment_type_code', 'truck_type_code', 'skid_count', 'handling_type_code', 'is_priority', 'requester_location_id',
  ]);
  const slotFieldChanged = slotFields.has(field) && previous !== value;
  if (slotFieldChanged) clearSlotSelection();
  if (field === 'truck_type_code' || field === 'skid_count') renderFullness();
  if (field.startsWith('repeat_')) {
    // Ticking Repeat opens the pattern controls, and every control inside it
    // changes which dates the summary line names.
    if (field === 'repeat_on' && value && !state.form.repeat_days.length && selectedDate()) {
      state.form.repeat_days = [format.dayOfWeek(selectedDate())];
    }
    renderRepeat();
    renderActions();
    return;
  }
  if (field === 'after_hours' && !value) {
    state.form.custom_time = '';
    state.form.after_hours_acknowledged = false;
  }
  if (field === 'destination_location_id') {
    state.form.location_id = currentLocation().id;
    state.form.appointment_type_code = '';
    state.form.truck_type_code = '';
    state.form.handling_type_code = '';
    state.form.date = format.inputDate(null, currentLocation());
    clearSlotSelection();
    reloadReferenceForLocation();
    return;
  }
  if (field === 'after_hours' || field === 'movement_kind' || field === 'direction') renderStep();
  // Turning after-hours back off has to re-fetch: switching it on cleared the
  // slot list, and this branch used to exclude the very field that emptied it, so
  // the times never came back until the date was changed.
  if (slotFieldChanged && state.step === 2 && !state.form.after_hours) findSlots();
}

async function handleAction(button) {
  const action = button.dataset.action;
  if (action === 'close-booking') {
    context.onClose?.();
  } else if (action === 'continue') {
    const error = validateStep();
    if (error) setMessage(error);
    else setStep(state.step + 1);
  } else if (action === 'back') {
    setStep(state.step - 1);
  } else if (action === 'go-step') {
    const target = Number(button.dataset.step);
    if (target <= state.maxStep) setStep(target);
  } else if (action === 'set-direction') {
    state.form.direction = button.dataset.value;
    clearSlotSelection();
    renderAll();
  } else if (action === 'set-movement') {
    state.form.movement_kind = button.dataset.value;
    state.form.requester_location_id = null;
    clearSlotSelection();
    renderAll();
  } else if (action === 'find-slots') {
    await findSlots();
  } else if (action === 'select-slot') {
    state.form.selected_slot = state.slots.find(slot => slot.slot_start === button.dataset.slot) || null;
    state.sameDayAccepted = false;
    renderTimeStep();
  } else if (action === 'book') {
    await attemptBooking();
  } else if (action === 'view-existing') {
    globalThis.location.assign('my-appointments.html?view=upcoming');
  } else if (action === 'combine-load') {
    // Back to the Time step, where the loads are listed with a tick box beside
    // each one. It used to land on step one with nothing to tick and a red line
    // telling the user to work it out themselves.
    sameDayModal.close();
    state.sameDayAccepted = false;
    state.combineReviewed = true;
    state.step = 2;
    state.maxStep = Math.max(state.maxStep, 4);
    renderAll();
    setMessage('');
    hosts.step.querySelector('[data-combine]')?.focus();
  } else if (action === 'continue-separately') {
    state.sameDayAccepted = true;
    sameDayModal.close();
    await submitBooking();
  } else if (action === 'shortcut-template') {
    openShortcut(state.reference.templates.find(template => template.id === button.dataset.templateId), button);
  } else if (action === 'dismiss-shortcut') {
    shortcutModal.close();
  } else if (action === 'copy-shortcut') {
    try {
      await navigator.clipboard.writeText(shortcutUrl);
      toast('Shortcut link copied.', 'success');
    } catch {
      toast('The shortcut link could not be copied.', 'error');
    }
  } else if (action === 'print-shortcut') {
    printShortcut();
  } else if (action === 'use-template') {
    applyTemplate(state.reference.templates.find(template => template.id === button.dataset.templateId));
  } else if (action === 'delete-template') {
    deleteTemplateId = button.dataset.templateId;
    deleteTemplateModal.open({ trigger: button });
  } else if (action === 'dismiss-template-delete') {
    deleteTemplateId = null;
    deleteTemplateModal.close();
  } else if (action === 'confirm-template-delete') {
    await removeTemplate();
  } else if (action === 'copy-confirmation') {
    try {
      await navigator.clipboard.writeText(hosts.step.dataset.confirmationText || '');
      toast('Appointment confirmation copied.', 'success');
    } catch {
      toast('The confirmation could not be copied.', 'error');
    }
  } else if (action === 'book-another') {
    state = {
      ...state,
      step: 0,
      maxStep: 0,
      form: createInitialForm(),
      slots: [],
      slotLoading: false,
      slotError: '',
      sameDayMatches: [],
      sameDayAccepted: false,
      combineMatches: [],
      combineSelected: [],
      combineReviewed: false,
      combineLoading: false,
      confirmation: null,
      busy: false,
    };
    renderAll();
  }
}

function bindInteractions() {
  // A checkbox fires both input and change; the combine picker re-fetches times,
  // so it answers to change alone rather than doing the round trip twice.
  const onInput = event => {
    const combineKey = event.target.dataset?.combine;
    if (combineKey !== undefined) {
      if (event.type === 'change') toggleCombine(combineKey, event.target.checked);
      return;
    }
    const repeatDay = event.target.dataset?.repeatDay;
    if (repeatDay !== undefined) {
      if (event.type !== 'change') return;
      const day = Number(repeatDay);
      state.form.repeat_days = event.target.checked
        ? [...new Set([...state.form.repeat_days, day])].sort((a, b) => a - b)
        : state.form.repeat_days.filter(entry => entry !== day);
      renderRepeat();
      renderActions();
      return;
    }
    updateField(event.target);
  };
  const onClick = event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    event.preventDefault();
    handleAction(button);
  };
  context.pageRoot.addEventListener('input', onInput);
  context.pageRoot.addEventListener('change', onInput);
  context.pageRoot.addEventListener('click', onClick);
  cleanup.push(() => context.pageRoot.removeEventListener('input', onInput));
  cleanup.push(() => context.pageRoot.removeEventListener('change', onInput));
  cleanup.push(() => context.pageRoot.removeEventListener('click', onClick));
}

async function applyRequestedTemplate() {
  const templateId = new URLSearchParams(globalThis.location.search).get('template');
  if (!templateId) return;
  const template = state.reference.templates.find(item => item.id === templateId);
  if (template) applyTemplate(template);
}

const page = {
  code: 'book',
  permission: 'appointment.create',

  async mount(pageContext) {
    context = pageContext;
    if (!context.onClose) document.title = 'Book appointment · MaxDock';
    const reference = await loadReferenceData();
    state = {
      step: 0,
      maxStep: 0,
      form: createInitialForm(),
      reference,
      slots: [],
      slotLoading: false,
      slotError: '',
      sameDayMatches: [],
      sameDayAccepted: false,
      combineMatches: [],
      combineSelected: [],
      combineReviewed: false,
      combineLoading: false,
      confirmation: null,
      busy: false,
    };
    buildShell();
    bindInteractions();
    renderAll();
    await applyRequestedTemplate();
  },

  poll: {
    interval: 5000,
    fetch: async () => ({ checked_at: format.nowIso() }),
  },

  async refresh() {
    // Booking does not re-render on the five-second heartbeat. The heartbeat is
    // explicitly suspended while the slot picker is open and slots are
    // revalidated immediately before the booking RPC is called.
  },

  destroy() {
    poll.resume(SLOT_SUSPENSION);
    sameDayModal?.destroy();
    deleteTemplateModal?.destroy();
    shortcutModal?.destroy();
    for (const fn of cleanup.splice(0)) fn();
    context = null;
    state = null;
    hosts = null;
  },
};

if (globalThis.location.pathname.endsWith('book.html')) startPage(page);

export const { mount, refresh, destroy } = page;
