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

async function fetchAll() {
  const locationId = state.locationId;
  const [hours, settings, docks, truckTypes, locationTruckTypes, dockTruckTypes] = await Promise.all([
    db.select('location_operating_hours', q => q.select('location_id,day_of_week,is_open,open_time,close_time').eq('location_id', locationId), { key: `settings:hours:${locationId}`, cache: 0 }),
    db.select('location_settings', q => q.select('*').eq('location_id', locationId).maybeSingle(), { key: `settings:row:${locationId}`, cache: 0 }),
    db.select('docks', q => q.select('id,name,description,sort_order,direction_mode,is_active').eq('location_id', locationId).order('sort_order').order('name'), { key: `settings:docks:${locationId}`, cache: 0 }),
    db.select('truck_types', q => q.select('code,name').eq('is_active', true).order('sort_order'), { key: 'truck-types:active', cache: 60000 }),
    db.select('location_truck_types', q => q.select('truck_type_code,setup_minutes,is_active').eq('location_id', locationId), { key: `settings:location-truck-types:${locationId}`, cache: 0 }),
    db.select('dock_truck_types', q => q.select('dock_id,truck_type_code').eq('location_id', locationId), { key: `settings:dock-truck-types:${locationId}`, cache: 0 }),
  ]);
  state.hours = hours || [];
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
      <input class="input" type="time" name="open" value="${escapeHtml(timeInput(row.open_time))}" ${isOpen ? '' : 'disabled'} ${canEdit ? '' : 'readonly disabled'}>
      <input class="input" type="time" name="close" value="${escapeHtml(timeInput(row.close_time))}" ${isOpen ? '' : 'disabled'} ${canEdit ? '' : 'readonly disabled'}>
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
      <div class="field field--xs"><span class="field__label">Base minutes</span><input class="input" type="number" min="0" name="base_minutes" value="${s.base_minutes ?? 0}" ${disabled}></div>
      <div class="field field--xs"><span class="field__label">Per skid</span><input class="input" type="number" min="0" step="0.1" name="minutes_per_skid" value="${s.minutes_per_skid ?? 0}" ${disabled}></div>
      <div class="field field--xs"><span class="field__label">Buffer</span><input class="input" type="number" min="0" name="buffer_minutes" value="${s.buffer_minutes ?? 0}" ${disabled}></div>
    </div>
    <div class="frow">
      <div class="field field--sm"><span class="field__label">Full truck at (skids)</span><input class="input" type="number" min="0" name="full_truck_skid_threshold" value="${s.full_truck_skid_threshold ?? 0}" ${disabled}></div>
      <div class="field field--sm"><span class="field__label">Full truck minimum</span><input class="input" type="number" min="0" name="full_truck_minimum_minutes" value="${s.full_truck_minimum_minutes ?? 0}" ${disabled}></div>
      <div class="field field--sm"><span class="field__label">Priority minimum</span><input class="input" type="number" min="0" name="priority_minimum_minutes" value="${s.priority_minimum_minutes ?? 0}" ${disabled}></div>
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
      <div class="field field--sm"><span class="field__label">Minimum notice (minutes)</span><input class="input" type="number" min="0" name="minimum_notice_minutes" value="${s.minimum_notice_minutes ?? 0}" ${disabled}></div>
      <div class="field field--sm"><span class="field__label">Max days ahead</span><input class="input" type="number" min="0" name="maximum_advance_days" value="${s.maximum_advance_days ?? 0}" ${disabled}></div>
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
      <div class="field field--xs"><span class="field__label">Daily capacity</span><input class="input" type="number" min="1" name="skid_capacity" value="${s.skid_capacity ?? ''}" ${disabled}></div>
      <div class="field field--xs"><span class="field__label">Reserve skids</span><input class="input" type="number" min="0" name="capacity_reserve_skids" value="${s.capacity_reserve_skids ?? 0}" ${disabled}></div>
      <div class="field field--sm"><span class="field__label">When over capacity</span><select class="select" name="capacity_enforcement_mode" ${disabled}>
        <option value="warn" ${s.capacity_enforcement_mode === 'warn' ? 'selected' : ''}>Warn only</option>
        <option value="enforce" ${s.capacity_enforcement_mode === 'enforce' ? 'selected' : ''}>Block booking</option>
      </select></div>
    </div>
    <p class="hint">Currently ${s.current_occupied_skids ?? 0} skids occupied${s.inventory_as_of ? ` as of ${format.timestamp(s.inventory_as_of, state.context.location)}` : ''} (${s.capacity_last_source === 'mis' ? 'from MIS import' : 'manual entry'}).</p>
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
      <div class="field field--sm"><span class="field__label">Assignment strategy</span><select class="select" name="dock_assignment_strategy" ${disabled}>
        <option value="balanced" ${s.dock_assignment_strategy === 'balanced' ? 'selected' : ''}>Balanced across docks</option>
        <option value="fill_first" ${s.dock_assignment_strategy === 'fill_first' ? 'selected' : ''}>Fill one dock first</option>
      </select></div>
      <div class="field field--sm"><span class="field__label">Max concurrent (blank = no limit)</span><input class="input" type="number" min="1" name="max_concurrent_appointments" value="${s.max_concurrent_appointments ?? ''}" ${disabled}></div>
    </div>
    <div class="setrow">
      <div><div class="setrow__t">Same-day consolidation warning</div><div class="setrow__d">Flag same-destination bookings on the same day for review</div></div>
      <button type="button" class="switch ${consolidation ? '' : 'switch--off'}" data-consolidation-switch aria-pressed="${consolidation}" aria-label="Same-day consolidation warning" ${disabled}></button>
    </div>
    ${saveFoot(canEdit)}
  </form>`;
}

function dockTruckLabels(dockId) {
  const codes = new Set(state.dockTruckTypes.filter(row => row.dock_id === dockId).map(row => row.truck_type_code));
  const names = state.truckTypes.filter(type => codes.has(type.code)).map(type => type.name);
  return names.length ? names.join(', ') : 'All types';
}

function renderDocks() {
  const canEditDocks = state.canManageDocks && state.canManage;
  const rows = state.docks.map(dock => `<tr>
    <td class="data data--strong">${escapeHtml(dock.name)}</td>
    <td>${escapeHtml(dock.direction_mode === 'both' ? 'Both' : format.role(dock.direction_mode))}</td>
    <td class="data">${escapeHtml(dockTruckLabels(dock.id))}</td>
    <td>${dock.is_active ? '<span class="tag tag--ok">Active</span>' : '<span class="tag tag--quiet">Inactive</span>'}</td>
    <td>${canEditDocks ? `<button class="btn btn--quiet btn--sm" type="button" data-edit-dock="${dock.id}">Edit</button>` : ''}</td>
  </tr>`).join('') || '<tr><td colspan="5" class="data">No docks configured for this location.</td></tr>';

  const locationTypes = state.locationTruckTypes;
  const truckRows = state.truckTypes.map(type => {
    const enabled = locationTypes.find(row => row.truck_type_code === type.code);
    return `<div class="setrow" data-truck-code="${type.code}">
      <div><div class="setrow__t">${escapeHtml(type.name)}</div></div>
      <div class="frow" style="align-items:center;gap:var(--s2)">
        <input class="input" type="number" min="0" style="max-width:90px" name="setup_minutes" value="${enabled ? enabled.setup_minutes : 0}" ${state.canManage ? '' : 'disabled'} aria-label="${escapeHtml(type.name)} setup minutes">
        <button type="button" class="switch ${enabled?.is_active !== false && enabled ? '' : 'switch--off'}" data-truck-switch aria-pressed="${Boolean(enabled)}" aria-label="Enable ${escapeHtml(type.name)}" ${state.canManage ? '' : 'disabled'}></button>
      </div>
    </div>`;
  }).join('');

  return `<div class="card">
      <h3 class="card__title">Docks${canEditDocks ? '<button class="btn btn--quiet btn--sm" type="button" data-add-dock>Add dock</button>' : ''}</h3>
      <table class="table"><thead><tr><th>Dock</th><th>Direction</th><th>Truck types</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="card" style="margin-top:var(--s4)">
      <form data-section-form="truck-types">
        <h3 class="card__title">Truck types enabled at this location</h3>
        ${truckRows}
        <p class="hint">Setup minutes here override the truck type's default for this location only.</p>
        ${saveFoot(state.canManage)}
      </form>
    </div>`;
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
    minimum_notice_minutes: Number(data.get('minimum_notice_minutes')),
    maximum_advance_days: Number(data.get('maximum_advance_days')),
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
  });
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
  await db.remove('location_truck_types', q => q.eq('location_id', state.locationId), { select: false });
  if (toEnable.length) await db.insert('location_truck_types', toEnable, { select: false, single: false });
  db.invalidate(`settings:location-truck-types:${state.locationId}`);
}

async function submitSection(event) {
  event.preventDefault();
  const form = event.target;
  const kind = form.dataset.sectionForm;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    if (kind === 'hours') await saveHours(form);
    else if (kind === 'timing') await saveTiming(form);
    else if (kind === 'notice') await saveNotice(form);
    else if (kind === 'capacity') await saveCapacity(form);
    else if (kind === 'assignment') await saveAssignment(form);
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

function openDockModal(dockId) {
  state.editingDockId = dockId || null;
  const dock = dockId ? state.docks.find(item => item.id === dockId) : null;
  const enabledCodes = new Set(dockId ? state.dockTruckTypes.filter(row => row.dock_id === dockId).map(row => row.truck_type_code) : []);
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
  form.querySelector('[data-dock-checks]').innerHTML = state.truckTypes.map(type => `<label class="dock-check"><input type="checkbox" name="truck_type_code" value="${type.code}" ${enabledCodes.has(type.code) ? 'checked' : ''}><span>${escapeHtml(type.name)}</span></label>`).join('');
  state.dockModal.open({ trigger: document.activeElement });
}

async function submitDock(event) {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  const name = form.elements.name.value.trim();
  if (!name) { toast('Dock name is required.', 'error'); return; }
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
    const codes = [...form.querySelectorAll('input[name="truck_type_code"]:checked')].map(input => input.value);
    await db.remove('dock_truck_types', q => q.eq('dock_id', dockId), { select: false });
    if (codes.length) {
      await db.insert('dock_truck_types', codes.map(code => ({ dock_id: dockId, location_id: state.locationId, truck_type_code: code })), { select: false });
    }
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
              <label class="field field--md"><span class="field__label">Name</span><input class="input" name="name" maxlength="80" required></label>
              <label class="field field--xs"><span class="field__label">Sort order</span><input class="input" type="number" name="sort_order" min="1" required></label>
              <label class="field field--sm"><span class="field__label">Direction</span><select class="select" name="direction_mode"><option value="both">Both</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></label>
            </div>
            <label class="field field--full"><span class="field__label">Description</span><input class="input" name="description" maxlength="200"></label>
            <div class="setrow"><div><div class="setrow__t">Active</div></div><button type="button" class="switch" data-dock-active-switch aria-label="Dock active"></button></div>
            <fieldset class="dock-checks"><legend>Truck types this dock accepts (none checked = all types)</legend><div data-dock-checks></div></fieldset>
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
