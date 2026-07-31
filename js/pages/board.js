import { startPage } from '../router.js';
import { db } from '../db.js';
import { createModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { renderState } from '../ui/empty.js';
import { pageHead, controlsBar, searchField } from '../ui/pagehead.js';
import { createCustomizePanel } from '../ui/customize.js';
import { openWall, paintWall } from '../ui/wall.js';
import { renderTimeline, fitTimelineBlocks, watchTimelineFit, clockLabel } from '../ui/timeline.js';
import { createAppointmentDetails } from '../ui/appointment-details.js';
import { createCombineDialog, laneForRecord, laneDescription } from '../ui/combine-loads.js';
import { format } from '../format.js';

const state = {
  context: null,
  date: format.todayInput(),
  docks: [],
  hours: null,
  records: [],
  filters: { direction: 'all', status: 'all', search: '' },
  elements: {},
  blockModal: null,
  editModal: null,
  editingRecord: null,
  reference: null,
  customizePanel: null,
  visibleCards: [],
  blockFields: [],
  fit: 'window',
  wall: null,
  granularity: 30,
  truckTypeNames: new Map(),
  truckCapacity: new Map(),
  detailsModal: null,
  combineDialog: null,
  signature: '',
};

const KPI_CARDS = [
  { id: 'appointments', label: 'Appointments', className: '', compute: (appts) => appts.length },
  // Trucks and skids answer different questions — how many vehicles are coming
  // through the gate, and how much is on them. A day of 20 trucks carrying two
  // skids each is nothing like a day of 20 carrying twenty, so both are here and
  // either can be switched off.
  { id: 'inboundTrucks', label: 'Inbound trucks', className: 'kpi--out', compute: appts => appts.filter(r => r.direction === 'inbound').length },
  { id: 'outboundTrucks', label: 'Outbound trucks', className: 'kpi--ok', compute: appts => appts.filter(r => r.direction === 'outbound').length },
  { id: 'inbound', label: 'Inbound skids', className: 'kpi--out', compute: appts => appts.filter(r => r.direction === 'inbound').reduce((sum, r) => sum + Number(r.skid_count || 0), 0) },
  { id: 'outbound', label: 'Outbound skids', className: 'kpi--ok', compute: appts => appts.filter(r => r.direction === 'outbound').reduce((sum, r) => sum + Number(r.skid_count || 0), 0) },
  { id: 'active', label: 'Active trucks', className: 'kpi--signal', compute: appts => appts.filter(r => ['arrived', 'loading', 'unloading'].includes(r.status)).length },
  { id: 'blocked', label: 'Blocked docks', className: 'kpi--stop', compute: (appts, blocks) => blocks.length },
];
const DEFAULT_CARDS = KPI_CARDS.map(card => card.id);

// What each appointment block carries, in the order it is read: which booking,
// what is happening to it, where it is going, when, and what is on the truck.
// The block only has room for so many of these, so which ones matter is the
// reader's call rather than a decision baked into the page — a receiver wants
// the skid count, a coordinator wants the carrier, and a wall display wants
// whichever two still fit at a glance.
const BLOCK_FIELDS = [
  { id: 'reference', label: 'Reference' },
  { id: 'status', label: 'Status' },
  { id: 'route', label: 'From / To' },
  { id: 'time', label: 'Time' },
  { id: 'truck', label: 'Truck type' },
  { id: 'skids', label: 'Skids' },
  { id: 'carrier', label: 'Carrier' },
  { id: 'po', label: 'PO / BOL / job' },
  { id: 'combined', label: 'Combined loads' },
];
const DEFAULT_BLOCK_FIELDS = ['reference', 'status', 'route', 'time', 'truck', 'skids', 'combined'];

const GRANULARITIES = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
];

const BLOCK_REASONS = ['Maintenance', 'Cleaning', 'Staff break', 'Shift change', 'Event', 'Inventory count', 'Equipment down', 'Weather', 'Other'];

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'no_show']);
// What each choice in the Status filter actually matches. It used to compare the
// option's value against the status directly, and the option said "complete"
// while every finished appointment says "completed" — so picking it emptied a
// board that was full of them. A filter is a group, not a spelling: a truck on
// the dock being loaded is still Arrived to the person looking for it, and a
// no-show belongs with the cancellations rather than nowhere.
const STATUS_FILTERS = {
  scheduled: new Set(['scheduled', 'confirmed']),
  arrived: new Set(['arrived', 'in_progress']),
  complete: new Set(['completed']),
  'no-show': new Set(['no_show']),
};

// Cancelled loads do not reach the board at all. A no-show is not one of them —
// the truck was expected and did not come, which is something the day has to
// account for, so it stays on the schedule.
const isCancelled = record => record?.status === 'cancelled' || !!record?.merged_into_appointment_id;

// update_appointment_details is restricted to System Admin / Site Admin server-side.
// A linked movement is the mirrored view of another site's appointment, so it must be
// edited from the site that physically owns it.
function canEditRecord(record) {
  if (!record || record.entry_kind !== 'appointment') return false;
  if (record.is_linked_movement) return false;
  if (TERMINAL_STATUSES.has(record.status)) return false;
  if (!can('appointment.update')) return false;
  return ['system_admin', 'site_admin'].includes(state.context?.profile?.role_code);
}

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const can = permission => state.context?.can?.(permission);
// What one truck of that type holds at this site. Zero means the site has not
// entered it, which the combine dialog says out loud rather than treating as empty.
const capacityFor = code => Number(state.truckCapacity.get(code) || 0);

function normalizeRecord(row) {
  const record = row?.schedule_record || row || {};
  return {
    ...record,
    id: record.id || record.appointment_id,
    dock_id: record.display_dock_id || record.dock_id,
    direction: record.display_direction || record.direction || 'inbound',
    entry_kind: record.entry_kind || 'appointment',
    status: record.status || 'scheduled',
  };
}

async function fetchBoardData() {
  const locationId = state.context.location.id;
  const day = format.dayOfWeek(state.date);
  const [, scheduleRows, docks, hours, truckTypes, truckCapacities] = await Promise.all([
    db.rpc('settle_due_appointments', { p_location_id: locationId }, { key: `board:settle:${locationId}`, cache: 0, retry: 0 }).catch(() => 0),
    db.rpc('list_location_schedule', { p_location_id: locationId }, { key: `board:schedule:${locationId}`, cache: 0, retry: 1 }),
    db.select('docks', query => query.select('id,name,description,sort_order,direction_mode,is_active').eq('location_id', locationId).eq('is_active', true).order('sort_order').order('name'), { key: `board:docks:${locationId}`, cache: 30000 }),
    db.select('location_operating_hours', query => query.select('day_of_week,is_open,open_time,close_time').eq('location_id', locationId).eq('day_of_week', day).maybeSingle(), { key: `board:hours:${locationId}:${day}`, cache: 30000 }),
    db.select('truck_types', query => query.select('code,name').eq('is_active', true), { key: 'board:truck-type-names', cache: 300000 }),
    // What each truck type holds at this site, so combining from a block can say how
    // full the surviving truck ends up rather than merging blind. Advisory: a site
    // that has not entered its capacities still gets the board.
    db.select('location_truck_types', query => query.select('truck_type_code,skid_capacity').eq('location_id', locationId), { key: `board:truck-capacity:${locationId}`, cache: 60000 }).catch(() => []),
  ]);
  const selectedDate = state.date;
  return {
    docks: docks || [],
    hours: hours || null,
    truckTypeNames: new Map((truckTypes || []).map(type => [type.code, type.name])),
    truckCapacity: new Map((truckCapacities || []).map(row => [row.truck_type_code, Number(row.skid_capacity || 0)])),
    records: (scheduleRows || []).map(normalizeRecord).filter(record => {
      if (!record.start_at) return false;
      // A cancelled load is not work any more. Leaving it on the board doubles
      // the number of things to read past on a day that is already full, and it
      // is worst exactly where it matters most — a combine leaves its cancelled
      // half sitting beside the truck that is actually carrying the freight. It
      // is still there to be found by its number, in the appointment window.
      if (isCancelled(record)) return false;
      return format.sameLocalDate(record.start_at, selectedDate, state.context.location);
    }),
  };
}

async function loadEnabledTypes(mappingTable, codeColumn, masterTable) {
  const locationId = state.context.location.id;
  const mappings = await db.select(mappingTable, query => query.select(codeColumn).eq('location_id', locationId).eq('is_active', true), {
    key: `board:${mappingTable}:${locationId}`, cache: 300000, retry: 1,
  });
  const codes = (mappings || []).map(row => row[codeColumn]);
  if (!codes.length) return [];
  return db.select(masterTable, query => query.select('code,name,sort_order').in('code', codes).eq('is_active', true).order('sort_order'), {
    key: `board:${masterTable}:${locationId}`, cache: 300000, retry: 1,
  });
}

async function loadEditReference() {
  if (state.reference) return state.reference;
  const [appointmentTypes, truckTypes, handlingTypes] = await Promise.all([
    loadEnabledTypes('location_appointment_types', 'appointment_type_code', 'appointment_types'),
    loadEnabledTypes('location_truck_types', 'truck_type_code', 'truck_types'),
    loadEnabledTypes('location_handling_types', 'handling_type_code', 'handling_types'),
  ]);
  state.reference = { appointmentTypes: appointmentTypes || [], truckTypes: truckTypes || [], handlingTypes: handlingTypes || [] };
  return state.reference;
}

function optionList(rows, selected) {
  return rows.map(row => `<option value="${escapeHtml(row.code)}" ${row.code === selected ? 'selected' : ''}>${escapeHtml(row.name)}</option>`).join('');
}

async function openEditModal(record, trigger) {
  state.editingRecord = record;
  const reference = await loadEditReference();
  const form = state.elements.editForm;
  form.reset();
  state.elements.editTitle.textContent = record.booking_reference || 'Edit appointment';
  state.elements.editSub.textContent = `${format.role(record.direction)} · ${record.company_name || record.display_counterpart_location_name || 'Scheduled movement'}`;
  form.elements.date.value = format.inputDate(record.start_at, state.context.location);
  form.elements.start_time.value = format.inputTime(record.start_at, state.context.location);
  form.elements.dock_id.innerHTML = state.docks.map(dock => `<option value="${dock.id}" ${dock.id === record.dock_id ? 'selected' : ''}>${escapeHtml(dock.name)}</option>`).join('');
  form.elements.direction.value = record.direction;
  form.elements.company_name.value = record.company_name || '';
  form.elements.appointment_type_code.innerHTML = optionList(reference.appointmentTypes, record.appointment_type_code);
  form.elements.truck_type_code.innerHTML = optionList(reference.truckTypes, record.truck_type_code);
  form.elements.handling_type_code.innerHTML = optionList(reference.handlingTypes, record.handling_type_code);
  form.elements.skid_count.value = record.skid_count ?? 0;
  form.elements.requester_name.value = record.requester_name || '';
  form.elements.requester_email.value = record.requester_email || '';
  form.elements.carrier_name.value = record.carrier_name || '';
  form.elements.external_reference.value = record.external_reference || '';
  form.elements.notes.value = record.notes || '';
  const prioritySwitch = form.querySelector('[data-priority-switch]');
  prioritySwitch.classList.toggle('switch--off', !record.is_priority);
  prioritySwitch.setAttribute('aria-pressed', String(Boolean(record.is_priority)));
  state.elements.editMessage.textContent = '';
  state.elements.editHistory.innerHTML = '<p class="hint">Loading history…</p>';
  state.editModal.open({ trigger });

  try {
    const history = await db.rpc('get_appointment_history', { p_appointment_id: record.id }, { key: `board:history:${record.id}`, cache: 15000, retry: 1 });
    state.elements.editHistory.innerHTML = (history || []).length
      ? (history || []).map(entry => `<div class="watchitem"><span class="wdot" style="--c:var(--dock)"></span><div><b>${escapeHtml(format.role(entry.action))} · ${escapeHtml(entry.changed_by_name || 'MaxDock')}</b>${escapeHtml(entry.summary || '')} <span class="sub">${escapeHtml(format.timestamp(entry.changed_at, state.context.location))}</span></div></div>`).join('')
      : '<p class="hint">No history recorded for this appointment.</p>';
  } catch {
    state.elements.editHistory.innerHTML = '<p class="hint">The change history could not be loaded.</p>';
  }
}

async function submitEdit(event) {
  event.preventDefault();
  const form = state.elements.editForm;
  const submit = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  submit.disabled = true;
  state.elements.editMessage.textContent = '';
  try {
    await db.rpc('update_appointment_details', {
      p_appointment_id: state.editingRecord.id,
      p_date: data.get('date'),
      p_start_time: data.get('start_time'),
      p_dock_id: data.get('dock_id'),
      p_direction: data.get('direction'),
      p_company_name: data.get('company_name') || null,
      p_appointment_type_code: data.get('appointment_type_code'),
      p_truck_type_code: data.get('truck_type_code'),
      p_skid_count: Number(data.get('skid_count')),
      p_handling_type_code: data.get('handling_type_code'),
      p_is_priority: form.querySelector('[data-priority-switch]').getAttribute('aria-pressed') === 'true',
      p_requester_name: data.get('requester_name'),
      p_requester_email: data.get('requester_email'),
      p_carrier_name: data.get('carrier_name') || null,
      p_external_reference: data.get('external_reference'),
      p_notes: data.get('notes') || null,
    }, { key: `board:edit:${state.editingRecord.id}:${crypto.randomUUID()}`, retry: 0 });
    db.invalidate('rpc:list_location_schedule');
    db.invalidate('board:schedule:');
    db.invalidate('queue:schedule:');
    db.invalidate(`board:history:${state.editingRecord.id}`);
    state.editModal.close();
    toast('Appointment updated.', 'success');
    patchData(await fetchBoardData());
  } catch (error) {
    // The RPC rejects hour, slot-alignment, capacity and conflict violations by name;
    // surface its own wording rather than a generic failure.
    state.elements.editMessage.textContent = error.userMessage || error.message || 'The appointment could not be updated.';
  } finally {
    submit.disabled = false;
  }
}

function buildShell(root) {
  root.innerHTML = `
    ${pageHead('Dock board', { subtitleAttribute: 'data-board-subtitle', actions: ['export', 'print', 'fullscreen', 'customize'] })}
    ${controlsBar({
      label: 'Dock board controls',
      lead: `<div class="ctrl-field"><label for="board-date">Date</label><div class="datenav">
        <button class="iconbtn" type="button" data-day="-1" aria-label="Previous day">‹</button>
        <button class="btn btn--quiet btn--sm" type="button" data-today>Today</button>
        <input class="input input--date" type="date" id="board-date" data-board-date>
        <button class="iconbtn" type="button" data-day="1" aria-label="Next day">›</button>
      </div></div>`,
      filters: `<div class="ctrl-field"><label for="board-direction">Direction</label><select class="select" id="board-direction" data-filter-direction><option value="all">All movements</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></div>
      <div class="ctrl-field"><label for="board-status">Status</label><select class="select" id="board-status" data-filter-status><option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="arrived">Arrived</option><option value="complete">Complete</option><option value="no-show">No show</option></select></div>
      ${searchField({ id: 'board-search', placeholder: 'Reference, company, PO', attribute: 'data-filter-search' })}`,
      trailing: [['block', can('block.manage')], ['book', can('appointment.create')]],
    })}
    <section class="kpis" aria-label="Dock board summary" data-kpis></section>
    <section class="board" data-board-host aria-label="Dock schedule"></section>
    <div class="scrim" data-block-backdrop hidden aria-hidden="true">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="block-title">
        <div class="modal__head"><div><h2 class="modal__title" id="block-title">Block dock time</h2><p class="modal__sub">Reserve one or more docks for maintenance, breaks or operational constraints.</p></div><button class="modal__x" type="button" data-close-block aria-label="Close">×</button></div>
        <form data-block-form>
          <div class="modal__body">
            <div class="frow">
              <label class="field field--sm"><span class="field__label">Date</span><input class="input" type="date" name="date" required></label>
              <label class="field field--sm"><span class="field__label">Start time</span><input class="input" type="time" name="start_time" required></label>
              <label class="field field--num"><span class="field__label">Duration</span><span class="inputwrap"><input class="input" type="number" name="duration_hours" min="0.5" max="168" step="0.5" value="1" required><span class="input__unit">hours</span></span></label>
              <label class="field field--sm"><span class="field__label">Reason</span><select class="select" name="reason" required>${BLOCK_REASONS.map(reason => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`).join('')}</select></label>
            </div>
            <div class="frow">
              <label class="field field--full"><span class="field__label">Note <span class="field__opt">optional</span></span><input class="input" name="notes" maxlength="500" placeholder="Anything the reason does not cover"></label>
            </div>
            <fieldset class="dock-checks"><legend>Select docks</legend><div data-dock-checks></div></fieldset>
          </div>
          <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close-block>Cancel</button><button class="btn btn--primary" type="submit">Block selected docks</button></div>
        </form>
      </section>
    </div>
    <div class="scrim" data-edit-backdrop hidden aria-hidden="true">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-appointment-title">
        <div class="modal__head"><div><h2 class="modal__title" id="edit-appointment-title" data-edit-title>Edit appointment</h2><p class="modal__sub" data-edit-sub></p></div><button class="modal__x" type="button" data-close-edit aria-label="Close">×</button></div>
        <form data-edit-form>
          <div class="modal__body">
            <div class="frow">
              <label class="field field--sm"><span class="field__label">Date</span><input class="input" type="date" name="date" required></label>
              <label class="field field--sm"><span class="field__label">Start time</span><input class="input" type="time" name="start_time" required></label>
              <label class="field field--sm"><span class="field__label">Dock</span><select class="select" name="dock_id" required></select></label>
              <label class="field field--sm"><span class="field__label">Direction</span><select class="select" name="direction"><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></label>
            </div>
            <div class="frow">
              <label class="field field--md"><span class="field__label">Appointment type</span><select class="select" name="appointment_type_code"></select></label>
              <label class="field field--sm"><span class="field__label">Truck type</span><select class="select" name="truck_type_code"></select></label>
              <label class="field field--sm"><span class="field__label">Handling</span><select class="select" name="handling_type_code"></select></label>
              <label class="field field--xs"><span class="field__label">Skids</span><input class="input" type="number" min="0" name="skid_count" required></label>
            </div>
            <div class="frow">
              <label class="field field--md"><span class="field__label">Company</span><input class="input" name="company_name" maxlength="120"></label>
              <label class="field field--md"><span class="field__label">Carrier</span><input class="input" name="carrier_name" maxlength="120"></label>
              <label class="field field--md"><span class="field__label">PO / BOL / job</span><input class="input" name="external_reference" maxlength="80" required></label>
            </div>
            <div class="frow">
              <label class="field field--lg"><span class="field__label">Requester name</span><input class="input" name="requester_name" maxlength="120" required></label>
              <label class="field field--lg"><span class="field__label">Requester email</span><input class="input" type="email" name="requester_email" maxlength="160" required></label>
            </div>
            <div class="setrow"><div><div class="setrow__t">Priority load</div><div class="setrow__d">Applies this location's priority minimum duration</div></div><button type="button" class="switch" data-priority-switch aria-label="Priority load"></button></div>
            <label class="field field--full"><span class="field__label">Notes</span><textarea name="notes" rows="2" maxlength="500"></textarea></label>
            <p class="form-message" data-edit-message aria-live="polite"></p>
            <h3 class="watch__t">Change history</h3>
            <div data-edit-history></div>
          </div>
          <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close-edit>Cancel</button><button class="btn btn--primary" type="submit">Save changes</button></div>
        </form>
      </section>
    </div>`;
  state.elements = {
    root,
    subtitle: root.querySelector('[data-board-subtitle]'),
    date: root.querySelector('[data-board-date]'),
    kpis: root.querySelector('[data-kpis]'),
    host: root.querySelector('[data-board-host]'),
    fullscreen: root.querySelector('[data-fullscreen]'),
    blockBackdrop: root.querySelector('[data-block-backdrop]'),
    blockForm: root.querySelector('[data-block-form]'),
    dockChecks: root.querySelector('[data-dock-checks]'),
    editBackdrop: root.querySelector('[data-edit-backdrop]'),
    editForm: root.querySelector('[data-edit-form]'),
    editTitle: root.querySelector('[data-edit-title]'),
    editSub: root.querySelector('[data-edit-sub]'),
    editMessage: root.querySelector('[data-edit-message]'),
    editHistory: root.querySelector('[data-edit-history]'),
  };
  state.blockModal = createModal(state.elements.blockBackdrop, { onRequestClose: () => state.blockModal.close() });
  // Combining from the board. The same dialog the operations brief opens and the
  // same `merge_appointments` the booking wizard calls — there is one way to merge
  // in this application, and this is a second door to it rather than a second set
  // of rules about who may cancel whose load.
  state.combineDialog = createCombineDialog({
    location: state.context.location,
    capacityFor: record => capacityFor(record.truck_type_code),
    truckName: code => state.truckTypeNames.get(code),
    // Every truck type at this site with its capacity, so the dialog can work out which
    // trailer a combined run actually needs rather than only that it does not fit.
    truckTypes: () => [...state.truckCapacity.entries()].map(([code, skid_capacity]) => ({
      code, skid_capacity, name: state.truckTypeNames.get(code) || code,
    })),
    onDone: async () => { patchData(await fetchBoardData()); },
  });
  // Editing is handed back to the form that already exists rather than rebuilt.
  state.detailsModal = createAppointmentDetails({
    location: state.context.location,
    truckName: code => state.truckTypeNames.get(code),
    onEdit: record => openEditModal(record, state.elements.host),
    // Only offered to somebody who could actually carry it out: merge_appointments
    // wants appointment.create at this site, and a button certain to be refused is
    // worse than no button.
    laneFor: record => (can('appointment.create') ? laneForRecord(record, state.records) : null),
    onCombine: lane => state.combineDialog.open(lane.rows, laneDescription(lane), state.elements.host),
  });
  state.editModal = createModal(state.elements.editBackdrop, { onRequestClose: () => state.editModal.close() });
}
// Everything an operator has in their hand when they are looking for a load: the
// booking reference off the paperwork, the company that sent it, the carrier on
// the gate, or the PO the office quoted down the phone.
function matchesSearch(record, term) {
  if (!term) return true;
  return [
    record.booking_reference, record.company_name, record.display_counterpart_location_name,
    record.carrier_name, record.external_reference, record.requester_name, record.driver_name,
  ].some(value => String(value || '').toLowerCase().includes(term));
}

function visibleRecords() {
  const term = state.filters.search.trim().toLowerCase();
  return state.records.filter(record => {
    // A load that was combined onto another truck is not a movement any more —
    // it is part of one. It leaves the schedule at both ends rather than sitting
    // there cancelled next to the truck that is actually carrying it.
    if (record.merged_into_appointment_id) return false;
    if (state.filters.direction !== 'all' && record.direction !== state.filters.direction) return false;
    if (state.filters.status !== 'all' && !(STATUS_FILTERS[state.filters.status] || new Set()).has(record.status)) return false;
    return matchesSearch(record, term);
  });
}

function renderKpis() {
  const records = visibleRecords();
  const appointments = records.filter(record => record.entry_kind !== 'block');
  const blocks = records.filter(record => record.entry_kind === 'block');
  const cards = KPI_CARDS.filter(card => state.visibleCards.includes(card.id));
  // Turning every card off hides the strip rather than leaving an empty band.
  state.elements.kpis.hidden = cards.length === 0;
  const page = state.elements.kpis.closest('.page');
  page?.style.setProperty('--kpi-cols', String(Math.max(2, cards.length)));
  state.elements.kpis.innerHTML = cards
    .map(card => `<article class="kpi ${card.className}"><span class="kpi__label">${card.label}</span><span class="kpi__value">${card.compute(appointments, blocks)}</span></article>`)
    .join('');
}

// The window the timeline spans. Operating hours where they exist, widened just
// enough to contain anything booked outside them — an after-hours movement must
// still appear on the board, not fall off the end of the axis.
function boardWindow() {
  const open = format.clockMinutes(state.hours?.open_time || '06:00:00');
  const close = format.clockMinutes(state.hours?.close_time || '18:00:00');
  let start = Math.min(open, close - 60);
  let end = Math.max(close, start + 60);
  for (const record of visibleRecords()) {
    if (!record.start_at || !record.end_at) continue;
    const from = format.localTimeMinutes(record.start_at, state.context.location);
    const to = from + Math.max(5, format.minutesBetween(record.start_at, record.end_at));
    start = Math.min(start, Math.floor(from / 60) * 60);
    end = Math.max(end, Math.ceil(to / 60) * 60);
  }
  return { start: Math.max(0, start), end: Math.min(24 * 60, end) };
}

function blockTone(record) {
  if (record.entry_kind === 'block') return 'tlb--blk';
  if (record.is_priority) return 'tlb--pri';
  if (['completed'].includes(record.status)) return 'tlb--done';
  return record.direction === 'outbound' ? 'tlb--out' : 'tlb--in';
}

// Truck and skids share a line because they are read as one phrase — "53 ft
// Trailer · 26 skids" — and splitting them spends a line of a block that has
// four to give. Every other fact stands alone, which is what stopped the
// reference from being squeezed onto a line it never fitted.
function blockLines(record, startMin) {
  const show = id => state.blockFields.includes(id);
  const endMin = startMin + Math.max(5, format.minutesBetween(record.start_at, record.end_at));
  const load = [
    show('truck') && state.truckTypeNames?.get(record.truck_type_code),
    show('skids') && `${Number(record.skid_count || 0)} skids`,
  ].filter(Boolean).join(' · ');
  // A combined truck is marked on the reference itself rather than on a line of
  // its own, so the mark cannot be turned off and lost: this block is not one
  // load, and that changes what an operator expects to see back up to the door.
  const combined = Number(record.combined_from_count || 0);
  return [
    show('reference') && `${combined ? '⧉ ' : ''}${record.booking_reference}`,
    combined && show('combined') && `${combined} load${combined === 1 ? '' : 's'} combined in`,
    show('status') && format.role(record.status),
    show('route') && `${record.direction === 'outbound' ? 'To' : 'From'} ${record.company_name || record.display_counterpart_location_name || record.requester_name || 'unnamed'}`,
    show('time') && `${clockLabel(startMin)}–${clockLabel(endMin)}`,
    load,
    show('carrier') && record.carrier_name,
    show('po') && record.external_reference,
  ].filter(Boolean);
}

function applyVisible(selected) {
  state.visibleCards = selected.filter(id => !id.startsWith('block:'));
  state.blockFields = selected.filter(id => id.startsWith('block:')).map(id => id.slice(6));
}

function timelineBlocks() {
  return visibleRecords()
    .filter(record => record.start_at && record.end_at)
    .map(record => {
      const isBlock = record.entry_kind === 'block';
      const startMin = format.localTimeMinutes(record.start_at, state.context.location);
      const editable = canEditRecord(record);
      return {
        laneId: record.dock_id,
        startMin,
        endMin: startMin + Math.max(5, format.minutesBetween(record.start_at, record.end_at)),
        tone: blockTone(record),
        // One fact to a line, in the order somebody standing at the board reads
        // them. A blocked door is not an appointment and keeps its own three
        // lines; everything else is whatever the reader asked to see.
        lines: isBlock
          ? [record.block_reason || 'Dock blocked', record.notes || 'Unavailable', `${clockLabel(startMin)}–${clockLabel(startMin + Math.max(5, format.minutesBetween(record.start_at, record.end_at)))}`]
          : blockLines(record, startMin),
        attrs: `data-record-id="${escapeHtml(record.id)}"${isBlock ? '' : ` data-open-record${editable ? ' data-editable' : ''} role="button" tabindex="0"`}`,
      };
    });
}

// A board with no data in it yet. Six lanes is a guess at the number of doors, and it does
// not need to be right: it is holding the page's height and its structure for a second or two,
// not claiming how many doors this site has. Aria-hidden and aria-busy, so a screen reader is
// told the region is loading rather than read six empty rows.
function boardSkeleton() {
  // Written with repeat rather than the Array constructor helper on purpose. Everything on
  // this page goes through db.js, and verify-stage4-board enforces that by refusing the
  // table-selector call anywhere in this file. That check is deliberately blunt and catches
  // the Array helper too, and even a comment quoting the forbidden text. The guard is worth
  // more than the convenience, so the code works around it rather than the other way round.
  const lanes = '<div class="sk__lane"><span class="sk__label"></span><span class="sk__track"></span></div>'.repeat(6);
  return `<div class="board__skel" aria-busy="true" aria-label="Loading the dock schedule">
    <div class="sk__ruler"></div>${lanes}
  </div>`;
}

function renderBoard() {
  const records = visibleRecords();
  state.elements.subtitle.textContent = `${state.context.location.name} · ${state.docks.length} docks · ${records.length} scheduled today`;
  state.elements.date.value = state.date;
  renderKpis();
  if (state.hours?.is_open === false) {
    renderState(state.elements.host, { type: 'empty', title: 'Location closed', message: `${state.context.location.name} is closed on this date.` });
    return;
  }
  if (!state.docks.length) {
    renderState(state.elements.host, { type: 'empty', title: 'No active docks', message: 'This location has no active dock doors configured.' });
    return;
  }
  const window = boardWindow();
  const timeline = renderTimeline({
    lanes: state.docks.map(dock => ({ id: dock.id, name: dock.name, note: dock.direction_mode || 'both' })),
    blocks: timelineBlocks(),
    windowStart: window.start,
    windowEnd: window.end,
    granularity: state.granularity,
    fit: state.fit,
    // Only on today's board. The line answers "where has the day got to", and on any other
    // date that question has no answer, so it is not drawn rather than drawn misleadingly.
    nowMin: format.sameLocalDate(new Date(), state.date, state.context.location)
      ? format.minutesOfDay(new Date(), state.context.location)
      : null,
  });
  state.elements.host.innerHTML = `<div class="board__head">
      <!-- Title and refresh stamp share the first grid column. The head is three columns and
           a fourth child would push the legend and the timeline controls out of the places
           they hold on every other board, so the stamp goes inside the cell rather than
           beside it.
           The board repaints every five seconds; without a stamp there is no way to tell a
           quiet morning from a page that stopped talking to the server twenty minutes ago,
           and the two look identical. -->
      <div class="board__lead">
        <span class="board__title">${format.longDateInput(state.date, state.context.location)}</span>
        <span class="page-updated" data-board-updated>updated ${escapeHtml(format.currentTimeLabel())}</span>
      </div>
      <div class="board__legend"><span class="lg" style="--c:var(--dock)">Inbound</span><span class="lg" style="--c:var(--ok)">Outbound</span><span class="lg" style="--c:var(--signal)">Priority</span><span class="lg" style="--c:var(--rule-strong)">Blocked</span></div>
      <div class="board__gran">
        <label class="ctrl-field ctrl-field--inline"><span>Timeline</span><select class="select" data-granularity>${GRANULARITIES.map(option => `<option value="${option.minutes}" ${state.granularity === option.minutes ? 'selected' : ''}>${option.label}</option>`).join('')}</select></label>
        <label class="ctrl-field ctrl-field--inline"><span>Docks</span><select class="select" data-fit>
          <option value="window" ${state.fit === 'window' ? 'selected' : ''}>All on screen</option>
          <option value="scroll" ${state.fit === 'scroll' ? 'selected' : ''}>Full size, scroll</option>
        </select></label>
      </div>
    </div>
    <div class="board__scroll">${timeline}</div>`;
  fitTimelineBlocks(state.elements.host);
}
// One signature covering everything the timeline is drawn from: the day on the
// axis, the operating hours, the lanes and the movements. The board is only
// rebuilt when that signature moves, so a five-second poll on an unchanged day
// costs a KPI pass rather than a full repaint.
//
// It has to be computed from the incoming data, not from state after the
// assignment — comparing state.docks to data.docks once state.docks had already
// been overwritten always said "unchanged", so a location with docks configured
// and nothing booked yet never drew at all and sat on "Loading dock schedule…".
function boardSignature(data) {
  return JSON.stringify([
    state.date,
    data.hours,
    (data.docks || []).map(dock => [dock.id, dock.name, dock.direction_mode]),
    data.records || [],
  ]);
}

function patchData(data) {
  const signature = boardSignature(data);
  const changed = signature !== state.signature;
  state.signature = signature;
  state.docks = data.docks;
  state.hours = data.hours;
  state.truckTypeNames = data.truckTypeNames || state.truckTypeNames;
  state.truckCapacity = data.truckCapacity || state.truckCapacity;
  state.records = data.records;
  if (changed) renderBoard();
  else renderKpis();
  // Repainted from the same poll that drives the page, so the display stays
  // current on its own — nobody walks over to a wall screen to refresh it.
  if (state.wall && !state.wall.closed) paintWall(state.wall, wallPayload());
}

function exportCsv() {
  const rows = [['Reference', 'Type', 'Dock', 'Start', 'End', 'Direction', 'Status', 'Company', 'Skids']];
  for (const record of visibleRecords()) {
    const dock = state.docks.find(item => item.id === record.dock_id)?.name || '';
    rows.push([record.booking_reference || record.block_reason || '', record.entry_kind, dock, record.start_at, record.end_at, record.direction, record.status, record.company_name || record.display_counterpart_location_name || '', record.skid_count || 0]);
  }
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `maxdock-${state.context.location.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${state.date}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function openBlockModal(trigger) {
  state.elements.blockForm.reset();
  state.elements.blockForm.elements.date.value = state.date;
  state.elements.dockChecks.innerHTML = state.docks.map(dock => `<label class="dock-check"><input type="checkbox" name="dock_id" value="${dock.id}"><span>${escapeHtml(dock.name)}</span></label>`).join('');
  state.blockModal.open({ trigger });
}

async function submitBlock(event) {
  event.preventDefault();
  const form = new FormData(state.elements.blockForm);
  const dockIds = form.getAll('dock_id');
  if (!dockIds.length) { toast('Select at least one dock.', 'error'); return; }
  const submit = state.elements.blockForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await db.rpc('block_dock_time', {
      p_location_id: state.context.location.id,
      p_date: form.get('date'), p_start_time: form.get('start_time'),
      p_duration_minutes: Math.round(Number(form.get('duration_hours') || 0) * 60), p_dock_ids: dockIds,
      p_reason: form.get('reason'), p_notes: form.get('notes') || null,
    }, { key: `board:block:${crypto.randomUUID()}`, retry: 0 });
    db.invalidate('rpc:list_location_schedule');
    state.blockModal.close();
    toast('Dock time blocked.', 'success');
    patchData(await fetchBoardData());
  } catch (error) {
    toast(error.userMessage || 'The dock block could not be created.', 'error');
  } finally { submit.disabled = false; }
}

function wallPayload() {
  const window = boardWindow();
  const appointments = visibleRecords().filter(record => record.entry_kind !== 'block').length;
  return {
    lanes: state.docks.map(dock => ({ id: dock.id, name: dock.name, note: dock.direction_mode || '' })),
    blocks: timelineBlocks(),
    windowStart: window.start,
    windowEnd: window.end,
    granularity: state.granularity,
    subtitle: `${format.longDateInput(state.date, state.context.location)} · ${appointments} scheduled · ${state.docks.length} docks`,
    clock: format.currentTimeLabel(),
  };
}

function openBroadcastWindow() {
  state.wall = openWall({
    name: 'maxdock-broadcast',
    title: `${state.context.location.name} · Dock board`,
    cssHref: new URL('../assets/maxdock.css', globalThis.location.href).href,
    onNoWindow: () => toast('Allow pop-ups to open the broadcast board.', 'error'),
    ...wallPayload(),
  });
}

function openRecord(target) {
  const record = state.records.find(item => String(item.id) === target.dataset.recordId);
  if (!record) return;
  state.detailsModal.open(record, { trigger: target, canEdit: target.hasAttribute('data-editable') });
}

function wireEvents(root) {
  root.addEventListener('click', async event => {
    const booking = event.target.closest('[data-open-booking]');
    if (booking) globalThis.dispatchEvent(new CustomEvent('maxdock:open-booking', { detail: { trigger: booking } }));
    const day = event.target.closest('[data-day]');
    if (day) { state.date = format.addDaysInput(state.date, Number(day.dataset.day), state.context.location); patchData(await fetchBoardData()); }
    if (event.target.closest('[data-today]')) { state.date = format.todayInput(state.context.location); patchData(await fetchBoardData()); }
    const block = event.target.closest('[data-block-time]');
    if (block) openBlockModal(block);
    if (event.target.closest('[data-close-block]')) state.blockModal.close();
    if (event.target.closest('[data-close-edit]')) state.editModal.close();
    if (event.target.closest('[data-export]')) exportCsv();
    if (event.target.closest('[data-print]')) globalThis.print();
    if (event.target.closest('[data-fullscreen]')) openBroadcastWindow();
    const customize = event.target.closest('[data-customize]');
    if (customize) state.customizePanel?.open(customize);
    const priority = event.target.closest('[data-priority-switch]');
    if (priority) {
      const off = priority.classList.toggle('switch--off');
      priority.setAttribute('aria-pressed', String(!off));
    }
    const openTarget = event.target.closest('[data-open-record]');
    if (openTarget) openRecord(openTarget);
  });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const openTarget = event.target.closest('[data-open-record]');
    if (!openTarget) return;
    event.preventDefault();
    openRecord(openTarget);
  });
  // Filtering as you type. The search box lives in the controls band, outside the
  // timeline that gets rebuilt, so the caret stays where the operator left it.
  root.addEventListener('input', event => {
    if (!event.target.matches('[data-filter-search]')) return;
    state.filters.search = event.target.value;
    renderBoard();
  });
  // The magnifier inside the box. Filtering already happened as they typed, so this
  // reads what is in the field and draws again — which is the right thing whether it
  // is pressed after typing or on an empty box, and it hands the caret back either way.
  root.addEventListener('click', event => {
    if (!event.target.closest('[data-search-go]')) return;
    const field = root.querySelector('[data-filter-search]');
    if (!field) return;
    state.filters.search = field.value;
    renderBoard();
    field.focus();
  });
  root.addEventListener('change', async event => {
    if (event.target.matches('[data-board-date]')) { state.date = event.target.value; patchData(await fetchBoardData()); }
    if (event.target.matches('[data-granularity]')) { state.granularity = Number(event.target.value); renderBoard(); }
    // Every dock on screen, or every dock at full size with a scrollbar. A board
    // on a wall wants the first; somebody working one dock at a desk may want the
    // second.
    if (event.target.matches('[data-fit]')) { state.fit = event.target.value; renderBoard(); }
    if (event.target.matches('[data-filter-direction]')) { state.filters.direction = event.target.value; renderBoard(); }
    if (event.target.matches('[data-filter-status]')) { state.filters.status = event.target.value; renderBoard(); }
    if (event.target.matches('[data-filter-search]')) { state.filters.search = event.target.value; renderBoard(); }
  });
  state.elements.blockForm?.addEventListener('submit', submitBlock);
  state.elements.editForm?.addEventListener('submit', submitEdit);
}

const page = {
  code: 'board', permission: 'dock.view',
  async mount(context) {
    state.context = context;
    state.date = format.todayInput(state.context.location);
    // Blocks are sized as a percentage of the day, so a resize changes how much
    // text each one holds — and so does the type scale, without touching a box.
    state.unwatchFit = watchTimelineFit(() => state.elements.host);
    document.title = `Dock board · ${context.location.name} · MaxDock`;
    buildShell(context.pageRoot);
    wireEvents(context.pageRoot);
    state.customizePanel = await createCustomizePanel({
      // A new key rather than board-cards: the saved list now carries block
      // fields too, and an old list read against the new options would turn
      // every one of them off without anybody asking for that.
      preferenceKey: 'board-view',
      options: [
        ...KPI_CARDS.map(card => ({ id: card.id, group: 'Metric cards', label: card.label })),
        ...BLOCK_FIELDS.map(field => ({ id: `block:${field.id}`, group: 'Appointment block', label: field.label })),
      ],
      defaultIds: [...DEFAULT_CARDS, ...DEFAULT_BLOCK_FIELDS.map(id => `block:${id}`)],
      max: KPI_CARDS.length + BLOCK_FIELDS.length,
      onChange: selected => { applyVisible(selected); renderKpis(); renderBoard(); },
    });
    applyVisible(state.customizePanel.selected);
    // The board's shape is known before its data is: a ruler and one row per door. Drawing
    // that shape while the schedule is in flight means the page arrives at its final height
    // once, instead of collapsing to a line of text and then jumping to full size when the
    // first response lands. It is the same markup the real board uses, with nothing in it.
    state.elements.host.innerHTML = boardSkeleton();
    patchData(await fetchBoardData());
  },
  poll: { interval: 5000, fetch: fetchBoardData },
  async refresh(data) { patchData(data); },
  destroy() {
    state.unwatchFit?.();
    state.blockModal?.destroy(); state.editModal?.destroy(); state.detailsModal?.destroy();
    state.combineDialog?.destroy(); state.customizePanel?.destroy();
  },
};

startPage(page);
export const { mount, refresh, destroy } = page;
