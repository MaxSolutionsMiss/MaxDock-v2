import { startPage } from '../router.js';
import { db } from '../db.js';
import { createModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { renderState } from '../ui/empty.js';
import { pageHead } from '../ui/pagehead.js';
import { format } from '../format.js';

const state = {
  context: null,
  date: format.todayInput(),
  docks: [],
  hours: null,
  records: [],
  filters: { direction: 'all', status: 'all' },
  elements: {},
  blockModal: null,
  editModal: null,
  editingRecord: null,
  reference: null,
};

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'no_show']);

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
  const [scheduleRows, docks, hours] = await Promise.all([
    db.rpc('list_location_schedule', { p_location_id: locationId }, { key: `board:schedule:${locationId}`, cache: 0, retry: 1 }),
    db.select('docks', query => query.select('id,name,description,sort_order,direction_mode,is_active').eq('location_id', locationId).eq('is_active', true).order('sort_order').order('name'), { key: `board:docks:${locationId}`, cache: 30000 }),
    db.select('location_operating_hours', query => query.select('day_of_week,is_open,open_time,close_time').eq('location_id', locationId).eq('day_of_week', day).maybeSingle(), { key: `board:hours:${locationId}:${day}`, cache: 30000 }),
  ]);
  const selectedDate = state.date;
  return {
    docks: docks || [],
    hours: hours || null,
    records: (scheduleRows || []).map(normalizeRecord).filter(record => {
      if (!record.start_at) return false;
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
    ${pageHead('Dock board', {
      subtitleAttribute: 'data-board-subtitle',
      actions: ['export', 'print', 'fullscreen', ['block', can('block.manage')], ['book', can('appointment.create')]],
    })}
    <section class="controls" aria-label="Dock board controls">
      <div class="datenav">
        <button class="iconbtn" type="button" data-day="-1" aria-label="Previous day">‹</button>
        <button class="btn btn--quiet btn--sm" type="button" data-today>Today</button>
        <input class="input input--date" type="date" data-board-date aria-label="Board date">
        <button class="iconbtn" type="button" data-day="1" aria-label="Next day">›</button>
      </div>
      <div class="ctrl-field"><label for="board-direction">Direction</label><select class="select" id="board-direction" data-filter-direction><option value="all">All movements</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></div>
      <div class="ctrl-field"><label for="board-status">Status</label><select class="select" id="board-status" data-filter-status><option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="arrived">Arrived</option><option value="complete">Complete</option><option value="cancelled">Cancelled</option></select></div>
    </section>
    <section class="kpis kpis--5" aria-label="Dock board summary" data-kpis></section>
    <section class="board" data-board-host aria-label="Dock schedule"></section>
    <div class="scrim" data-block-backdrop hidden aria-hidden="true">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="block-title">
        <div class="modal__head"><div><h2 class="modal__title" id="block-title">Block dock time</h2><p class="modal__sub">Reserve one or more docks for maintenance, breaks or operational constraints.</p></div><button class="modal__x" type="button" data-close-block aria-label="Close">×</button></div>
        <form data-block-form>
          <div class="modal__body">
            <div class="frow">
              <label class="field field--sm"><span class="field__label">Date</span><input class="input" type="date" name="date" required></label>
              <label class="field field--sm"><span class="field__label">Start time</span><input class="input" type="time" name="start_time" required></label>
              <label class="field field--sm"><span class="field__label">Duration</span><select class="select" name="duration"><option value="30">30 minutes</option><option value="60" selected>1 hour</option><option value="90">90 minutes</option><option value="120">2 hours</option><option value="240">4 hours</option></select></label>
              <label class="field field--sm"><span class="field__label">Reason</span><input class="input" name="reason" maxlength="120" required></label>
            </div>
            <fieldset class="dock-checks"><legend>Select docks</legend><div data-dock-checks></div></fieldset>
            <label class="field"><span class="field__label">Notes</span><textarea name="notes" rows="3" maxlength="500"></textarea></label>
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
              <label class="field field--md"><span class="field__label">PO / BOL / Job</span><input class="input" name="external_reference" maxlength="80" required></label>
            </div>
            <div class="frow">
              <label class="field field--lg"><span class="field__label">Requester name</span><input class="input" name="requester_name" maxlength="120" required></label>
              <label class="field field--lg"><span class="field__label">Requester email</span><input class="input" type="email" name="requester_email" maxlength="160" required></label>
            </div>
            <div class="setrow"><div><div class="setrow__t">Priority load</div><div class="setrow__d">Applies this location's priority minimum duration</div></div><button type="button" class="switch" data-priority-switch aria-label="Priority load"></button></div>
            <label class="field field--full"><span class="field__label">Notes</span><textarea name="notes" rows="2" maxlength="500"></textarea></label>
            <p class="form-message" data-edit-message aria-live="polite"></p>
            <h3 class="watch__t" style="margin-top:var(--s4)">Change history</h3>
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
  state.editModal = createModal(state.elements.editBackdrop, { onRequestClose: () => state.editModal.close() });
}
function visibleRecords() {
  return state.records.filter(record => {
    if (state.filters.direction !== 'all' && record.direction !== state.filters.direction) return false;
    if (state.filters.status !== 'all' && record.status !== state.filters.status) return false;
    return true;
  });
}

function renderKpis() {
  const records = visibleRecords();
  const appointments = records.filter(record => record.entry_kind !== 'block');
  const blocks = records.filter(record => record.entry_kind === 'block');
  const inbound = appointments.filter(record => record.direction === 'inbound');
  const outbound = appointments.filter(record => record.direction === 'outbound');
  const active = appointments.filter(record => ['arrived', 'loading', 'unloading'].includes(record.status));
  state.elements.kpis.innerHTML = [
    ['Appointments', appointments.length, ''],
    ['Inbound skids', inbound.reduce((sum, record) => sum + Number(record.skid_count || 0), 0), 'kpi--out'],
    ['Outbound skids', outbound.reduce((sum, record) => sum + Number(record.skid_count || 0), 0), 'kpi--ok'],
    ['Active trucks', active.length, 'kpi--signal'],
    ['Blocked docks', blocks.length, 'kpi--stop'],
  ].map(([label, value, className]) => `<article class="kpi ${className}"><div class="kpi__label">${label}</div><div class="kpi__value">${value}</div></article>`).join('');
}

function slotTimes() {
  const open = state.hours?.is_open !== false ? (state.hours?.open_time || '06:00:00') : '06:00:00';
  const close = state.hours?.is_open !== false ? (state.hours?.close_time || '22:00:00') : '22:00:00';
  const start = format.clockMinutes(open);
  const end = format.clockMinutes(close);
  const slots = [];
  for (let minute = start; minute < end; minute += 60) slots.push(minute);
  return slots;
}

function recordsForCell(dockId, minute) {
  return visibleRecords().filter(record => {
    if (record.dock_id !== dockId || !record.start_at || !record.end_at) return false;
    const startMinute = format.localTimeMinutes(record.start_at, state.context.location);
    const duration = Math.max(1, format.minutesBetween(record.start_at, record.end_at));
    return startMinute < minute + 60 && startMinute + duration > minute;
  });
}

function card(record) {
  const isBlock = record.entry_kind === 'block';
  const title = isBlock ? (record.block_reason || 'Dock blocked') : (record.booking_reference || 'Appointment');
  const who = isBlock ? (record.notes || 'Unavailable') : (record.company_name || record.display_counterpart_location_name || record.requester_name || 'Scheduled movement');
  const meta = isBlock ? `${format.time(record.start_at, state.context.location)}–${format.time(record.end_at, state.context.location)}` : `${record.direction} · ${Number(record.skid_count || 0)} skids`;
  const editable = canEditRecord(record);
  const hint = editable ? ' · Enter or click to edit' : '';
  return `<article class="slot ${isBlock ? 'slot--blk' : record.direction === 'outbound' ? 'slot--out' : record.is_priority ? 'slot--pri' : 'slot--in'}" data-record-id="${escapeHtml(record.id)}"${editable ? ' data-edit-record role="button"' : ''} tabindex="0" title="${escapeHtml(`${title} · ${who}${hint}`)}"><div class="slot__ref">${escapeHtml(title)}</div><div class="slot__who">${escapeHtml(who)}</div><div class="slot__meta">${escapeHtml(meta)}</div></article>`;
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
  const hours = slotTimes();
  const labels = hours.map(minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
  const header = `<div class="corner"></div>${labels.map(label => `<div class="thead">${label}</div>`).join('')}`;
  const rows = state.docks.map(dock => {
    const cells = hours.map(minute => `<div class="cell" data-dock-id="${dock.id}" data-minute="${minute}">${recordsForCell(dock.id, minute).map(record => card(record)).join('')}</div>`).join('');
    return `<div class="dock">${escapeHtml(dock.name)}<small>${escapeHtml(dock.direction_mode || 'both')}</small></div>${cells}`;
  }).join('');
  state.elements.host.innerHTML = `<div class="board__head"><span class="board__title">${format.longDateInput(state.date, state.context.location)}</span><div class="board__legend"><span class="lg" style="--c:var(--dock)">Inbound</span><span class="lg" style="--c:var(--ok)">Outbound</span><span class="lg" style="--c:var(--signal)">Priority</span><span class="lg" style="--c:var(--rule-strong)">Blocked</span></div></div><div class="board__scroll"><div class="rowGrid" style="--hours:${hours.length}">${header}${rows}</div></div>`;
}
function patchData(data) {
  state.docks = data.docks;
  state.hours = data.hours;
  const before = new Map(state.records.map(record => [record.id, JSON.stringify(record)]));
  const after = new Map(data.records.map(record => [record.id, JSON.stringify(record)]));
  const structureChanged = state.records.length !== data.records.length || state.docks.length !== (data.docks || []).length || [...after].some(([id, value]) => before.get(id) !== value);
  state.records = data.records;
  if (structureChanged) renderBoard();
  else renderKpis();
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
      p_duration_minutes: Number(form.get('duration')), p_dock_ids: dockIds,
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

function openBroadcastWindow() {
  const popup = globalThis.open('', 'maxdock-broadcast', 'popup=yes,width=1280,height=760');
  if (!popup) { toast('Allow pop-ups to open the broadcast board.', 'error'); return; }
  const cssHref = new URL('../assets/maxdock.css', globalThis.location.href).href;
  const rows = visibleRecords().filter(record => record.entry_kind !== 'block').slice(0, 18).map(record => {
    const dock = state.docks.find(item => item.id === record.dock_id)?.name || 'Unassigned';
    const statusClass = record.is_priority ? 'tag--pri' : ['arrived', 'loading', 'unloading'].includes(record.status) ? 'tag--ok' : 'tag--quiet';
    return `<tr><td>${escapeHtml(dock)}</td><td>${escapeHtml(format.time(record.start_at, state.context.location))}</td><td>${escapeHtml(record.booking_reference || 'Appointment')}</td><td><span class="tag ${statusClass}">${escapeHtml(record.status || 'Scheduled')}</span></td></tr>`;
  }).join('');
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="en" data-text="larger"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(state.context.location.name)} · Dock board</title><link rel="stylesheet" href="${cssHref}"></head><body class="wall"><header class="wall__head"><div class="wall__title">${escapeHtml(state.context.location.name)} · Dock board</div><div class="wall__clock">${escapeHtml(format.currentTimeLabel())}</div></header><table><thead><tr><th>Dock</th><th>Time</th><th>Reference</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No scheduled appointments</td></tr>'}</tbody></table></body></html>`);
  popup.document.close();
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
    const priority = event.target.closest('[data-priority-switch]');
    if (priority) {
      const off = priority.classList.toggle('switch--off');
      priority.setAttribute('aria-pressed', String(!off));
    }
    const editTarget = event.target.closest('[data-edit-record]');
    if (editTarget) {
      const record = state.records.find(item => String(item.id) === editTarget.dataset.recordId);
      if (record) openEditModal(record, editTarget);
    }
  });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const editTarget = event.target.closest('[data-edit-record]');
    if (!editTarget) return;
    event.preventDefault();
    const record = state.records.find(item => String(item.id) === editTarget.dataset.recordId);
    if (record) openEditModal(record, editTarget);
  });
  root.addEventListener('change', async event => {
    if (event.target.matches('[data-board-date]')) { state.date = event.target.value; patchData(await fetchBoardData()); }
    if (event.target.matches('[data-filter-direction]')) { state.filters.direction = event.target.value; renderBoard(); }
    if (event.target.matches('[data-filter-status]')) { state.filters.status = event.target.value; renderBoard(); }
  });
  state.elements.blockForm?.addEventListener('submit', submitBlock);
  state.elements.editForm?.addEventListener('submit', submitEdit);
}

const page = {
  code: 'board', permission: 'dock.view',
  async mount(context) {
    state.context = context;
    state.date = format.todayInput(state.context.location);
    document.title = `Dock board · ${context.location.name} · MaxDock`;
    buildShell(context.pageRoot);
    wireEvents(context.pageRoot);
    state.elements.host.innerHTML = '<div class="board-loading">Loading dock schedule…</div>';
    patchData(await fetchBoardData());
  },
  poll: { interval: 5000, fetch: fetchBoardData },
  async refresh(data) { patchData(data); },
  destroy() { state.blockModal?.destroy(); state.editModal?.destroy(); },
};

startPage(page);
export const { mount, refresh, destroy } = page;
