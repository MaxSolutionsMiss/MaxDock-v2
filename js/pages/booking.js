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

function isStaff() {
  return !context.customerShell;
}

function currentLocation() {
  return context.location;
}

function counterpartLocation() {
  return context.locations.find(location => location.id === state.form.requester_location_id) || null;
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
  };
}

async function loadEnabledRows(mappingTable, codeColumn, masterTable, locationId) {
  const mappings = await db.select(mappingTable, query => query
    .select(codeColumn)
    .eq('location_id', locationId)
    .eq('is_active', true), {
    key: `booking:${mappingTable}:${locationId}`,
    cache: 300000,
    retry: 1,
    userMessage: 'The enabled booking options could not be loaded.',
  });
  const codes = (mappings || []).map(row => row[codeColumn]);
  if (!codes.length) return [];
  return db.select(masterTable, query => query
    .select('code, name, sort_order')
    .in('code', codes)
    .eq('is_active', true)
    .order('sort_order'), {
    key: `booking:${masterTable}:${locationId}`,
    cache: 300000,
    retry: 1,
    userMessage: 'The enabled booking options could not be loaded.',
  });
}

async function loadTemplates() {
  return db.select('booking_templates', query => query
    .select('id, owner_user_id, location_id, name, direction, requester_type, company_name, appointment_type_code, truck_type_code, skid_count, handling_type_code, is_priority, carrier_name, preferred_start_time, preferred_end_time, created_at, updated_at')
    .eq('owner_user_id', context.user.id)
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
    loadEnabledRows('location_truck_types', 'truck_type_code', 'truck_types', locationId),
    loadEnabledRows('location_handling_types', 'handling_type_code', 'handling_types', locationId),
    db.select('location_settings', query => query
      .select('slot_interval_minutes, suggest_same_day_consolidation, consolidation_window_hours')
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
          <button class="btn btn--quiet" type="button" data-action="combine-load">Go back and combine</button>
          <button class="btn btn--primary" type="button" data-action="continue-separately">Continue separately</button>
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

function renderQuickRebook() {
  if (!state.reference.templates.length) return '';
  const items = state.reference.templates.slice(0, 4).map(template => {
    const location = context.locations.find(item => item.id === template.location_id);
    return `<div class="rebook"><div class="integ__ico">${template.name.slice(0, 1).toUpperCase()}</div>
      <div class="rebook__body"><div class="rebook__ref">${template.name}</div><div class="rebook__det">${location?.name || 'Location'} · ${selectedName(state.reference.truckTypes, template.truck_type_code, template.truck_type_code)}</div></div>
      <button class="btn btn--primary btn--sm" type="button" data-action="use-template" data-template-id="${template.id}">Use</button>
      <button class="btn btn--quiet btn--sm" type="button" data-action="delete-template" data-template-id="${template.id}">Delete</button></div>`;
  }).join('');
  return `<div class="field__label" style="margin-bottom:var(--s2)">Quick rebook — saved templates</div><div>${items}</div><p class="hint">Use a template to prefill this booking, then continue through the steps.</p>`;
}

function renderLoadStep() {
  const customer = context.customerShell;
  const staff = isStaff();
  // One row. The direction and movement choices were two full-width blocks of
  // button cards that pushed the actual fields below the fold on a laptop; as
  // selects they carry the same meaning in a fraction of the height.
  hosts.step.innerHTML = `
    ${renderQuickRebook()}
    <div class="frow">
      ${customer ? '' : `
        <div class="field field--sm"><span class="field__label">Direction</span><select class="select" data-field="direction">
          <option value="inbound" ${state.form.direction === 'inbound' ? 'selected' : ''}>Inbound</option>
          <option value="outbound" ${state.form.direction === 'outbound' ? 'selected' : ''}>Outbound</option>
        </select></div>
        <div class="field field--sm"><span class="field__label">Movement</span><select class="select" data-field="movement_kind">
          <option value="external" ${state.form.movement_kind === 'external' ? 'selected' : ''}>External</option>
          <option value="max" ${state.form.movement_kind === 'max' ? 'selected' : ''}>Max-to-Max</option>
        </select></div>`}
      ${!customer && state.form.movement_kind === 'external' ? `
        <div class="field field--sm"><span class="field__label">Party type</span><select class="select" data-field="requester_type"></select></div>
        <div class="field field--sm"><span class="field__label">Company</span><input class="input" data-field="company_name" list="company-directory" maxlength="120" autocomplete="organization"><datalist id="company-directory"></datalist></div>
        <div class="field field--md"><span class="field__label">Appointment type</span><select class="select" data-field="appointment_type_code"></select></div>` : ''}
      ${!customer && state.form.movement_kind === 'max' ? `
        <div class="field field--md"><span class="field__label">Other Max location</span><select class="select" data-field="requester_location_id"></select></div>
        <div class="field field--md"><span class="field__label">Appointment type</span><select class="select" data-field="appointment_type_code"></select></div>` : ''}
      ${customer ? '<div class="field field--full"><span class="field__label">Appointment type</span><select class="select" data-field="appointment_type_code"></select></div>' : ''}
    </div>
    <div class="frow">
      <div class="field field--num"><span class="field__label">Skids</span><input class="input" data-field="skid_count" type="number" min="0" max="9999" inputmode="numeric"></div>
      <div class="field field--${staff ? 'xl' : 'xxl'}"><span class="field__label">PO / BOL / job number</span><input class="input" data-field="external_reference" maxlength="120" autocomplete="off"></div>
      ${staff ? '<div class="field field--num"><span class="field__label">Priority</span><select class="select" data-field="is_priority"><option value="">No</option><option value="1">Yes</option></select></div>' : ''}
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
      context.locations
        .filter(location => location.id !== currentLocation().id)
        .map(location => ({ value: location.id, label: location.name })),
      state.form.requester_location_id,
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

function renderVehicleStep() {
  hosts.step.innerHTML = `
    <div class="frow">
      <div class="field field--md"><span class="field__label">Truck type</span><select class="select" data-field="truck_type_code"></select></div>
      <div class="field field--md"><span class="field__label">Handling</span><select class="select" data-field="handling_type_code"></select></div>
      <div class="field field--md"><span class="field__label">Carrier or courier</span><input class="input" data-field="carrier_name" maxlength="120" autocomplete="organization"></div>
    </div>
`;
  addOptions(hosts.step.querySelector('[data-field="truck_type_code"]'), state.reference.truckTypes, state.form.truck_type_code, 'Choose a truck type');
  addOptions(hosts.step.querySelector('[data-field="handling_type_code"]'), state.reference.handlingTypes, state.form.handling_type_code, 'Choose a handling type');
  hosts.step.querySelector('[data-field="carrier_name"]').value = state.form.carrier_name;
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
    host.append(element('p', 'hint', 'Choose a date and select “Find available times”.'));
    return;
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
      <div class="field field--md"><span class="field__label">Requested date</span><input class="input" data-field="date" type="date" min="${format.inputDate(null, receivingLocation())}"></div>
      <div class="field field--md"><span class="field__label">Preferred start</span><input class="input" data-field="preferred_start_time" type="time"></div>
      <div class="field field--md"><span class="field__label">Preferred end</span><input class="input" data-field="preferred_end_time" type="time"></div>
    </div>
    ${staff ? `
      <label class="check-row" style="margin-top:var(--s4)"><input type="checkbox" data-field="after_hours"><span><strong>Request an after-hours time</strong><small>Staff only. The booking RPC verifies the time and records your confirmation.</small></span></label>
      ${state.form.after_hours ? `
        <div class="inline-note inline-note--warning">
          <div class="field field--sm"><span class="field__label">Custom start time</span><input class="input" data-field="custom_time" type="time" step="${Math.max(1, Number(state.reference.settings.slot_interval_minutes || 30)) * 60}"></div>
          <label class="check-row"><input type="checkbox" data-field="after_hours_acknowledged"><span><strong>I confirm this appointment may be outside operating hours</strong><small>This explicit acknowledgement is required before MaxDock sends the override to the booking RPC.</small></span></label>
        </div>` : ''}` : ''}
    ${!state.form.after_hours ? `
      <div class="field__label" style="margin:var(--s4) 0 var(--s2)">Available · ${state.form.date ? format.longDateInput(state.form.date, receivingLocation()) : 'choose a date'}</div>
      <div data-slot-list></div>` : ''}`;

  hosts.step.querySelector('[data-field="date"]').value = state.form.date;
  hosts.step.querySelector('[data-field="preferred_start_time"]').value = state.form.preferred_start_time;
  hosts.step.querySelector('[data-field="preferred_end_time"]').value = state.form.preferred_end_time;
  const afterHours = hosts.step.querySelector('[data-field="after_hours"]');
  if (afterHours) afterHours.checked = state.form.after_hours;
  const customTime = hosts.step.querySelector('[data-field="custom_time"]');
  if (customTime) customTime.value = state.form.custom_time;
  const acknowledged = hosts.step.querySelector('[data-field="after_hours_acknowledged"]');
  if (acknowledged) acknowledged.checked = state.form.after_hours_acknowledged;
  renderSlotCards();
}

function renderContactStep() {
  // The row always totals twelve columns, and the email gets the larger share of
  // them either way — a work address runs past a field sized for a person's name.
  const external = state.form.movement_kind === 'external';
  hosts.step.innerHTML = `
    <p class="hint" style="margin:0 0 var(--s4)">These details identify the requester and are included in the confirmation draft.</p>
    <div class="frow">
      <div class="field ${external ? 'field--sm' : 'field--md'}"><span class="field__label">Requester name</span><input class="input" data-field="requester_name" maxlength="120" autocomplete="name"></div>
      <div class="field ${external ? 'field--lg' : 'field--xl'}"><span class="field__label">Requester email</span><input class="input" data-field="requester_email" type="email" maxlength="180" autocomplete="email"></div>
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
  return [
    ['Route', route],
    ['Appointment type', type],
    ['Vehicle', truck],
    ['Handling', handling],
    ['Skids', String(state.form.skid_count ?? 0)],
    ['PO / BOL / job', clean(state.form.external_reference) || 'Not entered'],
    ['Date', selectedDate() || 'Not selected'],
    ['Time', selectedTime() || 'Not selected'],
    ['Requester', clean(state.form.requester_name) || 'Not entered'],
  ];
}

function renderConfirmStep() {
  hosts.step.innerHTML = `
    <p class="hint" style="margin:0 0 var(--s3)">Review the booking before reserving the dock${state.form.movement_kind === 'max' ? 's' : ''}.</p>
    <div class="card" data-confirm-grid></div>
    ${state.form.after_hours ? '<div class="inline-note inline-note--warning"><strong>After-hours override</strong><span>Your acknowledgement will be recorded with the booking.</span></div>' : ''}
    <div class="frow">
      <label class="field field--full"><span class="field__label">Notes <span class="field__opt">optional</span></span><textarea class="input" data-field="notes" maxlength="1000" rows="2" placeholder="Handling instructions only — no passwords or personal information."></textarea></label>
    </div>
    <div class="frow">
      <label class="field field--full"><span class="field__label">Save as template <span class="field__opt">optional</span></span><input class="input" data-field="template_name" maxlength="80" placeholder="Name it to save these load and vehicle details"></label>
    </div>`;

  const grid = hosts.step.querySelector('[data-confirm-grid]');
  for (const [label, value] of summaryRows()) {
    const row = element('div', 'setrow');
    row.append(element('div', 'setrow__d', label), element('strong', '', value));
    grid.append(row);
  }
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

function renderConfirmation() {
  const result = state.confirmation;
  const text = confirmationText(result);
  hosts.step.innerHTML = `
    <div style="text-align:center;padding:var(--s4) 0">
      <span class="tag tag--ok" style="font-size:var(--t-base);padding:4px 10px">✓ Appointment booked</span>
      <h3 style="margin:var(--s2) 0;font-family:var(--font-data);font-size:var(--t-metric);color:var(--dock-deep)">${result.booking_reference}</h3>
      <p class="hint">${currentLocation().name} · ${format.timestamp(result.start_at, receivingLocation())}</p>
    </div>
    <div class="frow">
      <div class="card field--xl" data-confirmation-details></div>
      <div class="card field--md" style="text-align:center">
        <div class="qr-frame" data-qr></div>
        <p class="hint">QR check-in code<br>Generated locally in this browser.</p>
      </div>
    </div>
    <div class="modal__foot" style="margin-top:var(--s4);border:none;background:none;padding:0;flex-wrap:wrap">
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
  renderQr(hosts.step.querySelector('[data-qr]'), `MAXDOCK|${result.appointment_id}|${result.booking_reference}`, {
    label: `QR code for MaxDock appointment ${result.booking_reference}`,
  });
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
  const primary = element('button', 'btn btn--primary', state.step === STEPS.length - 1 ? 'Book appointment' : 'Continue');
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
    if (!form.appointment_type_code) return 'Choose an appointment type.';
    if (!state.reference.appointmentTypes.some(item => item.code === form.appointment_type_code)) return 'Choose an appointment type enabled at this location.';
    if (Number(form.skid_count) < 0 || !Number.isFinite(Number(form.skid_count))) return 'Enter a valid skid count.';
    if (!clean(form.external_reference)) return 'Enter the PO, BOL or job number.';
    if (form.movement_kind === 'max' && !form.requester_location_id) return 'Choose the other Max Solutions location.';
    if (form.movement_kind === 'max' && !context.hasLocation(form.requester_location_id)) return 'Choose a Max Solutions location assigned to your account.';
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
  if (target === 2 && !state.form.after_hours && !state.slots.length) findSlots();
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

  const routed = state.form.movement_kind === 'max';
  const rpcName = routed ? 'list_routed_appointment_slots' : 'list_capacity_aware_appointment_slots';
  const args = {
    p_location_id: currentLocation().id,
    ...(routed ? { p_requester_location_id: state.form.requester_location_id } : {}),
    p_date: state.form.date,
    p_direction: state.form.direction,
    p_appointment_type_code: state.form.appointment_type_code,
    p_truck_type_code: state.form.truck_type_code,
    p_skid_count: Number(state.form.skid_count || 0),
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
function withinConsolidationWindow(startAt, targetDate, timezone) {
  const hours = Number(state.reference.settings.consolidation_window_hours || 0);
  if (!hours) return format.sameLocalDate(startAt, targetDate, { timezone });
  const target = state.form.selected_slot?.slot_start || `${targetDate}T${selectedTime() || '00:00'}`;
  return Math.abs(format.minutesBetween(target, startAt)) <= hours * 60;
}

async function findSameDayAppointments() {
  if (!state.reference.settings.suggest_same_day_consolidation) return [];
  const targetDate = selectedDate();
  if (!targetDate) return [];

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
      && withinConsolidationWindow(record.start_at, targetDate, record.location_timezone)
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
    && withinConsolidationWindow(record.start_at, targetDate, currentLocation().timezone)
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
    p_notes: clean(state.form.notes) || null,
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
    const result = await db.rpc(routed ? 'book_routed_appointment' : 'book_appointment', bookingArgs(), {
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
    toast(`Appointment ${result.booking_reference} booked.`, 'success');
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
  if (!state.sameDayAccepted) {
    try {
      const matches = await findSameDayAppointments();
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
    'date', 'preferred_start_time', 'preferred_end_time', 'after_hours', 'custom_time',
    'appointment_type_code', 'truck_type_code', 'skid_count', 'handling_type_code', 'is_priority', 'requester_location_id',
  ]);
  const slotFieldChanged = slotFields.has(field) && previous !== value;
  if (slotFieldChanged) clearSlotSelection();
  if (field === 'after_hours' && !value) {
    state.form.custom_time = '';
    state.form.after_hours_acknowledged = false;
  }
  if (field === 'after_hours') renderStep();
  if (slotFieldChanged && field !== 'after_hours' && state.step === 2 && !state.form.after_hours) findSlots();
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
    sameDayModal.close();
    state.sameDayAccepted = false;
    state.step = 0;
    state.maxStep = Math.max(state.maxStep, 4);
    renderAll();
    setMessage('Review the existing appointment and adjust the skid count or reference to combine the load.');
    hosts.step.querySelector('[data-field="skid_count"]')?.focus();
  } else if (action === 'continue-separately') {
    state.sameDayAccepted = true;
    sameDayModal.close();
    await submitBooking();
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
      confirmation: null,
      busy: false,
    };
    renderAll();
  }
}

function bindInteractions() {
  const onInput = event => updateField(event.target);
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
    for (const fn of cleanup.splice(0)) fn();
    context = null;
    state = null;
    hosts = null;
  },
};

if (globalThis.location.pathname.endsWith('book.html')) startPage(page);

export const { mount, refresh, destroy } = page;
