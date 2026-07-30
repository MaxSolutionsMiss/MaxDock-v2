import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { renderState } from '../ui/empty.js';
import { pageHead, controlsBar } from '../ui/pagehead.js';
import { createCustomizePanel } from '../ui/customize.js';
import { format } from '../format.js';

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'truck-flow', label: 'Truck flow' },
  { id: 'skid-movement', label: 'Skid movement' },
  { id: 'dock-utilisation', label: 'Dock hours' },
  { id: 'scorecard-company', label: 'Vendor scorecard' },
  { id: 'scorecard-location', label: 'Site scorecard' },
  { id: 'fullness', label: 'Truck fullness' },
  { id: 'labour', label: 'Labour hours', permission: 'reports.view_labour' },
];

const PRESETS = [
  { id: 'last7', label: 'Past 7 days', days: 7 },
  { id: 'last30', label: 'Past 30 days', days: 30 },
  { id: 'month', label: 'This month', days: null },
  { id: 'custom', label: 'Custom range', days: null },
];

const state = {
  context: null,
  // The site this page is reporting on. It starts as the one in the top bar and then
  // belongs to this page: a report is something you read *about* a site, not a site you
  // are working at, and reading Guelph's scorecard should not move the dock board.
  locationId: null,
  view: 'overview',
  preset: 'last30',
  from: '',
  to: '',
  data: null,
  scorecard: [],
  fullness: [],
  labour: [],
  elements: {},
  customizePanel: null,
  visibleCards: [],
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const num = value => Number(value ?? 0);

function compact(value) {
  const number = num(value);
  if (number >= 10000) return `${(number / 1000).toFixed(1)}k`;
  return String(Math.round(number));
}

function applyPreset(presetId) {
  state.preset = presetId;
  const today = format.todayInput(state.context.location);
  // addDaysInput takes a calendar day, not an instant. Passing a timestamp left
  // the range start unparsed, so From came up blank and the report asked the RPC
  // for a range it could not read.
  if (presetId === 'last7') { state.from = format.addDaysInput(today, -6); state.to = today; }
  else if (presetId === 'last30') { state.from = format.addDaysInput(today, -29); state.to = today; }
  else if (presetId === 'month') { state.from = `${today.slice(0, 7)}-01`; state.to = today; }
}

async function fetchReport() {
  return db.rpc('get_ai_operations_context', {
    p_location_id: state.locationId,
    p_start_date: state.from,
    p_end_date: state.to,
  }, { key: `reports:${state.locationId}:${state.from}:${state.to}`, cache: 60000, retry: 1, userMessage: 'The report data could not be loaded.' });
}

const KPI_CARDS = [
  { id: 'appointments', label: 'Appointments', className: '', compute: s => compact(num(s.appointments)) },
  { id: 'inbound', label: 'Inbound skids', className: 'kpi--out', compute: s => compact(s.inbound_skids) },
  { id: 'outbound', label: 'Outbound skids', className: 'kpi--ok', compute: s => compact(s.outbound_skids) },
  { id: 'cancelRate', label: 'Cancel rate', className: 'kpi--stop', compute: s => `${(num(s.appointments) ? num(s.cancelled) / num(s.appointments) * 100 : 0).toFixed(0)}%` },
  { id: 'bookedHours', label: 'Booked hours', className: 'kpi--signal', compute: s => compact(num(s.booked_minutes) / 60) },
];
const DEFAULT_CARDS = KPI_CARDS.map(card => card.id);

function kpiRow() {
  const summary = state.data?.summary || {};
  const cards = KPI_CARDS.filter(card => state.visibleCards.includes(card.id));
  if (!cards.length) return '';
  return `<div class="kpis" style="--kpi-cols:${Math.max(2, cards.length)}">${cards.map(card => `<article class="kpi ${card.className}"><span class="kpi__label">${escapeHtml(card.label)}</span><span class="kpi__value">${escapeHtml(card.compute(summary))}</span></article>`).join('')}</div>`;
}

// A compact strip rather than a tall block of bars. The previous chart was a wall
// of blue that told you a shape and nothing else; this splits inbound from outbound
// and prints the day and the number, so a glance gives you the reading and not just
// the silhouette.

// Three readings side by side instead of one tall wall of bars in the middle of
// the page: trucks a day, skids a day split inbound/outbound, and dock hours
// booked a day. Each carries its own total and unit, and the table underneath is
// still the exact record — the strip is for the shape, not for reading numbers off.
function trend(title, unit, rows, series, total) {
  const max = Math.max(1, ...rows.map(row => series.reduce((sum, key) => sum + num(row[key]), 0)));
  const day = row => String(row.date || '').slice(5);
  const columns = rows.map(row => {
    const parts = series.map(key => num(row[key]));
    const readout = series.length > 1 ? `${parts[0]} in / ${parts[1]} out` : String(parts[0]);
    return `<span class="trend__col" title="${escapeHtml(`${day(row)}: ${readout}`)}">${
      parts.map((value, index) => `<span class="trend__bar${index ? ' trend__bar--alt' : ''}" style="height:${(value / max * 100).toFixed(1)}%"></span>`).reverse().join('')
    }</span>`;
  }).join('');
  return `<article class="trend">
    <div class="trend__head"><span class="trend__label">${escapeHtml(title)}</span><span class="trend__total">${escapeHtml(total)}<span>${escapeHtml(unit)}</span></span></div>
    <div class="trend__plot">${columns}</div>
    <div class="trend__axis"><span>${escapeHtml(day(rows[0]) || '')}</span><span>peak ${max}</span><span>${escapeHtml(day(rows[rows.length - 1]) || '')}</span></div>
  </article>`;
}

function trendStrip(byDay) {
  if (!byDay.length) return '<p class="hint">No data in this range.</p>';
  const sum = key => byDay.reduce((total, row) => total + num(row[key]), 0);
  return `<div class="trends">
    ${trend('Truckloads per day', 'trucks', byDay, ['appointments'], compact(sum('appointments')))}
    ${trend('Skid movement per day', 'skids', byDay, ['inbound_skids', 'outbound_skids'], compact(sum('inbound_skids') + sum('outbound_skids')))}
    ${trend('Dock time booked per day', 'hours', byDay.map(row => ({ date: row.date, hours: Math.round(num(row.booked_minutes) / 60) })), ['hours'], compact(sum('booked_minutes') / 60))}
  </div>`;
}

// Dates are read by people here, not by the API. Never print the ISO string.
const dayLabel = value => format.shortDateInput(value, state.context?.location);
const rangeLabel = () => `${format.shortDateInput(state.from, state.context?.location)} – ${format.shortDateInput(state.to, state.context?.location)}`;
// Which site, in words. On a printed report the range alone does not say whose figures
// these are, and the picker is not on the paper.
const siteName = () => (state.context?.locations || []).find(site => site.id === state.locationId)?.name || state.context?.location?.name || '';
const siteRange = () => `${siteName()} · ${rangeLabel()}`;

// ── Three shapes, each for one job ────────────────────────────────────────────
//
// A dial for a single bounded percentage against a target — dock time used, crew used,
// trailer used. One measure, one number, and the thing a manager wants is "how close to
// full is this", which a bar an inch wide does not answer at a glance. Coloured by band,
// and the band is *named* under the number as well as coloured, because a colour on its
// own is not a reading anybody can rely on.
function dial(percent, label, note) {
  if (percent === null || percent === undefined) {
    return `<figure class="dial dial--empty"><div class="dial__face"><span class="dial__v">—</span></div><figcaption class="dial__l">${escapeHtml(label)}<span>not measured</span></figcaption></figure>`;
  }
  const value = Math.max(0, Number(percent));
  const shown = Math.min(100, value);
  // Bands, and what each one means here. Over 100 is a finding, not an error: the day
  // asked for more than there was.
  const band = value > 100 ? 'over' : value >= 85 ? 'high' : value >= 55 ? 'mid' : 'low';
  const words = { over: 'over capacity', high: 'near capacity', mid: 'healthy', low: 'light' }[band];
  return `<figure class="dial dial--${band}" role="img" aria-label="${escapeHtml(`${label}: ${value.toFixed(1)} per cent, ${words}`)}">
    <div class="dial__face" style="--pct:${shown.toFixed(1)}"><span class="dial__v">${value.toFixed(0)}<i>%</i></span></div>
    <figcaption class="dial__l">${escapeHtml(label)}<span>${escapeHtml(note || words)}</span></figcaption>
  </figure>`;
}

// A ring for a part-to-whole with two parts — in and out. Two slices, both named and
// both carrying their number in the legend, so identity never rests on the colour.
// Anything with more parts than this is a ranked bar below, not a thinner slice.
function ring(parts, centreLabel) {
  const total = parts.reduce((sum, part) => sum + num(part.value), 0);
  if (!total) return '<p class="hint">No data in this range.</p>';
  const first = (num(parts[0].value) / total) * 100;
  return `<figure class="ring" role="img" aria-label="${escapeHtml(parts.map(part => `${part.label} ${num(part.value)}`).join(', '))}">
    <div class="ring__face" style="--a:${first.toFixed(1)}"><span class="ring__c">${compact(total)}<i>${escapeHtml(centreLabel)}</i></span></div>
    <figcaption class="ring__k">${parts.map((part, index) => `<span class="lg lg--${index ? 'b' : 'a'}">${escapeHtml(part.label)} <b>${compact(num(part.value))}</b></span>`).join('')}</figcaption>
  </figure>`;
}

// Ranked bars for a magnitude across named categories: truck mix, on-time by partner.
// One hue, because the category is named on its own row — five hues for five truck types
// cannot be told apart under colour blindness however they are chosen, and the name is a
// better label than a colour anyway.
function ranked(rows, { unit = '', max = 8 } = {}) {
  const list = rows.filter(row => num(row.value) > 0).sort((a, b) => num(b.value) - num(a.value)).slice(0, max);
  if (!list.length) return '<p class="hint">No data in this range.</p>';
  const top = Math.max(...list.map(row => num(row.value)));
  return `<div class="ranked">${list.map(row => `<div class="ranked__row">
    <span class="ranked__l" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
    <span class="ranked__t"><span style="width:${((num(row.value) / top) * 100).toFixed(1)}%"></span></span>
    <span class="ranked__v">${escapeHtml(row.shown || `${compact(num(row.value))}${unit}`)}</span>
  </div>`).join('')}</div>`;
}

function table(headers, rows) {
  return `<table class="table"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${
    rows.length ? rows.map(cells => `<tr>${cells.map((cell, index) => `<td class="${index === 0 ? 'data data--strong' : 'data'}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${headers.length}" class="data">No data in this range.</td></tr>`
  }</tbody></table>`;
}

function renderOverview() {
  const byDay = state.data.by_day || [];
  return `${kpiRow()}
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Daily shape</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="panel__body">${trendStrip(byDay)}</div>
      <div class="panel__body">${ring([
        { label: 'Inbound skids', value: state.data.summary?.inbound_skids },
        { label: 'Outbound skids', value: state.data.summary?.outbound_skids },
      ], 'skids moved')}</div>
      <div class="panel__scroll">${table(['Date', 'Appointments', 'Cancelled', 'Priority', 'Inbound skids', 'Outbound skids'], byDay.map(row => [dayLabel(row.date), num(row.appointments), num(row.cancelled), num(row.priority), num(row.inbound_skids), num(row.outbound_skids)]))}</div>
    </div>`;
}

function renderTruckFlow() {
  const byVehicle = state.data.by_vehicle || [];
  return `${kpiRow()}
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Truck mix</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="panel__body">${ranked(byVehicle.map(row => ({ label: row.name, value: row.appointments, shown: `${compact(num(row.appointments))} trucks · ${compact(num(row.skids))} skids` })))}<p class="hint">Trucks by type across the selected range, biggest first.</p></div>
      <div class="panel__scroll">${table(['Truck type', 'Appointments', 'Skids'], byVehicle.map(row => [row.name, num(row.appointments), num(row.skids)]))}</div>
    </div>`;
}

function renderSkidMovement() {
  const byDay = state.data.by_day || [];
  const s = state.data.summary || {};
  return `${kpiRow()}
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Skid movement per day</h3><div class="panel__actions"><span class="sub">${compact(s.inbound_skids)} in · ${compact(s.outbound_skids)} out</span></div></div>
      <div class="panel__body">${byDay.length
        ? `<div class="trends">${trend('Skids per day', 'skids', byDay, ['inbound_skids', 'outbound_skids'], compact(num(s.inbound_skids) + num(s.outbound_skids)))}</div>
           ${ring([{ label: 'Inbound skids', value: s.inbound_skids }, { label: 'Outbound skids', value: s.outbound_skids }], 'skids moved')}`
        : '<p class="hint">No data in this range.</p>'}
        <p class="hint">A taller column is a heavier day. The ring is the balance over the whole range: a site that ships out what it takes in sits near half and half, and a site drifting off centre is either filling up or emptying.</p></div>
      <div class="panel__scroll">${table(['Date', 'Inbound skids', 'Outbound skids', 'Net change'], byDay.map(row => [dayLabel(row.date), num(row.inbound_skids), num(row.outbound_skids), num(row.inbound_skids) - num(row.outbound_skids)]))}</div>
    </div>`;
}

function renderDockUtilisation() {
  const s = state.data.summary || {};
  const byHour = state.data.by_hour || [];
  const compatibility = state.data.compatibility || {};
  const warnings = [];
  if (num(compatibility.docks_without_vehicle_types) > 0) warnings.push(`${compatibility.docks_without_vehicle_types} active dock(s) accept no configured truck type.`);
  if (num(compatibility.vehicle_types_without_docks) > 0) warnings.push(`${compatibility.vehicle_types_without_docks} enabled truck type(s) have no compatible dock.`);
  return `<div class="panel"><div class="panel__head"><h3 class="panel__title">How hard the doors worked</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="dials">
        ${dial(num(s.occupied_utilization_percent), 'Dock time used', 'of the hours the doors were open')}
        ${dial(s.available_dock_minutes ? (num(s.blocked_minutes) / num(s.available_dock_minutes)) * 100 : null, 'Time blocked off', 'maintenance, breaks, events')}
        ${dial(num(s.active_docks) ? (num(s.booked_minutes) / 60) / num(s.active_docks) / Math.max(1, (state.data.by_day || []).length) / 9.5 * 100 : null, 'Busiest door share', 'booked hours per door per day')}
      </div></div>
    <div class="kpis" style="--kpi-cols:4">
      <article class="kpi kpi--signal"><span class="kpi__label">Dock time used</span><span class="kpi__value">${num(s.occupied_utilization_percent).toFixed(1)}<span>%</span></span></article>
      <article class="kpi"><span class="kpi__label">Booked hours</span><span class="kpi__value">${compact(num(s.booked_minutes) / 60)}</span></article>
      <article class="kpi kpi--stop"><span class="kpi__label">Blocked hours</span><span class="kpi__value">${compact(num(s.blocked_minutes) / 60)}</span></article>
      <article class="kpi kpi--out"><span class="kpi__label">Active docks</span><span class="kpi__value">${num(s.active_docks)}</span></article>
    </div>
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Busiest start hours</h3><div class="panel__actions"><span class="sub">${compact(num(s.available_dock_minutes) / 60)} dock-hours available</span></div></div>
      <div class="panel__body">${ranked(byHour.map(row => ({ label: row.label, value: row.appointments, shown: `${compact(num(row.appointments))} trucks · ${compact(num(row.skids))} skids` })))}<p class="hint">The eight busiest booking hours across the selected range, heaviest first. The full hour-by-hour record is in the table below.</p>
        ${warnings.length ? `<p class="form-message">${warnings.map(escapeHtml).join(' ')}</p>` : ''}</div>
      <div class="panel__scroll">${table(['Hour', 'Appointments', 'Skids'], byHour.map(row => [row.label, num(row.appointments), num(row.skids)]))}</div>
    </div>`;
}

// How each vendor and sister site is actually performing. On-time is measured
// against the booked start with the same fifteen-minute grace the operations
// queue uses to call a load late — one definition in the product, not two.
function scoreTone(percent) {
  if (percent === null || percent === undefined) return 'tag--quiet';
  if (percent >= 90) return 'tag--ok';
  return percent >= 75 ? 'tag--warn' : 'tag--stop';
}

// Vendors and sister sites answer different questions. "Which carrier keeps us
// waiting" and "which Max site turns our transfers around" are both worth asking
// and neither is improved by averaging them together, so each is its own view
// over the same query.
function renderScorecard(kind) {
  const rows = (state.scorecard || []).filter(row => row.partner_kind === kind);
  const arrived = rows.reduce((sum, row) => sum + num(row.on_time) + num(row.late), 0);
  const onTime = rows.reduce((sum, row) => sum + num(row.on_time), 0);
  const overall = arrived ? Math.round((onTime / arrived) * 1000) / 10 : null;
  return `<div class="kpis" style="--kpi-cols:4">
      <article class="kpi kpi--ok"><span class="kpi__label">On time</span><span class="kpi__value">${overall === null ? '—' : overall.toFixed(1)}<span>%</span></span></article>
      <article class="kpi"><span class="kpi__label">${kind === 'location' ? 'Sites' : 'Vendors'}</span><span class="kpi__value">${rows.length}</span></article>
      <article class="kpi kpi--out"><span class="kpi__label">Trucks</span><span class="kpi__value">${compact(rows.reduce((sum, row) => sum + num(row.trucks), 0))}</span></article>
      <article class="kpi kpi--stop"><span class="kpi__label">No shows</span><span class="kpi__value">${rows.reduce((sum, row) => sum + num(row.no_shows), 0)}</span></article>
    </div>
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">${kind === 'location' ? 'Max site scorecard' : 'Vendor &amp; carrier scorecard'}</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="panel__body">${ranked(rows
        .filter(row => row.on_time_pct !== null && row.on_time_pct !== undefined)
        .map(row => ({ label: row.partner_name, value: Number(row.on_time_pct), shown: `${Number(row.on_time_pct).toFixed(1)}% of ${num(row.trucks)}` })),
        { max: 10 })}<p class="hint">On time, worst to best is bottom to top — the row to act on is the shortest bar with the most trucks beside it.</p></div>
      <div class="panel__scroll"><table class="table"><thead><tr>
        <th>Partner</th><th>On time</th><th>Trucks</th><th>Skids</th><th>Late</th><th>Average late</th><th>No show</th><th>Cancelled</th><th>Average at dock</th><th class="col-fill">Truck types</th>
      </tr></thead><tbody>${
        rows.length ? rows.map(row => {
          const pct = row.on_time_pct === null || row.on_time_pct === undefined ? null : Number(row.on_time_pct);
          return `<tr>
            <td class="data data--strong">${escapeHtml(row.partner_name)}</td>
            <td><span class="tag ${scoreTone(pct)}">${pct === null ? 'No arrivals' : `${pct.toFixed(1)}%`}</span></td>
            <td class="data">${num(row.trucks)}</td>
            <td class="data">${num(row.skids)} sk</td>
            <td class="data">${num(row.late)}</td>
            <td class="data">${row.avg_minutes_late === null || row.avg_minutes_late === undefined ? '—' : format.duration(row.avg_minutes_late)}</td>
            <td class="data">${num(row.no_shows)}</td>
            <td class="data">${num(row.cancelled)}</td>
            <td class="data">${row.avg_dwell_minutes === null || row.avg_dwell_minutes === undefined ? '—' : format.duration(row.avg_dwell_minutes)}</td>
            <td class="data cell-elide" title="${escapeHtml(row.truck_types || '')}">${escapeHtml(row.truck_types || '—')}</td>
          </tr>`;
        }).join('') : `<tr><td colspan="10" class="data">No movements from any ${kind === 'location' ? 'Max site' : 'vendor or carrier'} in this range.</td></tr>`
      }</tbody></table></div>
      <p class="hint">On time counts a truck checked in within 15 minutes of its booked start. Percentages are over trucks that arrived, so a cancellation is not counted as a late arrival.</p>
    </div>`;
}

// How full the trucks ran on each lane, and what combining did about it.
//
// The number that matters is not how many appointments there were: it is how much
// of each trailer was used, and how many loads were merged onto another truck
// instead of taking one of their own. A 53 ft trailer leaving with eleven skids is
// a truck somebody paid for and did not fill — and if the same lane ran three of
// them in a week, that is two trucks the combining should have caught.
function fullnessCell(row) {
  const pct = row.fullness_pct === null || row.fullness_pct === undefined ? null : Number(row.fullness_pct);
  if (pct === null) return '<span class="sub">Trailer capacity not set</span>';
  return `<div class="fullness${pct > 100 ? ' fullness--over' : ''}">
    <div class="fullness__bar"><span style="width:${Math.min(100, Math.round(pct))}%"></span></div>
    <div class="fullness__t">${pct.toFixed(1)}% · ${num(row.skids)} of ${num(row.capacity_skids)} skids</div>
  </div>`;
}

function renderFullness() {
  const rows = state.fullness || [];
  const measured = rows.reduce((sum, row) => sum + num(row.measured_trucks), 0);
  const skids = rows.reduce((sum, row) => sum + (num(row.measured_trucks) ? num(row.skids) : 0), 0);
  const capacity = rows.reduce((sum, row) => sum + num(row.capacity_skids), 0);
  const overall = capacity ? Math.round((skids / capacity) * 1000) / 10 : null;
  const absorbed = rows.reduce((sum, row) => sum + num(row.loads_absorbed), 0);
  const part = rows.reduce((sum, row) => sum + num(row.part_trucks), 0);
  const savedPct = rows.reduce((sum, row) => sum + num(row.trucks), 0)
    ? (rows.reduce((sum, row) => sum + num(row.loads_absorbed), 0) / (rows.reduce((sum, row) => sum + num(row.trucks), 0) + rows.reduce((sum, row) => sum + num(row.loads_absorbed), 0))) * 100
    : null;
  return `<div class="panel"><div class="panel__head"><h3 class="panel__title">How full the trucks ran</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="dials">
        ${dial(overall, 'Trailer used', 'skids against what the trailers hold')}
        ${dial(measured ? (rows.reduce((sum, row) => sum + num(row.full_trucks), 0) / measured) * 100 : null, 'Trucks that ran full', '90% or more')}
        ${dial(savedPct, 'Trucks saved by combining', 'of what would have run')}
      </div>
      <div class="panel__body">${ranked(rows
        .filter(row => row.fullness_pct !== null && row.fullness_pct !== undefined)
        .map(row => ({ label: row.partner_name, value: Number(row.fullness_pct), shown: `${Number(row.fullness_pct).toFixed(0)}% · ${num(row.trucks)} trucks` })),
        { max: 10 })}<p class="hint">Trailer used per lane. A long run of short bars is a lane that should be combining.</p></div>
    </div>
    <div class="kpis" style="--kpi-cols:4">
      <article class="kpi kpi--ok"><span class="kpi__label">Trailer used</span><span class="kpi__value">${overall === null ? '—' : overall.toFixed(1)}<span>%</span></span></article>
      <article class="kpi kpi--out"><span class="kpi__label">Trucks measured</span><span class="kpi__value">${compact(measured)}</span></article>
      <article class="kpi"><span class="kpi__label">Loads combined</span><span class="kpi__value">${compact(absorbed)}</span></article>
      <article class="kpi kpi--stop"><span class="kpi__label">Under 60% full</span><span class="kpi__value">${compact(part)}</span></article>
    </div>
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Truck fullness and combining</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="panel__scroll"><table class="table"><thead><tr>
        <th>Lane</th><th>Trucks</th><th>Full</th><th>Under 60%</th><th>Combined</th><th>Loads absorbed</th><th>Trucks saved</th><th class="col-fill">Trailer used</th>
      </tr></thead><tbody>${
        rows.length ? rows.map(row => `<tr>
          <td class="data data--strong">${escapeHtml(row.partner_name)}${row.partner_kind === 'location' ? ' <span class="tag tag--quiet">Max site</span>' : ''}</td>
          <td class="data">${num(row.trucks)}</td>
          <td class="data">${num(row.full_trucks)}</td>
          <td class="data">${num(row.part_trucks)}</td>
          <td class="data">${num(row.combined_trucks)}</td>
          <td class="data">${num(row.loads_absorbed)}</td>
          <td class="data">${row.trucks_saved_pct === null || row.trucks_saved_pct === undefined ? '—' : `${Number(row.trucks_saved_pct).toFixed(1)}%`}</td>
          <td>${fullnessCell(row)}</td>
        </tr>`).join('') : '<tr><td colspan="8" class="data">No trucks ran on any lane in this range.</td></tr>'
      }</tbody></table></div>
      <p class="hint hint--wide">Fullness is the skids on a truck against what that truck type holds at this site — set under Settings › Capacity, per site, because the same trailer is stacked differently in different buildings. A truck whose type has no capacity set is counted as a truck and left out of the percentage rather than counted as empty. Full is 90% or more. Trucks saved is the loads that were combined onto another truck as a share of the trucks that would otherwise have run.</p>
    </div>`;
}

// How much of the crew's day the trucks actually took. The denominator is the
// day's recorded crew where somebody recorded one and the standing setting where
// they did not, and the row says which — a manager reading 42% needs to know
// whether it was measured or assumed.
function renderLabour() {
  const rows = state.labour || [];
  const worked = rows.filter(row => num(row.available_hours) > 0 || num(row.trucks) > 0);
  const available = rows.reduce((sum, row) => sum + num(row.available_hours), 0);
  const truckHours = rows.reduce((sum, row) => sum + num(row.truck_hours), 0);
  const trucks = rows.reduce((sum, row) => sum + num(row.trucks), 0);
  const overall = available ? Math.round((truckHours / available) * 1000) / 10 : null;
  const recorded = rows.filter(row => row.source === 'recorded').length;
  const busiest = [...worked].sort((a, b) => num(b.utilization_percent) - num(a.utilization_percent))[0];
  return `<div class="panel"><div class="panel__head"><h3 class="panel__title">What the day asked of the crew</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="dials">
        ${dial(overall, 'Crew used', 'hours on trucks against hours available')}
        ${dial(busiest && busiest.utilization_percent !== null && busiest.utilization_percent !== undefined ? Number(busiest.utilization_percent) : null, 'Busiest day', busiest ? dayLabel(busiest.work_date) : 'no day measured')}
        ${dial(rows.length ? (recorded / rows.length) * 100 : null, 'Days with a real count', 'the rest come off the shift roster')}
      </div></div>
    <div class="kpis" style="--kpi-cols:4">
      <article class="kpi kpi--ok"><span class="kpi__label">Crew used</span><span class="kpi__value">${overall === null ? '—' : overall.toFixed(1)}<span>%</span></span></article>
      <article class="kpi kpi--out"><span class="kpi__label">Hours available</span><span class="kpi__value">${compact(Math.round(available))}</span></article>
      <article class="kpi kpi--signal"><span class="kpi__label">Hours on trucks</span><span class="kpi__value">${compact(Math.round(truckHours))}</span></article>
      <article class="kpi"><span class="kpi__label">Trucks handled</span><span class="kpi__value">${compact(trucks)}</span></article>
    </div>
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Labour hours by day</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="panel__scroll"><table class="table"><thead><tr>
        <th>Date</th><th>People</th><th>Hours each</th><th>Available</th><th>Trucks</th><th>Hours on trucks</th><th>Crew used</th><th>Crew figures</th><th class="col-fill">Note</th>
      </tr></thead><tbody>${
        rows.length ? rows.map(row => `<tr>
          <td class="data data--strong">${escapeHtml(format.dateShort(`${row.work_date}T12:00:00Z`, state.context.location))}</td>
          <td class="data">${num(row.people)}</td>
          <td class="data">${Number(row.hours_each || 0).toFixed(1)}</td>
          <td class="data">${Number(row.available_hours || 0).toFixed(1)} h</td>
          <td class="data">${num(row.trucks)}</td>
          <td class="data">${Number(row.truck_hours || 0).toFixed(1)} h</td>
          <td>${labourCell(row)}</td>
          <td><span class="tag ${row.source === 'recorded' ? 'tag--ok' : 'tag--quiet'}">${row.source === 'recorded' ? 'Recorded' : 'Shift roster'}</span></td>
          <td class="data cell-wrap2">${escapeHtml(row.note || '')}</td>
        </tr>`).join('') : '<tr><td colspan="9" class="data">No days in this range.</td></tr>'
      }</tbody></table></div>
      <p class="hint hint--wide">Hours on trucks is every booked window multiplied by the crew a truck takes — the same arithmetic the operations brief uses, so the two cannot disagree. Cancelled and no-show loads are left out; nobody worked them. Available hours come from the day's recorded crew where somebody recorded one, and from the shift roster under Settings › Labour where nobody did — which is what the Crew figures column says. There is no fudge factor in it: it is the shifts running that weekday, each one's length times the people on it. ${recorded} of ${rows.length} day${rows.length === 1 ? '' : 's'} in this range ${recorded === 1 ? 'has' : 'have'} recorded hours.${busiest && busiest.utilization_percent !== null ? ` Busiest day was ${escapeHtml(dayLabel(busiest.work_date))} at ${Number(busiest.utilization_percent).toFixed(1)}%.` : ''}</p>
    </div>`;
}

// Over 100% is the finding, not an error: it means the day's trucks needed more
// crew hours than the crew had, which is how a site discovers it was short.
function labourCell(row) {
  const pct = row.utilization_percent === null || row.utilization_percent === undefined ? null : Number(row.utilization_percent);
  if (pct === null) return '<span class="sub">No crew recorded</span>';
  return `<div class="fullness${pct > 100 ? ' fullness--over' : ''}">
    <div class="fullness__bar"><span style="width:${Math.min(100, Math.round(pct))}%"></span></div>
    <div class="fullness__t">${pct.toFixed(1)}%${pct > 100 ? ` · ${(Number(row.truck_hours) - Number(row.available_hours)).toFixed(1)} h short` : ''}</div>
  </div>`;
}

function renderView() {
  if (!state.data) return;
  const renderers = {
    overview: renderOverview, 'truck-flow': renderTruckFlow, 'skid-movement': renderSkidMovement,
    'dock-utilisation': renderDockUtilisation,
    'scorecard-company': () => renderScorecard('company'),
    'scorecard-location': () => renderScorecard('location'),
    fullness: renderFullness, labour: renderLabour,
  };
  state.elements.host.innerHTML = (renderers[state.view] || renderOverview)();
}

function csvRowsForView() {
  const data = state.data || {};
  if (state.view.startsWith('scorecard')) {
    const kind = state.view === 'scorecard-location' ? 'location' : 'company';
    return [
      ['Partner', 'Kind', 'On time %', 'Trucks', 'Skids', 'Completed', 'On time', 'Late', 'Avg minutes late', 'No shows', 'Cancelled', 'Avg minutes at dock', 'Truck types'],
      ...(state.scorecard || []).filter(row => row.partner_kind === kind).map(row => [
        row.partner_name, row.partner_kind, row.on_time_pct ?? '', num(row.trucks), num(row.skids), num(row.completed),
        num(row.on_time), num(row.late), row.avg_minutes_late ?? '', num(row.no_shows), num(row.cancelled),
        row.avg_dwell_minutes ?? '', row.truck_types || '',
      ]),
    ];
  }
  if (state.view === 'fullness') {
    return [
      ['Lane', 'Kind', 'Trucks', 'Measured', 'Full', 'Under 60%', 'Combined trucks', 'Loads absorbed', 'Trucks saved %', 'Skids', 'Capacity skids', 'Trailer used %'],
      ...(state.fullness || []).map(row => [
        row.partner_name, row.partner_kind, num(row.trucks), num(row.measured_trucks), num(row.full_trucks),
        num(row.part_trucks), num(row.combined_trucks), num(row.loads_absorbed), row.trucks_saved_pct ?? '',
        num(row.skids), num(row.capacity_skids), row.fullness_pct ?? '',
      ]),
    ];
  }
  if (state.view === 'labour') {
    return [
      ['Date', 'People', 'Hours each', 'Available hours', 'Trucks', 'Hours on trucks', 'Crew used %', 'Crew figures', 'Note'],
      ...(state.labour || []).map(row => [
        row.work_date, num(row.people), row.hours_each ?? '', row.available_hours ?? '',
        num(row.trucks), row.truck_hours ?? '', row.utilization_percent ?? '', row.source || '', row.note || '',
      ]),
    ];
  }
  if (state.view === 'truck-flow') {
    return [['Truck type', 'Appointments', 'Skids'], ...(data.by_vehicle || []).map(row => [row.name, num(row.appointments), num(row.skids)])];
  }
  if (state.view === 'dock-utilisation') {
    return [['Hour', 'Appointments', 'Skids'], ...(data.by_hour || []).map(row => [row.label, num(row.appointments), num(row.skids)])];
  }
  if (state.view === 'skid-movement') {
    return [['Date', 'Inbound skids', 'Outbound skids', 'Net change'], ...(data.by_day || []).map(row => [row.date, num(row.inbound_skids), num(row.outbound_skids), num(row.inbound_skids) - num(row.outbound_skids)])];
  }
  return [['Date', 'Appointments', 'Cancelled', 'Priority', 'Inbound skids', 'Outbound skids'], ...(data.by_day || []).map(row => [row.date, num(row.appointments), num(row.cancelled), num(row.priority), num(row.inbound_skids), num(row.outbound_skids)])];
}

function exportCsv() {
  const rows = csvRowsForView();
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `maxdock-${state.view}-${state.from}-to-${state.to}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function reload() {
  state.elements.host.innerHTML = '<div class="board-loading">Loading report…</div>';
  try {
    // The scorecard is its own query, fetched alongside so switching views does
    // not go back to the network. A failure there must not take the rest of the
    // report down with it.
    const [data, scorecard, fullness, labour] = await Promise.all([
      fetchReport(),
      db.rpc('get_partner_scorecard', {
        p_location_id: state.locationId,
        p_start_date: state.from,
        p_end_date: state.to,
      }, { key: `reports:scorecard:${state.locationId}:${state.from}:${state.to}`, cache: 60000, retry: 1 }).catch(() => []),
      db.rpc('get_truck_fullness_scorecard', {
        p_location_id: state.locationId,
        p_start_date: state.from,
        p_end_date: state.to,
      }, { key: `reports:fullness:${state.locationId}:${state.from}:${state.to}`, cache: 60000, retry: 1 }).catch(() => []),
      // Only asked for by an account allowed to see it. The RPC refuses anyone
      // else anyway, but a report nobody may read is not a request worth making.
      state.context.can('reports.view_labour')
        ? db.rpc('get_labour_utilization', {
          p_location_id: state.locationId,
          p_from: state.from,
          p_to: state.to,
        }, { key: `reports:labour:${state.locationId}:${state.from}:${state.to}`, cache: 60000, retry: 1 }).catch(() => [])
        : Promise.resolve([]),
    ]);
    state.data = data;
    state.scorecard = Array.isArray(scorecard) ? scorecard : [];
    state.fullness = Array.isArray(fullness) ? fullness : [];
    state.labour = Array.isArray(labour) ? labour : [];
    renderView();
  } catch (error) {
    renderState(state.elements.host, {
      type: 'error',
      title: 'The report could not be loaded',
      message: error.userMessage || 'The report data is unavailable for this range.',
    });
  }
}

function syncControls() {
  state.elements.preset.value = state.preset;
  state.elements.from.value = state.from;
  state.elements.to.value = state.to;
  const custom = state.preset === 'custom';
  state.elements.from.disabled = !custom;
  state.elements.to.disabled = !custom;
  state.elements.subtitle.textContent = `${state.context.location.name} · ${rangeLabel()}`;
}

function buildShell(root) {
  root.innerHTML = `
    ${pageHead('Reports', { actions: ['export', 'print', 'customize'] })}
    ${controlsBar({
      label: 'Report controls',
      filters: `<div class="ctrl-field"><label for="report-site">Site</label><select class="select" id="report-site" data-site>${(state.context.locations || []).map(site => `<option value="${site.id}" ${site.id === state.locationId ? 'selected' : ''}>${escapeHtml(site.name)}</option>`).join('')}</select></div>
      <div class="ctrl-field"><label for="report-view">View</label><select class="select" id="report-view" data-view>${VIEWS.filter(view => !view.permission || state.context.can(view.permission)).map(view => `<option value="${view.id}">${view.label}</option>`).join('')}</select></div>
      <div class="ctrl-field"><label for="report-preset">Range</label><select class="select" id="report-preset" data-preset>${PRESETS.map(preset => `<option value="${preset.id}">${preset.label}</option>`).join('')}</select></div>
      <div class="ctrl-field"><label for="report-from">From</label><input class="input input--date" type="date" id="report-from" data-from></div>
      <div class="ctrl-field"><label for="report-to">To</label><input class="input input--date" type="date" id="report-to" data-to></div>
      <button class="btn btn--primary" type="button" data-apply>Apply</button>`,
      actions: [],
    })}
    <div data-report-host></div>`;
  state.elements = {
    root,
    subtitle: root.querySelector('[data-subtitle]'),
    site: root.querySelector('[data-site]'),
    view: root.querySelector('[data-view]'),
    preset: root.querySelector('[data-preset]'),
    from: root.querySelector('[data-from]'),
    to: root.querySelector('[data-to]'),
    host: root.querySelector('[data-report-host]'),
  };
}

function wireEvents(root) {
  root.addEventListener('click', event => {
    if (event.target.closest('[data-export]')) { exportCsv(); return; }
    if (event.target.closest('[data-print]')) { globalThis.print(); return; }
    const customize = event.target.closest('[data-customize]');
    if (customize) { state.customizePanel?.open(customize); return; }
    if (event.target.closest('[data-apply]')) {
      if (state.preset === 'custom') {
        if (!state.elements.from.value || !state.elements.to.value) { toast('Choose both a from and to date.', 'error'); return; }
        if (state.elements.from.value > state.elements.to.value) { toast('The from date must be before the to date.', 'error'); return; }
        state.from = state.elements.from.value;
        state.to = state.elements.to.value;
      }
      syncControls();
      reload();
    }
  });
  root.addEventListener('change', event => {
    // Changing the site reloads this page's figures and nothing else: the rest of the
    // application stays where the person left it.
    if (event.target.matches('[data-site]')) { state.locationId = event.target.value; reload(); return; }
    if (event.target.matches('[data-view]')) { state.view = event.target.value; renderView(); }
    if (event.target.matches('[data-preset]')) {
      applyPreset(event.target.value);
      syncControls();
      if (event.target.value !== 'custom') reload();
    }
  });
}

const page = {
  code: 'reports',
  permission: 'reports.view',
  async mount(context) {
    state.context = context;
    state.locationId = context.location.id;
    document.title = `Reports · ${context.location.name} · MaxDock`;
    buildShell(context.pageRoot);
    wireEvents(context.pageRoot);
    state.customizePanel = await createCustomizePanel({
      preferenceKey: 'report-cards',
      options: KPI_CARDS.map(card => ({ id: card.id, group: 'Metric cards', label: card.label })),
      defaultIds: DEFAULT_CARDS,
      max: KPI_CARDS.length,
      onChange: selected => { state.visibleCards = selected; renderView(); },
    });
    state.visibleCards = state.customizePanel.selected;
    applyPreset('last30');
    syncControls();
    await reload();
  },
  refresh() {},
  destroy() { state.customizePanel?.destroy(); },
};

startPage(page);
export const { mount, refresh, destroy } = page;
