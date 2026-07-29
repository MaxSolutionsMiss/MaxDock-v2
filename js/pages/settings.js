import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { createModal } from '../ui/modal.js';
import { pageHead } from '../ui/pagehead.js';
import { format } from '../format.js';
import { createShortcutCard } from '../ui/shortcut-card.js';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SLOT_INTERVALS = [5, 10, 15, 20, 30, 60];

// One subject to a section, named for what it is. A section that holds two
// unrelated subjects makes both harder to find — "Docks & truck types" was two
// screens with an ampersand between them, and the rule for combining loads was
// buried under Dock assignment where nobody would look for it.
const SECTIONS = [
  { id: 'hours', label: 'Operating hours' },
  { id: 'timing', label: 'Timing & duration' },
  { id: 'notice', label: 'Booking window & notice' },
  { id: 'capacity', label: 'Capacity' },
  { id: 'combining', label: 'Combining loads' },
  { id: 'docks', label: 'Docks' },
  { id: 'trucks', label: 'Truck types' },
  { id: 'labour', label: 'Labour' },
  { id: 'quickqr', label: 'Quick QR (QQ)' },
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
  directionWindows: [],
  // Which windows are unlocked for editing right now, by section-form name.
  editing: new Set(),
  appointmentTypes: [],
  handlingTypes: [],
  shortcuts: [],
  locations: [],
  elements: {},
  dockModal: null,
  editingDockId: null,
  shortcutModal: null,
  shortcutCard: null,
  editingShortcutId: null,
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const timeInput = value => (value ? String(value).slice(0, 5) : '');

// A datetime-local input speaks the browser's local clock with no zone. The
// stored value is an instant, so it is rendered in the location's own time —
// a count taken at 7am in Langley is 7am to the person who took it.
function localDateTime(value) {
  if (!value) return '';
  const location = state.context?.location;
  return `${format.inputDate(value, location)}T${format.inputTime(value, location)}`;
}

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
const LEAD_UNITS = ['hours', 'days'];
// A code that picks its own time always leaves a gap; four hours is the working
// default, so the field is never a blank nobody knows to fill in.
const LEAD_DEFAULT_MINUTES = 240;

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
  const [hours, settings, docks, truckTypes, locationTruckTypes, dockTruckTypes, capacity, directionWindows,
    appointmentTypes, handlingTypes, shortcuts] = await Promise.all([
    db.select('location_operating_hours', q => q.select('location_id,day_of_week,is_open,open_time,close_time').eq('location_id', locationId), { key: `settings:hours:${locationId}`, cache: 0 }),
    db.select('location_settings', q => q.select('*').eq('location_id', locationId).maybeSingle(), { key: `settings:row:${locationId}`, cache: 0 }),
    db.select('docks', q => q.select('id,name,description,sort_order,direction_mode,is_active').eq('location_id', locationId).order('sort_order').order('name'), { key: `settings:docks:${locationId}`, cache: 0 }),
    db.select('truck_types', q => q.select('code,name').eq('is_active', true).order('sort_order'), { key: 'truck-types:active', cache: 60000 }),
    db.select('location_truck_types', q => q.select('truck_type_code,setup_minutes,is_active,skid_capacity').eq('location_id', locationId), { key: `settings:location-truck-types:${locationId}`, cache: 0 }),
    db.select('dock_truck_types', q => q.select('dock_id,truck_type_code').eq('location_id', locationId), { key: `settings:dock-truck-types:${locationId}`, cache: 0 }),
    db.rpc('get_location_capacity_projection', { p_location_id: locationId, p_at: format.nowIso(), p_direction: 'inbound', p_skid_count: 0 }, { key: `settings:capacity:${locationId}`, cache: 0, retry: 1 }).catch(() => null),
    db.rpc('list_dock_direction_windows', { p_location_id: locationId }, { key: `settings:windows:${locationId}`, cache: 0, retry: 1 }).catch(() => []),
    db.select('appointment_types', q => q.select('code,name').eq('is_active', true).order('sort_order'), { key: 'appointment-types:active', cache: 60000 }),
    db.select('handling_types', q => q.select('code,name').eq('is_active', true).order('sort_order'), { key: 'handling-types:active', cache: 60000 }),
    db.select('booking_templates', q => q
      .select('id,owner_user_id,location_id,name,is_shared,direction,requester_type,company_name,appointment_type_code,truck_type_code,skid_count,handling_type_code,is_priority,carrier_name,auto_time,lead_minutes,updated_at')
      .eq('location_id', locationId).eq('is_shared', true).order('name'), { key: `settings:shortcuts:${locationId}`, cache: 0 }),
  ]);
  state.hours = hours || [];
  state.capacity = Array.isArray(capacity) ? capacity[0] || null : capacity || null;
  state.settings = settings || null;
  state.docks = docks || [];
  state.truckTypes = truckTypes || [];
  state.locationTruckTypes = locationTruckTypes || [];
  state.dockTruckTypes = dockTruckTypes || [];
  state.directionWindows = groupWindows(directionWindows);
  state.appointmentTypes = appointmentTypes || [];
  state.handlingTypes = handlingTypes || [];
  state.shortcuts = shortcuts || [];
}

// Every settings window ends the same way: Reset, Save, Edit — one size, in that
// order, and the same size as Add dock at the top of the window, because controls
// that do the same kind of job should not be two different shapes on one screen.
// A window arrives locked; nothing on a settings screen should change because
// somebody leaned on a dropdown while reading it. Edit unlocks the window it
// belongs to; Save puts it back to locked; Reset throws the edit away and does
// the same.
function saveFoot(canEdit) {
  if (!canEdit) return '';
  return `<div class="form-actions form-actions--edit">
    <button class="btn btn--quiet btn--sm" type="button" data-reset>Reset</button>
    <button class="btn btn--primary btn--sm" type="submit">Save</button>
    <button class="btn btn--primary btn--sm" type="button" data-edit-section>Edit</button>
  </div><p class="form-message" data-save-message aria-live="polite"></p>`;
}

// Locking is applied after the markup is drawn, not baked into it, so a control
// that is already disabled for its own reason — a closing time on a day the site
// is shut, the window length when the mode is "same day" — stays disabled when
// the window is unlocked. What that control was before the lock is remembered on
// the element itself, because the panel is re-rendered from scratch on every
// change and there is nowhere else for it to live.
function applyLocks() {
  for (const form of state.elements.panel.querySelectorAll('[data-section-form]')) {
    const foot = form.querySelector('.form-actions--edit');
    if (!foot) continue;
    const editing = state.editing.has(form.dataset.sectionForm);
    for (const control of form.querySelectorAll('input,select,textarea,button')) {
      // A control that opens its own dialog and saves on its own is not part of
      // this window's Save, so the lock has nothing to do with it — Add dock is
      // still Add dock while the in-service switches beside it are locked.
      if (foot.contains(control) || control.hasAttribute('data-unlocked')) continue;
      if (editing) control.disabled = control.dataset.lockedWas === '1';
      else {
        control.dataset.lockedWas = control.disabled ? '1' : '0';
        control.disabled = true;
      }
    }
    foot.querySelector('[data-edit-section]').disabled = editing;
    foot.querySelector('[data-reset]').disabled = !editing;
    foot.querySelector('[type="submit"]').disabled = !editing;
  }
}

function editSection(form) {
  state.editing.add(form.dataset.sectionForm);
  applyLocks();
  form.querySelector('input:not([disabled]),select:not([disabled]),textarea:not([disabled])')?.focus();
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
  return `<div class="stack"><form data-section-form="hours">
    <h3 class="card__title">Operating hours</h3>
    <div class="hours">${rows}</div>
    <p class="hint">Staff may book outside these hours with a warning. Customers cannot.</p>
    ${saveFoot(canEdit)}
  </form>
  ${renderDirectionWindows(canEdit)}</div>`;
}

// When this site takes inbound and when it takes outbound.
//
// A window with no dock applies to every door here, which is how "inbound before
// noon, outbound after" is said once instead of once per dock. No windows at all
// means the site takes either direction whenever it is open, which is how every
// location behaves today and stays behaving until somebody adds a row.
// One window on screen can stand for several stored rows: the database keeps a
// row per dock per day, which is what the booking rules read, and the owner sets
// them the way he says them — "docks one, two and three take inbound, Monday to
// Thursday, before noon" is one thing to say, not twelve.
function directionWindowRow(row, index, canEdit) {
  const disabled = canEdit ? '' : 'disabled';
  const docks = new Set(row.dock_ids || []);
  const days = new Set((row.days || []).map(String));
  const dockChecks = state.docks.map(dock => `<label class="dock-check"><input type="checkbox" data-window-dock value="${dock.id}" ${docks.has(dock.id) ? 'checked' : ''} ${disabled}><span>${escapeHtml(dock.name)}</span></label>`).join('');
  const dayChecks = DAY_ORDER.map(day => `<label class="dock-check"><input type="checkbox" data-window-day value="${day}" ${days.has(String(day)) ? 'checked' : ''} ${disabled}><span>${DAY_LABELS[day]}</span></label>`).join('');
  return `<fieldset class="dock-checks dirwin" data-window="${index}">
    <legend>Window ${index + 1}${canEdit ? '<button class="btn btn--danger btn--icon at-end" type="button" data-remove-window aria-label="Remove this window" title="Remove this window">×</button>' : ''}</legend>
    <fieldset class="pickgroup"><div class="frow">
      <div class="field field--md"><span class="field__label">This site</span><select class="select" data-window-direction ${disabled}>
        <option value="inbound" ${row.direction === 'inbound' ? 'selected' : ''}>takes inbound</option>
        <option value="outbound" ${row.direction === 'outbound' ? 'selected' : ''}>takes outbound</option>
      </select></div>
      <div class="field field--sm"><span class="field__label">From</span><input class="input" type="time" data-window-start value="${escapeHtml(timeInput(row.start_time))}" ${disabled}></div>
      <div class="field field--sm"><span class="field__label">To</span><input class="input" type="time" data-window-end value="${escapeHtml(timeInput(row.end_time))}" ${disabled}></div>
    </div></fieldset>
    <fieldset class="dock-checks pickgroup"><legend>Docks · none ticked means every dock</legend>${dockChecks}</fieldset>
    <fieldset class="dock-checks pickgroup"><legend>Days · none ticked means every day</legend>${dayChecks}</fieldset>
  </fieldset>`;
}

function renderDirectionWindows(canEdit) {
  const rows = state.directionWindows.map((row, index) => directionWindowRow(row, index, canEdit)).join('');
  return `<form data-section-form="direction-windows">
    <h3 class="card__title">Inbound and outbound hours${canEdit ? '<button class="btn btn--quiet btn--sm at-end" type="button" data-add-window>Add a window</button>' : ''}</h3>
    <div class="dirlist">${rows || '<p class="hint">No windows set. This location takes inbound and outbound at any time it is open.</p>'}</div>
    <p class="hint hint--wide">A window says when a door takes a direction. Tick the docks and the days it applies to, or leave a list empty to mean all of them. A load must fit entirely inside a window, so an outbound running past the end of the outbound period is not offered. Each dock's own Inbound or Outbound setting still applies.</p>
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

// What MaxDock will actually fill: the floor less whatever is held back. Shown
// because "Free now 80" against a capacity of 100 reads as arithmetic nobody
// asked for until the 20 being reserved is on the same row.
function workingLimit(settings) {
  const total = Number(settings.skid_capacity || 0);
  if (!total) return '—';
  return Math.max(total - Number(settings.capacity_reserve_skids || 0), 0);
}

function renderCapacity() {
  const s = state.settings || {};
  const canEdit = state.canManage;
  const disabled = canEdit ? '' : 'disabled';
  const enabled = s.capacity_enabled === true;
  return `<div class="stack"><form data-section-form="capacity">
    <h3 class="card__title">Capacity</h3>
    <div class="setrow setrow--lead">
      <div><div class="setrow__t">Enforce skid capacity</div><div class="setrow__d">Track occupied skids against how much this floor holds</div></div>
      <button type="button" class="switch ${enabled ? '' : 'switch--off'}" data-capacity-switch aria-pressed="${enabled}" aria-label="Enforce skid capacity" ${disabled}></button>
    </div>
    <div class="frow">
      <div class="field field--num"><span class="field__label">Floor capacity</span><span class="inputwrap"><input class="input" type="number" min="1" name="skid_capacity" value="${s.skid_capacity ?? ''}" ${disabled}><span class="input__unit">skids</span></span></div>
      <div class="field field--num"><span class="field__label">Reserve</span><span class="inputwrap"><input class="input" type="number" min="0" name="capacity_reserve_skids" value="${s.capacity_reserve_skids ?? 0}" ${disabled}><span class="input__unit">skids</span></span></div>
      <div class="field field--num"><span class="field__label">Working limit</span><span class="inputwrap"><input class="input" value="${workingLimit(s)}" readonly tabindex="-1" aria-label="Working limit, calculated"><span class="input__unit">skids</span></span></div>
      <div class="field field--lg"><span class="field__label">When over capacity</span><select class="select" name="capacity_enforcement_mode" ${disabled}>
        <option value="warn" ${s.capacity_enforcement_mode === 'warn' ? 'selected' : ''}>Warn only</option>
        <option value="enforce" ${s.capacity_enforcement_mode === 'enforce' ? 'selected' : ''}>Block booking</option>
      </select></div>
    </div>
    <fieldset class="countset">
      <legend>Counted stock</legend>
      <div class="frow">
        <div class="field field--num"><span class="field__label">Counted</span><span class="inputwrap"><input class="input" type="number" min="0" name="current_occupied_skids" value="${s.current_occupied_skids ?? 0}" ${disabled}><span class="input__unit">skids</span></span></div>
        <div class="field field--md"><span class="field__label">As of</span><input class="input" type="datetime-local" name="inventory_as_of" value="${escapeHtml(localDateTime(s.inventory_as_of))}" ${disabled}></div>
        <div class="field field--num"><span class="field__label">Occupied now</span><span class="inputwrap"><input class="input" value="${state.capacity?.projected_before ?? s.current_occupied_skids ?? 0}" readonly tabindex="-1" aria-label="Occupied now, calculated"><span class="input__unit">skids</span></span></div>
        <div class="field field--num"><span class="field__label">Free now</span><span class="inputwrap"><input class="input" value="${state.capacity?.available_after ?? '—'}" readonly tabindex="-1" aria-label="Free now, calculated"><span class="input__unit">skids</span></span></div>
      </div>
      <p class="hint hint--wide">Floor capacity is how many skids this site holds; the reserve is held back and never booked into, so the working limit is what MaxDock will fill. Enter a floor count and the time it was taken. MaxDock keeps it current from there: every booked inbound adds, every outbound subtracts. Occupied now and Free now are calculated${s.capacity_last_source === 'mis' ? ', last set from an MIS import' : ''}.</p>
    </fieldset>
    ${saveFoot(canEdit)}
  </form>
  ${renderTruckCapacity(canEdit)}</div>`;
}

function renderAssignment() {
  const s = state.settings || {};
  const canEdit = state.canManage;
  const disabled = canEdit ? '' : 'disabled';
  const autoAssign = s.auto_assign_dock !== false;
  const consolidation = s.suggest_same_day_consolidation !== false;
  return `<form data-section-form="assignment">
    <h3 class="card__title">Dock assignment</h3>
    <div class="setrow setrow--lead">
      <div><div class="setrow__t">Auto-assign docks</div><div class="setrow__d">MaxDock picks the dock for each booking</div></div>
      <button type="button" class="switch ${autoAssign ? '' : 'switch--off'}" data-assign-switch aria-pressed="${autoAssign}" aria-label="Auto-assign docks" ${disabled}></button>
    </div>
    <div class="frow">
      <div class="field field--md"><span class="field__label">Assignment strategy</span><select class="select" name="dock_assignment_strategy" ${disabled}>
        <option value="balanced" ${s.dock_assignment_strategy === 'balanced' ? 'selected' : ''}>Balanced across docks</option>
        <option value="fill_first" ${s.dock_assignment_strategy === 'fill_first' ? 'selected' : ''}>Fill one dock first</option>
      </select></div>
      <div class="field field--num"><span class="field__label">Max concurrent</span><span class="inputwrap"><input class="input" type="number" min="1" name="max_concurrent_appointments" value="${s.max_concurrent_appointments ?? ''}" placeholder="∞" ${disabled}><span class="input__unit">at once</span></span></div>
    </div>
    <p class="hint hint--wide">How MaxDock chooses a dock for a booking, and the most trucks it will put on the docks at one time.</p>
    ${saveFoot(canEdit)}
  </form>`;
}

// Labour is its own section rather than three fields at the bottom of Dock
// assignment. It is not about docks — it is about people, it is the setting a
// site revisits when the crew changes, and buried under a heading about dock
// choice nobody would go looking for it.
function renderLabour() {
  const s = state.settings || {};
  const canEdit = state.canManage;
  const disabled = canEdit ? '' : 'disabled';
  return `<form data-section-form="labour">
    <h3 class="card__title">Labour</h3>
    <p class="hint hint--wide hint--lead">What a truck costs in people, and what the site has to spend on a normal day. The operations brief reports the day's booked hours against that — the number to look at before agreeing to a day off.</p>
    <div class="frow">
      <div class="field field--num"><span class="field__label">Crew per truck</span><span class="inputwrap"><input class="input" type="number" min="0" max="50" name="handlers_per_truck" value="${s.handlers_per_truck ?? 2}" ${disabled}><span class="input__unit">people</span></span></div>
      <div class="field field--num"><span class="field__label">Crew on shift</span><span class="inputwrap"><input class="input" type="number" min="0" max="500" name="crew_size" value="${s.crew_size ?? 0}" ${disabled}><span class="input__unit">people</span></span></div>
      <div class="field field--num"><span class="field__label">Shift length</span><span class="inputwrap"><input class="input" type="number" min="1" max="24" step="0.5" name="shift_hours" value="${s.shift_hours ?? 8}" ${disabled}><span class="input__unit">hours</span></span></div>
      <div class="field field--num"><span class="field__label">On the dock</span><span class="inputwrap"><input class="input" type="number" min="1" max="100" name="crew_availability_percent" value="${s.crew_availability_percent ?? 80}" ${disabled}><span class="input__unit">%</span></span></div>
    </div>
    <p class="hint hint--wide">Nobody unloads trucks for eight hours out of eight, so <strong>On the dock</strong> is the share of a shift realistically spent on them — six people on an eight-hour shift at 80% is 38.4 dock hours to work with. Leave <strong>Crew on shift</strong> at 0 and the brief states what the day costs and says nothing about capacity, rather than guessing at a number this site never gave.</p>
    ${saveFoot(canEdit)}
  </form>`;
}

// When MaxDock offers to put two loads on one truck.
//
// "On the same day" is the behaviour this has always had. "Within a set window"
// narrows or widens it to that many hours either side of the proposed time — an
// eight-hour window means a load eight hours earlier is still worth combining
// with, a two-hour window means only something close to it is.
function renderCombining() {
  const s = state.settings || {};
  const canEdit = state.canManage;
  const disabled = canEdit ? '' : 'disabled';
  const consolidation = s.suggest_same_day_consolidation !== false;
  return `<form class="card" data-section-form="combining">
    <h3 class="card__title">Combining loads</h3>
    <div class="setrow setrow--lead">
      <div><div class="setrow__t">Offer to combine</div><div class="setrow__d">Point out loads already booked that could travel together</div></div>
      <button type="button" class="switch ${consolidation ? '' : 'switch--off'}" data-consolidation-switch aria-pressed="${consolidation}" aria-label="Offer to combine loads" ${disabled}></button>
    </div>
    <div class="frow">
      <div class="field field--md"><span class="field__label">Look for loads</span><select class="select" name="consolidation_window_mode" data-consolidation-mode ${disabled}>
        <option value="day" ${s.consolidation_window_hours ? '' : 'selected'}>On the same day</option>
        <option value="hours" ${s.consolidation_window_hours ? 'selected' : ''}>Within a set window</option>
      </select></div>
      ${durationField('Window', 'consolidation_window_hours', s.consolidation_window_hours ?? '', 'hours', WINDOW_UNITS, s.consolidation_window_hours ? disabled : 'disabled')}
    </div>
    <p class="hint hint--wide">Turned off, MaxDock never mentions other loads and never asks before booking. On the same day is the widest setting; a window narrows it to that many hours either side of the time being booked, so a twelve-hour window catches a morning load for an afternoon one and a two-hour window does not.</p>
    ${saveFoot(canEdit)}
  </form>`;
}

// How many skids each truck type holds here. The same 53 ft trailer is 26 skids
// single stacked and 52 double stacked, and two sites can load it differently,
// so the number belongs to the location. Blank means not stated, which reads as
// unknown — a zero would claim the trailer holds nothing.
function renderTruckCapacity(canEdit) {
  const disabled = canEdit ? '' : 'disabled';
  const enabled = state.locationTruckTypes.filter(row => row.is_active !== false);
  const rows = state.truckTypes
    .filter(type => enabled.some(row => row.truck_type_code === type.code))
    .map(type => {
      const row = enabled.find(item => item.truck_type_code === type.code);
      return `<div class="setrow setrow--compact" data-capacity-code="${type.code}">
        <div><div class="setrow__t">${escapeHtml(type.name)}</div></div>
        <div class="setrow__ctl"><span class="inputwrap">
          <input class="input input--mins" type="number" min="1" name="skid_capacity" value="${row?.skid_capacity ?? ''}" placeholder="—" ${disabled} aria-label="${escapeHtml(type.name)} skid capacity">
          <span class="input__unit">skids</span>
        </span></div>
      </div>`;
    }).join('');
  return `<form data-section-form="truck-capacity">
    <h3 class="card__title">Skids per truck</h3>
    ${rows || '<p class="hint">No truck types are enabled at this location yet.</p>'}
    <p class="hint hint--wide">What each truck holds when this site loads it. Set it to how you actually stack, single or double. This is what tells a planner how full a booked load is and how much room is left on it.</p>
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
    <td>${canEditDocks ? `<button class="btn btn--quiet btn--sm" type="button" data-unlocked data-edit-dock="${dock.id}">Edit</button>` : ''}</td>
  </tr>`).join('') || '<tr><td colspan="5" class="data">No docks configured for this location.</td></tr>';

  // Five short columns, so the window is sized to them: Add dock lands over the
  // Edit column rather than out at the edge of a wide monitor, and the note under
  // the table wraps instead of running the width of the screen.
  //
  // Dock assignment sits under the table it decides between. It is about docks, so
  // it is found where the docks are rather than under a heading of its own.
  return `<div class="stack stack--table">
    <form data-section-form="docks">
      <h3 class="card__title">Docks${canEditDocks ? '<button class="btn btn--primary btn--sm at-end" type="button" data-unlocked data-add-dock>Add dock</button>' : ''}</h3>
      <div class="tablewrap"><table class="table"><thead><tr><th>Dock</th><th>Direction</th><th>In service</th><th class="col-fill">Truck types</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hint">Add dock and Edit save on their own. Save below applies the in-service switches.</p>
      ${saveFoot(canEditDocks)}
    </form>
    ${renderAssignment()}</div>`;
}

function renderTruckTypes() {
  const locationTypes = state.locationTruckTypes;
  const truckRows = state.truckTypes.map(type => {
    const enabled = locationTypes.find(row => row.truck_type_code === type.code);
    return `<div class="setrow setrow--compact" data-truck-code="${type.code}">
      <div><div class="setrow__t">${escapeHtml(type.name)}</div></div>
      <div class="setrow__ctl">
        <span class="inputwrap"><input class="input input--mins" type="number" min="0" name="setup_minutes" value="${enabled ? enabled.setup_minutes : 0}" ${state.canManage ? '' : 'disabled'} aria-label="${escapeHtml(type.name)} setup minutes"><span class="input__unit">min setup</span></span>
        <button type="button" class="switch ${enabled?.is_active !== false && enabled ? '' : 'switch--off'}" data-truck-switch aria-pressed="${Boolean(enabled)}" aria-label="Enable ${escapeHtml(type.name)}" ${state.canManage ? '' : 'disabled'}></button>
      </div>
    </div>`;
  }).join('');
  // A truck type is a company-wide code, so only a System Admin makes one — which
  // is also what the database allows. The rest of the section is per-location.
  const canAdd = state.context?.profile?.role_code === 'system_admin';
  return `<form class="card card--table" data-section-form="truck-types">
      <h3 class="card__title">Truck types enabled at this location${canAdd ? '<button class="btn btn--primary btn--sm at-end" type="button" data-unlocked data-add-truck-type>Add truck type</button>' : ''}</h3>
      ${truckRows}
      <p class="hint">Setup minutes here override the truck type's default for this location only. Skids per truck is under Capacity.</p>
      ${saveFoot(state.canManage)}
    </form>`;
}

// Quick QR — a booking somebody does over and over, saved once and reachable
// with a phone camera.
//
// Mississauga sends to Guelph on a 53 with 33 skids, always outbound. That is
// not a setting, it is a shortcut: the code goes on the wall, the driver's
// coordinator scans it, and the booking form opens with everything filled in
// but the time. Changing what a code books is editing the shortcut behind it —
// the printed code keeps working, because it points at the shortcut, not at a
// copy of its contents.
function shortcutRoute(shortcut) {
  const here = state.context?.location?.name || 'This site';
  const party = String(shortcut.company_name || shortcut.requester_type || '').trim() || 'Not named';
  return String(shortcut.direction || '').toLowerCase() === 'outbound' ? `${here} → ${party}` : `${party} → ${here}`;
}

function labelFor(rows, code) {
  return rows.find(row => row.code === code)?.name || code || '—';
}

function shortcutDetail(shortcut) {
  return [
    labelFor(state.appointmentTypes, shortcut.appointment_type_code),
    labelFor(state.truckTypes, shortcut.truck_type_code),
    `${Number(shortcut.skid_count || 0)} skids`,
    labelFor(state.handlingTypes, shortcut.handling_type_code),
    shortcut.auto_time
      ? `MaxDock picks the time${shortcut.lead_minutes ? `, ${format.duration(shortcut.lead_minutes)} ahead at the earliest` : ''}`
      : 'The person picks the time',
  ].join(' · ');
}

function renderQuickQr() {
  const canEdit = state.canManage;
  const rows = state.shortcuts.map(shortcut => `<div class="setrow" data-shortcut-row="${shortcut.id}">
      <div>
        <div class="setrow__t">${escapeHtml(shortcut.name)}</div>
        <div class="setrow__d">${escapeHtml(shortcutRoute(shortcut))} · ${escapeHtml(shortcutDetail(shortcut))}</div>
      </div>
      <div class="setrow__ctl">
        <button class="btn btn--primary btn--sm" type="button" data-print-shortcut="${shortcut.id}">Print code</button>
        ${canEdit ? `<button class="btn btn--quiet btn--sm" type="button" data-edit-shortcut="${shortcut.id}">Edit</button>` : ''}
        ${canEdit ? `<button class="btn btn--quiet btn--sm" type="button" data-delete-shortcut="${shortcut.id}">Delete</button>` : ''}
      </div>
    </div>`).join('');
  return `<form class="card" data-section-form="quickqr">
    <h3 class="card__title">Quick QR (QQ)${canEdit ? '<button class="btn btn--primary btn--sm at-end" type="button" data-add-shortcut>New code</button>' : ''}</h3>
    ${rows || '<p class="hint">No quick codes yet. Make one for a run this site books over and over.</p>'}
    <p class="hint hint--wide">A quick code is a booking saved with everything but the time. Print it, put it where the loads are made up, and scanning it opens MaxDock with the load already in — the person booking picks a time and confirms. Edit a code and every printed copy of it changes with it; the paper does not have to be replaced.</p>
  </form>`;
}

function renderPanel() {
  const map = {
    hours: renderHours, timing: renderTiming, notice: renderNotice, capacity: renderCapacity,
    combining: renderCombining, docks: renderDocks, trucks: renderTruckTypes,
    labour: renderLabour, quickqr: renderQuickQr,
  };
  state.elements.panel.innerHTML = (map[state.section] || renderHours)();
  applyLocks();
}

function renderNav() {
  state.elements.nav.innerHTML = SECTIONS.map(section => `<button type="button" data-section="${section.id}" aria-current="${section.id === state.section}">${section.label}</button>`).join('');
}

function switchSection(id) {
  state.section = id;
  // Leaving a section abandons whatever was being edited in it. Coming back to a
  // window that is still unlocked, but showing saved values again, would be a lie
  // about what is about to be saved.
  state.editing.clear();
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
  // A stock count is only meaningful with the moment it was taken, so the two
  // move together. An empty timestamp stamps the save itself, which is what
  // somebody who just walked the floor means by "as of now"; a manual count
  // supersedes whatever the last MIS import left behind.
  const countedAt = data.get('inventory_as_of');
  await saveSettingsFields({
    capacity_enabled: enabled,
    skid_capacity: capacity ? Number(capacity) : null,
    capacity_reserve_skids: Number(data.get('capacity_reserve_skids')),
    capacity_enforcement_mode: data.get('capacity_enforcement_mode'),
    current_occupied_skids: Number(data.get('current_occupied_skids') || 0),
    inventory_as_of: countedAt ? new Date(countedAt).toISOString() : format.nowIso(),
    capacity_last_source: 'manual',
  });
  db.invalidate(`settings:capacity:${state.locationId}`);
}

async function saveAssignment(form) {
  const data = new FormData(form);
  const autoAssign = form.querySelector('[data-assign-switch]').getAttribute('aria-pressed') === 'true';
  const maxConcurrent = data.get('max_concurrent_appointments');
  await saveSettingsFields({
    auto_assign_dock: autoAssign,
    dock_assignment_strategy: data.get('dock_assignment_strategy'),
    max_concurrent_appointments: maxConcurrent ? Number(maxConcurrent) : null,
  });
}

async function saveLabour(form) {
  const data = new FormData(form);
  await saveSettingsFields({
    handlers_per_truck: Number(data.get('handlers_per_truck') || 0),
    crew_size: Number(data.get('crew_size') || 0),
    shift_hours: Number(data.get('shift_hours') || 8),
    crew_availability_percent: Number(data.get('crew_availability_percent') || 80),
  });
}

async function saveCombining(form) {
  const data = new FormData(form);
  const consolidation = form.querySelector('[data-consolidation-switch]').getAttribute('aria-pressed') === 'true';
  await saveSettingsFields({
    suggest_same_day_consolidation: consolidation,
    // NULL is the same-day behaviour this setting has always had; a number narrows
    // or widens it to that many hours either side of the proposed appointment.
    consolidation_window_hours: data.get('consolidation_window_mode') === 'hours' && data.get('consolidation_window_hours')
      ? durationValue(data, 'consolidation_window_hours', 'hours', WINDOW_UNITS)
      : null,
  });
}

// Only the capacity column moves here; the enabled flag and setup minutes stay
// with the Docks and truck types section that owns them.
async function saveTruckCapacity(form) {
  const updates = [...form.querySelectorAll('[data-capacity-code]')].map(row => {
    const code = row.dataset.capacityCode;
    const raw = row.querySelector('input[name="skid_capacity"]').value.trim();
    const value = raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 1)) throw { userMessage: 'Skids per truck must be a whole number above zero, or blank.' };
    return db.update('location_truck_types', { skid_capacity: value },
      q => q.eq('location_id', state.locationId).eq('truck_type_code', code), { select: false });
  });
  await Promise.all(updates);
  db.invalidate(`settings:location-truck-types:${state.locationId}`);
}

async function saveDirectionWindows(form) {
  const onScreen = [...form.querySelectorAll('[data-window]')].map(row => ({
    dock_ids: [...row.querySelectorAll('[data-window-dock]:checked')].map(box => box.value),
    days: [...row.querySelectorAll('[data-window-day]:checked')].map(box => Number(box.value)),
    direction: row.querySelector('[data-window-direction]').value,
    start_time: row.querySelector('[data-window-start]').value,
    end_time: row.querySelector('[data-window-end]').value,
  }));
  if (onScreen.some(window => !window.start_time || !window.end_time)) {
    throw { userMessage: 'Every window needs a start and an end time.' };
  }
  const windows = expandWindows(onScreen);
  await db.rpc('save_dock_direction_windows', { p_location_id: state.locationId, p_windows: windows }, {
    key: `settings:windows:save:${crypto.randomUUID()}`, retry: 0,
    userMessage: 'The inbound and outbound hours could not be saved.',
  });
  db.invalidate(`settings:windows:${state.locationId}`);
}

// Only the in-service switches are edited on the dock table itself; everything
// else about a dock is changed through Add dock or Edit, which save on their own.
// Read straight off the rows on screen, so what is shown is what is stored.
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

  // Updated in place, never deleted and re-inserted. Appointments carry a foreign
  // key to (location, truck type), so wiping the location's rows to rewrite them
  // is refused by the database the moment a single appointment has ever used one:
  // "violates foreign key constraint appointments_location_truck_fk". Turning a
  // type off means is_active = false, which is what the rest of the app reads —
  // the row stays so the history that points at it stays valid.
  const existing = new Set(state.locationTruckTypes.map(row => row.truck_type_code));
  const enabling = new Map(toEnable.map(row => [row.truck_type_code, row]));
  for (const row of toEnable) {
    if (existing.has(row.truck_type_code)) {
      await db.update('location_truck_types', { setup_minutes: row.setup_minutes, is_active: true },
        q => q.eq('location_id', state.locationId).eq('truck_type_code', row.truck_type_code), { select: false });
    } else {
      await db.insert('location_truck_types', row, { select: false });
    }
  }
  for (const code of existing) {
    if (enabling.has(code)) continue;
    await db.update('location_truck_types', { is_active: false },
      q => q.eq('location_id', state.locationId).eq('truck_type_code', code), { select: false });
  }

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
// Which site is about to change, asked in MaxDock's own words rather than the
// browser's. A settings change lands on one location and the person making it is
// often responsible for several, so the site's name has to be the loudest thing
// on the screen at the moment they commit — and a grey browser strip at the top
// of the window is not that.
function confirmLocation() {
  if (state.context.locations.length <= 1) return Promise.resolve(true);
  const backdrop = state.elements.applyBackdrop;
  backdrop.querySelector('[data-apply-location]').textContent = state.context.location.name;
  return new Promise(resolve => {
    applyDecision = resolve;
    state.applyModal.open({ trigger: document.activeElement });
  });
}

// Resolved by whichever button the person presses; closing the dialog any other
// way is a no.
let applyDecision = null;

function settleApply(answer) {
  const decide = applyDecision;
  applyDecision = null;
  state.applyModal.close();
  decide?.(answer);
}

async function submitSection(event) {
  event.preventDefault();
  const form = event.target;
  const kind = form.dataset.sectionForm;
  if (!await confirmLocation()) return;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    if (kind === 'hours') await saveHours(form);
    else if (kind === 'timing') await saveTiming(form);
    else if (kind === 'notice') await saveNotice(form);
    else if (kind === 'capacity') await saveCapacity(form);
    else if (kind === 'assignment') await saveAssignment(form);
    else if (kind === 'labour') await saveLabour(form);
    else if (kind === 'combining') await saveCombining(form);
    else if (kind === 'truck-capacity') await saveTruckCapacity(form);
    else if (kind === 'direction-windows') await saveDirectionWindows(form);
    else if (kind === 'docks') await saveDocks(form);
    else if (kind === 'truck-types') await saveTruckTypes(form);
    db.invalidate('booking:');
    await fetchAll();
    toast('Settings saved.', 'success');
    // Saved is locked again: Save goes grey, Edit comes back.
    state.editing.delete(kind);
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
  if (!await confirmLocation()) return;
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

function optionList(rows, selected) {
  return rows.map(row => `<option value="${escapeHtml(row.code)}" ${row.code === selected ? 'selected' : ''}>${escapeHtml(row.name)}</option>`).join('');
}

function openShortcutModal(shortcutId) {
  state.editingShortcutId = shortcutId || null;
  const shortcut = shortcutId ? state.shortcuts.find(item => item.id === shortcutId) : null;
  const form = state.elements.shortcutForm;
  form.reset();
  state.elements.shortcutBackdrop.querySelector('[data-shortcut-modal-title]').textContent = shortcut ? 'Edit quick code' : 'New quick code';
  form.querySelector('[data-shortcut-types]').innerHTML = optionList(state.appointmentTypes, shortcut?.appointment_type_code);
  form.querySelector('[data-shortcut-trucks]').innerHTML = optionList(state.truckTypes, shortcut?.truck_type_code);
  form.querySelector('[data-shortcut-handling]').innerHTML = optionList(state.handlingTypes, shortcut?.handling_type_code);
  form.elements.name.value = shortcut?.name || '';
  form.elements.direction.value = shortcut?.direction || 'outbound';
  form.elements.company_name.value = shortcut?.company_name || '';
  form.elements.skid_count.value = Number(shortcut?.skid_count || 0);
  form.elements.carrier_name.value = shortcut?.carrier_name || '';
  // A code that picks its own time carries the gap it must leave; one that does
  // not has no gap to show, so the field goes with the choice.
  const auto = Boolean(shortcut?.auto_time);
  form.elements.time_mode.value = auto ? 'auto' : 'manual';
  // Never zero and never a unit the list does not offer: unitParts falls back to
  // the base unit, and minutes is not one of the choices here, so setting it left
  // the select with nothing chosen at all — which is what read as "blank".
  const stored = Number(shortcut?.lead_minutes || 0) || LEAD_DEFAULT_MINUTES;
  const { value, unit } = unitParts(stored, 'minutes', LEAD_UNITS);
  form.elements.lead_minutes.value = value || Math.round(stored / 60);
  form.elements.lead_minutes__unit.value = LEAD_UNITS.includes(unit) ? unit : 'hours';
  applyShortcutTimeMode(form);
  state.shortcutModal.open();
}

// The gap stays on screen either way, greyed out when the person picks the time.
// Hiding it changed the dialog's height the moment the choice was made, which
// moved Save out from under the pointer that had just chosen.
function applyShortcutTimeMode(form) {
  const auto = form.elements.time_mode.value === 'auto';
  form.elements.lead_minutes.disabled = !auto;
  form.elements.lead_minutes__unit.disabled = !auto;
  form.querySelector('[data-lead-row]').classList.toggle('is-off', !auto);
}

// A new truck type is two things: the company-wide code, and this site switched
// on for it. Made together, because a type nobody can book is not what "add a
// truck type" means to the person adding one.
function truckCode(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}

async function submitTruckType(event) {
  event.preventDefault();
  const form = state.elements.truckForm;
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const code = truckCode(name);
  if (!code) { toast('Give the truck type a name.', 'error'); return; }
  if (state.truckTypes.some(type => type.code === code)) {
    toast(`There is already a truck type called ${name}.`, 'error');
    return;
  }
  const setup = Number(data.get('default_setup_minutes') || 0);
  try {
    await db.insert('truck_types', {
      code,
      name,
      default_setup_minutes: setup,
      qualifies_as_full_truck: data.get('qualifies_as_full_truck') === 'on',
      sort_order: state.truckTypes.length + 1,
      is_active: true,
    }, { select: false });
    await db.insert('location_truck_types', {
      location_id: state.locationId,
      truck_type_code: code,
      setup_minutes: setup,
      is_active: true,
    }, { select: false });
    db.invalidate('truck-types:active');
    db.invalidate(`settings:location-truck-types:${state.locationId}`);
    state.truckModal.close();
    await fetchAll();
    renderPanel();
    toast(`${name} added and switched on here.`, 'success');
  } catch (error) {
    toast(error.userMessage || 'The truck type could not be added.', 'error');
  }
}

async function submitShortcut(event) {
  event.preventDefault();
  const form = state.elements.shortcutForm;
  const data = new FormData(form);
  const party = String(data.get('company_name') || '').trim();
  const values = {
    location_id: state.locationId,
    name: String(data.get('name') || '').trim(),
    direction: data.get('direction'),
    // A quick code is always for an outside party or another site by name; the
    // booking page works out which from the name when the code is scanned.
    requester_type: party,
    company_name: party,
    appointment_type_code: data.get('appointment_type_code'),
    truck_type_code: data.get('truck_type_code'),
    skid_count: Number(data.get('skid_count') || 0),
    handling_type_code: data.get('handling_type_code'),
    carrier_name: String(data.get('carrier_name') || '').trim() || null,
    is_priority: false,
    is_shared: true,
    auto_time: data.get('time_mode') === 'auto',
    lead_minutes: data.get('time_mode') === 'auto' ? durationValue(data, 'lead_minutes', 'minutes', LEAD_UNITS) : 0,
  };
  try {
    if (state.editingShortcutId) {
      await db.update('booking_templates', values, q => q.eq('id', state.editingShortcutId), { select: false });
    } else {
      await db.insert('booking_templates', { ...values, owner_user_id: state.context.user.id }, { select: false });
    }
    db.invalidate(`settings:shortcuts:${state.locationId}`);
    state.shortcutModal.close();
    await fetchAll();
    renderPanel();
    toast('Quick code saved.', 'success');
  } catch (error) {
    toast(error.userMessage || 'The quick code could not be saved.', 'error');
  }
}

async function deleteShortcut(shortcutId) {
  try {
    await db.remove('booking_templates', q => q.eq('id', shortcutId));
    db.invalidate(`settings:shortcuts:${state.locationId}`);
    await fetchAll();
    renderPanel();
    toast('Quick code deleted.', 'success');
  } catch (error) {
    toast(error.userMessage || 'The quick code could not be deleted.', 'error');
  }
}

function buildShell(root) {
  root.innerHTML = `
    ${pageHead('Settings', { actions: ['print'] })}
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
    </div>
    <div class="scrim" data-shortcut-backdrop hidden aria-hidden="true">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="shortcut-modal-title">
        <div class="modal__head"><div><h2 class="modal__title" id="shortcut-modal-title" data-shortcut-modal-title>New quick code</h2><p class="modal__sub">Everything but the time. Whoever scans the code picks that.</p></div><button class="modal__x" type="button" data-close-shortcut aria-label="Close">×</button></div>
        <form data-shortcut-form>
          <div class="modal__body">
            <div class="frow">
              <label class="field field--xl"><span class="field__label">Name<span class="field__req" aria-hidden="true">*</span></span><input class="input" name="name" maxlength="80" required placeholder="Guelph run"></label>
              <label class="field field--md"><span class="field__label">Direction</span><select class="select" name="direction"><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label>
            </div>
            <div class="frow">
              <label class="field field--lg"><span class="field__label">Other party<span class="field__req" aria-hidden="true">*</span></span><input class="input" name="company_name" maxlength="120" required placeholder="Guelph"></label>
              <label class="field field--lg"><span class="field__label">Appointment type</span><select class="select" name="appointment_type_code" data-shortcut-types></select></label>
            </div>
            <div class="frow">
              <label class="field field--md"><span class="field__label">Truck type</span><select class="select" name="truck_type_code" data-shortcut-trucks></select></label>
              <div class="field field--num"><span class="field__label">Skids</span><span class="inputwrap"><input class="input" type="number" name="skid_count" min="0" value="0"><span class="input__unit">skids</span></span></div>
              <label class="field field--lg"><span class="field__label">Handling</span><select class="select" name="handling_type_code" data-shortcut-handling></select></label>
            </div>
            <div class="frow">
              <label class="field field--full"><span class="field__label">Carrier <span class="field__opt">optional</span></span><input class="input" name="carrier_name" maxlength="120"></label>
            </div>
            <fieldset class="dock-checks dock-checks--roomy">
              <legend>When it is scanned</legend>
              <label class="dock-check"><input type="radio" name="time_mode" value="manual" checked><span>The person picks the time</span></label>
              <label class="dock-check"><input type="radio" name="time_mode" value="auto"><span>MaxDock takes the first time it can</span></label>
            </fieldset>
            <div data-lead-row>
              <div class="frow">${durationField('No earlier than', 'lead_minutes', LEAD_DEFAULT_MINUTES, 'minutes', LEAD_UNITS, '')}</div>
              <p class="hint hint--wide">The gap before the earliest time MaxDock will take, so there is room to make the truck up — and room for the load to be combined with something else going the same way.</p>
            </div>
            <p class="hint hint--wide">Saved for everyone at this site, so any printed copy of the code works for whoever picks it up.</p>
          </div>
          <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close-shortcut>Cancel</button><button class="btn btn--primary" type="submit">Save code</button></div>
        </form>
      </section>
    </div>
    <div class="scrim" data-apply-backdrop hidden aria-hidden="true">
      <section class="modal modal--xs" role="dialog" aria-modal="true" aria-labelledby="apply-title">
        <div class="modal__head"><div><h2 class="modal__title" id="apply-title">Apply to <span data-apply-location></span>?</h2></div></div>
        <div class="modal__body"><p class="modal__message">These settings belong to this location. Every other Max Solutions site keeps its own.</p></div>
        <div class="modal__foot"><button class="btn btn--quiet" type="button" data-apply-no>Cancel</button><button class="btn btn--primary" type="button" data-apply-yes>Apply</button></div>
      </section>
    </div>
    <div class="scrim" data-truck-backdrop hidden aria-hidden="true">
      <section class="modal modal--md" role="dialog" aria-modal="true" aria-labelledby="truck-modal-title">
        <div class="modal__head"><div><h2 class="modal__title" id="truck-modal-title">Add a truck type</h2><p class="modal__sub">A truck type is shared by every Max Solutions site. This one is switched on here.</p></div><button class="modal__x" type="button" data-close-truck aria-label="Close">×</button></div>
        <form data-truck-form>
          <div class="modal__body">
            <div class="frow">
              <label class="field field--lg"><span class="field__label">Name<span class="field__req" aria-hidden="true">*</span></span><input class="input" name="name" maxlength="60" required placeholder="40 ft flatbed"></label>
              <div class="field field--num"><span class="field__label">Setup</span><span class="inputwrap"><input class="input" type="number" name="default_setup_minutes" min="0" value="0"><span class="input__unit">min</span></span></div>
            </div>
            <fieldset class="dock-checks dock-checks--roomy">
              <legend>Counts as</legend>
              <label class="dock-check"><input type="checkbox" name="qualifies_as_full_truck"><span>A full truck, so the full-truck minimum applies</span></label>
            </fieldset>
            <p class="hint hint--wide">How many skids it holds is set per site under Capacity, because the same trailer is loaded differently at different sites.</p>
          </div>
          <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close-truck>Cancel</button><button class="btn btn--primary" type="submit">Add truck type</button></div>
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
    shortcutBackdrop: root.querySelector('[data-shortcut-backdrop]'),
    shortcutForm: root.querySelector('[data-shortcut-form]'),
    truckBackdrop: root.querySelector('[data-truck-backdrop]'),
    applyBackdrop: root.querySelector('[data-apply-backdrop]'),
    truckForm: root.querySelector('[data-truck-form]'),
  };
  state.dockModal = createModal(state.elements.dockBackdrop, { onRequestClose: () => state.dockModal.close() });
  state.shortcutModal = createModal(state.elements.shortcutBackdrop, { onRequestClose: () => state.shortcutModal.close() });
  state.truckModal = createModal(state.elements.truckBackdrop, { onRequestClose: () => state.truckModal.close() });
  state.applyModal = createModal(state.elements.applyBackdrop, { onRequestClose: () => settleApply(false) });
  state.shortcutCard = createShortcutCard();
}

function readWindowRows() {
  return [...(state.elements.panel?.querySelectorAll('[data-window]') || [])].map(row => ({
    dock_ids: [...row.querySelectorAll('[data-window-dock]:checked')].map(box => box.value),
    days: [...row.querySelectorAll('[data-window-day]:checked')].map(box => Number(box.value)),
    direction: row.querySelector('[data-window-direction]').value,
    start_time: row.querySelector('[data-window-start]').value,
    end_time: row.querySelector('[data-window-end]').value,
  }));
}

// Stored rows are one dock and one day each. A set of them that is exactly every
// combination of some docks and some days is the same thing as one window with
// those ticked, so it is shown that way. Anything that is not a complete
// combination is left as it is stored rather than being widened into one — that
// would add windows nobody asked for.
function groupWindows(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = `${row.direction}|${timeInput(row.start_time)}|${timeInput(row.end_time)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const windows = [];
  for (const [, members] of groups) {
    const docks = [...new Set(members.map(row => row.dock_id || ''))];
    const days = [...new Set(members.map(row => (row.day_of_week === null || row.day_of_week === undefined ? '' : String(row.day_of_week))))];
    const one = members[0];
    const shape = {
      direction: one.direction,
      start_time: one.start_time,
      end_time: one.end_time,
      dock_ids: docks.filter(Boolean),
      days: days.filter(day => day !== '').map(Number),
    };
    if (members.length === docks.length * days.length) windows.push(shape);
    else {
      for (const row of members) {
        windows.push({
          direction: row.direction,
          start_time: row.start_time,
          end_time: row.end_time,
          dock_ids: row.dock_id ? [row.dock_id] : [],
          days: row.day_of_week === null || row.day_of_week === undefined ? [] : [Number(row.day_of_week)],
        });
      }
    }
  }
  return windows;
}

// The other direction: one window on screen becomes every dock-and-day pair it
// covers, because that is the shape the booking rules read.
function expandWindows(windows) {
  return windows.flatMap(window => {
    const docks = window.dock_ids.length ? window.dock_ids : [null];
    const days = window.days.length ? window.days : [null];
    return docks.flatMap(dock => days.map(day => ({
      dock_id: dock,
      day_of_week: day,
      direction: window.direction,
      start_time: window.start_time,
      end_time: window.end_time,
    })));
  });
}

function wireEvents(root) {
  // The hours field only means anything when the window mode asks for one.
  root.addEventListener('change', event => {
    if (event.target.matches('[name="time_mode"]')) { applyShortcutTimeMode(event.target.closest('form')); return; }
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
  // The working limit is arithmetic on two fields on the same row, so it follows
  // them as they are typed rather than waiting for a save to tell you what you
  // just set.
  root.addEventListener('input', event => {
    if (!event.target.matches('[name="skid_capacity"],[name="capacity_reserve_skids"]')) return;
    const form = event.target.closest('form');
    const limit = form.querySelector('[aria-label="Working limit, calculated"]');
    if (limit) {
      limit.value = workingLimit({
        skid_capacity: form.elements.skid_capacity.value,
        capacity_reserve_skids: form.elements.capacity_reserve_skids.value,
      });
    }
  });
  root.addEventListener('click', event => {
    const navButton = event.target.closest('[data-set-nav] button');
    if (navButton) { switchSection(navButton.dataset.section); return; }
    if (event.target.closest('[data-print]')) { globalThis.print(); return; }
    const startEdit = event.target.closest('[data-edit-section]');
    if (startEdit) { editSection(startEdit.closest('[data-section-form]')); return; }
    const reset = event.target.closest('[data-reset]');
    if (reset) {
      state.editing.delete(reset.closest('[data-section-form]').dataset.sectionForm);
      renderPanel();
      return;
    }
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
    // Rows are edited in place, so adding or removing one reads the current
    // rows back out of the DOM first — otherwise an unsaved edit is lost on the
    // re-render that follows.
    if (event.target.closest('[data-add-window]')) {
      state.directionWindows = readWindowRows().concat([{ dock_ids: [], days: [], direction: 'inbound', start_time: '06:00', end_time: '12:00' }]);
      renderPanel();
      return;
    }
    const removeWindow = event.target.closest('[data-remove-window]');
    if (removeWindow) {
      const index = Number(removeWindow.closest('[data-window]').dataset.window);
      state.directionWindows = readWindowRows().filter((_, position) => position !== index);
      renderPanel();
      return;
    }
    if (event.target.closest('[data-add-shortcut]')) { openShortcutModal(null); return; }
    const editShortcut = event.target.closest('[data-edit-shortcut]');
    if (editShortcut) { openShortcutModal(editShortcut.dataset.editShortcut); return; }
    const deleteTarget = event.target.closest('[data-delete-shortcut]');
    if (deleteTarget) { deleteShortcut(deleteTarget.dataset.deleteShortcut); return; }
    const printTarget = event.target.closest('[data-print-shortcut]');
    if (printTarget) {
      const shortcut = state.shortcuts.find(item => item.id === printTarget.dataset.printShortcut);
      if (shortcut) {
        state.shortcutCard.open(shortcut, {
          route: shortcutRoute(shortcut),
          detail: shortcutDetail(shortcut),
          sub: `${state.context.location.name} · anyone at this site can use it`,
        }, printTarget);
      }
      return;
    }
    if (event.target.closest('[data-close-shortcut]')) { state.shortcutModal.close(); return; }
    const addTruck = event.target.closest('[data-add-truck-type]');
    if (addTruck) { state.elements.truckForm.reset(); state.truckModal.open({ trigger: addTruck }); return; }
    if (event.target.closest('[data-close-truck]')) { state.truckModal.close(); return; }
    if (event.target.closest('[data-apply-yes]')) { settleApply(true); return; }
    if (event.target.closest('[data-apply-no]')) { settleApply(false); return; }
    if (event.target.closest('[data-add-dock]')) { openDockModal(null); return; }
    const editDock = event.target.closest('[data-edit-dock]');
    if (editDock) { openDockModal(editDock.dataset.editDock); return; }
    if (event.target.closest('[data-close-dock]')) state.dockModal.close();
  });
  root.addEventListener('submit', event => {
    if (event.target.matches('[data-section-form]')) submitSection(event);
  });
  state.elements.dockForm.addEventListener('submit', submitDock);
  state.elements.shortcutForm.addEventListener('submit', submitShortcut);
  state.elements.truckForm.addEventListener('submit', submitTruckType);
}

const page = {
  code: 'settings',
  permission: 'settings.view',
  async mount(context) {
    state.context = context;
    state.locationId = context.location.id;
    state.canManage = context.can('settings.manage');
    state.canManageDocks = context.can('dock.manage');
    document.title = `Settings · ${context.location.name} · MaxDock`;
    buildShell(context.pageRoot);
    wireEvents(context.pageRoot);
    state.elements.subtitle.textContent = `${context.location.name} · operating rules`;
    await fetchAll();
    switchSection(state.section);
  },
  refresh() {},
  destroy() { state.dockModal?.destroy(); state.shortcutModal?.destroy(); state.truckModal?.destroy(); state.applyModal?.destroy(); state.shortcutCard?.destroy(); },
};

startPage(page);
export const { mount, refresh, destroy } = page;
