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

// Four megabytes, said once. The bucket enforces the same number, because a limit only
// checked in a browser is a limit anybody with a fetch call can ignore — this one is here so
// a person picking a 30 MB photo is told before they wait for the upload to fail.
const MAX_MB = 4;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const BUCKET = 'appointment-documents';

const fileSize = bytes => (bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// A mark for what kind of file it is, so a list of eight documents can be skimmed. Not a
// preview: a PDF thumbnail in a dialog is a lot of work to tell somebody something the file
// name already says.
const fileKind = (mime, name) => {
  const lower = String(name || '').toLowerCase();
  if (/^image\//.test(mime || '') || /\.(jpe?g|png|heic|webp|gif)$/.test(lower)) return 'image';
  if ((mime || '').includes('pdf') || lower.endsWith('.pdf')) return 'pdf';
  if (/\.(xlsx?|csv)$/.test(lower)) return 'sheet';
  return 'file';
};

function cell(label, value) {
  return `<div class="confirmgrid__cell"><span class="confirmgrid__l">${escapeHtml(label)}</span><span class="confirmgrid__v">${escapeHtml(value ?? '–')}</span></div>`;
}


// A dot per event, coloured by what the event was. A scan is the one people look
// for, so it gets the accent rather than the same grey as an edit.
function eventTone(entry) {
  if (entry.details?.is_check_in) return 'var(--ok)';
  // A combine is the one event that moves freight off this number and onto
  // another, so it is the line somebody chasing a load is scanning for.
  if (entry.details?.is_merge) return 'var(--dock-deep)';
  if (entry.action === 'created') return 'var(--dock)';
  if (entry.action === 'status_changed') return 'var(--signal)';
  return 'var(--rule-strong)';
}

export function createAppointmentDetails({ location, onEdit, laneFor, onCombine, truckName } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'scrim';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="appt-details-title">
      <!-- The number is what somebody came here holding, so it is the biggest thing on the
           window; then a small arrow for the direction; then where the load is going, set
           nearly as large, because "outbound to Guelph" is the second thing anybody wants
           and it was previously a grey line half the size. All on one line: two short lines
           stacked wasted the width a landscape window has plenty of. -->
      <div class="modal__head modal__head--load">
        <h2 class="modal__title" id="appt-details-title" data-title>Appointment</h2>
        <span class="apptway">
          <span class="apptdir" data-dir aria-hidden="true"></span>
          <p class="modal__sub" data-sub></p>
        </span>
        <button class="modal__x" type="button" data-close aria-label="Close">×</button>
      </div>
      <div class="modal__body">
        <!-- Four quarters, because a monitor is wider than it is tall and this window used to
             be a single column you scrolled through twice.

             Down the left, the two things somebody *does* with a load: hold its code up to be
             scanned, and deal with its paperwork. Everything about the paperwork lives in that
             one square: the picker, the limit, and the list of what is already attached. So
             there is one place to look for a document rather than two.

             Down the right, everything about the load itself, reading from its own heading. The
             history runs under both at full width, where a long list belongs. It collapses to
             one column on a narrow screen. -->
        <div class="apptcols">
          <div class="apptcols__side">
            <div class="qrbox" data-checkin hidden>
              <div class="qr-frame" data-qr></div>
              <p class="qrbox__c" data-qr-note></p>
            </div>
            <div class="apptdocs">
              <h3 class="watch__t">Documents</h3>
              <div class="docadd">
                <input class="input" type="file" data-doc-file accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx,.xlsx,.csv">
                <button class="btn btn--quiet" type="button" data-doc-upload>Upload</button>
              </div>
              <p class="hint hint--flush">PDF, PNG, JPEG or Word, up to ${MAX_MB} MB each</p>
              <p class="form-message" data-doc-message aria-live="polite"></p>
              <div data-docs></div>
            </div>
          </div>
          <div class="apptcols__main">
            <h3 class="watch__t">This load</h3>
            <div class="confirmgrid" data-grid></div>
            <h3 class="watch__t section-gap">Activity</h3>
            <div data-log></div>
          </div>
        </div>
      </div>
      <div class="modal__foot"><button class="btn btn--quiet" type="button" data-close>Close</button><button class="btn btn--quiet" type="button" data-combine hidden></button><button class="btn btn--primary" type="button" data-edit hidden>Edit appointment</button></div>
    </section>`;
  document.body.append(backdrop);
  const modal = createModal(backdrop, { onRequestClose: () => modal.close() });
  const els = {
    title: backdrop.querySelector('[data-title]'),
    sub: backdrop.querySelector('[data-sub]'),
    dir: backdrop.querySelector('[data-dir]'),
    grid: backdrop.querySelector('[data-grid]'),
    log: backdrop.querySelector('[data-log]'),
    edit: backdrop.querySelector('[data-edit]'),
    combine: backdrop.querySelector('[data-combine]'),
    checkin: backdrop.querySelector('[data-checkin]'),
    qr: backdrop.querySelector('[data-qr]'),
    qrNote: backdrop.querySelector('[data-qr-note]'),
    docs: backdrop.querySelector('[data-docs]'),
    docFile: backdrop.querySelector('[data-doc-file]'),
    docUpload: backdrop.querySelector('[data-doc-upload]'),
    docMessage: backdrop.querySelector('[data-doc-message]'),
  };
  let current = null;
  let currentLane = null;

  backdrop.addEventListener('click', event => {
    if (event.target.closest('[data-close]')) { modal.close(); return; }
    if (event.target.closest('[data-edit]') && current) { modal.close(); onEdit?.(current); return; }
    if (event.target.closest('[data-combine]') && currentLane) { modal.close(); onCombine?.(currentLane, current); return; }
    if (event.target.closest('[data-doc-upload]')) { uploadDocument(); return; }
    const view = event.target.closest('[data-doc-open]');
    if (view) { openDocument(view.dataset.docOpen); return; }
    const drop = event.target.closest('[data-doc-remove]');
    if (drop) { removeDocument(drop.dataset.docRemove, drop.dataset.docPath); }
  });

  function renderLog(entries) {
    if (!entries.length) {
      els.log.innerHTML = '<p class="hint">No activity recorded for this appointment.</p>';
      return;
    }
    els.log.innerHTML = entries.map(entry => {
      const fields = entry.details?.changed_fields || [];
      const detail = fields.length ? `${fields.join(', ')} changed. ` : '';
      // One row per event, reading across: when, what, and who. Stacked over three lines
      // each, four events filled the column and everything older was a scroll away; across,
      // the same four take a quarter of the room and the times line up to be scanned.
      return `<div class="logrow">
        <span class="wdot" style="--c:${eventTone(entry)}"></span>
        <span class="logrow__t">${escapeHtml(format.timestamp(entry.changed_at, location))}</span>
        <span class="logrow__w">${escapeHtml(entry.summary || format.role(entry.action))}${detail ? ` · ${escapeHtml(detail.trim())}` : ''}</span>
        <span class="logrow__b">${escapeHtml(entry.changed_by_name || 'MaxDock')}</span>
      </div>`;
    }).join('');
  }

  async function open(record, { trigger, canEdit = false } = {}) {
    current = record;
    const site = { timezone: record.location_timezone || location?.timezone };
    els.title.textContent = record.booking_reference || 'Appointment';
    // An arrow into a tray or up out of one. The pair everybody already knows from every
    // inbox and every download button, rather than an arrow at a wall that has to be
    // worked out: goods coming in drop into the building, goods going out leave it.
    const inbound = (record.direction || 'inbound') === 'inbound';
    const TRAY = '<path d="M3 14v4a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-4"/>';
    els.dir.innerHTML = inbound
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/>${TRAY}</svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/>${TRAY}</svg>`;
    els.dir.className = inbound ? 'apptdir' : 'apptdir apptdir--out';
    els.dir.setAttribute('title', inbound ? 'Inbound' : 'Outbound');
    // "Inbound from Weston Foods", not "Inbound · Weston Foods": the preposition is the
    // difference between a label and a sentence, and it costs nothing to say which end of
    // the journey the other party is.
    const other = record.company_name || record.display_counterpart_location_name || record.requester_name;
    els.sub.textContent = other ? `${inbound ? 'Inbound from' : 'Outbound to'} ${other}` : (inbound ? 'Inbound' : 'Outbound');
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
      // What is backing onto the door. The window named the skid count but never the truck
      // carrying them, which is the one fact a dock hand wants before the truck arrives —
      // a 26 ft straight truck and a 53 ft tandem are not the same job at the same door.
      // The schedule carries the code and not the name, so the page that opened this window
      // lends the lookup it already loaded. Without it the window would read "Trailer 53"
      // where the whole application says "53 ft Trailer".
      // A name, not a picture. The truck drawing is reserved for the two places it answers a
      // question — how full a load ended up when combining, and the report about it. Beside a
      // label reading "53 ft Trailer" it added nothing the words did not already say.
      cell('Truck type', record.truck_type || truckName?.(record.truck_type_code) || format.role(record.truck_type_code)),
      cell('PO / BOL / job', record.external_reference),
      cell('Driver', record.driver_name),
      cell('First scanned', record.checked_in_at ? format.timestamp(record.checked_in_at, site) : 'Not scanned yet'),
      // The operational clock, and only the parts of it that were actually recorded. A site
      // that has not switched these on never writes them, and a row reading "Work started: –"
      // would be the window describing a feature rather than describing this load. cell()
      // renders a dash for an empty value rather than nothing, so these are filtered out
      // before they reach it instead of being passed in empty.
      record.service_started_at ? cell('Work started', format.timestamp(record.service_started_at, site)) : '',
      record.departed_at ? cell('Truck left', format.timestamp(record.departed_at, site)) : '',
    ].filter(Boolean).join('');
    els.log.innerHTML = '<p class="hint">Loading activity…</p>';
    els.docs.innerHTML = '<p class="hint">Loading documents…</p>';
    els.docMessage.textContent = '';
    if (els.docFile) els.docFile.value = '';
    els.checkin.hidden = true;
    modal.open({ trigger });
    renderCheckIn(record, site);
    loadDocuments(record);

    try {
      const rows = await db.rpc('get_appointment_history', { p_appointment_id: record.id || record.appointment_id }, {
        key: `appointment:history:${record.id || record.appointment_id}`, cache: 10000, retry: 1,
      });
      const log = Array.isArray(rows) ? rows : [];
      renderLog(log);
      // The numbers that came onto this truck belong with the load, not only in the list of
      // events underneath it. Somebody holding a cancelled reference and somebody asking
      // "what is on this truck" are the same person, and they should not have to read a
      // history to find out. Taken from the history because that is where the merge is
      // recorded; added after it arrives, so the rest of the panel is never held up by it.
      const from = log.flatMap(entry => entry.details?.combined_from || []);
      if (from.length) {
        els.grid.insertAdjacentHTML('beforeend',
          cell(from.length === 1 ? 'Combined from' : `Combined from ${from.length} loads`, from.join(', ')));
      }
    } catch (error) {
      // Reading history needs audit.view, which not every role holds. That is a
      // permission, not a fault, and the details above are still worth showing.
      els.log.innerHTML = `<p class="hint">${escapeHtml(error.userMessage || 'The activity log is not available for your account.')}</p>`;
    }
  }

  // ── Documents ───────────────────────────────────────────────────────────────
  //
  // Read, add and remove, and nothing clever. The bucket is private, so viewing means asking
  // for a short-lived signed link at the moment somebody clicks — not holding a hundred URLs
  // that expire while the window is open.
  async function loadDocuments(record) {
    const id = record.id || record.appointment_id;
    if (!id) return;
    try {
      const rows = await db.select('appointment_documents', query => query
        .select('id,file_name,mime_type,size_bytes,storage_path,origin_reference,uploaded_at')
        .eq('appointment_id', id)
        .order('uploaded_at', { ascending: false }), { key: `appointment:docs:${id}`, cache: 0, retry: 1 });
      if (current !== record) return;
      renderDocuments(Array.isArray(rows) ? rows : [], record);
    } catch (error) {
      els.docs.innerHTML = `<p class="hint">${escapeHtml(error.userMessage || 'The documents for this load could not be read.')}</p>`;
    }
  }

  function renderDocuments(rows, record) {
    if (!rows.length) {
      els.docs.innerHTML = '<p class="hint">Nothing attached to this load yet.</p>';
      return;
    }
    const site = { timezone: record.location_timezone || location?.timezone };
    els.docs.innerHTML = `<ul class="doclist">${rows.map(row => `<li class="docrow">
      <span class="docrow__k docrow__k--${fileKind(row.mime_type, row.file_name)}" aria-hidden="true"></span>
      <span class="docrow__n">
        <b>${escapeHtml(row.file_name)}</b>
        <span>${escapeHtml(fileSize(Number(row.size_bytes || 0)))} · ${escapeHtml(format.dateShort(row.uploaded_at, site))}${
          // Only after a merge. Before one it would say the number already at the top of the
          // window, which is noise.
          row.origin_reference && row.origin_reference !== record.booking_reference
            ? ` · came with ${escapeHtml(row.origin_reference)}` : ''}</span>
      </span>
      <span class="docrow__a">
        <button class="linkBtn" type="button" data-doc-open="${escapeHtml(row.storage_path)}">View</button>
        <button class="linkBtn" type="button" data-doc-remove="${escapeHtml(row.id)}" data-doc-path="${escapeHtml(row.storage_path)}" aria-label="${escapeHtml(`Remove ${row.file_name}`)}">Remove</button>
      </span>
    </li>`).join('')}</ul>`;
  }

  async function uploadDocument() {
    const record = current;
    const file = els.docFile?.files?.[0];
    els.docMessage.textContent = '';
    if (!record || !file) { els.docMessage.textContent = 'Choose a file first.'; return; }
    if (file.size > MAX_BYTES) {
      els.docMessage.textContent = `${file.name} is ${fileSize(file.size)}. The limit is ${MAX_MB} MB. Send a smaller scan or split it.`;
      return;
    }
    const id = record.id || record.appointment_id;
    // The site that physically owns the appointment, not the site whose board is open. On a
    // linked movement those differ — the board shows the far end of another site's booking —
    // and a document belongs to the load, so it is filed against the site holding it. An
    // account without access to that site is refused by row-level security, which is right.
    const locationId = record.physical_location_id || record.location_id || location?.id;
    if (!locationId) { els.docMessage.textContent = 'This load has no site recorded, so a document cannot be filed against it.'; return; }
    els.docUpload.disabled = true;
    // The site is the first path segment because every policy on the bucket asks "may this
    // account see this site", and a policy that has to look the answer up in a table is a
    // policy that runs on every object in the list.
    const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 90);
    const path = `${locationId}/${id}/${crypto.randomUUID()}-${safe}`;
    try {
      await db.storage.upload(BUCKET, path, file, { userMessage: 'The document could not be uploaded.' });
      // The row is written after the file lands, so a failed upload never leaves a document
      // in the list that cannot be opened.
      await db.insert('appointment_documents', {
        appointment_id: id,
        location_id: locationId,
        storage_path: path,
        file_name: file.name.slice(0, 200),
        mime_type: file.type || null,
        size_bytes: file.size,
      }, { select: false, userMessage: 'The document was uploaded but could not be filed against this load.' });
      els.docFile.value = '';
      await loadDocuments(record);
    } catch (error) {
      els.docMessage.textContent = error.userMessage || 'The document could not be uploaded.';
    } finally {
      els.docUpload.disabled = false;
    }
  }

  async function openDocument(path) {
    els.docMessage.textContent = '';
    try {
      const url = await db.storage.signedUrl(BUCKET, path, 300, { userMessage: 'That document could not be opened.' });
      if (url) globalThis.open(url, '_blank', 'noopener');
    } catch (error) {
      els.docMessage.textContent = error.userMessage || 'That document could not be opened.';
    }
  }

  async function removeDocument(id, path) {
    const record = current;
    els.docMessage.textContent = '';
    try {
      // The row first: it is the one under row-level security, so if this account may not
      // remove the document nothing has been deleted from the bucket by the time it is
      // refused.
      await db.remove('appointment_documents', query => query.eq('id', id), { select: false, userMessage: 'That document could not be removed.' });
      await db.storage.remove(BUCKET, [path]).catch(() => {});
      await loadDocuments(record);
    } catch (error) {
      els.docMessage.textContent = error.userMessage || 'That document could not be removed.';
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
    els.qrNote.textContent = 'Scan at the dock to check this load in';
    els.checkin.hidden = false;
    void site;
  }

  return { open, close: () => modal.close(), destroy: () => { modal.destroy(); backdrop.remove(); } };
}
