import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { pageHead } from '../ui/pagehead.js';
import { format } from '../format.js';

// Receiving.
//
// A receiver stands at the dock with a phone and scans the QR on the paperwork.
// There are two ways in and both land here:
//
//   1. The phone's own camera app reads the code and opens this page with the
//      token in the query string. Every phone can do this — no scanner library,
//      and it is the only route that works on iOS, where the browser has no
//      barcode API at all.
//   2. In-app scanning, for a receiver who would rather stay in MaxDock. This
//      uses BarcodeDetector where the browser has it, and simply is not offered
//      where it does not, rather than presenting a camera that cannot read.
//
// Either way the load is shown before anything changes, so a wrong scan is
// caught by the person holding the phone.

const state = {
  context: null,
  appointment: null,
  scanner: null,
  elements: {},
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

const hasScanner = () => typeof globalThis.BarcodeDetector === 'function';

function tokenFromUrl() {
  const value = new URL(globalThis.location.href).searchParams.get('t');
  return /^[0-9a-f-]{36}$/i.test(String(value || '')) ? value : null;
}

// The QR carries a full URL so a phone camera can open it. Older codes carried
// "MAXDOCK|id|reference"; those are read too rather than rejected, so paperwork
// already printed keeps working — it just cannot check anything in, because the
// reference is not a token.
function tokenFromScan(text) {
  const raw = String(text || '').trim();
  if (/^[0-9a-f-]{36}$/i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    const value = parsed.searchParams.get('t');
    if (/^[0-9a-f-]{36}$/i.test(String(value || ''))) return value;
  } catch { /* not a URL — fall through */ }
  return null;
}

function renderIdle(message = '') {
  state.elements.host.innerHTML = `
    <section class="card recv">
      <h3 class="card__title">Scan the appointment code</h3>
      <p class="hint">Point your phone camera at the QR code on the driver's paperwork. It opens MaxDock with the load ready to receive.</p>
      ${hasScanner()
        ? '<div class="form-actions"><button class="btn btn--primary" type="button" data-scan>Scan with camera</button></div>'
        : '<p class="hint">This browser cannot scan inside the app. Use the phone’s own camera app on the code, or type the token below.</p>'}
      <div class="recv__stage" data-stage hidden><video class="recv__video" data-video playsinline muted></video><div class="recv__frame" aria-hidden="true"></div></div>
      <div class="inline-controls" style="margin-top:var(--s4)">
        <label class="field"><span class="field__label">Appointment code</span><input class="input" data-token placeholder="Paste or type the code" autocomplete="off"></label>
        <button class="btn btn--quiet" type="button" data-lookup>Find</button>
      </div>
      ${message ? `<p class="form-message">${escapeHtml(message)}</p>` : ''}
    </section>`;
}

function detail(label, value) {
  return `<div class="confirmgrid__cell"><span class="confirmgrid__l">${escapeHtml(label)}</span><span class="confirmgrid__v">${escapeHtml(value ?? '—')}</span></div>`;
}

function renderAppointment(record) {
  const location = { timezone: record.location_timezone };
  const when = `${format.time(record.start_at, location)}–${format.time(record.end_at, location)}`;
  state.elements.host.innerHTML = `
    <section class="card recv">
      <h3 class="card__title">${escapeHtml(record.booking_reference || 'Appointment')}<span class="status">${escapeHtml(format.role(record.status))}</span></h3>
      <div class="confirmgrid">
        ${detail('Location', record.location_name)}
        ${detail('Dock', record.dock_name)}
        ${detail('Booked', `${format.shortDateInput(format.inputDate(record.start_at, location), location)} · ${when}`)}
        ${detail('Direction', format.role(record.direction))}
        ${detail('Company', record.company_name)}
        ${detail('Carrier', record.carrier_name)}
        ${detail('Truck', record.truck_type)}
        ${detail('Skids', record.skid_count)}
        ${detail('PO / BOL / job', record.external_reference)}
      </div>
      ${record.already_checked_in
        ? `<p class="form-message form-message--success">Received ${escapeHtml(format.timestamp(record.checked_in_at, location))}${record.driver_name ? ` · driver ${escapeHtml(record.driver_name)}` : ''}.</p>`
        : `<div class="inline-controls" style="margin-top:var(--s4)">
             <label class="field"><span class="field__label">Driver <span class="field__opt">optional</span></span><input class="input" data-driver maxlength="120" autocomplete="name" value="${escapeHtml(record.driver_name || '')}"></label>
             <button class="btn btn--primary" type="button" data-confirm>At the dock</button>
           </div>`}
      <div class="form-actions"><button class="btn btn--quiet" type="button" data-again>Scan another</button></div>
    </section>`;
}

async function lookup(token) {
  if (!token) { toast('That code is not a MaxDock appointment code.', 'error'); return; }
  try {
    const rows = await db.rpc('lookup_appointment_by_check_in_token', { p_token: token }, {
      key: `receiving:lookup:${token}`, cache: 0, retry: 1,
      userMessage: 'That appointment could not be looked up.',
    });
    const record = Array.isArray(rows) ? rows[0] : rows;
    if (!record) { renderIdle('That code does not match an appointment at a location you can receive for.'); return; }
    state.appointment = record;
    renderAppointment(record);
  } catch (error) {
    renderIdle(error.userMessage || error.message || 'That appointment could not be looked up.');
  }
}

async function confirmArrival() {
  const record = state.appointment;
  if (!record) return;
  const button = state.elements.host.querySelector('[data-confirm]');
  if (button) button.disabled = true;
  try {
    await db.rpc('check_in_appointment', {
      p_token: new URL(globalThis.location.href).searchParams.get('t') || state.lastToken,
      p_driver_name: state.elements.host.querySelector('[data-driver]')?.value || null,
    }, { key: `receiving:checkin:${crypto.randomUUID()}`, retry: 0 });
    toast(`${record.booking_reference} is at the dock.`, 'success');
    await lookup(state.lastToken);
  } catch (error) {
    toast(error.userMessage || error.message || 'That truck could not be checked in.', 'error');
    if (button) button.disabled = false;
  }
}

// Camera scanning, where the browser can do it. Stopped on every exit path — a
// page that walks away leaving the camera light on is the fastest way to lose an
// operator's trust in an app they are holding.
async function startScanner() {
  const stage = state.elements.host.querySelector('[data-stage]');
  const video = state.elements.host.querySelector('[data-video]');
  if (!stage || !video) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    stage.hidden = false;
    video.srcObject = stream;
    await video.play();
    const detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
    state.scanner = { stream, stopped: false };
    const tick = async () => {
      if (state.scanner?.stopped) return;
      try {
        const found = await detector.detect(video);
        const token = found.map(code => tokenFromScan(code.rawValue)).find(Boolean);
        if (token) { stopScanner(); state.lastToken = token; await lookup(token); return; }
      } catch { /* a frame that cannot be read is not an error worth showing */ }
      globalThis.requestAnimationFrame(tick);
    };
    globalThis.requestAnimationFrame(tick);
  } catch (error) {
    stage.hidden = true;
    toast(error?.name === 'NotAllowedError' ? 'MaxDock needs camera access to scan.' : 'The camera could not be started.', 'error');
  }
}

function stopScanner() {
  if (!state.scanner) return;
  state.scanner.stopped = true;
  for (const track of state.scanner.stream.getTracks()) track.stop();
  state.scanner = null;
}

function wireEvents(root) {
  root.addEventListener('click', event => {
    if (event.target.closest('[data-scan]')) { startScanner(); return; }
    if (event.target.closest('[data-lookup]')) {
      const token = tokenFromScan(root.querySelector('[data-token]')?.value);
      state.lastToken = token;
      lookup(token);
      return;
    }
    if (event.target.closest('[data-confirm]')) { confirmArrival(); return; }
    if (event.target.closest('[data-again]')) { state.appointment = null; renderIdle(); }
  });
}

const page = {
  code: 'receiving',
  permission: 'appointment.check_in',
  async mount(context) {
    state.context = context;
    document.title = 'Receiving · MaxDock';
    context.pageRoot.innerHTML = `${pageHead('Receiving', { subtitle: 'Scan a truck in at the dock' })}<div data-receiving-host></div>`;
    state.elements = { host: context.pageRoot.querySelector('[data-receiving-host]') };
    wireEvents(context.pageRoot);
    const token = tokenFromUrl();
    state.lastToken = token;
    if (token) await lookup(token);
    else renderIdle();
  },
  // The camera stops when the page does. An app that walks away leaving the
  // camera light on is the fastest way to lose the trust of somebody holding it.
  destroy() {
    stopScanner();
  },
};

startPage(page);
export const { mount, refresh, destroy } = page;
