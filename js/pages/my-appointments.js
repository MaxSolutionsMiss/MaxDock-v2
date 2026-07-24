import { db } from '../db.js';
import { format } from '../format.js';
import { poll } from '../poll.js';
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
  return `${format.date(record.start_at, { timezone: record.location_timezone })} · ${format.time(record.start_at, { timezone: record.location_timezone })}–${format.time(record.end_at, { timezone: record.location_timezone })}`;
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
  hosts.cancelModal.hidden = true;
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
    db.invalidate('rpc:list_my_appointments');
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
    hosts.list.append(renderState({
      type: 'empty',
      title: `No ${VIEW_LABELS[activeView].toLowerCase()} appointments`,
      message: activeView === 'upcoming'
        ? 'When an appointment is booked, its confirmation and current status will appear here.'
        : 'There are no appointments in this view.',
    }));
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
  hosts.list.replaceChildren(renderState({
    type: 'error',
    title: 'Appointments are temporarily unavailable',
    message: error.userMessage || 'MaxDock could not load your appointments. Your session is still active.',
    primaryLabel: 'Try again',
    onPrimary: () => refreshData(true),
  }));
}

async function loadAppointments({ force = false } = {}) {
  const response = await db.rpc('list_my_appointments', {}, {
    key: 'appointments:mine',
    ttl: 4000,
    force,
    userMessage: 'MaxDock could not load your appointments.',
  });
  return Array.isArray(response.data) ? response.data : [];
}

async function refreshData(force = false) {
  try {
    const nextRecords = await loadAppointments({ force });
    records = nextRecords;
    renderPage();
  } catch (error) {
    renderLoadError(error);
  }
}

function cacheHosts() {
  hosts = {
    metrics: document.querySelector('[data-appointment-metrics]'),
    next: document.querySelector('[data-next-appointment]'),
    views: document.querySelector('[data-appointment-views]'),
    count: document.querySelector('[data-appointment-count]'),
    updated: document.querySelector('[data-appointment-updated]'),
    list: document.querySelector('[data-appointment-list]'),
    cancelModal: document.querySelector('[data-cancel-modal]'),
    cancelReference: document.querySelector('[data-cancel-reference]'),
    cancelConfirm: document.querySelector('[data-cancel-confirm]'),
    cancelDismiss: document.querySelector('[data-cancel-dismiss]'),
  };
}

function bindInteractions() {
  hosts.views.addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    activeView = button.dataset.view;
    renderAppointments();
  });

  hosts.cancelDismiss.addEventListener('click', closeCancelModal);
  hosts.cancelConfirm.addEventListener('click', confirmCancellation);
  hosts.cancelModal.addEventListener('click', event => {
    if (event.target === hosts.cancelModal) closeCancelModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !hosts.cancelModal.hidden) closeCancelModal();
  });
}

startPage({ requiredPermission: 'appointments.view_own' }).then(async context => {
  if (!context) return;
  activeContext = context;
  cacheHosts();
  bindInteractions();
  await refreshData(true);

  poll.start('my-appointments', () => refreshData(false), 5000);
  window.addEventListener('pagehide', () => poll.stop('my-appointments'), { once: true });
});
