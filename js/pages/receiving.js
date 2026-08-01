import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { pageHead } from '../ui/pagehead.js';
import { format } from '../format.js';
import { canScan, createReader } from '../ui/qr-scan.js';
import { createAppointmentDetails } from '../ui/appointment-details.js';

// Receiving.
//
// A receiver stands at the dock with a phone and scans the QR on the paperwork.
// There are two ways in and both land here:
//
//   1. The phone's own camera app reads the code and opens this page with the
//      token in the query string. Every phone can do this, with nothing loaded
//      and no permission to grant, so it stays the route the printed code is
//      built around.
//   2. In-app scanning, for a receiver who would rather stay in MaxDock. This
//      works on every browser that can open a camera, the iPad at the dock
//      included. It used to be offered only where the browser had its own
//      barcode API, which meant Android and almost nowhere else; the camera was
//      never the missing part, only the decode, so that is the only part that
//      falls back. See js/ui/qr-scan.js.
//
//   3. A typed booking number, for paperwork that will not scan. Everything past
//      the lookup works from the appointment's id, so all three routes converge
//      on the same screen and the same status controls.
//
// Whichever way in, the load is shown before anything changes, so a wrong scan
// is caught by the person holding the phone.

const state = {
  context: null,
  appointment: null,
  matches: [],
  scanner: null,
  // Which of the optional steps this site has turned on, keyed by location. A site the
  // receiver has not visited yet is simply not in here, and an absent answer means off.
  clock: new Map(),
  details: null,
  elements: {},
};

// What a receiver can set from the dock, in the order the truck moves through
// them. "Loading" or "Unloading" depends on which way the load is going — the
// same word for both would be wrong half the time.
//
// Only Departed is gated here, and that is the point rather than an oversight. This screen
// has always offered Loading/Unloading, so hiding it behind a switch that ships off would
// take away something the dock uses today — the exact opposite of "with the toggles off,
// nothing changes". The Start switch governs the places that did not have the action at all,
// which are the queue and the appointment window, and whether the recorded time is shown.
// Setting in_progress here stamps the service clock either way, which costs nothing and is
// invisible until a site asks to see it.
//
// Departed is the odd one and deliberately so. It is not a status: the load stays complete
// and only gains the time it pulled off the door, so nothing that reads status — the board
// colours, the queue filters, every scorecard — sees any difference at all.
const STATUS_STEPS = [
  { id: 'arrived', label: 'At the dock' },
  { id: 'in_progress', label: direction => (direction === 'outbound' ? 'Loading' : 'Unloading') },
  { id: 'completed', label: 'Complete' },
  { id: 'departed', label: 'Left the yard', needs: 'track_departure', after: 'completed' },
];

const stepLabel = (step, direction) => (typeof step.label === 'function' ? step.label(direction) : step.label);

// The site's two switches, read the same way the operations queue reads its labour numbers.
// Cached per location for a minute: a receiver stands at one dock for a shift, and this must
// not become a second request on every scan.
async function clockFor(locationId) {
  if (!locationId) return {};
  if (state.clock.has(locationId)) return state.clock.get(locationId);
  const row = await db.select('location_settings', query => query
    .select('track_service_start,track_departure').eq('location_id', locationId).maybeSingle(),
  { key: `receiving:clock:${locationId}`, cache: 60000 }).catch(() => null);
  const value = {
    track_service_start: row?.track_service_start === true,
    track_departure: row?.track_departure === true,
  };
  state.clock.set(locationId, value);
  return value;
}

// Which steps this load can actually be put into, at this site, right now.
function stepsFor(record) {
  const clock = state.clock.get(record.location_id) || {};
  return STATUS_STEPS.filter(step => {
    if (step.needs && clock[step.needs] !== true) return false;
    // Departed only means something once the load is finished, and the RPC refuses it
    // otherwise. Offering a button that is guaranteed to fail is worse than not offering it.
    if (step.after && String(record.status || '') !== step.after) return false;
    return true;
  });
}

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));


function tokenFromUrl() {
  const value = new URL(globalThis.location.href).searchParams.get('t');
  return /^[0-9a-f-]{36}$/i.test(String(value || '')) ? value : null;
}

// The QR carries a full URL so a phone camera can open it. Older codes carried
// "MAXDOCK|id|reference"; those are read too rather than rejected, so paperwork
// already printed keeps working — the reference goes down the typed-code path.
function tokenFromScan(text) {
  const raw = String(text || '').trim();
  if (/^[0-9a-f-]{36}$/i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    const value = parsed.searchParams.get('t');
    if (/^[0-9a-f-]{36}$/i.test(String(value || ''))) return value;
  } catch { /* not a URL, fall through */ }
  return null;
}

// The fixed part of this year's references, filled in for them. Every reference
// is MXD-<year>-<serial>, so the only thing that varies between two loads booked
// this year is the serial — and that is all a receiver should have to key. The
// prefix stays editable rather than being a locked adornment, because a code
// from last year is still a code somebody may need to look up in January.
const referencePrefix = () => `MXD-${new Date().getFullYear()}-`;

// What a receiver types off the paperwork. Anything from two digits up, with or
// without the prefix and the dashes, because nobody standing at a dock types
// punctuation. The prefix is prefilled, so in practice this receives the whole
// reference and the serial is what they actually touched.
function referenceFromInput(text) {
  const raw = String(text || '').trim();
  const digits = raw.replace(/\D/g, '');
  // The prefix alone is not a search — the year's digits would match everything.
  if (raw.replace(/[^0-9a-z]/gi, '').toUpperCase() === referencePrefix().replace(/[^0-9a-z]/gi, '').toUpperCase()) return null;
  return digits.length >= 2 ? raw : null;
}

// One panel, two ways in. Scanning and typing a code are two ways of doing the
// same job, so they are halves of one thing with a rule and the word between
// them rather than two cards that could be mistaken for two steps. On a phone
// they stack and the rule turns with them.
// Opened from the home screen icon rather than from a browser tab. The manifest asks for
// standalone, so this is true exactly when somebody installed it and tapped the icon —
// which is the one context where the office's rail and top bar are in the way.
const isApp = () => Boolean(globalThis.matchMedia?.('(display-mode: standalone)')?.matches)
  || globalThis.navigator?.standalone === true;

// The app's whole first screen: two buttons and nothing else. No list, no counts, no menu.
// Somebody opening this has already decided which one they want before the phone is out of
// their pocket, and every pixel spent on anything else is a pixel they have to look past.
//
// Neither button does the work. Scan opens the camera, Find reveals the number field — the
// same two routes the desk screen shows side by side, one at a time because a phone held in
// one hand has room for one.
function renderHome(message = '') {
  state.elements.host.className = 'rapp rapp--home';
  state.elements.host.innerHTML = `
      <button class="rapp__btn" type="button" data-scan${canScan() ? '' : ' disabled'}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v2.2H5.2V10H3zM14 3h7v7h-2.2V5.2H14zM3 14h2.2v4.8H10V21H3zM18.8 14H21v7h-7v-2.2h4.8z"/><path d="M6.6 6.6h4v4h-4zM13.4 6.6h4v4h-4zM6.6 13.4h4v4h-4zM13.4 13.4h4v4h-4z" class="rapp__dim"/></svg>
        <b>Scan</b>
        <small>${canScan() ? 'Point at the QR on the paperwork' : 'This browser cannot open a camera here'}</small>
      </button>
      <button class="rapp__btn rapp__btn--alt" type="button" data-find>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 2.4a8.2 8.2 0 1 1 0 16.4 8.2 8.2 0 0 1 0-16.4zm0 2.4a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6z"/><path d="M16.3 15.1 22 20.8l-1.7 1.7-5.7-5.7z"/></svg>
        <b>Find</b>
        <small>Type the booking number</small>
      </button>
      <div class="recv__stage" data-stage hidden><video class="recv__video" data-video playsinline muted></video><div class="recv__frame" aria-hidden="true"></div></div>
      ${message ? `<p class="form-message">${escapeHtml(message)}</p>` : ''}`;
}

// The number pad, reached from Find. The prefix is furniture — it is filled in and the caret
// sits after it, so the first key pressed is the first digit that matters.
function renderFind(message = '') {
  state.elements.host.className = '';
  state.elements.host.innerHTML = `
    <div class="rapp">
      <label class="field__label rapp__cap" for="recv-token">Booking number</label>
      <input class="input input--jumbo rapp__in" id="recv-token" data-token value="${referencePrefix()}" placeholder="${referencePrefix()}000071" autocomplete="off" inputmode="text" enterkeyhint="search">
      <p class="hint hint--flush">Just the digits after the last dash. The year is filled in and can be changed for an older load.</p>
      <button class="rapp__btn" type="button" data-lookup><b>Find this load</b></button>
      <button class="btn btn--quiet btn--block" type="button" data-home>Back</button>
      ${message ? `<p class="form-message">${escapeHtml(message)}</p>` : ''}
    </div>`;
  const box = state.elements.host.querySelector('[data-token]');
  if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
}

// One door onto the first screen, so the app and the desk cannot drift into two idle states.
function renderStart(message = '') {
  if (state.mode === 'app') renderHome(message);
  else renderIdle(message);
}

function renderIdle(message = '') {
  state.elements.host.className = '';
  state.elements.host.innerHTML = `
    <div class="recv">
      <section class="card recv__panel">
        <div class="recv__box recv__box--scan">
          <span class="recv__mark"><svg class="recv__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><path d="M14 14h3v3h-3zM20 14v3M14 20h7"></path></svg></span>
          <h3 class="card__title">Scan the code</h3>
          <p class="hint">Point your phone camera at the QR code on the driver's paperwork.</p>
          <span class="field__label recv__cap">QR code</span>
          ${canScan()
            ? '<div class="form-actions"><button class="btn btn--primary btn--block btn--jumbo" type="button" data-scan>Open the camera</button></div>'
            : '<p class="hint hint--flush">This browser cannot open a camera here. Use the phone’s own camera app on the code, and it will open MaxDock here.</p>'}
          <div class="recv__stage" data-stage hidden><video class="recv__video" data-video playsinline muted></video><div class="recv__frame" aria-hidden="true"></div></div>
        </div>
        <div class="recv__or"><span class="tag tag--quiet">or</span></div>
        <div class="recv__box recv__box--type">
          <span class="recv__mark"><svg class="recv__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"></rect><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"></path></svg></span>
          <h3 class="card__title">Enter the booking number</h3>
          <p class="hint">Type the number off the paperwork; the rest is already filled in.</p>
          <label class="field__label recv__cap" for="recv-token">Booking number</label>
          <input class="input input--jumbo" id="recv-token" data-token value="${referencePrefix()}" placeholder="${referencePrefix()}000071" autocomplete="off" inputmode="text" enterkeyhint="search">
          <div class="form-actions"><button class="btn btn--quiet btn--block" type="button" data-lookup>Find the appointment</button></div>
        </div>
      </section>
      ${message ? `<p class="form-message">${escapeHtml(message)}</p>` : ''}
    </div>`;
}

function detail(label, value) {
  return `<div class="confirmgrid__cell"><span class="confirmgrid__l">${escapeHtml(label)}</span><span class="confirmgrid__v">${escapeHtml(value ?? '–')}</span></div>`;
}

// More than one load can end in the same few digits. Rather than guess, the
// receiver is shown the candidates and picks — reference, time and company are
// enough to tell them apart at a glance.
function renderMatches(records) {
  state.elements.host.className = '';
  state.matches = records;
  state.elements.host.innerHTML = `
    <section class="card recv">
      <h3 class="card__title">${records.length} loads match that number</h3>
      <p class="hint">Pick the one at your dock, or type more digits.</p>
      <div class="recv__picks">
        ${records.map((record, index) => {
          const location = { timezone: record.location_timezone };
          return `<button class="recv__pick" type="button" data-pick="${index}">
            <span class="recv__pick-ref data">${escapeHtml(record.booking_reference)}</span>
            <span class="recv__pick-when">${escapeHtml(format.shortDateInput(format.inputDate(record.start_at, location), location))} · ${escapeHtml(format.time(record.start_at, location))}</span>
            <span class="recv__pick-who">${escapeHtml(record.company_name || record.carrier_name || format.role(record.direction))}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="form-actions"><button class="btn btn--quiet" type="button" data-again>Start again</button></div>
    </section>`;
}

// The status chooser the owner asked for: whatever the truck is doing, the
// receiver says so in one tap. Every step stays available rather than only the
// next one, because a receiver who forgot to scan on arrival is standing there
// with a loaded truck and needs Complete, not a lecture about order.
function statusButtons(record) {
  const current = String(record.status || '');
  return stepsFor(record).map(step => {
    const label = stepLabel(step, record.direction);
    const isCurrent = step.id === current;
    return `<button class="btn ${isCurrent ? 'btn--primary' : 'btn--quiet'}" type="button" data-status="${step.id}" ${isCurrent ? 'aria-current="true"' : ''}>${escapeHtml(label)}</button>`;
  }).join('');
}

// What has already been recorded on this load, in the order it happened. Only the parts the
// site has turned on, and only once there is something to show: a line reading "started —"
// tells a receiver nothing except that the screen has a feature they are not using.
function clockLine(record, location) {
  const clock = state.clock.get(record.location_id) || {};
  const parts = [];
  if (clock.track_service_start && record.service_started_at) {
    parts.push(`work started ${format.timestamp(record.service_started_at, location)}`);
  }
  if (clock.track_departure && record.departed_at) {
    parts.push(`left ${format.timestamp(record.departed_at, location)}`);
  }
  if (!parts.length) return '';
  return `<p class="hint hint--flush">${escapeHtml(parts.join(' · '))}.</p>`;
}

function renderAppointment(record) {
  state.elements.host.className = '';
  const location = { timezone: record.location_timezone };
  const when = `${format.time(record.start_at, location)}–${format.time(record.end_at, location)}`;
  state.elements.host.innerHTML = `
    <section class="card recv">
      <h3 class="card__title">${escapeHtml(record.booking_reference || 'Appointment')}<span class="status status--${escapeHtml(String(record.status || ''))}">${escapeHtml(format.role(record.status))}</span></h3>
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
        ? `<p class="form-message form-message--success">First seen ${escapeHtml(format.timestamp(record.checked_in_at, location))}${record.driver_name ? ` · driver ${escapeHtml(record.driver_name)}` : ''}.</p>`
        : ''}
      ${clockLine(record, location)}
      <label class="field field--md"><span class="field__label">Driver <span class="field__opt">optional</span></span><input class="input" data-driver maxlength="120" autocomplete="name" value="${escapeHtml(record.driver_name || '')}"></label>
      <fieldset class="recv__steps"><legend>Where is this truck?</legend>${statusButtons(record)}</fieldset>
      <div class="form-actions"><button class="btn btn--quiet" type="button" data-details>Full details</button><button class="btn btn--quiet" type="button" data-again>Scan another</button></div>
    </section>`;
}

function showResult(rows, emptyMessage) {
  const records = Array.isArray(rows) ? rows : [rows].filter(Boolean);
  if (!records.length) { renderIdle(emptyMessage); return; }
  if (records.length === 1) {
    state.appointment = records[0];
    // Awaited rather than drawn twice. A set of buttons that appears and then rearranges is
    // exactly the moment somebody presses the wrong one.
    clockFor(records[0].location_id).then(() => {
      if (state.appointment === records[0]) renderAppointment(records[0]);
    });
    renderAppointment(records[0]);
    return;
  }
  renderMatches(records);
}

async function lookup(token) {
  if (!token) { toast('That code is not a MaxDock appointment code.', 'error'); return; }
  try {
    const rows = await db.rpc('lookup_appointment_by_check_in_token', { p_token: token }, {
      key: `receiving:lookup:${token}`, cache: 0, retry: 1,
      userMessage: 'That appointment could not be looked up.',
    });
    showResult(rows, 'That code does not match an appointment at a location you can receive for.');
  } catch (error) {
    renderStart(error.userMessage || error.message || 'That appointment could not be looked up.');
  }
}

async function lookupByReference(code) {
  if (!code) { toast('Enter at least the last two digits of the booking number.', 'error'); return; }
  try {
    const rows = await db.rpc('lookup_appointment_by_reference', { p_code: code }, {
      key: `receiving:ref:${code}`, cache: 0, retry: 1,
      userMessage: 'That booking number could not be looked up.',
    });
    showResult(rows, 'No load with that number is booked around today at a location you can receive for.');
  } catch (error) {
    renderStart(error.userMessage || error.message || 'That booking number could not be looked up.');
  }
}

// Re-reads the appointment after the change so the screen shows what the server
// actually holds, not what the tap was meant to do.
async function refreshCurrent() {
  const record = state.appointment;
  if (!record) return;
  const rows = await db.rpc('lookup_appointment_by_reference', { p_code: record.booking_reference }, {
    key: `receiving:refresh:${record.appointment_id}:${Date.now()}`, cache: 0, retry: 1,
  }).catch(() => null);
  const fresh = (Array.isArray(rows) ? rows : []).find(row => row.appointment_id === record.appointment_id);
  // The lookup returns the shape it always returned; extending it would have meant dropping
  // and recreating a SECURITY DEFINER function, which also drops its grants, and the whole
  // point of this change is that it stays easy to reverse. So the departure time, which only
  // the status RPC hands back, is carried across the refetch rather than lost by it.
  if (fresh) {
    const merged = record.departed_at ? { ...fresh, departed_at: record.departed_at } : fresh;
    state.appointment = merged;
    renderAppointment(merged);
  }
}

async function setStatus(status) {
  const record = state.appointment;
  if (!record) return;
  const buttons = [...state.elements.host.querySelectorAll('[data-status]')];
  for (const button of buttons) button.disabled = true;
  try {
    const result = await db.rpc('receive_appointment', {
      p_appointment_id: record.appointment_id,
      p_status: status,
      p_driver_name: state.elements.host.querySelector('[data-driver]')?.value || null,
    }, { key: `receiving:status:${crypto.randomUUID()}`, retry: 0 });
    db.invalidate('queue:schedule:');
    db.invalidate('board:schedule:');
    const step = STATUS_STEPS.find(item => item.id === status);
    toast(`${result.booking_reference} · ${stepLabel(step, record.direction).toLowerCase()}.`, 'success');
    // Departure is not a status, so a refetch cannot show it. The RPC hands it back and it is
    // held on the record the panel is drawing from.
    if (result.departed_at) state.appointment = { ...record, departed_at: result.departed_at };
    await refreshCurrent();
  } catch (error) {
    toast(error.userMessage || error.message || 'That status could not be set.', 'error');
    for (const button of buttons) button.disabled = false;
  }
}

// Camera scanning, where the browser can do it. Stopped on every exit path — a
// page that walks away leaving the camera light on is the fastest way to lose an
// operator's trust in an app they are holding.
async function startScanner() {
  const stage = state.elements.host.querySelector('[data-stage]');
  const video = state.elements.host.querySelector('[data-video]');
  if (!stage || !video) return;
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    // Claimed before the first await after it, so a second press or a page change while the
    // decoder is still being fetched has something to stop and the camera cannot be left on.
    state.scanner = { stream, stopped: false, timer: 0 };
    stage.hidden = false;
    video.srcObject = stream;
    await video.play();
    // Where the browser has no detector this fetches the decoder, which is why it is here
    // and not at the top of the file. By now the camera is already showing, so the wait
    // happens behind a picture rather than behind a button that looks stuck.
    const reader = await createReader();
    if (state.scanner?.stopped) { stopScanner(); return; }
    // Paced rather than run every frame. Reading pixels costs real time on a tablet, and a
    // scan that lands within a tenth of a second of the code being in shot is instant to
    // the person holding it; running sixty times a second would only heat the device.
    const tick = async () => {
      if (state.scanner?.stopped) return;
      try {
        const token = tokenFromScan(await reader.read(video));
        if (token) { stopScanner(); await lookup(token); return; }
      } catch { /* a frame that cannot be read is not an error worth showing */ }
      if (state.scanner && !state.scanner.stopped) state.scanner.timer = globalThis.setTimeout(tick, 100);
    };
    tick();
  } catch (error) {
    stopScanner();
    if (stream) for (const track of stream.getTracks()) track.stop();
    stage.hidden = true;
    video.srcObject = null;
    toast(error?.name === 'NotAllowedError' ? 'MaxDock needs camera access to scan.' : 'The camera could not be started.', 'error');
  }
}

function stopScanner() {
  if (!state.scanner) return;
  state.scanner.stopped = true;
  if (state.scanner.timer) globalThis.clearTimeout(state.scanner.timer);
  for (const track of state.scanner.stream.getTracks()) track.stop();
  state.scanner = null;
}

function submitCode(root) {
  const typed = root.querySelector('[data-token]')?.value;
  // A pasted check-in link or a full token still works here; anything else is
  // treated as a booking number, which is what a receiver actually types.
  const token = tokenFromScan(typed);
  if (token) { lookup(token); return; }
  lookupByReference(referenceFromInput(typed));
}

function wireEvents(root) {
  root.addEventListener('click', event => {
    if (event.target.closest('[data-scan]')) { startScanner(); return; }
    if (event.target.closest('[data-find]')) { renderFind(); return; }
    if (event.target.closest('[data-home]')) { renderStart(); return; }
    if (event.target.closest('[data-lookup]')) { submitCode(root); return; }
    const status = event.target.closest('[data-status]');
    if (status) { setStatus(status.dataset.status); return; }
    // The same window the board and the queue open, rather than a fourth idea of what an
    // appointment looks like. Documents, the activity log and the combining trail are all
    // there already; duplicating a thinner version of them here is how four screens end up
    // disagreeing about one load.
    const details = event.target.closest('[data-details]');
    if (details && state.appointment) {
      state.details = state.details || createAppointmentDetails({ location: state.context.location });
      state.details.open(state.appointment, { trigger: details, canEdit: false });
      return;
    }
    const pick = event.target.closest('[data-pick]');
    if (pick) {
      state.appointment = state.matches[Number(pick.dataset.pick)];
      if (state.appointment) renderAppointment(state.appointment);
      return;
    }
    if (event.target.closest('[data-again]')) { state.appointment = null; state.matches = []; renderStart(); }
  });
  // A phone keyboard offers Go, not a button press. Typing a number and hitting
  // it is the whole interaction for a receiver who is not scanning.
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !event.target.matches('[data-token]')) return;
    event.preventDefault();
    submitCode(root);
  });
}

const page = {
  code: 'receiving',
  permission: 'appointment.check_in',
  // Read by the router before the shell is built, so an installed app never draws the rail.
  get chrome() { return isApp() ? 'app' : 'desk'; },
  async mount(context) {
    state.context = context;
    state.mode = isApp() ? 'app' : 'desk';
    document.title = state.mode === 'app' ? 'Receiving' : 'Receiving · MaxDock';
    // The app has no page head either. The title bar of a one-screen app is the screen.
    context.pageRoot.innerHTML = state.mode === 'app'
      ? '<div data-receiving-host></div>'
      : `${pageHead('Receiving', { subtitle: 'Scan a truck in at the dock' })}<div data-receiving-host></div>`;
    state.elements = { host: context.pageRoot.querySelector('[data-receiving-host]') };
    wireEvents(context.pageRoot);
    const token = tokenFromUrl();
    if (token) { await lookup(token); return; }
    renderStart();
    // Caret after the prefix, so the first key they press is the first digit
    // that matters rather than a correction to text MaxDock filled in.
    const box = state.elements.host.querySelector('[data-token]');
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  },
  // The camera stops when the page does. An app that walks away leaving the
  // camera light on is the fastest way to lose the trust of somebody holding it.
  destroy() {
    stopScanner();
    state.details?.destroy();
    state.details = null;
  },
};

startPage(page);
export const { mount, refresh, destroy } = page;
