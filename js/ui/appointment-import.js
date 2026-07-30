import { db } from '../db.js';
import { createModal } from './modal.js';
import { readSheet, toCsv, downloadFile } from './sheet.js';
import { format } from '../format.js';

// A spreadsheet of loads, booked one at a time through the ordinary booking.
//
// A site coming onto MaxDock has next week already written down somewhere, and
// typing forty loads into a wizard is the reason it does not get written down in
// MaxDock. This reads the sheet they already have.
//
// Two rules make that safe, and they are the same two the user import follows:
//
//   Every row goes through `book_appointment` or `book_routed_appointment` — the
//   same functions the wizard calls. So the notice period, the booking window, the
//   capacity check, the direction windows, the duration rules, the dock choice and
//   the after-hours refusal are all the ones that already exist. There is no second
//   way to create an appointment in this application and there must never be one:
//   a row that would be refused at the counter is refused here.
//
//   Nothing is booked until the sheet has been read back on screen with a verdict
//   against every row. A sheet is checked against this site's own enabled types and
//   its own dock rules before anybody presses the button, and the rows that cannot
//   go are named rather than silently dropped.
//
// The file is read in the browser. It is a list of a customer's shipments and it is
// not sent anywhere to be parsed.

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const normalise = value => String(value ?? '').trim().toLowerCase();
const clean = value => String(value ?? '').trim();
// Spacing and punctuation are not a decision anybody made: "53 ft Trailer",
// "53ft trailer" and "trailer_53" are one truck written three ways, and sending a
// sheet back over a space would be the wrong answer.
const key = value => normalise(value).replace(/[^a-z0-9]/g, '');

// The headings a site might reasonably write, mapped onto the fields the booking
// functions want. Anything unrecognised is ignored rather than refused, so an
// export from somebody else's system can be handed over with its extra columns on.
const FIELDS = {
  date: 'date', 'appointment date': 'date', day: 'date',
  time: 'time', 'start time': 'time', start: 'time',
  direction: 'direction', 'in / out': 'direction', 'in/out': 'direction',
  company: 'company', 'company or site': 'company', vendor: 'company', customer: 'company', site: 'company', 'other end': 'company',
  // Not a bare "Type": on a shipping sheet that is as likely to mean the load as
  // the company, and guessing wrong would book forty rows against the wrong field.
  'company type': 'companyType', 'party type': 'companyType',
  'appointment type': 'appointmentType', load: 'appointmentType', 'load type': 'appointmentType',
  'truck type': 'truckType', truck: 'truckType', trailer: 'truckType', vehicle: 'truckType',
  skids: 'skids', 'skid count': 'skids', pallets: 'skids',
  handling: 'handling', 'handling type': 'handling',
  carrier: 'carrier', 'carrier name': 'carrier',
  'po / bol / job': 'reference', po: 'reference', bol: 'reference', job: 'reference', reference: 'reference', 'po number': 'reference',
  priority: 'priority',
  'requester name': 'requesterName', contact: 'requesterName', 'contact name': 'requesterName',
  'requester email': 'requesterEmail', email: 'requesterEmail', 'contact email': 'requesterEmail',
  notes: 'notes', note: 'notes', comments: 'notes',
};

const DIRECTIONS = { inbound: 'inbound', in: 'inbound', receiving: 'inbound', receipt: 'inbound', delivery: 'inbound', outbound: 'outbound', out: 'outbound', shipping: 'outbound', shipment: 'outbound', pickup: 'outbound', collection: 'outbound' };
const EXTERNAL_TYPES = ['Customer', 'Vendor', 'Carrier'];
const YES = new Set(['y', 'yes', 'true', '1', 'priority', 'urgent']);

// 2026-08-04, 04/08/2026 and 8/4/2026 are all a date somebody typed. The first is
// unambiguous and the rest are not, so a slashed date is read the way this country
// writes it — day first is a European habit and these sites are Canadian, which
// means month first. Said out loud on the screen for every row, so a sheet written
// the other way is seen before it is booked rather than after.
function readDate(value) {
  const text = clean(value);
  if (!text) return '';
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const slashed = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (slashed) {
    const year = slashed[3].length === 2 ? `20${slashed[3]}` : slashed[3];
    return `${year}-${slashed[1].padStart(2, '0')}-${slashed[2].padStart(2, '0')}`;
  }
  return '';
}

// 08:00, 8:00, 0800, 8, "8:00 AM". A spreadsheet turns some of these into a
// fraction of a day on its own, which readSheet has already converted back.
function readTime(value) {
  const text = clean(value).toUpperCase();
  if (!text) return '';
  const match = text.match(/^(\d{1,2})(?::?(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (match[3] === 'PM' && hour < 12) hour += 12;
  if (match[3] === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function createAppointmentImport({ location, locations = [], reference, onDone } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'scrim';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="appt-import-title">
      <div class="modal__head">
        <div><h2 class="modal__title" id="appt-import-title">Import appointments</h2><p class="modal__sub" data-import-sub></p></div>
        <button class="modal__x" type="button" data-import-close aria-label="Close">×</button>
      </div>
      <div class="modal__body">
        <div class="frow">
          <label class="field field--xl"><span class="field__label">Filled-in sheet</span><input class="input" type="file" accept=".csv,.xlsx,text/csv" data-import-file></label>
          <div class="field-action field--md"><button class="btn btn--quiet" type="button" data-import-template>Download template</button></div>
        </div>
        <p class="hint hint--wide">Every row is booked the same way the booking screen books one, so a load that would be turned down at the counter (too little notice, outside the hours, no dock that takes that truck) is turned down here and says why. Nothing is booked until you have read this list.</p>
        <div data-import-preview></div>
      </div>
      <div class="modal__foot">
        <button class="btn btn--quiet" type="button" data-import-close>Close</button>
        <span class="sub" data-import-status></span>
        <button class="btn btn--primary" type="button" data-import-run disabled>Book appointments</button>
      </div>
    </section>`;
  document.body.append(backdrop);
  const modal = createModal(backdrop, { onRequestClose: () => modal.close() });
  const els = {
    sub: backdrop.querySelector('[data-import-sub]'),
    file: backdrop.querySelector('[data-import-file]'),
    preview: backdrop.querySelector('[data-import-preview]'),
    status: backdrop.querySelector('[data-import-status]'),
    run: backdrop.querySelector('[data-import-run]'),
  };
  let rows = [];
  let results = [];
  let running = false;

  const types = () => reference?.() || { appointmentTypes: [], truckTypes: [], handlingTypes: [] };
  const matchCode = (list, value) => {
    const wanted = key(value);
    if (!wanted) return null;
    return list.find(item => key(item.name) === wanted || key(item.code) === wanted)?.code || null;
  };
  // A Max site at the other end makes this a routed movement, booked at both ends
  // by book_routed_appointment. Anything else is an external company.
  const maxSite = value => {
    const wanted = key(value);
    return wanted ? locations.find(item => key(item.name) === wanted) || null : null;
  };

  function templateCsv() {
    const kinds = types();
    const today = format.addDaysInput(format.todayInput(location), 7, location);
    return toCsv([
      [`# MaxDock appointment import · ${location?.name || ''}`],
      ['# One row per truck. Lines starting with # are ignored, and so is any column MaxDock does not recognise.'],
      ['# Date: 2026-08-11 or 11/08/2026 read as month/day. Time: 08:00, 8:00 or 8:00 AM.'],
      ['# Direction: Inbound or Outbound.'],
      [`# Company or site: a Max site books the run at both ends. Sites: ${locations.map(item => item.name).join('; ')}`],
      ['# Company type applies to an outside company only: Customer, Vendor or Carrier.'],
      [`# Appointment type: ${kinds.appointmentTypes.map(item => item.name).join(', ') || 'none enabled at this site'}`],
      [`# Truck type: ${kinds.truckTypes.map(item => item.name).join(', ') || 'none enabled at this site'}`],
      [`# Handling: ${kinds.handlingTypes.map(item => item.name).join(', ') || 'none enabled at this site'}`],
      ['Date', 'Time', 'Direction', 'Company or site', 'Company type', 'Appointment type', 'Truck type', 'Skids', 'Handling', 'PO / BOL / job', 'Carrier', 'Priority', 'Requester name', 'Requester email', 'Notes'],
      ['# EXAMPLE, delete this row', today, '08:00', 'Outbound', locations[0]?.name || 'Acme Foods', 'Customer',
        kinds.appointmentTypes[0]?.name || '', kinds.truckTypes[0]?.name || '', '18', kinds.handlingTypes[0]?.name || '',
        'PO-10231', 'Day & Ross', 'No', 'A. Planner', 'planner@example.com', ''],
    ]);
  }

  // Everything that can be known without asking the server. What is left — the
  // notice period, the hours, capacity, whether a dock is free — is the booking
  // function's job, and asking it twice would be two sets of rules.
  function readRows(sheet) {
    const body = sheet.filter(row => !String(row[0] || '').startsWith('#'));
    if (!body.length) return { records: [], error: 'That sheet has no rows on it.' };
    const header = body[0].map(cell => FIELDS[normalise(cell)] || '');
    for (const required of ['date', 'time', 'direction', 'skids']) {
      if (!header.includes(required)) {
        return { records: [], error: 'That sheet is missing the Date, Time, Direction or Skids column. Download the template and fill that in.' };
      }
    }
    const kinds = types();
    const records = [];
    for (const [index, row] of body.slice(1).entries()) {
      const values = {};
      header.forEach((field, column) => { if (field) values[field] = clean(row[column]); });
      const site = maxSite(values.company);
      const record = {
        line: index + 2,
        date: readDate(values.date),
        time: readTime(values.time),
        direction: DIRECTIONS[normalise(values.direction)] || '',
        company: values.company || '',
        site,
        companyType: EXTERNAL_TYPES.find(item => key(item) === key(values.companyType)) || '',
        appointmentTypeCode: matchCode(kinds.appointmentTypes, values.appointmentType),
        truckTypeCode: matchCode(kinds.truckTypes, values.truckType),
        handlingCode: matchCode(kinds.handlingTypes, values.handling),
        skids: Number(values.skids),
        reference: values.reference || '',
        carrier: values.carrier || '',
        priority: YES.has(normalise(values.priority)),
        requesterName: values.requesterName || '',
        requesterEmail: values.requesterEmail || '',
        notes: values.notes || '',
        raw: values,
        errors: [],
      };
      if (!record.date) record.errors.push(`Date "${values.date}" is not a date`);
      if (!record.time) record.errors.push(`Time "${values.time}" is not a time`);
      if (!record.direction) record.errors.push(`Direction has to be Inbound or Outbound, not "${values.direction}"`);
      if (!Number.isInteger(record.skids) || record.skids < 0) record.errors.push(`Skids "${values.skids}" is not a whole number`);
      if (!record.appointmentTypeCode) record.errors.push(`Appointment type "${values.appointmentType}" is not enabled at this site`);
      if (!record.truckTypeCode) record.errors.push(`Truck type "${values.truckType}" is not enabled at this site`);
      if (!record.handlingCode) record.errors.push(`Handling "${values.handling}" is not enabled at this site`);
      if (!record.reference) record.errors.push('No PO / BOL / job');
      if (!record.company) record.errors.push('No company or site at the other end');
      else if (!site && !record.companyType) record.errors.push('An outside company needs a company type: Customer, Vendor or Carrier');
      if (!record.requesterName) record.errors.push('No requester name');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(record.requesterEmail)) record.errors.push('No requester email');
      records.push(record);
    }
    return { records, error: records.length ? '' : 'That sheet has no loads on it.' };
  }

  // One arg shape for both functions: book_appointment and
  // book_routed_appointment take the same parameters, and which one runs is
  // decided by whether the other end is a Max site — exactly as the wizard
  // decides it.
  function bookingArgs(record) {
    const routed = Boolean(record.site);
    return {
      p_location_id: location.id,
      p_date: record.date,
      p_start_time: record.time,
      p_direction: record.direction,
      p_requester_type: routed ? record.site.name : record.companyType,
      p_appointment_type_code: record.appointmentTypeCode,
      p_truck_type_code: record.truckTypeCode,
      p_skid_count: record.skids,
      p_handling_type_code: record.handlingCode,
      p_is_priority: record.priority,
      p_requester_name: record.requesterName,
      p_requester_email: record.requesterEmail.toLowerCase(),
      p_external_reference: record.reference,
      p_company_name: routed ? record.site.name : record.company,
      p_requester_location_id: routed ? record.site.id : null,
      p_carrier_name: record.carrier || null,
      p_notes: record.notes || null,
      // Never from a sheet. Booking outside a site's hours is a decision somebody
      // takes with their name against it, on the screen, one load at a time.
      p_after_hours_confirmed: false,
    };
  }

  function renderPreview() {
    const good = rows.filter(record => !record.errors.length);
    els.run.disabled = running || !good.length;
    els.run.textContent = good.length > 1 ? `Book ${good.length} appointments` : 'Book appointment';
    if (!rows.length) { els.preview.replaceChildren(); return; }
    els.preview.innerHTML = `
      <p class="form-message ${good.length === rows.length ? 'form-message--success' : ''}">${good.length} of ${rows.length} row${rows.length === 1 ? '' : 's'} ready${good.length === rows.length ? '' : ` · ${rows.length - good.length} to fix in the sheet`}</p>
      <div class="tablewrap"><table class="table">
        <thead><tr><th>Row</th><th>When</th><th>Direction</th><th>Other end</th><th>Load</th><th class="col-fill">Check</th></tr></thead>
        <tbody>${rows.map(record => `<tr>
          <td class="data">${record.line}</td>
          <td class="data">${escapeHtml(record.date && record.time ? `${format.shortDateInput(record.date, location)} ${record.time}` : `${record.raw.date || '–'} ${record.raw.time || ''}`)}</td>
          <td>${escapeHtml(record.direction ? format.role(record.direction) : record.raw.direction || '–')}</td>
          <td class="cell-cap">${escapeHtml(record.company || '–')}${record.site ? ' <span class="tag tag--quiet">Max site</span>' : ''}</td>
          <td class="data">${escapeHtml(Number.isFinite(record.skids) ? `${record.skids} sk` : '–')}</td>
          <td class="cell-elide" title="${escapeHtml(record.errors.join(' · ') || 'Ready to book')}">${record.errors.length
            ? `<span class="tag tag--stop">Fix</span> ${escapeHtml(record.errors.join(' · '))}`
            : '<span class="tag tag--ok">Ready</span>'}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  }

  async function loadFile(file) {
    els.status.textContent = '';
    if (!file) { rows = []; renderPreview(); return; }
    try {
      const { records, error } = readRows(await readSheet(file));
      rows = records;
      renderPreview();
      if (error) els.status.textContent = error;
    } catch (error) {
      rows = [];
      renderPreview();
      els.status.textContent = error.message || 'That file could not be read.';
    }
  }

  // One at a time, on purpose. Each row takes a real slot, and the one before it
  // changes what is free for the one after — booking them together would either
  // need a second set of capacity rules or hand back a list nobody can act on.
  // A failure halfway through leaves an exact account of which loads exist.
  async function run() {
    const ready = rows.filter(record => !record.errors.length);
    if (!ready.length || running) return;
    running = true;
    els.run.disabled = true;
    results = [];
    for (const [index, record] of ready.entries()) {
      els.status.textContent = `Booking ${index + 1} of ${ready.length}…`;
      try {
        const answer = await db.rpc(record.site ? 'book_routed_appointment' : 'book_appointment', bookingArgs(record), {
          key: `board:import:${crypto.randomUUID()}`, retry: 0,
        });
        results.push({ record, ok: true, reference: answer?.booking_reference || '', dock: answer?.dock_name || '', message: 'Booked' });
      } catch (error) {
        results.push({ record, ok: false, reference: '', dock: '', message: error.userMessage || error.message || 'Could not be booked' });
      }
    }
    running = false;
    db.invalidate('board:schedule:');
    db.invalidate('queue:schedule:');
    db.invalidate('appointments:mine');
    renderResults();
    await onDone?.();
  }

  function renderResults() {
    const booked = results.filter(result => result.ok);
    els.status.textContent = '';
    els.run.hidden = true;
    els.file.disabled = true;
    els.preview.innerHTML = `
      <p class="form-message ${booked.length === results.length ? 'form-message--success' : ''}">${booked.length} of ${results.length} appointment${results.length === 1 ? '' : 's'} booked.</p>
      <p class="hint hint--wide">Whoever was named on each row has been told, the same as any other booking. A row that was refused says why; fix it in the sheet and import that sheet again; the ones already booked are not booked twice, because their references exist and the loads are on the board.</p>
      <div class="tablewrap"><table class="table">
        <thead><tr><th>Row</th><th>When</th><th>Reference</th><th>Dock</th><th class="col-fill">Result</th></tr></thead>
        <tbody>${results.map(result => `<tr>
          <td class="data">${result.record.line}</td>
          <td class="data">${escapeHtml(`${format.shortDateInput(result.record.date, location)} ${result.record.time}`)}</td>
          <td class="data">${escapeHtml(result.reference || '–')}</td>
          <td>${escapeHtml(result.dock || '–')}</td>
          <td class="cell-elide" title="${escapeHtml(result.message)}">${result.ok ? '<span class="tag tag--ok">Booked</span>' : `<span class="tag tag--stop">Not booked</span> ${escapeHtml(result.message)}`}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="form-actions"><button class="btn btn--quiet" type="button" data-import-download>Download the result</button></div>`;
  }

  function downloadResults() {
    const out = [['Row', 'Date', 'Time', 'Direction', 'Other end', 'Skids', 'PO / BOL / job', 'Reference', 'Dock', 'Result']];
    for (const result of results) {
      out.push([
        result.record.line, result.record.date, result.record.time, result.record.direction,
        result.record.company, result.record.skids, result.record.reference,
        result.reference, result.dock, result.ok ? 'Booked' : result.message,
      ]);
    }
    downloadFile('maxdock-imported-appointments.csv', toCsv(out));
  }

  backdrop.addEventListener('click', event => {
    if (event.target.closest('[data-import-close]')) { modal.close(); return; }
    if (event.target.closest('[data-import-template]')) { downloadFile('maxdock-appointment-import-template.csv', templateCsv()); return; }
    if (event.target.closest('[data-import-run]')) { run(); return; }
    if (event.target.closest('[data-import-download]')) downloadResults();
  });
  backdrop.addEventListener('change', event => {
    if (event.target.matches('[data-import-file]')) loadFile(event.target.files?.[0]);
  });

  function open(trigger) {
    rows = [];
    results = [];
    running = false;
    els.preview.replaceChildren();
    els.status.textContent = '';
    els.file.disabled = false;
    els.file.value = '';
    els.run.hidden = false;
    els.run.disabled = true;
    els.run.textContent = 'Book appointments';
    els.sub.textContent = `${location?.name || ''} · a sheet of loads, booked one at a time through the ordinary booking`;
    renderPreview();
    modal.open({ trigger });
  }

  return { open, close: () => modal.close(), destroy: () => { modal.destroy(); backdrop.remove(); } };
}
