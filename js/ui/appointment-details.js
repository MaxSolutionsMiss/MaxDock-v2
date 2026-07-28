import { db } from '../db.js';
import { createModal } from './modal.js';
import { format } from '../format.js';

// One appointment, everything known about it, from anywhere it appears.
//
// The board and the queue both show a movement as a block or a row, and until
// now clicking one either opened an edit form — for the two roles allowed to
// edit — or did nothing at all. So the questions people come back with weeks
// later, when was this finished and who was driving, had no screen to answer
// them. This is that screen: the booking as it stands, and every event against
// it in order, for anyone who can see the appointment.
//
// Editing stays where it was. If the caller can edit the record it passes an
// `onEdit`, and this hands off rather than duplicating the form.

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function cell(label, value) {
  return `<div class="confirmgrid__cell"><span class="confirmgrid__l">${escapeHtml(label)}</span><span class="confirmgrid__v">${escapeHtml(value ?? '—')}</span></div>`;
}

// A dot per event, coloured by what the event was. A scan is the one people look
// for, so it gets the accent rather than the same grey as an edit.
function eventTone(entry) {
  if (entry.details?.is_check_in) return 'var(--ok)';
  if (entry.action === 'created') return 'var(--dock)';
  if (entry.action === 'status_changed') return 'var(--signal)';
  return 'var(--rule-strong)';
}

export function createAppointmentDetails({ location, onEdit } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'scrim';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="modal modal--md" role="dialog" aria-modal="true" aria-labelledby="appt-details-title">
      <div class="modal__head">
        <div><h2 class="modal__title" id="appt-details-title" data-title>Appointment</h2><p class="modal__sub" data-sub></p></div>
        <button class="modal__x" type="button" data-close aria-label="Close">×</button>
      </div>
      <div class="modal__body">
        <div class="confirmgrid" data-grid></div>
        <h3 class="watch__t section-gap">Activity</h3>
        <div data-log></div>
      </div>
      <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close>Close</button><button class="btn btn--primary" type="button" data-edit hidden>Edit appointment</button></div>
    </section>`;
  document.body.append(backdrop);
  const modal = createModal(backdrop, { onRequestClose: () => modal.close() });
  const els = {
    title: backdrop.querySelector('[data-title]'),
    sub: backdrop.querySelector('[data-sub]'),
    grid: backdrop.querySelector('[data-grid]'),
    log: backdrop.querySelector('[data-log]'),
    edit: backdrop.querySelector('[data-edit]'),
  };
  let current = null;

  backdrop.addEventListener('click', event => {
    if (event.target.closest('[data-close]')) { modal.close(); return; }
    if (event.target.closest('[data-edit]') && current) { modal.close(); onEdit?.(current); }
  });

  function renderLog(entries) {
    if (!entries.length) {
      els.log.innerHTML = '<p class="hint">No activity recorded for this appointment.</p>';
      return;
    }
    els.log.innerHTML = entries.map(entry => {
      const fields = entry.details?.changed_fields || [];
      const detail = fields.length ? `${fields.join(', ')} changed. ` : '';
      return `<div class="watchitem">
        <span class="wdot" style="--c:${eventTone(entry)}"></span>
        <div>
          <b>${escapeHtml(entry.summary || format.role(entry.action))}</b>
          ${escapeHtml(detail)}<span class="sub">${escapeHtml(format.timestamp(entry.changed_at, location))} · ${escapeHtml(entry.changed_by_name || 'MaxDock')}</span>
        </div>
      </div>`;
    }).join('');
  }

  async function open(record, { trigger, canEdit = false } = {}) {
    current = record;
    const site = { timezone: record.location_timezone || location?.timezone };
    els.title.textContent = record.booking_reference || 'Appointment';
    els.sub.textContent = [format.role(record.direction || ''), record.company_name || record.display_counterpart_location_name || record.requester_name].filter(Boolean).join(' · ');
    els.edit.hidden = !canEdit;
    els.grid.innerHTML = [
      cell('Status', format.role(record.status)),
      cell('Booked', `${format.shortDateInput(format.inputDate(record.start_at, site), site)} · ${format.time(record.start_at, site)}–${format.time(record.end_at, site)}`),
      cell('Dock', record.dock_name || record.dock),
      cell('Direction', format.role(record.direction || '')),
      cell('Company', record.company_name || record.display_counterpart_location_name),
      cell('Carrier', record.carrier_name),
      cell('Skids', record.skid_count === null || record.skid_count === undefined ? null : `${record.skid_count} skids`),
      cell('PO / BOL / job', record.external_reference),
      cell('Driver', record.driver_name),
      cell('First scanned', record.checked_in_at ? format.timestamp(record.checked_in_at, site) : 'Not scanned yet'),
    ].join('');
    els.log.innerHTML = '<p class="hint">Loading activity…</p>';
    modal.open({ trigger });

    try {
      const rows = await db.rpc('get_appointment_history', { p_appointment_id: record.id || record.appointment_id }, {
        key: `appointment:history:${record.id || record.appointment_id}`, cache: 10000, retry: 1,
      });
      renderLog(Array.isArray(rows) ? rows : []);
    } catch (error) {
      // Reading history needs audit.view, which not every role holds. That is a
      // permission, not a fault, and the details above are still worth showing.
      els.log.innerHTML = `<p class="hint">${escapeHtml(error.userMessage || 'The activity log is not available for your account.')}</p>`;
    }
  }

  return { open, close: () => modal.close(), destroy: () => { modal.destroy(); backdrop.remove(); } };
}
