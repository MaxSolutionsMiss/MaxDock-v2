import { db } from '../db.js';
import { createModal } from './modal.js';
import { format } from '../format.js';
import { renderQr } from './qr.js';

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
// `onEdit`, and this hands off rather than duplicating the form. Combining works
// the same way: the caller says which lane this load is on and what to do about
// it, and this offers the action without knowing how a merge is performed.

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

export function createAppointmentDetails({ location, onEdit, laneFor, onCombine } = {}) {
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
        <div class="section-gap qrblock" data-checkin hidden>
          <div class="qr-frame" data-qr></div>
          <div><h3 class="watch__t">Check-in code</h3><p class="hint hint--flush" data-qr-note></p></div>
        </div>
        <h3 class="watch__t section-gap">Activity</h3>
        <div data-log></div>
      </div>
      <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close>Close</button><button class="btn btn--quiet" type="button" data-combine hidden></button><button class="btn btn--primary" type="button" data-edit hidden>Edit appointment</button></div>
    </section>`;
  document.body.append(backdrop);
  const modal = createModal(backdrop, { onRequestClose: () => modal.close() });
  const els = {
    title: backdrop.querySelector('[data-title]'),
    sub: backdrop.querySelector('[data-sub]'),
    grid: backdrop.querySelector('[data-grid]'),
    log: backdrop.querySelector('[data-log]'),
    edit: backdrop.querySelector('[data-edit]'),
    combine: backdrop.querySelector('[data-combine]'),
    checkin: backdrop.querySelector('[data-checkin]'),
    qr: backdrop.querySelector('[data-qr]'),
    qrNote: backdrop.querySelector('[data-qr-note]'),
  };
  let current = null;
  let currentLane = null;

  backdrop.addEventListener('click', event => {
    if (event.target.closest('[data-close]')) { modal.close(); return; }
    if (event.target.closest('[data-edit]') && current) { modal.close(); onEdit?.(current); return; }
    if (event.target.closest('[data-combine]') && currentLane) { modal.close(); onCombine?.(currentLane, current); }
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
    // The other trucks going the same way to the same place today. This is where an
    // operator is standing when the question occurs to them: they have clicked the
    // load they were wondering about, so the offer belongs on it rather than only in
    // a brief they may never have scrolled to. The button names the run instead of
    // saying "Combine", because pressing it is agreeing to cancel real bookings.
    currentLane = laneFor?.(record) || null;
    els.combine.hidden = !currentLane;
    // The lane in the brief's own words — "2 outbound loads to Guelph" — so the two
    // places this is offered read the same. Counting the whole lane rather than "1
    // other load" is both shorter and truer to what happens: two loads become one
    // truck. On a phone the footer has three actions and this is the longest of
    // them; anything wordier wrapped it onto a third row.
    if (currentLane) {
      els.combine.textContent = `Combine ${currentLane.rows.length} loads ${currentLane.direction === 'outbound' ? 'to' : 'from'} ${currentLane.partner}`;
    }
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
    els.checkin.hidden = true;
    modal.open({ trigger });
    renderCheckIn(record, site);

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

  // Every appointment carries its check-in code, not just the one you have this
  // second finished booking. A driver turns up with a printed sheet from three
  // weeks ago, or a coordinator needs to read the code down the phone — the code
  // belongs to the appointment, so it lives wherever the appointment is shown.
  async function renderCheckIn(record, site) {
    const id = record.id || record.appointment_id;
    if (!id || record.entry_kind === 'block') return;
    let token = null;
    try {
      token = await db.rpc('get_appointment_check_in_token', { p_appointment_id: id }, {
        key: `appointment:token:${id}`, cache: 60000, retry: 1,
      });
    } catch { token = null; }
    if (!token || current !== record) return;
    const url = new URL('receiving.html', globalThis.location.href);
    url.searchParams.set('t', token);
    renderQr(els.qr, url.href, { label: `Check-in code for MaxDock appointment ${record.booking_reference || ''}` });
    els.qrNote.textContent = `Scan at the dock to check ${record.booking_reference || 'this appointment'} in. Generated in this browser — nothing about the appointment is sent anywhere to draw it.`;
    els.checkin.hidden = false;
    void site;
  }

  return { open, close: () => modal.close(), destroy: () => { modal.destroy(); backdrop.remove(); } };
}
