import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { createModal } from '../ui/modal.js';
import { pageHead } from '../ui/pagehead.js';
import { format } from '../format.js';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SLOT_INTERVALS = [5, 10, 15, 20, 30, 60];

const SECTIONS = [
  { id: 'hours', label: 'Operating hours' },
  { id: 'timing', label: 'Timing & duration' },
  { id: 'notice', label: 'Booking window & notice' },
  { id: 'capacity', label: 'Capacity' },
  { id: 'assignment', label: 'Dock assignment' },
  { id: 'docks', label: 'Docks & truck types' },
];

const state = {
  context: null,
  locationId: null,
  canManage: false,
  canManageDocks: false,
  section: 'hours',
  hours: [],
  settings: null,
  docks: [],
  truckTypes: [],
  locationTruckTypes: [],
  dockTruckTypes: [],
  elements: {},
  dockModal: null,
  editingDockId: null,
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const timeInput = value => (value ? String(value).slice(0, 5) : '');

// A duration is stored in one unit and thought about in another. Two hours' notice
// is two hours to the manager setting it and 120 to the column holding it; making
// them type 120 is asking them to do the conversion the page can do. The unit is a
// choice beside the number, and the value comes back in whichever unit the column
// uses. Reading back, the largest unit the value divides into evenly is picked, so
// 120 comes back as "2 hours" and 90 as "90 minutes".
const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };
const NOTICE_UNITS = ['minutes', 'hours', 'days'];
const AHEAD_UNITS = ['days', 'weeks'];
// Hours and days only: the column holds hours, so a minute would round away.
const WINDOW_UNITS = ['hours', 'days'];

function unitParts(storedValue, baseUnit, units) {
  // An unset value stays unset, so a field with a placeholder does not read as a
  // deliberate zero.
  if (storedValue === '' || storedValue === null || storedValue === undefined) return { value: '', unit: baseUnit };
  const minutes = Number(storedValue || 0) * UNIT_MINUTES[baseUnit];
  for (const unit of [...units].reverse()) {
    const size = UNIT_MINUTES[unit];
    if (minutes >= size && minutes % size === 0) return { value: minutes / size, unit };
  }
  return { value: Number(storedValue || 0), unit: baseUnit };
}

function durationField(label, name, storedValue, baseUnit, units, disabled) {
  const { value, unit } = unitParts(storedValue, baseUnit, units);
  const options = units.map(item => `<option value="${item}" ${item === unit ? 'selected' : ''}>${item}</option>`).join('');
  return `<div class="field field--num field--dur"><span class="field__label">${escapeHtml(label)}</span><span class="inputwrap">
    <input class="input" type="number" min="0" name="${name}" value="${value}" ${disabled}>
    <select class="select unitsel" name="${name}__unit" aria-label="${escapeHtml(label)} unit" ${disabled}>${options}</select>
  </span></div>`;
}

function durationValue(data, name, baseUnit, units) {
  const unit = units.includes(data.get(`${name}__unit`)) ? data.get(`${name}__unit`) : baseUnit;
  return Math.round(Number(data.get(name) || 0) * UNIT_MINUTES[unit] / UNIT_MINUTES[baseUnit]);
}

async function fetchAll() {
  const locationId = state.locationId;
  const [hours, settings, docks, truckTypes, locationTruckTypes, dockTruckTypes, capacity] = await Promise.all([
    db.select('location_operating_hours', q => q.select('location_id,day_of_week,is_open,open_time,close_time').eq('location_id', locationId), { key: `settings:hours:${locationId}`, cache: 0 }),
    db.select('location_settings', q => q.select('*').eq('location_id', locationId).maybeSingle(), { key: `settings:row:${locationId}`, cache: 0 }),
    db.select('docks', q => q.select('id,name,description,sort_order,direction_mode,is_active').eq('location_id', locationId).order('sort_order').order('name'), { key: `settings:docks:${locationId}`, cache: 0 }),
    db.select('truck_types', q => q.select('code,name').eq('is_active', true).order('sort_order'), { key: 'truck-types:active', cache: 60000 }),
    db.select('location_truck_types', q => q.select('truck_type_code,setup_minutes,is_active').eq('location_id', locationId), { key: `settings:location-truck-types:${locationId}`, cache: 0 }),
    db.select('dock_truck_types', q => q.select('dock_id,truck_type_code').eq('location_id', locationId), { key: `settings:dock-truck-types:${locationId}`, cache: 0 }),
    db.rpc('get_location_capacity_projection', { p_location_id: locationId, p_at: format.nowIso(), p_direction: 'inbound', p_skid_count: 0 }, { key: `settings:capacity:${locationId}`, cache: 0, retry: 1 }).catch(() => null),
  ]);
  state.hours = hours || [];
  state.capacity = Array.isArray(capacity) ? capacity[0] || null : capacity || null;
  state.settings = settings || null;
  state.docks = docks || [];
  state.truckTypes = truckTypes || [];
  state.locationTruckTypes = locationTruckTypes || [];
  state.dockTruckTypes = dockTruckTypes || [];
}

function saveFoot(canEdit) {
  if (!canEdit) return '';
  return `<div class="form-actions">
    <button class="btn btn--quiet" type="button" data-reset>Reset</button>
    <button class="btn btn--primary" type="submit">Save</button>
  </div><p class="form-message" data-save-message aria-live="polite"></p>`;
}

function renderHours() {
  const canEdit = state.canManage;
  const rows = DAY_ORDER.map(day => {
    const row = state.hours.find(item => item.day_of_week === day) || {};
    const isOpen = row.is_open !== false;
    return `<div class="hourrow" data-day="${day}">
      <span class="day">${DAY_LABELS[day]}</span>
      <input class="input" type="time" name="open" aria-label="${DAY_LABELS[day]} opening time" value="${escapeHtml(timeInput(row.open_time))}" ${isOpen ? '' : 'disabled'} ${canEdit ? '' : 'readonly disabled'}>
      <input class="input" type="time" name="close" aria-label="${DAY_LABELS[day]} closing time" value="${escapeHtml(timeInput(row.close_time))}" ${isOpen ? '' : 'disabled'} ${canEdit ? '' : 'readonly disabled'}>
      <button type="button" class="switch ${isOpen ? '' : 'switch--off'}" data-hours-switch aria-pressed="${isOpen}" aria-label="${DAY_LABELS[day]} open" ${canEdit ? '' : 'disabled'}></button>
    </div>`;
  }).join('');
  return `<form class="card" data-section-form="hours">
    <h3 class="card__title">Operating hours</h3>
    <div class="hours">${rows}</div>
    <p class="hint">Staff may book outside these hours with a warning. Customers cannot.</p>
    ${saveFoot(canEdit)}
  </form>`;
}

function renderTiming() {
  const s = state.settings || {};
  const canEdit = state.canManage;
  const disabled = canEdit ? '' : 'disabled';
  return `<form class="card" data-section-form="timing">
    <h3 class="card__title">Timing & duration</h3>
    <div class="frow">
      <div class="field field--sm"><span class="field__label">Slot interval</span><select class="select" name="slot_interval_minutes" ${disabled}>${SLOT_INTERVALS.map(minutes => `<option value="${minutes}" ${Number(s.slot_interval_minutes) === minutes ? 'selected' : ''}>${minutes} minutes</option>`).join('')}</select></div>
      <div class="field field--num"><span class="field__label">Base</span><span class="inputwrap"><input class="input" type="number" min="0" name="base_minutes" value="${s.base_minutes ?? 0}" ${disabled}><span class="input__unit">min</span></span></div>
      <div class="field field--num"><span class="field__label">Per skid</span><span class="inputwrap"><input class="input" type="number" min="0" step="0.1" name="minutes_per_skid" value="${s.minutes_per_skid ?? 0}" ${disabled}><span class="input__unit">min</span></span></div>
      <div class="field field--num"><span class="field__label">Buffer</span><span class="inputwrap"><input class="input" type="number" min="0" name="buffer_minutes" value="${s.buffer_minutes ?? 0}" ${disabled}><span class="input__unit">min</span></span></div>
    </div>
    <div class="frow">
      <div class="field field--num"><span class="field__label">Full truck at</span><span class="inputwrap"><input class="input" type="number" min="0" name="full_truck_skid_threshold" value="${s.full_truck_skid_threshold ?? 0}" ${disabled}><span class="input__unit">skids</span></span></div>
      <div class="field field--num"><span class="field__label">Full truck min</span><span class="inputwrap"><input class="input" type="number" min="0" name="full_truck_minimum_minutes" value="${s.full_truck_minimum_minutes ?? 0}" ${disabled}><span class="input__unit">min</span></span></div>
      <div class="field field--num"><span class="field__label">Priority min</span><span class="inputwrap"><input class="input" type="number" min="0" name="priority_minimum_minutes" value="${s.priority_minimum_minutes ?? 0}" ${disabled}><span class="input__unit">min</span></span></div>
    </div>
    <p class="hint">These values drive the appointment-duration calculation for every booking at this location.</p>
    ${saveFoot(canEdit)}
  </form>`;
}

function renderNotice() {
  const s = state.settings || {};
  const canEdit = state.canManage;
  const disabled = canEdit ? '' : 'disabled';
  return `<form class="card" data-section-form="notice">
    <h3 class="card__title">Booking window & notice</h3>
    <div class="frow">
      ${durationField('Minimum notice', 'minimum_notice_minutes', s.minimum_notice_minutes ?? 0, 'minutes', NOTICE_UNITS, disabled)}
      ${durationField('Book ahead up to', 'maximum_advance_days', s.maximum_advance_days ?? 0, 'days', AHEAD_UNITS, disabled)}
    </div>
    <p class="hint">Customers cannot book inside the minimum notice window or beyond the max days ahead.</p>
    ${saveFoot(canEdit)}
  </form>`;
}

function renderCapacity() {
  const s = state.settings || {};
  const canEdit = state.canManage;
  const disabled = canEdit ? '' : 'disabled';
  const enabled = s.capacity_enabled === true;
  return `<form class="card" data-section-form="capacity">
    <h3 class="card__title">Capacity</h3>
    <div class="setrow">
      <div><div class="setrow__t">Enforce skid capacity</div><div class="setrow__d">Track occupied skids against a daily capacity for this location</div></div>
      <button type="button" class="switch ${enabled ? '' : 'switch--off'}" data-capacity-switch aria-pressed="${enabled}" aria-label="Enforce skid capacity" ${disabled}></button>
    </div>
    <div class="frow">
      <div class="field field--num"><span class="field__label">Daily capacity</span><span class="inputwrap"><input class="input" type="number" min="1" name="skid_capacity" value="${s.skid_capacity ?? ''}" ${disabled}><span class="input__unit">skids</span></span></div>
      <div class="field field--num"><span class="field__label">Reserve</span><span class="inputwrap"><input class="input" type="number" min="0" name="capacity_reserve_skids" value="${s.capacity_reserve_skids ?? 0}" ${disabled}><span class="input__unit">skids</span></span></div>
      <div class="field field--md"><span class="field__label">When over capacity</span><select class="select" name="capacity_enforcement_mode" ${disabled}>
        <option value="warn" ${s.capacity_enforcement_mode === 'warn' ? 'selected' : ''}>Warn only</option>
        <option value="enforce" ${s.capacity_enforcement_mode === 'enforce' ? 'selected' : ''}>Block booking</option>
      </select></div>
      <div class="field field--num"><span class="field__label">Occupied now</span><span class="inputwrap"><input class="input" value="${state.capacity?.projected_before ?? s.current_occupied_skids ?? 0}" readonly><span class="input__unit">skids</span></span></div>
      <div class="field field--num"><span class="field__label">Free now</span><span class="inputwrap"><input class="input" value="${state.capacity?.available_after ?? '—'}" readonly><span class="input__unit">skids</span></span></div>
    </div>
    <p class="hint">Counted from ${s.current_occupied_skids ?? 0} skids${s.inventory_as_of ? ` as of ${format.timestamp(s.inventory_as_of, state.context.location)}` : ''} (${s.capacity_last_source === 'mis' ? 'from MIS import' : 'manual entry'}), then every booked inbound added and every outbound subtracted.</p>
    ${saveFoot(canEdit)}
  </form>`;
}

function renderAssignment() {
  const s = state.settings || {};
  const canEdit = state.canManage;
  const disabled = canEdit ? '' : 'disabled';
  const autoAssign = s.auto_assign_dock !== false;
  const consolidation = s.suggest_same_day_consolidation !== false;
  return `<form class="card" data-section-form="assignment">
    <h3 class="card__title">Dock assignment</h3>
    <div class="setrow">
      <div><div class="setrow__t">Auto-assign docks</div><div class="setrow__d">MaxDock picks a dock for each booking automatically</div></div>
      <button type="button" class="switch ${autoAssign ? '' : 'switch--off'}" data-assign-switch aria-pressed="${autoAssign}" aria-label="Auto-assign docks" ${disabled}></button>
    </div>
    <div class="frow">
      <div class="field field--xl"><span class="field__label">Assignment strategy</span><select class="select" name="dock_assignment_strategy" ${disabled}>
        <option value="balanced" ${s.dock_assignment_strategy === 'balanced' ? 'selected' : ''}>Balanced across docks</option>
        <option value="fill_first" ${s.dock_assignment_strategy === 'fill_first' ? 'selected' : ''}>Fill one dock first</option>
      </select></div>
      <div class="field field--md"><span class="field__label">Max concurrent</span><span class="inputwrap"><input class="input" type="number" min="1" name="max_concurrent_appointments" value="${s.max_concurrent_appointments ?? ''}" placeholder="∞" ${disabled}><span class="input__unit">at once</span></span></div>
    </div>
    <div class="setrow">
      <div><div class="setrow__t">Consolidation warning</div><div class="setrow__d">Flag combinable same-destination bookings for review</div></div>
      <button type="button" class="switch ${consolidation ? '' : 'switch--off'}" data-consolidation-switch aria-pressed="${consolidation}" aria-label="Consolidation warning" ${disabled}></button>
    </div>
    <div class="frow">
      <div class="field field--sm"><span class="field__label">Look for loads</span><select class="select" name="consolidation_window_mode" data-consolidation-mode ${disabled}>
        <option value="day" ${s.consolidation_window_hours ? '' : 'selected'}>On the same day</option>
        <option value="hours" ${s.consolidation_window_hours ? 'selected' : ''}>Within a set window</option>
      </select></div>
      ${durationField('Window', 'consolidation_window_hours', s.consolidation_window_hours ?? '', 'hours', WINDOW_UNITS, s.consolidation_window_hours ? disabled : 'disabled')}
    </div>
    ${saveFoot(canEdit)}
  </form>`;
}

// The truck types this location has turned on. A dock can only accept a type the
// location itself accepts, so this is the set a dock is measured against.
function locationTypeCodes() {
  return state.locationTruckTypes.filter(row => row.is_active !== false).map(row => row.truck_type_code);
}

function dockTypeCodes(dockId) {
  return new Set(state.dockTruckTypes.filter(row => row.dock_id === dockId).map(row => row.truck_type_code));
}

// A dock with no truck types accepts nothing — the database rejects any booking on
// it. This used to read "All types", which is the opposite of what it means, and a
// site set up that way looked configured while being unbookable.
function dockTruckLabels(dockId) {
  const codes = dockTypeCodes(dockId);
  if (!codes.size) return 'None — nothing can be booked here';
  const enabled = locationTypeCodes();
  if (enabled.length && enabled.every(code => codes.has(code))) return 'All types';
  return state.truckTypes.filter(type => codes.has(type.code)).map(type => type.name).join(', ');
}

function dockIsRestricted(dockId) {
  const enabled = locationTypeCodes();
  if (!enabled.length) return true;
  const codes = dockTypeCodes(dockId);
  return !enabled.every(code => codes.has(code));
}

function renderDocks() {
  const canEditDocks = state.canManageDocks && state.canManage;
  // The card is sized to its table rather than to the panel, so Add dock lands
  // over the Edit column instead of against the right edge of a wide monitor
  // with a hand's width of nothing in between.
  //
  // Status is a switch rather than a badge: taking a dock out of service for a
  // morning is the one dock change that happens often, and it needed a dialog.
  // It is the only thing on this table that is edited in place, which is what
  // Save and Reset underneath act on.
  const rows = state.docks.map(dock => `<tr data-dock-row="${dock.id}">
    <td class="data data--strong">${escapeHtml(dock.name)}</td>
    <td>${escapeHtml(dock.direction_mode === 'both' ? 'Both' : format.role(dock.direction_mode))}</td>
    <td><button type="button" class="switch ${dock.is_active ? '' : 'switch--off'}" data-dock-active aria-pressed="${Boolean(dock.is_active)}" aria-label="${escapeHtml(dock.name)} in service" ${canEditDocks ? '' : 'disabled'}></button></td>
    <td class="data cell-cap" title="${escapeHtml(dockTruckLabels(dock.id))}">${escapeHtml(dockTruckLabels(dock.id))}</td>
    <td>${canEditDocks ? `<button class="btn btn--quiet btn--sm" type="button" data-edit-dock="${dock.id}">Edit</button>` : ''}</td>
  </tr>`).join('') || '<tr><td colspan="5" class="data">No docks configured for this location.</td></tr>';

  const locationTypes = state.locationTruckTypes;
  const truckRows = state.truckTypes.map(type => {
    const enabled = locationTypes.find(row => row.truck_type_code === type.code);
    return `<div class="setrow" data-truck-code="${type.code}">
      <div><div class="setrow__t">${escapeHtml(type.name)}</div></div>
      <div class="setrow__ctl">
        <span class="inputwrap"><input class="input input--mins" type="number" min="0" name="setup_minutes" value="${enabled ? enabled.setup_minutes : 0}" ${state.canManage ? '' : 'disabled'} aria-label="${escapeHtml(type.name)} setup minutes"><span class="input__unit">min setup</span></span>
        <button type="button" class="switch ${enabled?.is_active !== false && enabled ? '' : 'switch--off'}" data-truck-switch aria-pressed="${Boolean(enabled)}" aria-label="Enable ${escapeHtml(type.name)}" ${state.canManage ? '' : 'disabled'}></button>
      </div>
    </div>`;
  }).join('');

  return `<form class="card card--fit" data-section-form="docks">
      <h3 class="card__title">Docks${canEditDocks ? '<button class="btn btn--primary btn--sm at-end" type="button" data-add-dock>Add dock</button>' : ''}</h3>
      <div class="tablewrap"><table class="table"><thead><tr><th>Dock</th><th>Direction</th><th>In service</th><th>Truck types</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hint">Add dock and Edit save on their own. Save below applies the in-service switches.</p>
      ${saveFoot(canEditDocks)}
    </form>
    <form class="card card--fit" data-section-form="truck-types">
      <h3 class="card__title">Truck types enabled at this location</h3>
      ${truckRows}
      <p class="hint">Setup minutes here override the truck type's default for this location only.</p>
      ${saveFoot(state.canManage)}
    </form>`;
}

function renderPanel() {
  const map = { hours: renderHours, timing: renderTiming, notice: renderNotice, capacity: renderCapacity, assignment: renderAssignment, docks: renderDocks };
  state.elements.panel.innerHTML = (map[state.section] || renderHours)();
}

function renderNav() {
  state.elements.nav.innerHTML = SECTIONS.map(section => `<button type="button" data-section="${section.id}" aria-current="${section.id === state.section}">${section.label}</button>`).join('');
}

function switchSection(id) {
  state.section = id;
  renderNav();
  renderPanel();
}

function showMessage(form, text, isError) {
  const message = form.querySelector('[data-save-message]');
  if (!message) return;
  message.textContent = text;
  message.classList.toggle('form-message--success', !isError);
}

async function saveHours(form) {
  const updates = [...form.querySelectorAll('.hourrow')].map(row => {
    const day = Number(row.dataset.day);
    const isOpen = row.querySelector('[data-hours-switch]').getAttribute('aria-pressed') === 'true';
    const open = row.querySelector('input[name="open"]').value || null;
    const close = row.querySelector('input[name="close"]').value || null;
    return db.update('location_operating_hours', { is_open: isOpen, open_time: open, close_time: close }, q => q.eq('location_id', state.locationId).eq('day_of_week', day), { select: false });
  });
  await Promise.all(updates);
  db.invalidate(`settings:hours:${state.locationId}`);
  db.invalidate('board:hours:');
}

async function saveSettingsFields(fields) {
  await db.update('location_settings', fields, q => q.eq('location_id', state.locationId), { select: false });
  db.invalidate(`settings:row:${state.locationId}`);
}

async function saveTiming(form) {
  const data = new FormData(form);
  await saveSettingsFields({
    slot_interval_minutes: Number(data.get('slot_interval_minutes')),
    base_minutes: Number(data.get('base_minutes')),
    minutes_per_skid: Number(data.get('minutes_per_skid')),
    buffer_minutes: Number(data.get('buffer_minutes')),
    full_truck_skid_threshold: Number(data.get('full_truck_skid_threshold')),
    full_truck_minimum_minutes: Number(data.get('full_truck_minimum_minutes')),
    priority_minimum_minutes: Number(data.get('priority_minimum_minutes')),
  });
}

async function saveNotice(form) {
  const data = new FormData(form);
  await saveSettingsFields({
    minimum_notice_minutes: durationValue(data, 'minimum_notice_minutes', 'minutes', NOTICE_UNITS),
    maximum_advance_days: durationValue(data, 'maximum_advance_days', 'days', AHEAD_UNITS),
  });
}

async function saveCapacity(form) {
  const data = new FormData(form);
  const enabled = form.querySelector('[data-capacity-switch]').getAttribute('aria-pressed') === 'true';
  const capacity = data.get('skid_capacity');
  await saveSettingsFields({
    capacity_enabled: enabled,
    skid_capacity: capacity ? Number(capacity) : null,
    capacity_reserve_skids: Number(data.get('capacity_reserve_skids')),
    capacity_enforcement_mode: data.get('capacity_enforcement_mode'),
  });
}

async function saveAssignment(form) {
  const data = new FormData(form);
  const autoAssign = form.querySelector('[data-assign-switch]').getAttribute('aria-pressed') === 'true';
  const consolidation = form.querySelector('[data-consolidation-switch]').getAttribute('aria-pressed') === 'true';
  const maxConcurrent = data.get('max_concurrent_appointments');
  await saveSettingsFields({
    auto_assign_dock: autoAssign,
    dock_assignment_strategy: data.get('dock_assignment_strategy'),
    max_concurrent_appointments: maxConcurrent ? Number(maxConcurrent) : null,
    suggest_same_day_consolidation: consolidation,
    // NULL is the same-day behaviour this setting has always had; a number narrows
    // or widens it to that many hours either side of the proposed appointment.
    consolidation_window_hours: data.get('consolidation_window_mode') === 'hours' && data.get('consolidation_window_hours')
      ? durationValue(data, 'consolidation_window_hours', 'hours', WINDOW_UNITS)
      : null,
  });
}

// Only the in-service switches are edited on the dock table itself; everything
// else about a dock is changed through Add dock or Edit, which save on their own.
async function saveDocks(form) {
  const updates = [...form.querySelectorAll('[data-dock-row]')].map(row => {
    const id = row.dataset.dockRow;
    const isActive = row.querySelector('[data-dock-active]').getAttribute('aria-pressed') === 'true';
    const dock = state.docks.find(item => item.id === id);
    if (!dock || Boolean(dock.is_active) === isActive) return null;
    return db.update('docks', { is_active: isActive }, q => q.eq('id', id), { select: false });
  }).filter(Boolean);
  if (!updates.length) return;
  await Promise.all(updates);
  db.invalidate(`settings:docks:${state.locationId}`);
  db.invalidate('board:docks:');
  db.invalidate('queue:docks:');
}

async function saveTruckTypes(form) {
  const rows = [...form.querySelectorAll('[data-truck-code]')];
  const toEnable = rows
    .filter(row => row.querySelector('[data-truck-switch]').getAttribute('aria-pressed') === 'true')
    .map(row => ({
      location_id: state.locationId,
      truck_type_code: row.dataset.truckCode,
      setup_minutes: Number(row.querySelector('input[name="setup_minutes"]').value || 0),
      is_active: true,
    }));
  // Which docks currently take everything the location takes. Read before the
  // location's list changes, because "everything" is about to mean something else.
  const before = locationTypeCodes();
  const unrestricted = before.length
    ? state.docks.filter(dock => { const codes = dockTypeCodes(dock.id); return before.every(code => codes.has(code)); })
    : [];
  const after = toEnable.map(row => row.truck_type_code);

  await db.remove('location_truck_types', q => q.eq('location_id', state.locationId), { select: false });
  if (toEnable.length) await db.insert('location_truck_types', toEnable, { select: false, single: false });

  // A type the location just turned off cannot stay bookable at a door, and a type
  // it just turned on has to reach every dock that was set to take all of them —
  // otherwise "All types" on the dock list stops being true and the database
  // refuses a booking the settings page says is fine.
  const removed = before.filter(code => !after.includes(code));
  if (removed.length) await db.remove('dock_truck_types', q => q.eq('location_id', state.locationId).in('truck_type_code', removed), { select: false });
  for (const dock of unrestricted) {
    await db.remove('dock_truck_types', q => q.eq('dock_id', dock.id), { select: false });
    if (after.length) await db.insert('dock_truck_types', after.map(code => ({ dock_id: dock.id, location_id: state.locationId, truck_type_code: code })), { select: false });
  }
  db.invalidate(`settings:location-truck-types:${state.locationId}`);
  db.invalidate(`settings:dock-truck-types:${state.locationId}`);
}

// Everything on this page applies to whichever site is selected in the top bar.
// An administrator who works across sites can change the wrong one without ever
// looking at the picker, so the save names the site and asks first. Single-site
// accounts have nothing to get wrong and are not interrupted.
function confirmLocation() {
  if (state.context.locations.length <= 1) return true;
  return globalThis.confirm(`Apply these changes to ${state.context.location.name}?`);
}

async function submitSection(event) {
  event.preventDefault();
  const form = event.target;
  const kind = form.dataset.sectionForm;
  if (!confirmLocation()) return;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    if (kind === 'hours') await saveHours(form);
    else if (kind === 'timing') await saveTiming(form);
    else if (kind === 'notice') await saveNotice(form);
    else if (kind === 'capacity') await saveCapacity(form);
    else if (kind === 'assignment') await saveAssignment(form);
    else if (kind === 'docks') await saveDocks(form);
    else if (kind === 'truck-types') await saveTruckTypes(form);
    db.invalidate('booking:');
    await fetchAll();
    toast('Settings saved.', 'success');
    renderPanel();
  } catch (error) {
    showMessage(form, error.userMessage || 'This could not be saved.', true);
    toast(error.userMessage || 'This could not be saved.', 'error');
  } finally {
    submit.disabled = false;
  }
}

// Restriction off means this dock takes anything the location takes; on means only
// the ticked types back up to it. Both are written out as explicit rows, because
// that is what the database checks a booking against.
function applyDockRestrict(restricted) {
  const form = state.elements.dockForm;
  const fieldset = form.querySelector('[data-dock-restrict-fieldset]');
  fieldset.disabled = !restricted || !state.canManage;
  fieldset.hidden = !restricted;
}

function openDockModal(dockId) {
  state.editingDockId = dockId || null;
  const dock = dockId ? state.docks.find(item => item.id === dockId) : null;
  const enabledCodes = dockId ? dockTypeCodes(dockId) : new Set(locationTypeCodes());
  const modal = state.elements.dockBackdrop;
  modal.querySelector('[data-dock-modal-title]').textContent = dock ? 'Edit dock' : 'Add dock';
  const form = state.elements.dockForm;
  form.reset();
  form.elements.name.value = dock?.name || '';
  form.elements.description.value = dock?.description || '';
  form.elements.sort_order.value = dock?.sort_order || (state.docks.length + 1);
  form.elements.direction_mode.value = dock?.direction_mode || 'both';
  const activeSwitch = form.querySelector('[data-dock-active-switch]');
  const isActive = dock ? dock.is_active : true;
  activeSwitch.classList.toggle('switch--off', !isActive);
  activeSwitch.setAttribute('aria-pressed', String(isActive));
  const offered = locationTypeCodes();
  form.querySelector('[data-dock-checks]').innerHTML = state.truckTypes
    .filter(type => offered.includes(type.code))
    .map(type => `<label class="dock-check" title="${escapeHtml(type.name)}"><input type="checkbox" name="truck_type_code" value="${type.code}" ${enabledCodes.has(type.code) ? 'checked' : ''}><span>${escapeHtml(type.name)}</span></label>`)
    .join('') || '<p class="hint">No truck types are enabled at this location yet — enable them below before a dock can take anything.</p>';
  const restricted = dockId ? dockIsRestricted(dockId) : false;
  const restrictSwitch = form.querySelector('[data-dock-restrict-switch]');
  restrictSwitch.classList.toggle('switch--off', !restricted);
  restrictSwitch.setAttribute('aria-pressed', String(restricted));
  applyDockRestrict(restricted);
  state.dockModal.open({ trigger: document.activeElement });
}

async function submitDock(event) {
  event.preventDefault();
  if (!confirmLocation()) return;
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  const name = form.elements.name.value.trim();
  if (!name) { toast('Dock name is required.', 'error'); return; }
  // A dock with nothing ticked would be saved as a door no truck can be booked
  // against, which is how a site ends up looking configured and refusing every
  // booking. Say so here rather than letting the database say it later.
  const restricted = form.querySelector('[data-dock-restrict-switch]').getAttribute('aria-pressed') === 'true';
  const codes = restricted
    ? [...form.querySelectorAll('input[name="truck_type_code"]:checked')].map(input => input.value)
    : locationTypeCodes();
  if (!codes.length) {
    toast(restricted ? 'Choose at least one truck type this dock can take.' : 'Enable at least one truck type at this location first.', 'error');
    return;
  }
  submit.disabled = true;
  try {
    const isActive = form.querySelector('[data-dock-active-switch]').getAttribute('aria-pressed') === 'true';
    const payload = {
      name,
      description: form.elements.description.value.trim() || null,
      sort_order: Number(form.elements.sort_order.value) || 1,
      direction_mode: form.elements.direction_mode.value,
      is_active: isActive,
    };
    let dockId = state.editingDockId;
    if (dockId) {
      await db.update('docks', payload, q => q.eq('id', dockId), { select: false });
    } else {
      const created = await db.insert('docks', { ...payload, location_id: state.locationId }, { select: 'id' });
      dockId = created.id;
    }
    await db.remove('dock_truck_types', q => q.eq('dock_id', dockId), { select: false });
    await db.insert('dock_truck_types', codes.map(code => ({ dock_id: dockId, location_id: state.locationId, truck_type_code: code })), { select: false });
    db.invalidate(`settings:docks:${state.locationId}`);
    db.invalidate(`settings:dock-truck-types:${state.locationId}`);
    db.invalidate('board:docks:');
    await fetchAll();
    renderPanel();
    state.dockModal.close();
    toast(dockId === state.editingDockId ? 'Dock updated.' : 'Dock added.', 'success');
  } catch (error) {
    toast(error.userMessage || 'The dock could not be saved.', 'error');
  } finally {
    submit.disabled = false;
  }
}

function buildShell(root) {
  root.innerHTML = `
    ${pageHead('Locations & docks', { actions: ['print'] })}
    <div class="setlayout">
      <nav class="setnav" data-set-nav aria-label="Settings sections"></nav>
      <div class="setpanel" data-set-panel></div>
    </div>
    <div class="scrim" data-dock-backdrop hidden aria-hidden="true">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="dock-modal-title">
        <div class="modal__head"><div><h2 class="modal__title" id="dock-modal-title" data-dock-modal-title>Add dock</h2></div><button class="modal__x" type="button" data-close-dock aria-label="Close">×</button></div>
        <form data-dock-form>
          <div class="modal__body">
            <div class="frow">
              <label class="field field--sm"><span class="field__label">Name</span><input class="input" name="name" maxlength="80" required></label>
              <label class="field field--xs"><span class="field__label">Order</span><input class="input" type="number" name="sort_order" min="1" required></label>
              <label class="field field--sm"><span class="field__label">Direction</span><select class="select" name="direction_mode"><option value="both">Both</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></label>
              <label class="field field--md"><span class="field__label">Description <span class="field__opt">optional</span></span><input class="input" name="description" maxlength="200"></label>
            </div>
            <div class="setrow setrow--tight"><div class="setrow__t">Active</div><button type="button" class="switch" data-dock-active-switch aria-label="Dock active"></button></div>
            <div class="setrow"><div><div class="setrow__t">Restrict truck types</div><div class="setrow__d">Off, this dock takes every truck type this location accepts. On, only the ones ticked can back up to it.</div></div><button type="button" class="switch" data-dock-restrict-switch aria-label="Restrict truck types"></button></div>
            <fieldset class="dock-checks" data-dock-restrict-fieldset>
              <legend>Truck types this dock accepts<span class="checkall"><button class="linkBtn" type="button" data-dock-check-all>Select all</button><button class="linkBtn" type="button" data-dock-check-none>Select none</button></span></legend>
              <div data-dock-checks></div>
            </fieldset>
          </div>
          <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close-dock>Cancel</button><button class="btn btn--primary" type="submit">Save dock</button></div>
        </form>
      </section>
    </div>`;
  state.elements = {
    root,
    subtitle: root.querySelector('[data-subtitle]'),
    nav: root.querySelector('[data-set-nav]'),
    panel: root.querySelector('[data-set-panel]'),
    dockBackdrop: root.querySelector('[data-dock-backdrop]'),
    dockForm: root.querySelector('[data-dock-form]'),
  };
  state.dockModal = createModal(state.elements.dockBackdrop, { onRequestClose: () => state.dockModal.close() });
}

function wireEvents(root) {
  // The hours field only means anything when the window mode asks for one.
  root.addEventListener('change', event => {
    const mode = event.target.closest('[data-consolidation-mode]');
    if (!mode) return;
    const form = mode.closest('form');
    const hours = form.elements.consolidation_window_hours;
    const unit = form.elements.consolidation_window_hours__unit;
    hours.disabled = mode.value !== 'hours';
    if (unit) unit.disabled = hours.disabled;
    if (hours.disabled) hours.value = '';
    else hours.focus();
  });
  root.addEventListener('click', event => {
    const navButton = event.target.closest('[data-set-nav] button');
    if (navButton) { switchSection(navButton.dataset.section); return; }
    if (event.target.closest('[data-print]')) { globalThis.print(); return; }
    if (event.target.closest('[data-reset]')) { renderPanel(); return; }
    const toggle = event.target.closest('.switch');
    if (toggle && !toggle.disabled) {
      const off = toggle.classList.toggle('switch--off');
      toggle.setAttribute('aria-pressed', String(!off));
      if (toggle.hasAttribute('data-hours-switch')) {
        const row = toggle.closest('.hourrow');
        row.querySelectorAll('input[type="time"]').forEach(input => { input.disabled = off; });
      }
      if (toggle.hasAttribute('data-dock-restrict-switch')) applyDockRestrict(!off);
      return;
    }
    const checkAll = event.target.closest('[data-dock-check-all], [data-dock-check-none]');
    if (checkAll) {
      const checked = checkAll.hasAttribute('data-dock-check-all');
      for (const input of state.elements.dockForm.querySelectorAll('input[name="truck_type_code"]')) input.checked = checked;
      return;
    }
    if (event.target.closest('[data-add-dock]')) { openDockModal(null); return; }
    const editDock = event.target.closest('[data-edit-dock]');
    if (editDock) { openDockModal(editDock.dataset.editDock); return; }
    if (event.target.closest('[data-close-dock]')) state.dockModal.close();
  });
  root.addEventListener('submit', event => {
    if (event.target.matches('[data-section-form]')) submitSection(event);
  });
  state.elements.dockForm.addEventListener('submit', submitDock);
}

const page = {
  code: 'settings',
  permission: 'settings.view',
  async mount(context) {
    state.context = context;
    state.locationId = context.location.id;
    state.canManage = context.can('settings.manage');
    state.canManageDocks = context.can('dock.manage');
    document.title = `Locations & docks · ${context.location.name} · MaxDock`;
    buildShell(context.pageRoot);
    wireEvents(context.pageRoot);
    state.elements.subtitle.textContent = `${context.location.name} · operating rules`;
    await fetchAll();
    switchSection(state.section);
  },
  refresh() {},
  destroy() { state.dockModal?.destroy(); },
};

startPage(page);
export const { mount, refresh, destroy } = page;
