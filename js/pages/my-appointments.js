import { db } from '../db.js';
import { format } from '../format.js';
import { startPage } from '../router.js';
import { renderState } from '../ui/empty.js';
import { toast } from '../ui/toast.js';

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'no_show']);
const CANCELLABLE_STATUSES = new Set(['scheduled', 'confirmed']);
const VIEW_LABELS = Object.freeze({
  upcoming: 'Upcoming',
  past: 'Past',
  cancelled: 'Cancelled',
  all: 'All',
});

let activeContext = null;
let records = [];
let activeView = 'upcoming';
let hosts = null;
let cancelTarget = null;
let interactionCleanup = [];

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

function isUpcoming(record, now = Date.now()) {
  return !TERMINAL_STATUSES.has(normaliseStatus(record.status))
    && format.epoch(record.start_at) >= now;
}

function filterRecords(view, rows) {
  const now = Date.now();
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

function createMetric(label, value) {
  const card = createElement('div', 'metric-card');
  const number = createElement('strong', 'metric-card__value data', String(value));
  const caption = createElement('span', 'metric-card__label', label);
  card.append(number, caption);
  return card;
}

function renderMetrics() {
  const upcoming = filterRecords('upcoming', records).length;
  const past = filterRecords('past', records).length;
  const cancelled = filterRecords('cancelled', records).length;
  hosts.metrics.replaceChildren(
    createMetric('Upcoming', upcoming),
    createMetric('Past', past),
    createMetric('Cancelled', cancelled),
    createMetric('Total', records.length),
  );
}

function createDetail(label, value) {
  const item = createElement('div', 'appointment-detail');
  const term = createElement('span', 'appointment-detail__label', label);
  const description = createElement('span', 'appointment-detail__value', detailValue(value));
  item.append(term, description);
  return item;
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

function openCancelModal(record) {
  cancelTarget = record;
  hosts.cancelReference.textContent = record.booking_reference;
  hosts.cancelModal.hidden = false;
  document.body.classList.add('modal-open');
  hosts.cancelConfirm.focus();
}

function closeCancelModal() {
  cancelTarget = null;
  if (hosts?.cancelModal) hosts.cancelModal.hidden = true;
  document.body.classList.remove('modal-open');
}

async function confirmCancellation() {
  if (!cancelTarget) return;
  const appointmentId = cancelTarget.appointment_id;
  hosts.cancelConfirm.disabled = true;
  hosts.cancelDismiss.disabled = true;
  try {
    await db.rpc('cancel_my_appointment', { p_appointment_id: appointmentId }, {
      key: `appointment:cancel:${appointmentId}:${Date.now()}`,
      retry: 0,
      userMessage: 'The appointment could not be cancelled.',
    });
    db.invalidate('appointments:mine');
    closeCancelModal();
    toast('Appointment cancelled.', 'success');
    await refreshData(true);
  } catch (error) {
    toast(error.userMessage || 'The appointment could not be cancelled.', 'error');
  } finally {
    hosts.cancelConfirm.disabled = false;
    hosts.cancelDismiss.disabled = false;
  }
}

function createAppointmentCard(record) {
  const card = createElement('article', 'appointment-card');
  card.dataset.appointmentId = record.appointment_id;

  const head = createElement('div', 'appointment-card__head');
  const identity = createElement('div');
  const reference = createElement('div', 'appointment-card__reference data', record.booking_reference);
  const location = createElement('h3', 'appointment-card__title', record.location_name);
  identity.append(reference, location);

  const status = createElement('span', `status status--${normaliseStatus(record.status)}`, statusLabel(record.status));
  head.append(identity, status);

  const when = createElement('p', 'appointment-card__time', appointmentTime(record));
  const details = createElement('div', 'appointment-card__details');
  details.append(
    createDetail('Direction', format.role(record.direction || '')),
    createDetail('Appointment type', record.appointment_type),
    createDetail('Truck type', record.truck_type),
    createDetail('Skids', record.skid_count),
    createDetail('Handling', record.handling_type),
    createDetail('PO / BOL / job', record.external_reference),
    createDetail('Company', record.company_name),
    createDetail('Carrier', record.carrier_name),
  );

  const actions = createElement('div', 'appointment-card__actions');
  const copy = createElement('button', 'btn btn--quiet', 'Copy confirmation');
  copy.type = 'button';
  copy.addEventListener('click', () => copyConfirmation(record));
  actions.append(copy);

  if (CANCELLABLE_STATUSES.has(normaliseStatus(record.status)) && isUpcoming(record)) {
    const cancel = createElement('button', 'btn btn--danger', 'Cancel appointment');
    cancel.type = 'button';
    cancel.addEventListener('click', () => openCancelModal(record));
    actions.append(cancel);
  }

  card.append(head, when, details, actions);
  return card;
}

function renderNextAppointment() {
  const next = sortRecords(filterRecords('upcoming', records))[0];
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

function renderAppointments() {
  const visible = sortRecords(filterRecords(activeView, records));
  hosts.list.replaceChildren();
  hosts.count.textContent = `${visible.length} ${visible.length === 1 ? 'appointment' : 'appointments'}`;

  for (const [view, label] of Object.entries(VIEW_LABELS)) {
    const button = hosts.views.querySelector(`[data-view="${view}"]`);
    if (!button) continue;
    button.textContent = label;
    button.setAttribute('aria-pressed', String(view === activeView));
  }

  if (!visible.length) {
    renderState(hosts.list, {
      type: 'empty',
      title: `No ${VIEW_LABELS[activeView].toLowerCase()} appointments`,
      message: activeView === 'upcoming'
        ? 'When an appointment is booked, its confirmation and current status will appear here.'
        : 'There are no appointments in this view.',
    });
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const record of visible) fragment.append(createAppointmentCard(record));
  hosts.list.append(fragment);
}

function renderPage() {
  renderMetrics();
  renderNextAppointment();
  renderAppointments();
  hosts.updated.textContent = `Updated ${format.time(format.nowIso(), activeContext?.location)}`;
}

function renderLoadError(error) {
  hosts.metrics.replaceChildren();
  hosts.next.replaceChildren();
  hosts.count.textContent = '';
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

async function refreshData(force = false) {
  try {
    records = await loadAppointments({ force });
    renderPage();
  } catch (error) {
    renderLoadError(error);
  }
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

function buildPage(root, context) {
  const head = createElement('div', 'page__head');
  const heading = createElement('div');
  const title = createElement('h1', 'page__title', 'My appointments');
  const subtitle = createElement('p', 'page__sub', context.customerShell
    ? 'View and manage your MaxDock bookings.'
    : `${context.location.name} · Your bookings`);
  heading.append(title, subtitle);
  head.append(heading);

  const metrics = createElement('section', 'metric-grid');
  metrics.setAttribute('aria-label', 'Appointment summary');

  const next = createElement('section', 'panel next-appointment');
  next.setAttribute('aria-label', 'Next appointment');

  const toolbar = createElement('div', 'appointment-toolbar');
  const views = createViewControls();
  const toolbarMeta = createElement('div', 'appointment-toolbar__meta');
  const count = createElement('span', 'appointment-toolbar__count data');
  const updated = createElement('span', 'page-updated muted');
  toolbarMeta.append(count, updated);
  toolbar.append(views, toolbarMeta);

  const list = createElement('section', 'appointment-list');
  list.setAttribute('aria-label', 'Appointments');

  const cancelModal = createElement('div', 'modal-backdrop');
  cancelModal.hidden = true;
  const dialog = createElement('section', 'modal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'cancel-appointment-title');
  const modalTitle = createElement('h2', 'modal__title', 'Cancel this appointment?');
  modalTitle.id = 'cancel-appointment-title';
  const modalMessage = createElement('p', 'modal__message');
  modalMessage.append('Booking ', createElement('strong', 'data'), ' will be cancelled. This cannot be undone.');
  const cancelReference = modalMessage.querySelector('strong');
  const modalActions = createElement('div', 'form-actions');
  const cancelDismiss = createElement('button', 'btn btn--quiet', 'Keep appointment');
  cancelDismiss.type = 'button';
  const cancelConfirm = createElement('button', 'btn btn--danger', 'Cancel appointment');
  cancelConfirm.type = 'button';
  modalActions.append(cancelDismiss, cancelConfirm);
  dialog.append(modalTitle, modalMessage, modalActions);
  cancelModal.append(dialog);

  root.append(head, metrics, next, toolbar, list, cancelModal);

  hosts = {
    metrics,
    next,
    views,
    count,
    updated,
    list,
    cancelModal,
    cancelReference,
    cancelConfirm,
    cancelDismiss,
  };
}

function bindInteractions() {
  const onViewClick = event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    activeView = button.dataset.view;
    renderAppointments();
  };
  const onModalClick = event => {
    if (event.target === hosts.cancelModal) closeCancelModal();
  };
  const onKeyDown = event => {
    if (event.key === 'Escape' && !hosts.cancelModal.hidden) closeCancelModal();
  };

  hosts.views.addEventListener('click', onViewClick);
  hosts.cancelDismiss.addEventListener('click', closeCancelModal);
  hosts.cancelConfirm.addEventListener('click', confirmCancellation);
  hosts.cancelModal.addEventListener('click', onModalClick);
  document.addEventListener('keydown', onKeyDown);

  interactionCleanup = [
    () => hosts?.views.removeEventListener('click', onViewClick),
    () => hosts?.cancelDismiss.removeEventListener('click', closeCancelModal),
    () => hosts?.cancelConfirm.removeEventListener('click', confirmCancellation),
    () => hosts?.cancelModal.removeEventListener('click', onModalClick),
    () => document.removeEventListener('keydown', onKeyDown),
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
    buildPage(context.pageRoot, context);
    bindInteractions();
    await refreshData(true);
  },

  async refresh(nextRecords) {
    records = Array.isArray(nextRecords) ? nextRecords : [];
    renderPage();
  },

  destroy() {
    closeCancelModal();
    for (const cleanup of interactionCleanup.splice(0)) cleanup();
    activeContext = null;
    records = [];
    hosts = null;
  },
};

startPage(page);

export const { mount, refresh, destroy } = page;
