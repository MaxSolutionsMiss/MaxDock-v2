import { db } from '../db.js';
import { format } from '../format.js';
import { poll } from '../poll.js';
import { startPage } from '../router.js';
import { renderState } from '../ui/empty.js';
import { createModal } from '../ui/modal.js';
import { controlsBar, pageHeadActions, icon } from '../ui/pagehead.js';
import { createCustomizePanel } from '../ui/customize.js';
import { toast } from '../ui/toast.js';

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'no_show']);
const CANCELLABLE_STATUSES = new Set(['scheduled', 'confirmed']);
const VIEW_LABELS = Object.freeze({
  upcoming: 'Upcoming',
  past: 'Past',
  cancelled: 'Cancelled',
  all: 'All',
});
const VIEW_PREFERENCE_KEY = 'my-appointments';
const CONTROL_FOCUS_REASON = 'my-appointments-control-focus';

let activeContext = null;
let records = [];
let activeView = 'upcoming';
let hosts = null;
let cancelTarget = null;
let cancelModal = null;
let moveTarget = null;
let moveModal = null;
let interactionCleanup = [];
let cards = new Map();
let nextAppointmentSignature = '';
let customizePanel = null;
let visibleCards = [];
let searchTerm = '';

// Same markup, same element types and the same accent colours the board and the
// queue use, so a metric card reads identically wherever it appears.
const METRIC_CARDS = [
  { id: 'upcoming', label: 'Upcoming', className: 'kpi--out' },
  { id: 'past', label: 'Past', className: 'kpi--ok' },
  { id: 'cancelled', label: 'Cancelled', className: 'kpi--stop' },
  { id: 'total', label: 'Total', className: '' },
];

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function normaliseStatus(value) {
  return String(value || 'scheduled').toLowerCase();
}

function statusLabel(value) {
  return format.role(normaliseStatus(value));
}

function isUpcoming(record, now = format.nowEpoch()) {
  return !TERMINAL_STATUSES.has(normaliseStatus(record.status))
    && format.epoch(record.start_at) >= now;
}

// What a customer or coordinator has in hand when they come looking: the booking
// reference from the confirmation, the site, the PO the office quoted, or the
// carrier on the gate.
function matchesSearch(record) {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return true;
  return [
    record.booking_reference, record.location_name, record.company_name,
    record.carrier_name, record.external_reference, record.truck_type,
  ].some(value => String(value || '').toLowerCase().includes(term));
}

function filterRecords(view, rows) {
  const now = format.nowEpoch();
  rows = rows.filter(matchesSearch);
  switch (view) {
    case 'cancelled':
      return rows.filter(record => normaliseStatus(record.status) === 'cancelled');
    case 'past':
      return rows.filter(record => normaliseStatus(record.status) !== 'cancelled' && !isUpcoming(record, now));
    case 'all':
      return rows;
    default:
      return rows.filter(record => isUpcoming(record, now));
  }
}

function sortRecords(rows) {
  return [...rows].sort((left, right) => format.compareChronologically(left.start_at, right.start_at));
}

function appointmentTime(record) {
  const location = { timezone: record.location_timezone };
  return `${format.date(record.start_at, location)} · ${format.time(record.start_at, location)}–${format.time(record.end_at, location)}`;
}

function detailValue(value, fallback = '—') {
  const clean = String(value ?? '').trim();
  return clean || fallback;
}

function renderMetrics() {
  const values = {
    upcoming: filterRecords('upcoming', records).length,
    past: filterRecords('past', records).length,
    cancelled: filterRecords('cancelled', records).length,
    total: records.length,
  };
  for (const [key, value] of Object.entries(values)) hosts.metricValues[key].textContent = String(value);
}

function confirmationText(record) {
  return [
    `MaxDock appointment ${record.booking_reference}`,
    `${record.location_name} — ${appointmentTime(record)}`,
    `${format.role(record.direction || '')} · ${detailValue(record.appointment_type)} · ${record.skid_count ?? 0} skids`,
    `Company: ${detailValue(record.company_name)}`,
    `Carrier: ${detailValue(record.carrier_name)}`,
    `Reference: ${detailValue(record.external_reference)}`,
    `Status: ${statusLabel(record.status)}`,
  ].join('\n');
}

async function copyConfirmation(record) {
  try {
    await navigator.clipboard.writeText(confirmationText(record));
    toast('Appointment confirmation copied.', 'success');
  } catch {
    toast('The appointment confirmation could not be copied.', 'error');
  }
}

function openMoveModal(record, trigger) {
  moveTarget = record;
  const location = { timezone: record.location_timezone };
  hosts.moveReference.textContent = `${record.booking_reference} · now ${format.timestamp(record.start_at, location)}`;
  hosts.moveDate.value = format.inputDate(record.start_at, location);
  hosts.moveDate.min = format.todayInput(location);
  hosts.moveTime.value = format.inputTime(record.start_at, location);
  hosts.moveMessage.textContent = '';
  moveModal.open({ trigger });
}

function closeMoveModal(options) {
  moveTarget = null;
  moveModal?.close(options);
}

async function confirmMove() {
  if (!moveTarget) return;
  const appointmentId = moveTarget.appointment_id;
  hosts.moveConfirm.disabled = true;
  hosts.moveMessage.textContent = '';
  try {
    const result = await db.rpc('reschedule_my_appointment', {
      p_appointment_id: appointmentId,
      p_date: hosts.moveDate.value,
      p_start_time: hosts.moveTime.value,
    }, { key: `appointment:move:${appointmentId}:${format.nowEpoch()}`, retry: 0, userMessage: 'The appointment could not be moved.' });
    db.invalidate('appointments:mine');
    closeMoveModal({ restoreFocus: false });
    toast(`${result.booking_reference} moved to ${format.timestamp(result.start_at, { timezone: moveTarget?.location_timezone })}.`, 'success');
    await refreshData(true);
  } catch (error) {
    hosts.moveMessage.textContent = error.userMessage || error.message || 'The appointment could not be moved.';
  } finally {
    hosts.moveConfirm.disabled = false;
  }
}

function openCancelModal(record, trigger) {
  cancelTarget = record;
  hosts.cancelReference.textContent = record.booking_reference;
  cancelModal.open({ trigger });
}

function closeCancelModal(options) {
  cancelTarget = null;
  cancelModal?.close(options);
}

async function confirmCancellation() {
  if (!cancelTarget) return;
  const appointmentId = cancelTarget.appointment_id;
  hosts.cancelConfirm.disabled = true;
  hosts.cancelDismiss.disabled = true;
  try {
    await db.rpc('cancel_my_appointment', { p_appointment_id: appointmentId }, {
      key: `appointment:cancel:${appointmentId}:${format.nowEpoch()}`,
      retry: 0,
      userMessage: 'The appointment could not be cancelled.',
    });
    db.invalidate('appointments:mine');
    closeCancelModal({ restoreFocus: false });
    toast('Appointment cancelled.', 'success');
    await refreshData(true);
    activeContext?.pageRoot?.focus();
  } catch (error) {
    toast(error.userMessage || 'The appointment could not be cancelled.', 'error');
  } finally {
    hosts.cancelConfirm.disabled = false;
    hosts.cancelDismiss.disabled = false;
  }
}

function createDetail(label) {
  const item = createElement('div', 'appointment-detail');
  const term = createElement('span', 'appointment-detail__label', label);
  const description = createElement('span', 'appointment-detail__value');
  item.append(term, description);
  return { element: item, value: description };
}

// A row action is an icon at the same height as every other button, with the
// wording it replaces kept as its label so it still reads to a screen reader and
// on hover. Three words of chrome per card, on every card, was the white space.
function createCardAction(name, label, className = 'btn btn--quiet btn--icon') {
  const button = createElement('button', className);
  button.type = 'button';
  button.innerHTML = icon(name);
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

function createAppointmentCard(record) {
  let currentRecord = record;
  const element = createElement('article', 'appointment-card');
  element.dataset.appointmentId = record.appointment_id;

  const head = createElement('div', 'appointment-card__head');
  const identity = createElement('div', 'appointment-card__identity');
  const reference = createElement('span', 'appointment-card__reference data');
  const location = createElement('h3', 'appointment-card__title');
  const when = createElement('span', 'appointment-card__time');
  identity.append(reference, location, when);
  const status = createElement('span', 'status');
  const actions = createElement('div', 'appointment-card__actions');
  const copy = createCardAction('copy', 'Copy confirmation');
  const move = createCardAction('move', 'Move to another time');
  move.dataset.moveAppointment = '';
  const cancel = createCardAction('cancel', 'Cancel appointment', 'btn btn--danger btn--icon');
  actions.append(copy, move, cancel);
  head.append(identity, status, actions);

  const details = createElement('div', 'appointment-card__details');
  const detailRefs = [
    ['direction', 'Direction'],
    ['appointment_type', 'Appointment type'],
    ['truck_type', 'Truck type'],
    ['skid_count', 'Skids'],
    ['handling_type', 'Handling'],
    ['external_reference', 'PO / BOL / job'],
    ['company_name', 'Company'],
    ['carrier_name', 'Carrier'],
  ].map(([key, label]) => ({ key, ...createDetail(label) }));
  details.append(...detailRefs.map(detail => detail.element));

  copy.addEventListener('click', () => copyConfirmation(currentRecord));
  move.addEventListener('click', () => openMoveModal(currentRecord, move));
  cancel.addEventListener('click', () => openCancelModal(currentRecord, cancel));

  function update(nextRecord) {
    currentRecord = nextRecord;
    reference.textContent = nextRecord.booking_reference;
    location.textContent = nextRecord.location_name;
    when.textContent = appointmentTime(nextRecord);
    const nextStatus = normaliseStatus(nextRecord.status);
    status.className = `status status--${nextStatus}`;
    status.textContent = statusLabel(nextStatus);

    for (const detail of detailRefs) {
      const rawValue = detail.key === 'direction'
        ? format.role(nextRecord.direction || '')
        : nextRecord[detail.key];
      detail.value.textContent = detailValue(rawValue);
    }

    const changeable = CANCELLABLE_STATUSES.has(nextStatus) && isUpcoming(nextRecord);
    cancel.hidden = !(activeContext?.can('appointment.cancel_own') && changeable);
    move.hidden = !(activeContext?.can('appointment.create') && changeable);
  }

  element.append(head, details);
  update(record);
  return Object.freeze({ element, update, destroy: () => element.remove() });
}

function recordId(record) {
  return String(record.appointment_id || '');
}

function reconcileRecordComponents() {
  const liveIds = new Set(records.map(recordId));
  for (const [id, card] of cards) {
    if (liveIds.has(id)) continue;
    card.destroy();
    cards.delete(id);
  }

  for (const record of records) {
    const id = recordId(record);
    if (!id) continue;
    const card = cards.get(id) || createAppointmentCard(record);
    card.update(record);
    cards.set(id, card);
  }
}

function renderNextAppointment() {
  const next = sortRecords(filterRecords('upcoming', records))[0] || null;
  const signature = next ? `${recordId(next)}|${next.start_at}|${next.end_at}|${next.status}|${next.location_name}|${next.booking_reference}` : 'none';
  if (signature === nextAppointmentSignature) return;
  nextAppointmentSignature = signature;
  hosts.next.replaceChildren();

  if (!next) {
    const content = createElement('div', 'next-appointment__empty');
    content.append(
      createElement('span', 'next-appointment__eyebrow', 'Next appointment'),
      createElement('strong', 'next-appointment__title', 'No upcoming appointment'),
      createElement('span', 'next-appointment__message', 'Your next confirmed booking will appear here.'),
    );
    hosts.next.append(content);
    return;
  }

  const summary = createElement('div', 'next-appointment__summary');
  summary.append(
    createElement('span', 'next-appointment__eyebrow', 'Next appointment'),
    createElement('strong', 'next-appointment__title', next.location_name),
    createElement('span', 'next-appointment__time', appointmentTime(next)),
  );
  const reference = createElement('div', 'next-appointment__reference');
  reference.append(
    createElement('span', 'next-appointment__reference-label', 'Booking reference'),
    createElement('strong', 'next-appointment__reference-value data', next.booking_reference),
  );
  hosts.next.append(summary, reference);
}

function updateViewButtons() {
  for (const [view, label] of Object.entries(VIEW_LABELS)) {
    const button = hosts.views.querySelector(`[data-view="${view}"]`);
    if (!button) continue;
    button.textContent = label;
    button.setAttribute('aria-pressed', String(view === activeView));
  }
}

function placeCardsInOrder(visible) {
  const visibleIds = new Set(visible.map(recordId));
  for (const [id, card] of cards) {
    if (!visibleIds.has(id)) card.element.remove();
  }

  let cursor = hosts.list.firstElementChild;
  for (const record of visible) {
    const card = cards.get(recordId(record));
    if (!card) continue;
    if (card.element === cursor) {
      cursor = cursor.nextElementSibling;
    } else {
      hosts.list.insertBefore(card.element, cursor);
    }
  }
}

function renderAppointments() {
  const visible = sortRecords(filterRecords(activeView, records));
  hosts.count.textContent = `${visible.length} ${visible.length === 1 ? 'appointment' : 'appointments'}`;
  updateViewButtons();
  reconcileRecordComponents();

  if (!visible.length) {
    hosts.list.replaceChildren();
    renderState(hosts.list, {
      type: 'empty',
      title: `No ${VIEW_LABELS[activeView].toLowerCase()} appointments`,
      message: activeView === 'upcoming'
        ? 'When an appointment is booked, its confirmation and current status will appear here.'
        : 'There are no appointments in this view.',
    });
    return;
  }

  if (hosts.list.querySelector('.state')) hosts.list.replaceChildren();
  placeCardsInOrder(visible);
}

function renderPage() {
  renderMetrics();
  renderNextAppointment();
  renderAppointments();
  hosts.updated.textContent = `Updated ${format.time(format.nowIso(), activeContext?.location)}`;
}

function renderLoadError(error) {
  hosts.count.textContent = '';
  hosts.list.replaceChildren();
  renderState(hosts.list, {
    type: 'error',
    title: 'Appointments are temporarily unavailable',
    message: error.userMessage || 'MaxDock could not load your appointments. Your session is still active.',
    actions: [{
      id: 'retry-appointments',
      label: 'Try again',
      primary: true,
      onClick: () => refreshData(true),
    }],
  });
}

async function loadAppointments({ force = false } = {}) {
  if (force) db.invalidate('appointments:mine');
  const response = await db.rpc('list_my_appointments', {}, {
    key: 'appointments:mine',
    cache: 4000,
    userMessage: 'MaxDock could not load your appointments.',
  });
  return Array.isArray(response) ? response : [];
}

async function loadViewPreference() {
  try {
    const preference = await db.rpc('get_user_preference', { p_preference_key: VIEW_PREFERENCE_KEY }, {
      key: `preference:${VIEW_PREFERENCE_KEY}`,
      cache: 300000,
      userMessage: 'Your saved appointment view could not be loaded.',
    });
    if (preference && VIEW_LABELS[preference.default_view]) activeView = preference.default_view;
  } catch {
    activeView = 'upcoming';
  }
}

async function saveViewPreference() {
  try {
    await db.rpc('save_user_preference', {
      p_preference_key: VIEW_PREFERENCE_KEY,
      p_preferences: { default_view: activeView },
    }, {
      key: `preference:${VIEW_PREFERENCE_KEY}:save`,
      retry: 0,
      userMessage: 'Your appointment view preference could not be saved.',
    });
    db.invalidate(`preference:${VIEW_PREFERENCE_KEY}`);
  } catch {
    toast('The view changed, but MaxDock could not save it as your default.', 'error');
  }
}

async function refreshData(force = false) {
  try {
    records = await loadAppointments({ force });
    renderPage();
  } catch (error) {
    renderLoadError(error);
  }
}

function createMetric(label, key, className = '') {
  const card = createElement('article', `kpi ${className}`.trim());
  const value = createElement('span', 'kpi__value', '0');
  const caption = createElement('span', 'kpi__label', label);
  card.append(caption, value);
  hosts.metricValues[key] = value;
  hosts.metricCards[key] = card;
  return card;
}

function applyVisibleCards() {
  let shown = 0;
  for (const card of METRIC_CARDS) {
    const element = hosts.metricCards[card.id];
    if (!element) continue;
    element.hidden = !visibleCards.includes(card.id);
    if (!element.hidden) shown += 1;
  }
  hosts.metrics.hidden = shown === 0;
  const page = hosts.metrics.closest('.page');
  page?.style.setProperty('--kpi-cols', String(Math.max(2, shown)));
}

function createViewControls() {
  const views = createElement('div', 'seg appointment-views');
  views.dataset.appointmentViews = '';
  views.setAttribute('aria-label', 'Appointment view');
  for (const [view, label] of Object.entries(VIEW_LABELS)) {
    const button = createElement('button', '', label);
    button.type = 'button';
    button.dataset.view = view;
    button.setAttribute('aria-pressed', String(view === activeView));
    views.append(button);
  }
  return views;
}

function exportCsv() {
  const rows = [['Reference', 'Status', 'Direction', 'Start', 'End', 'Location', 'Company', 'Skids', 'Carrier', 'Reference number']];
  for (const record of filterRecords(activeView, records)) {
    const location = { timezone: record.location_timezone };
    rows.push([
      record.booking_reference, statusLabel(record.status), record.direction,
      format.timestamp(record.start_at, location), format.timestamp(record.end_at, location),
      record.location_name, record.company_name, record.skid_count, record.carrier_name, record.external_reference,
    ]);
  }
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `maxdock-my-appointments-${activeView}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function buildPage(root, context) {
  hosts = { metricValues: {}, metricCards: {} };

  const head = createElement('div', 'pagehead');
  const heading = createElement('div');
  const title = createElement('h1', 'pagehead__title', 'My appointments');
  const subtitle = createElement('p', 'pagehead__sub', context.customerShell
    ? 'View and manage your MaxDock bookings.'
    : `${context.location.name} · Your bookings`);
  heading.append(title, subtitle);
  head.append(heading);
  const headActions = createElement('div', 'pagehead__actions');
  headActions.innerHTML = pageHeadActions(['export', 'print', 'customize']);
  head.append(headActions);

  const metrics = createElement('section', 'kpis');
  metrics.setAttribute('aria-label', 'Appointment summary');
  metrics.append(...METRIC_CARDS.map(card => createMetric(card.label, card.id, card.className)));

  const next = createElement('section', 'panel next-appointment');
  next.setAttribute('aria-label', 'Next appointment');

  // The view switcher and the page's output actions live in the same controls band
  // every other screen uses, so Print and the gear sit where they always sit.
  const controls = createElement('div');
  controls.innerHTML = controlsBar({ label: 'Appointment controls', actions: [['book', context.can('appointment.create')]] });
  const controlsHost = controls.firstElementChild;
  const views = createViewControls();
  const search = createElement('label', 'ctrl-field ctrl-field--grow appointment-search');
  const searchLabel = createElement('span', '', 'Search');
  const searchInput = createElement('input', 'input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Reference, site, PO';
  searchInput.autocomplete = 'off';
  searchInput.dataset.appointmentSearch = '';
  search.append(searchLabel, searchInput);

  const toolbarMeta = createElement('div', 'profile appointment-toolbar__meta');
  const count = createElement('span', 'appointment-toolbar__count data');
  count.setAttribute('aria-live', 'polite');
  const updated = createElement('span', 'page-updated muted');
  toolbarMeta.append(count, updated);
  const lead = controlsHost.querySelector('.controls__lead') || controlsHost;
  lead.append(views, search);
  lead.after(toolbarMeta);

  // Left column scrolls on its own so the appointments below the fold can be
  // reached; previously the list sat directly in the viewport-height page column
  // with nothing scrollable, so everything past the first screen was unreachable.
  const split = createElement('div', 'split split--list');
  const listPanel = createElement('section', 'panel panel--fill');
  const listScroll = createElement('div', 'panel__scroll');
  const list = createElement('section', 'appointment-list');
  list.setAttribute('aria-label', 'Appointments');
  listScroll.append(list);
  listPanel.append(listScroll);
  split.append(listPanel, next);

  const cancelBackdrop = createElement('div', 'scrim');
  cancelBackdrop.hidden = true;
  const dialog = createElement('section', 'modal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'cancel-appointment-title');
  dialog.setAttribute('aria-describedby', 'cancel-appointment-message');
  const modalTitle = createElement('h2', 'modal__title', 'Cancel this appointment?');
  modalTitle.id = 'cancel-appointment-title';
  const modalMessage = createElement('p', 'modal__message');
  modalMessage.id = 'cancel-appointment-message';
  modalMessage.append('Booking ', createElement('strong', 'data'), ' will be cancelled. This cannot be undone.');
  const cancelReference = modalMessage.querySelector('strong');
  const modalActions = createElement('div', 'form-actions');
  const cancelDismiss = createElement('button', 'btn btn--quiet', 'Keep appointment');
  cancelDismiss.type = 'button';
  const cancelConfirm = createElement('button', 'btn btn--danger', 'Cancel appointment');
  cancelConfirm.type = 'button';
  modalActions.append(cancelDismiss, cancelConfirm);
  dialog.append(modalTitle, modalMessage, modalActions);
  cancelBackdrop.append(dialog);

  // Moving a booking rather than cancelling it and losing the slot. The same
  // rules a new booking passes apply, including this location's minimum notice,
  // so the answer comes back from the server rather than being guessed here.
  const moveBackdrop = createElement('div', 'scrim');
  moveBackdrop.hidden = true;
  const moveDialog = createElement('section', 'modal modal--sm');
  moveDialog.setAttribute('role', 'dialog');
  moveDialog.setAttribute('aria-modal', 'true');
  moveDialog.setAttribute('aria-labelledby', 'move-appointment-title');
  moveDialog.innerHTML = `
    <div class="modal__head"><div><h2 class="modal__title" id="move-appointment-title">Move this appointment</h2><p class="modal__sub" data-move-reference></p></div><button class="modal__x" type="button" data-move-dismiss aria-label="Close">×</button></div>
    <div class="modal__body">
      <div class="frow">
        <label class="field field--lg"><span class="field__label">New date</span><input class="input" type="date" data-move-date required></label>
        <label class="field field--lg"><span class="field__label">New start time</span><input class="input" type="time" data-move-time required></label>
      </div>
      <p class="hint">The new time has to clear this location's notice period and have a compatible dock free.</p>
      <p class="form-message" data-move-message aria-live="polite"></p>
    </div>
    <div class="modal__foot"><button class="btn btn--quiet" type="button" data-move-dismiss>Keep the current time</button><button class="btn btn--primary" type="button" data-move-confirm>Move appointment</button></div>`;
  moveBackdrop.append(moveDialog);

  root.append(head, controlsHost, metrics, split, cancelBackdrop, moveBackdrop);

  Object.assign(hosts, {
    metrics,
    next,
    views,
    count,
    updated,
    list,
    cancelBackdrop,
    cancelReference,
    cancelConfirm,
    cancelDismiss,
    moveBackdrop,
    moveReference: moveDialog.querySelector('[data-move-reference]'),
    moveDate: moveDialog.querySelector('[data-move-date]'),
    moveTime: moveDialog.querySelector('[data-move-time]'),
    moveMessage: moveDialog.querySelector('[data-move-message]'),
    moveConfirm: moveDialog.querySelector('[data-move-confirm]'),
  });

  cancelModal = createModal(cancelBackdrop, {
    initialFocus: cancelConfirm,
    onRequestClose: () => closeCancelModal(),
  });

  moveModal = createModal(moveBackdrop, {
    initialFocus: hosts.moveDate,
    onRequestClose: () => closeMoveModal(),
  });
  moveBackdrop.addEventListener('click', event => {
    if (event.target.closest('[data-move-dismiss]')) closeMoveModal();
    if (event.target.closest('[data-move-confirm]')) confirmMove();
  });
}

function interactiveFocusWithinPage() {
  const active = document.activeElement;
  return Boolean(active && activeContext?.pageRoot?.contains(active) && active.matches('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
}

function bindInteractions() {
  const onViewClick = event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    activeView = button.dataset.view;
    renderAppointments();
    saveViewPreference();
  };
  const onFocusIn = event => {
    if (event.target.matches('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) poll.suspend(CONTROL_FOCUS_REASON);
  };
  const onFocusOut = () => {
    queueMicrotask(() => {
      if (!interactiveFocusWithinPage()) poll.resume(CONTROL_FOCUS_REASON);
    });
  };

  // Filtering as you type. The metric cards recount too, so "3 upcoming" always
  // means three of the ones actually on screen.
  const onSearch = event => {
    if (!event.target.matches('[data-appointment-search]')) return;
    searchTerm = event.target.value;
    renderMetrics();
    renderAppointments();
  };

  const onHeadAction = event => {
    if (event.target.closest('[data-export]')) exportCsv();
    if (event.target.closest('[data-print]')) globalThis.print();
    const customize = event.target.closest('[data-customize]');
    if (customize) customizePanel?.open(customize);
    const booking = event.target.closest('[data-open-booking]');
    if (booking) globalThis.dispatchEvent(new CustomEvent('maxdock:open-booking', { detail: { trigger: booking } }));
  };

  hosts.views.addEventListener('click', onViewClick);
  activeContext.pageRoot.addEventListener('click', onHeadAction);
  activeContext.pageRoot.addEventListener('input', onSearch);
  hosts.cancelDismiss.addEventListener('click', closeCancelModal);
  hosts.cancelConfirm.addEventListener('click', confirmCancellation);
  activeContext.pageRoot.addEventListener('focusin', onFocusIn);
  activeContext.pageRoot.addEventListener('focusout', onFocusOut);

  interactionCleanup = [
    () => hosts?.views.removeEventListener('click', onViewClick),
    () => activeContext?.pageRoot?.removeEventListener('click', onHeadAction),
    () => activeContext?.pageRoot?.removeEventListener('input', onSearch),
    () => hosts?.cancelDismiss.removeEventListener('click', closeCancelModal),
    () => hosts?.cancelConfirm.removeEventListener('click', confirmCancellation),
    () => activeContext?.pageRoot?.removeEventListener('focusin', onFocusIn),
    () => activeContext?.pageRoot?.removeEventListener('focusout', onFocusOut),
    () => poll.resume(CONTROL_FOCUS_REASON),
  ];
}

const page = {
  code: 'my-appointments',
  permissions: ['appointment.view_own', 'appointment.view'],
  poll: {
    interval: 5000,
    fetch: () => loadAppointments(),
  },

  async mount(context) {
    document.title = 'My appointments · MaxDock';
    activeContext = context;
    records = [];
    activeView = 'upcoming';
    searchTerm = '';
    cards = new Map();
    nextAppointmentSignature = '';
    buildPage(context.pageRoot, context);
    bindInteractions();
    customizePanel = await createCustomizePanel({
      preferenceKey: 'my-appointment-cards',
      options: METRIC_CARDS.map(card => ({ id: card.id, group: 'Metric cards', label: card.label })),
      defaultIds: METRIC_CARDS.map(card => card.id),
      max: METRIC_CARDS.length,
      onChange: selected => { visibleCards = selected; applyVisibleCards(); },
    });
    visibleCards = customizePanel.selected;
    applyVisibleCards();
    await loadViewPreference();
    await refreshData(true);
  },

  async refresh(nextRecords) {
    records = Array.isArray(nextRecords) ? nextRecords : [];
    renderPage();
  },

  destroy() {
    closeCancelModal({ restoreFocus: false });
    cancelModal?.destroy();
    cancelModal = null;
    customizePanel?.destroy();
    customizePanel = null;
    for (const cleanup of interactionCleanup.splice(0)) cleanup();
    for (const card of cards.values()) card.destroy();
    cards.clear();
    activeContext = null;
    records = [];
    hosts = null;
    cancelTarget = null;
    nextAppointmentSignature = '';
  },
};

startPage(page);

export const { mount, refresh, destroy } = page;
