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
    && new Date(record.start_at).getTime() >= now;
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
  return [...rows].sort((left, right) => new Date(left.start_at) - new Date(right.start_at));
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
    createElement('strong', 'data', next.booking_reference),
  );
  hosts.next.append(summary, reference);
}

function renderList() {
  const visible = activeView === 'upcoming'
    ? sortRecords(filterRecords(activeView, records))
    : sortRecords(filterRecords(activeView, records)).reverse();

  hosts.list.replaceChildren();
  hosts.resultCount.textContent = `${visible.length} ${visible.length === 1 ? 'appointment' : 'appointments'}`;

  if (!visible.length) {
    renderState(hosts.list, {
      type: 'empty',
      title: `No ${VIEW_LABELS[activeView].toLowerCase()} appointments`,
      message: activeView === 'upcoming'
        ? 'Your next dock appointment will appear here after it is booked.'
        : `There are no appointments in the ${VIEW_LABELS[activeView].toLowerCase()} view.`,
    });
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach(record => fragment.append(createAppointmentCard(record)));
  hosts.list.append(fragment);
}

function renderAll() {
  renderMetrics();
  renderNextAppointment();
  renderList();
}

async function loadAppointments() {
  const result = await db.rpc('list_my_appointments', {}, {
    key: 'rpc:list_my_appointments',
    cache: 0,
    retry: 1,
    userMessage: 'Your appointments could not be loaded.',
  });
  return Array.isArray(result) ? result : [];
}

async function refreshData(force = false) {
  if (force) db.invalidate('rpc:list_my_appointments');
  const nextRecords = await loadAppointments();
  records = nextRecords;
  renderAll();
  hosts.updated.textContent = `Updated ${format.time(null, activeContext.location)}`;
  return records;
}

function createViewControl() {
  const control = createElement('div', 'seg appointment-views');
  control.setAttribute('aria-label', 'Appointment views');

  Object.entries(VIEW_LABELS).forEach(([value, label]) => {
    const button = createElement('button', '', label);
    button.type = 'button';
    button.dataset.view = value;
    button.setAttribute('aria-pressed', String(value === activeView));
    button.addEventListener('click', () => {
      activeView = value;
      control.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      renderList();
    });
    control.append(button);
  });

  return control;
}

function createCancelModal() {
  const backdrop = createElement('div', 'modal-backdrop');
  backdrop.hidden = true;
  backdrop.setAttribute('role', 'presentation');

  const modal = createElement('section', 'modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'cancel-appointment-title');

  const title = createElement('h2', 'modal__title', 'Cancel appointment?');
  title.id = 'cancel-appointment-title';
  const message = createElement('p', 'modal__message');
  message.append('This will cancel booking ', createElement('strong', 'data'), '. This action cannot be undone.');
  const reference = message.querySelector('strong');

  const actions = createElement('div', 'form-actions');
  const dismiss = createElement('button', 'btn btn--quiet', 'Keep appointment');
  dismiss.type = 'button';
  const confirm = createElement('button', 'btn btn--danger', 'Cancel appointment');
  confirm.type = 'button';
  dismiss.addEventListener('click', closeCancelModal);
  confirm.addEventListener('click', confirmCancellation);
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) closeCancelModal();
  });
  actions.append(dismiss, confirm);
  modal.append(title, message, actions);
  backdrop.append(modal);

  return { backdrop, reference, dismiss, confirm };
}

function buildPage(context) {
  const root = context.pageRoot;
  const head = createElement('div', 'page__head');
  const heading = createElement('div');
  heading.append(
    createElement('h1', 'page__title', 'My appointments'),
    createElement('p', 'page__sub', context.customerShell ? 'Track your MaxDock bookings' : 'Your bookings across accessible locations'),
  );
  const actions = createElement('div', 'page__actions');
  const updated = createElement('span', 'page-updated muted', 'Loading appointments…');
  const refresh = createElement('button', 'btn btn--quiet', 'Refresh');
  refresh.type = 'button';
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    try {
      await refreshData(true);
      toast('Appointments refreshed.', 'success');
    } catch (error) {
      toast(error.userMessage || 'Appointments could not be refreshed.', 'error');
    } finally {
      refresh.disabled = false;
    }
  });
  actions.append(updated, refresh);
  head.append(heading, actions);

  const metrics = createElement('section', 'metric-grid');
  metrics.setAttribute('aria-label', 'Appointment summary');

  const next = createElement('section', 'panel next-appointment');
  next.setAttribute('aria-label', 'Next appointment');

  const toolbar = createElement('div', 'appointment-toolbar');
  const viewControl = createViewControl();
  const resultCount = createElement('span', 'appointment-toolbar__count muted');
  toolbar.append(viewControl, resultCount);

  const list = createElement('section', 'appointment-list');
  list.setAttribute('aria-live', 'polite');

  const modal = createCancelModal();
  root.append(head, metrics, next, toolbar, list, modal.backdrop);

  return {
    metrics,
    next,
    list,
    resultCount,
    updated,
    cancelModal: modal.backdrop,
    cancelReference: modal.reference,
    cancelDismiss: modal.dismiss,
    cancelConfirm: modal.confirm,
  };
}

const page = {
  code: 'my-appointments',
  permissions: ['appointment.view_own', 'appointment.view'],

  async mount(context) {
    document.title = 'My appointments · MaxDock';
    activeContext = context;
    hosts = buildPage(context);

    try {
      await refreshData(true);
      poll.start({
        interval: 5000,
        fetch: loadAppointments,
        apply: nextRecords => {
          records = nextRecords;
          renderAll();
          hosts.updated.textContent = `Updated ${format.time(null, activeContext.location)}`;
        },
        onStale: () => {
          hosts.updated.textContent = 'Showing last loaded appointments';
        },
      });
    } catch (error) {
      renderState(hosts.list, {
        type: 'error',
        title: 'Appointments could not be loaded',
        message: error.userMessage || 'MaxDock could not load your appointments.',
        actions: [{ id: 'retry-appointments', label: 'Try again', primary: true, onClick: () => refreshData(true) }],
      });
      hosts.updated.textContent = 'Not updated';
    }
  },

  async refresh() {
    await refreshData(true);
  },

  destroy() {
    poll.stop();
    closeCancelModal();
    activeContext = null;
    records = [];
    hosts = null;
  },
};

startPage(page);

export const { mount, refresh, destroy } = page;
