import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { renderState } from '../ui/empty.js';
import { pageHead, controlsBar, icon } from '../ui/pagehead.js';
import { createCustomizePanel } from '../ui/customize.js';
import { format } from '../format.js';
import { mergeContext, mergeScorecard, mergeFullness, mergeLabour } from '../reports-merge.js';
import { truckFill } from '../ui/truckfill.js';
import { fillFigure } from '../ui/fillfigure.js';
import { mark } from '../ui/marks.js';

// Each view carries a mark as well as a name. A report that opens with a heading and a
// number is correct and hard to tell apart from the last one you looked at; a mark makes the
// view recognisable before it is read, and on paper says what the sheet is at arm's length.
// Drawn from the same grid and stroke as every other glyph in the product — the ask was for
// something less dry, not for clip-art.
const VIEWS = [
  // One permission per view, not one for the whole page. A coordinator is a floor job and does
  // not need eight reports; a shipping supervisor needs most of them. With a single permission
  // the only choices were all or nothing, so it was nothing, and the reports were closed to the
  // floor entirely. Every role that could open Reports before holds all eight, so this changes
  // nothing until somebody unticks one.
  { id: 'overview', label: 'Overview', icon: 'chart', permission: 'reports.view_overview' },
  { id: 'truck-flow', label: 'Truck flow', icon: 'truck', permission: 'reports.view_truck_flow' },
  { id: 'skid-movement', label: 'Skid movement', icon: 'skid', permission: 'reports.view_skid_movement' },
  { id: 'dock-utilisation', label: 'Dock hours', icon: 'door', permission: 'reports.view_dock_hours' },
  { id: 'scorecard-company', label: 'Vendor scorecard', icon: 'company', permission: 'reports.view_scorecard_company' },
  { id: 'scorecard-location', label: 'Site scorecard', icon: 'site', permission: 'reports.view_scorecard_location' },
  { id: 'fullness', label: 'Truck fullness', icon: 'load', permission: 'reports.view_fullness' },
  { id: 'labour', label: 'Labour hours', icon: 'crew', permission: 'reports.view_labour' },
];
const viewIcon = () => VIEWS.find(view => view.id === state.view)?.icon || 'chart';
// Which views this account may open. Asked in three places — the picker, the landing view and
// the renderer — and they must agree: a picker that omits a view while the page still renders it
// is a restriction that only looks like one.
const permittedViews = () => VIEWS.filter(view => !view.permission || state.context.can(view.permission));

const PRESETS = [
  { id: 'last7', label: 'Past 7 days', days: 7 },
  { id: 'last30', label: 'Past 30 days', days: 30 },
  { id: 'month', label: 'This month', days: null },
  { id: 'custom', label: 'Custom range', days: null },
];

const state = {
  context: null,
  // The sites this page is reporting on — a list, because the questions worth asking
  // are rarely about exactly one place. "How full are our trailers" is a company
  // question; "did Milton clear its backlog" is a site question; "how are the two US
  // plants doing between them" is neither, and every one of those is a different set of
  // ticks in the same picker.
  //
  // It starts as the site in the top bar and then belongs to this page: a report is
  // something you read *about* a site, not a site you are working at, so changing it
  // must not move the dock board.
  locationIds: [],
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
  siteMenu: null,
  // Which form a panel that honestly has more than one is drawn in. Not every chart gets
  // a switch — a dial is the only sensible way to show one bounded percentage, and
  // offering a pie of it would be offering a worse chart. Where two forms genuinely
  // answer the same question differently, the reader picks, and the pick is remembered.
  forms: {},
  // Skid capacity per truck type at the chosen sites, so a truck type can be drawn as a
  // trailer with the right amount of room in it.
  capacity: {},
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

// Every report RPC answers for one site, because permission is decided per site. So
// each is asked once per chosen site and the answers are totalled — see
// js/reports-merge.js, which recomputes every rate rather than averaging it.
//
// One site is the overwhelmingly common case and takes exactly the one call it always
// did; the merge functions hand a single answer straight back untouched.
function fanOut(name, args, keyPrefix, options = {}) {
  return Promise.all(state.locationIds.map(id => db.rpc(name, { ...args(id) }, {
    key: `${keyPrefix}:${id}:${state.from}:${state.to}`,
    cache: 60000,
    retry: 1,
    ...options,
  })));
}

async function fetchReport() {
  const parts = await fanOut('get_ai_operations_context',
    id => ({ p_location_id: id, p_start_date: state.from, p_end_date: state.to }),
    'reports', { userMessage: 'The report data could not be loaded.' });
  return mergeContext(parts);
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
// Which sites, in words. On a printed report the range alone does not say whose figures
// these are, and the picker is not on the paper — so the selection is spelled out down
// to four names and only becomes a count past that, because "7 sites" on a sheet of
// paper is not something a reader can check.
const allSites = () => state.context?.locations || [];
function siteName() {
  const chosen = allSites().filter(site => state.locationIds.includes(site.id));
  if (!chosen.length) return state.context?.location?.name || '';
  if (chosen.length === allSites().length && chosen.length > 1) return `All ${chosen.length} sites`;
  if (chosen.length <= 4) return chosen.map(site => site.name).join(', ');
  return `${chosen.length} sites`;
}
const siteRange = () => `${siteName()} · ${rangeLabel()}`;

// ── Three shapes, each for one job ────────────────────────────────────────────
//
// A dial for a single bounded percentage against a target — dock time used, crew used,
// trailer used. One measure, one number, and the thing a manager wants is "how close to
// full is this", which a bar an inch wide does not answer at a glance. Coloured by band,
// and the band is *named* under the number as well as coloured, because a colour on its
// own is not a reading anybody can rely on.
// `good` says which end of the scale is the good end, and it has to be said rather than
// assumed. Dock time used and crew used are capacity readings: low is comfortable and over
// 100 is a finding. On time and trucks that ran full are the other way up — 95% is the
// answer you want and 40% is the problem — and colouring those two the same way was
// painting a 91% on-time vendor amber for being nearly punctual. `none` is for readings
// with no good end at all, which get one neutral colour and no verdict word.
// Which band a percentage falls in and what that band means, decided in one place.
//
// It is one place because the same reading is now drawn two ways — as a dial and as a
// shape filling up — and a figure that is "healthy" as a ring and "near capacity" as a
// crew would be worse than either. Whichever way it is drawn, this decides.
//
// Over 100 is a finding, not an error: the day asked for more than there was.
// `ok` is the verdict as a yes or no rather than as a colour, for the drawings that carry a
// status badge. It is decided here and nowhere else for the same reason the band is: a green
// tick beside a figure the band calls "near capacity" is worse than no badge at all. Note
// that it is not simply "the green band" — a capacity reading at 60% is healthy and gets a
// tick, and only near capacity and over do not. `none` readings have no verdict, so `ok` is
// undefined and nothing draws a badge for them.
// Four scales, because a percentage on its own does not say which way is up:
//   low   a capacity. 60% of the doors used is comfortable, over 100 is a finding.
//   high  a target to reach. 95% on time is the answer you want, 40% is the problem.
//   zero  a target of none at all. Lateness and cancellations are not capacities: they
//         have no comfortable middle, so 10% is already slipping and 30% is a problem.
//         Running these on the capacity scale called 62% of arrivals late "healthy".
//   none  no good end at all: one neutral colour, no verdict word, no badge.
function readingBand(percent, good = 'low') {
  const value = Math.max(0, Number(percent));
  const band = good === 'none' ? 'mid'
    : good === 'high' ? (value >= 90 ? 'low' : value >= 75 ? 'mid' : 'high')
      : good === 'zero' ? (value <= 10 ? 'low' : value <= 25 ? 'mid' : 'high')
        : (value > 100 ? 'over' : value >= 85 ? 'high' : value >= 55 ? 'mid' : 'low');
  const words = good === 'none' ? ''
    : good === 'high' || good === 'zero'
      ? { low: 'on target', mid: 'slipping', high: 'not acceptable' }[band]
      : { over: 'over capacity', high: 'near capacity', mid: 'healthy', low: 'light' }[band];
  const ok = good === 'none' ? undefined
    : good === 'high' || good === 'zero' ? band === 'low'
      : band === 'low' || band === 'mid';
  return { value, band, words, ok };
}

function dial(percent, label, note, { good = 'low' } = {}) {
  if (percent === null || percent === undefined) {
    return `<figure class="dial dial--empty"><div class="dial__face"><span class="dial__v">–</span></div><figcaption class="dial__l">${escapeHtml(label)}<span>not measured</span></figcaption></figure>`;
  }
  const { value, band, words } = readingBand(percent, good);
  const shown = Math.min(100, value);
  return `<figure class="dial dial--${band}" role="img" aria-label="${escapeHtml(`${label}: ${value.toFixed(1)} per cent${words ? `, ${words}` : ''}`)}">
    <div class="dial__face" style="--pct:${shown.toFixed(1)}"><span class="dial__v">${value.toFixed(0)}<i>%</i></span></div>
    <figcaption class="dial__l">${escapeHtml(label)}<span>${escapeHtml(note || words)}</span></figcaption>
  </figure>`;
}

// The same reading as the shape it is about, filling up. Same band, same words — this
// chooses only the outline, because that is the only thing that differs.
function shapeOf(percent, label, note, { good = 'low', shape = 'crew' } = {}) {
  if (percent === null || percent === undefined) return fillFigure({ percent: null, shape, label });
  const { value, band, words, ok } = readingBand(percent, good);
  return fillFigure({ percent: value, shape, label, note, band, words, ok });
}

// Three readings, drawn whichever way the reader picked. The switch is per panel and
// remembered, so a page that opens on dials stays on dials.
function readings(key, cards) {
  const form = formOf(key, 'dial');
  const drawn = cards.map(card => (form === 'shape'
    ? shapeOf(card.percent, card.label, card.note, { good: card.good, shape: card.shape })
    : dial(card.percent, card.label, card.note, { good: card.good })));
  return `<div class="dials">${drawn.join('')}</div>`;
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
// `outOf` matters more than it looks. Scaling to the biggest value in the list is right
// for counts — the busiest hour is the full bar and everything else is read against it —
// and wrong for percentages: a single vendor nine points short of perfect drew a
// full-width bar, because it was the only row and therefore also the biggest. A percentage
// is out of a hundred whatever else is in the list.
function ranked(rows, { unit = '', max = 8, outOf = 0 } = {}) {
  const list = rows.filter(row => num(row.value) > 0).sort((a, b) => num(b.value) - num(a.value)).slice(0, max);
  if (!list.length) return '<p class="hint">No data in this range.</p>';
  const top = outOf || Math.max(...list.map(row => num(row.value)));
  return `<div class="ranked">${list.map(row => `<div class="ranked__row">
    <span class="ranked__l" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
    <span class="ranked__t"><span style="width:${Math.min(100, (num(row.value) / top) * 100).toFixed(1)}%"></span></span>
    <span class="ranked__v">${escapeHtml(row.shown || `${compact(num(row.value))}${unit}`)}</span>
  </div>`).join('')}</div>`;
}

// A reading and its verdict, drawn as well as coloured and worded. The bands are the
// ones the scorecard table already uses, so a tag in the table and a badge on a card
// never disagree about whether 87% is acceptable.
// The view's mark and name, folded into the head of the section they introduce.
//
// They used to sit in a band of their own above it, which put two headings and the same
// "Milton · Jul 1 – Jul 30" line twice on a page carrying one report. A mark belongs to
// the thing it marks. So the first section of whichever view is showing gets it, and the
// eight render functions stay as they are — none of them has to remember.
function withViewMark(html) {
  const view = VIEWS.find(item => item.id === state.view);
  const head = '<div class="panel__head">';
  const at = html.indexOf(head);
  if (at < 0) return html;
  const lead = `<div class="panel__head panel__head--lead">
    <span class="panel__mark">${mark(viewIcon())}</span>
    <span class="panel__eyebrow">${escapeHtml(view?.label || 'Report')}</span>`;
  return html.slice(0, at) + lead + html.slice(at + head.length);
}

function verdict(percent) {
  if (percent === null || percent === undefined) return { key: 'quiet', glyph: '', words: 'no arrivals' };
  if (percent >= 90) return { key: 'ok', glyph: icon('ok'), words: 'on target' };
  if (percent >= 75) return { key: 'warn', glyph: icon('warn'), words: 'slipping' };
  return { key: 'stop', glyph: icon('stop'), words: 'not acceptable' };
}

// The switch on a panel that has two honest forms. Two, not five: a list of every chart
// type a library can draw is a menu of ways to make the same reading worse.
function formSwitch(key, options) {
  const current = state.forms[key] || options[0].id;
  return `<div class="seg" role="group" aria-label="How to draw this">${options.map(option =>
    `<button type="button" data-form="${escapeHtml(key)}" data-form-value="${escapeHtml(option.id)}" aria-pressed="${option.id === current}">${escapeHtml(option.label)}</button>`).join('')}</div>`;
}
const formOf = (key, fallback) => state.forms[key] || fallback;

// The capacity of a truck type across the chosen sites. They usually agree — a 53 ft
// trailer holds 26 skids in every Max building — but they are set per site because the
// same trailer is stacked differently in different buildings, so where they disagree this
// is the mean of the sites being reported on rather than one of them picked arbitrarily.
function capacityOfType(code) {
  const entries = state.capacity[code] || [];
  if (!entries.length) return 0;
  return Math.round(entries.reduce((sum, value) => sum + value, 0) / entries.length);
}

function table(headers, rows) {
  return `<table class="table"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${
    rows.length ? rows.map(cells => `<tr>${cells.map((cell, index) => `<td class="${index === 0 ? 'data data--strong' : 'data'}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${headers.length}" class="data">No data in this range.</td></tr>`
  }</tbody></table>`;
}

// ── Four drawings the data was already carrying ────────────────────────────────

// The day, hour by hour, as a strip of cells shaded by how busy each one was.
//
// The table underneath has said this all along, and a table of twenty-four rows is not how
// anybody finds the quiet hour to move a truck into. Shaded on one hue, light to dark, because
// this is a magnitude and not a set of categories — a rainbow here would invite somebody to
// read meaning into hue that is not there.
//
// The number is in the title of every cell and in the table, so the reading never rests on
// colour alone. The busiest hour is named in words underneath for the same reason.
function hourStrip(rows) {
  const busy = rows.filter(row => num(row.appointments) > 0);
  if (!busy.length) return '<p class="hint">No arrivals in this range.</p>';
  const max = Math.max(...rows.map(row => num(row.appointments)));
  const peak = rows.reduce((best, row) => (num(row.appointments) > num(best.appointments) ? row : best), rows[0]);
  const quiet = busy.reduce((least, row) => (num(row.appointments) < num(least.appointments) ? row : least), busy[0]);
  const cells = rows.map(row => {
    const value = num(row.appointments);
    // Zero is drawn as empty rather than as the lightest step: an hour with nothing in it and
    // an hour with one truck are different answers to "can I put a truck here".
    const step = value ? Math.max(1, Math.round((value / max) * 4)) : 0;
    return `<span class="hstrip__c hstrip__c--${step}" title="${escapeHtml(`${row.label}: ${value} truck${value === 1 ? '' : 's'}, ${num(row.skids)} skids`)}"></span>`;
  }).join('');
  // The hours sit under the cells rather than inside them. Inside, the label has to be legible
  // on every step of the ramp at once, and it cannot be: white clears 4.5:1 on none of these
  // blues at this text size and ink clears it on none of the dark ones. An axis under the plot
  // is where an axis belongs anyway.
  const axis = rows.map(row => `<span>${escapeHtml(String(row.label).replace(/:00$/, ''))}</span>`).join('');
  return `<div class="hstrip" role="img" aria-label="${escapeHtml(`Arrivals by hour. Busiest ${peak.label} with ${num(peak.appointments)}. Quietest working hour ${quiet.label} with ${num(quiet.appointments)}.`)}">${cells}</div>
    <div class="hstrip__ax" aria-hidden="true">${axis}</div>
    <p class="hint">Darker is busier, against ${max} truck${max === 1 ? '' : 's'} in the busiest hour. Busiest is ${escapeHtml(peak.label)}; the quietest hour that had anything in it is ${escapeHtml(quiet.label)}. An empty cell is an hour with no arrivals at all, which is where a truck can be moved to.</p>`;
}

// In above the line, out below it. A site that ships what it takes in draws roughly
// symmetrical; one that is filling up or emptying leans, and the lean is the reading. Printed
// as two numbers it is a subtraction somebody has to do in their head for every day.
function flowDays(rows) {
  if (!rows.length) return '<p class="hint">No data in this range.</p>';
  const max = Math.max(1, ...rows.map(row => Math.max(num(row.inbound_skids), num(row.outbound_skids))));
  const day = row => String(row.date || '').slice(5);
  const inTotal = rows.reduce((sum, row) => sum + num(row.inbound_skids), 0);
  const outTotal = rows.reduce((sum, row) => sum + num(row.outbound_skids), 0);
  const net = inTotal - outTotal;
  const columns = rows.map(row => {
    const into = num(row.inbound_skids);
    const out = num(row.outbound_skids);
    return `<span class="flow__col" title="${escapeHtml(`${day(row)}: ${into} in, ${out} out`)}">
      <span class="flow__half flow__half--in"><i style="height:${(into / max * 100).toFixed(1)}%"></i></span>
      <span class="flow__half flow__half--out"><i style="height:${(out / max * 100).toFixed(1)}%"></i></span>
    </span>`;
  }).join('');
  return `<figure class="flow" role="img" aria-label="${escapeHtml(`Skids in and out by day. ${inTotal} in, ${outTotal} out, ${Math.abs(net)} ${net >= 0 ? 'more in than out' : 'more out than in'}.`)}">
    <div class="flow__plot">${columns}<span class="flow__zero"></span></div>
    <figcaption class="flow__k">
      <span class="lg lg--a">In <b>${compact(inTotal)}</b></span>
      <span class="lg lg--b">Out <b>${compact(outTotal)}</b></span>
      <span class="flow__net">${net === 0 ? 'level over the range' : `${compact(Math.abs(net))} more ${net > 0 ? 'in than out' : 'out than in'}`}</span>
    </figcaption>
  </figure>`;
}

// One small card a partner, worst first, instead of twelve rows to read across. The bar is
// how far short of perfect they are, so the longest bar is the one to ring — the same way
// round as the ranked chart, because a reader should not have to work out which direction is
// bad twice on one page. The table underneath is still the record.
function partnerCards(rows, who, limit = 8) {
  const scored = rows
    .filter(row => row.on_time_pct !== null && row.on_time_pct !== undefined)
    .map(row => ({ ...row, pct: Number(row.on_time_pct) }))
    .sort((a, b) => a.pct - b.pct);
  if (!scored.length) return '<p class="hint">No arrivals to score in this range.</p>';
  const shown = scored.slice(0, limit);
  const cards = shown.map(row => {
    const verd = verdict(row.pct);
    return `<article class="pcard pcard--${verd.key}">
      <h4 class="pcard__t">${escapeHtml(row.partner_name || 'Not named')}</h4>
      <div class="pcard__n">${row.pct.toFixed(0)}<span>% on time</span></div>
      <div class="pcard__bar"><i style="width:${Math.max(2, Math.min(100, 100 - row.pct)).toFixed(1)}%"></i></div>
      <p class="pcard__s">${escapeHtml(`${num(row.trucks)} truck${num(row.trucks) === 1 ? '' : 's'}${num(row.late) ? `, ${num(row.late)} late` : ''}${num(row.no_shows) ? `, ${num(row.no_shows)} no show` : ''}`)}</p>
    </article>`;
  }).join('');
  const rest = scored.length - shown.length;
  return `<div class="pcards">${cards}</div>
    <p class="hint">Worst first. The bar is how far short of perfect each ${who} is, so the longest bar is the call to make.${rest > 0 ? ` ${rest} more ${rest === 1 ? 'is' : 'are'} in the table below.` : ''}</p>`;
}

function renderOverview() {
  const byDay = state.data.by_day || [];
  const s = state.data.summary || {};
  const fullness = state.fullness || [];
  const capacity = fullness.reduce((sum, row) => sum + num(row.capacity_skids), 0);
  const measuredSkids = fullness.reduce((sum, row) => sum + (row.fullness_pct === null || row.fullness_pct === undefined ? 0 : num(row.fullness_pct) * num(row.capacity_skids) / 100), 0);
  const used = capacity ? (measuredSkids / capacity) * 100 : null;
  const busiest = byDay.slice().sort((a, b) => num(b.appointments) - num(a.appointments)).slice(0, 6)
    .map(row => ({ label: dayLabel(row.date), value: row.appointments, shown: `${num(row.appointments)} trucks · ${num(row.inbound_skids) + num(row.outbound_skids)} skids` }));
  return `${kpiRow()}
    <div class="panel">
      <div class="panel__head"><h3 class="panel__title">The three readings</h3><div class="panel__actions">${formSwitch('overview-read', [{ id: 'dial', label: 'Dials' }, { id: 'shape', label: 'Fill' }])}<span class="sub">${escapeHtml(siteRange())}</span></div></div>
      ${readings('overview-read', [
        { percent: num(s.occupied_utilization_percent), label: 'Dock time used', note: 'of the hours the doors were open', shape: 'door' },
        { percent: used, label: 'Trailer used', note: 'skids against what the trailers hold', good: 'high', shape: 'truck' },
        { percent: num(s.appointments) ? (num(s.cancelled) / num(s.appointments)) * 100 : null, label: 'Cancelled', note: 'of every booking made', good: 'zero', shape: 'cancelled' },
      ])}
      <div class="panel__body"><p class="hint hint--flush">Doors, trailers and reliability. Each of the three has its own view with the detail behind it; this is whether any of them needs one.</p></div>
    </div>
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Daily shape</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="panel__body">${trendStrip(byDay)}</div>
      <div class="panel__body"><div class="chart2">
        <section><h4 class="chart2__t">Which way the range leaned</h4>${flowDays(byDay)}</section>
        <section><h4 class="chart2__t">In against out</h4>${ring([
          { label: 'Inbound skids', value: s.inbound_skids },
          { label: 'Outbound skids', value: s.outbound_skids },
        ], 'skids moved')}</section>
        <section><h4 class="chart2__t">Busiest days</h4>${ranked(busiest, { max: 6 })}</section>
      </div><p class="hint">A site that ships out what it takes in sits near half and half; one drifting off centre is filling up or emptying.</p></div>
      <div class="panel__scroll">${table(['Date', 'Appointments', 'Cancelled', 'Priority', 'Inbound skids', 'Outbound skids'], byDay.map(row => [dayLabel(row.date), num(row.appointments), num(row.cancelled), num(row.priority), num(row.inbound_skids), num(row.outbound_skids)]))}</div>
    </div>`;
}

// The fleet: what ran, and how full each kind of truck ran.
//
// Two readings, because "we ran 240 fifty-three foot trailers" and "the average one left
// with nineteen of twenty-six skids in it" are different findings and only the second one
// is worth a phone call. The mix can be read as bars or as the trucks themselves, and the
// trucks are the better answer to the second question — which is why they are offered.
function renderTruckFlow() {
  const byVehicle = state.data.by_vehicle || [];
  const fullness = state.fullness || [];
  const full = fullness.reduce((sum, row) => sum + num(row.full_trucks), 0);
  const measured = fullness.reduce((sum, row) => sum + num(row.measured_trucks), 0);
  const trailers = byVehicle.map(row => {
    const capacity = capacityOfType(row.code);
    const perTruck = num(row.appointments) ? num(row.skids) / num(row.appointments) : 0;
    return truckFill({
      skids: Math.round(perTruck),
      capacity,
      // The row is a truck type, so it is drawn as that truck rather than as the 53 ft
      // trailer every row used to be.
      code: row.code,
      label: row.name,
      // The bold line above says "13 of 20 skids", which reads as one truck until this
      // line says it is an average. Without the word, "13 of 20 skids across 39 trucks" is
      // two readings that appear to contradict each other.
      note: `average load, across ${compact(num(row.appointments))} truck${num(row.appointments) === 1 ? '' : 's'}`,
    });
  }).join('');
  const bars = ranked(byVehicle.map(row => ({ label: row.name, value: row.appointments, shown: `${compact(num(row.appointments))} trucks, carrying ${compact(num(row.skids))} skids` })));
  const drawn = formOf('flow', 'trucks') === 'bars' ? bars : `<div class="trucks">${trailers}</div>`;
  return `${kpiRow()}
    <div class="panel">
      <div class="panel__head"><h3 class="panel__title">The fleet that ran</h3>
        <div class="panel__actions">${formSwitch('flow', [{ id: 'trucks', label: 'Trucks' }, { id: 'bars', label: 'Bars' }])}<span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="panel__body">${byVehicle.length ? drawn : '<p class="hint">No trucks in this range.</p>'}
        <p class="hint">${formOf('flow', 'trucks') === 'bars'
          ? 'Trucks by type across the selected range, biggest first.'
          : 'One trailer per truck type, loaded to the average of every truck of that type that ran. The room left at the doors is the room that was paid for and not used.'}</p></div>
    </div>
    <div class="panel">
      <div class="panel__head"><h3 class="panel__title">Full against not</h3><div class="panel__actions"><span class="sub">${compact(measured)} trucks measured</span></div></div>
      <div class="panel__body"><div class="chart2">
        <section><h4 class="chart2__t">Trucks that ran full</h4>${ring([
          { label: 'Ran full', value: full },
          { label: 'Had room', value: Math.max(0, measured - full) },
        ], 'trucks')}</section>
        <section><h4 class="chart2__t">Skids carried, by truck type</h4>${ranked(byVehicle.map(row => ({ label: row.name, value: row.skids, shown: `${compact(num(row.skids))} skids` })))}</section>
      </div><p class="hint">Full is 90% of what the trailer holds or more; the last skid or two is rarely worth another appointment. A truck whose type has no capacity entered for its site is not measured either way.</p></div>
    </div>
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Truck mix</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="panel__scroll">${table(['Truck type', 'Appointments', 'Skids', 'Average skids a truck', 'Holds'], byVehicle.map(row => [row.name, num(row.appointments), num(row.skids), num(row.appointments) ? (num(row.skids) / num(row.appointments)).toFixed(1) : '–', capacityOfType(row.code) || '–']))}</div>
    </div>`;
}

function renderSkidMovement() {
  const byDay = state.data.by_day || [];
  const s = state.data.summary || {};
  // Two readings the view was computing and only ever printing as numbers. Both are about
  // skids, and both are drawn as skids: how full the trailers that carried them were, and how
  // much of the range's movement landed on its heaviest single day. The second is the one that
  // decides whether a site needs another door — a range that is level does not, and a range
  // that piles a fifth of its movement onto one day does.
  const fullness = state.fullness || [];
  const capacity = fullness.reduce((sum, row) => sum + num(row.capacity_skids), 0);
  const carried = fullness.reduce((sum, row) => sum + (row.fullness_pct === null || row.fullness_pct === undefined
    ? 0 : num(row.fullness_pct) * num(row.capacity_skids) / 100), 0);
  const moved = byDay.map(row => num(row.inbound_skids) + num(row.outbound_skids));
  const total = moved.reduce((sum, value) => sum + value, 0);
  const heaviest = moved.length ? Math.max(...moved) : 0;
  return `${kpiRow()}
    <div class="panel">
      <div class="panel__head"><h3 class="panel__title">How the skids moved</h3><div class="panel__actions">${formSwitch('skid-read', [{ id: 'dial', label: 'Dials' }, { id: 'shape', label: 'Fill' }])}<span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="panel__body">${readings('skid-read', [
        { percent: capacity ? (carried / capacity) * 100 : null, label: 'Trailer space used', note: 'skids carried against what those trailers hold', good: 'high', shape: 'truck' },
        { percent: total && moved.length ? (heaviest / (total / moved.length)) * 100 : null, label: 'Heaviest day against an even one', note: `${compact(heaviest)} skids on the busiest of ${moved.length} day${moved.length === 1 ? '' : 's'}`, good: 'none', shape: 'day' },
      ])}
        <p class="hint">Trailer space used is the room that was paid for and filled. The second reading is the busiest day measured against what an even day of this range would be, so 100% is perfectly level and 200% is a day carrying twice its share. Measured that way because a share out of the whole range makes every well-run month look empty: thirty level days are 3% each, and 3% drawn against 100 says nothing.</p></div>
    </div>
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Skid movement per day</h3><div class="panel__actions"><span class="sub">${compact(s.inbound_skids)} in · ${compact(s.outbound_skids)} out</span></div></div>
      <div class="panel__body">${byDay.length
        ? `${flowDays(byDay)}
           ${ring([{ label: 'Inbound skids', value: s.inbound_skids }, { label: 'Outbound skids', value: s.outbound_skids }], 'skids moved')}`
        : '<p class="hint">No data in this range.</p>'}
        <p class="hint">Above the line is what came in that day, below it what went out. A site that ships what it takes in draws roughly symmetrical; one that leans is filling up or emptying, and the total under the chart says by how much. Identity is the side of the line as well as the colour, so the pair reads without relying on hue. The ring is the same balance over the whole range.</p></div>
      <div class="panel__body"><div class="chart2">
        <section><h4 class="chart2__t">Heaviest days in</h4>${ranked(byDay
          .map(row => ({ label: dayLabel(row.date), value: row.inbound_skids, shown: `${num(row.inbound_skids)} skids in` })), { max: 6 })}</section>
        <section><h4 class="chart2__t">Heaviest days out</h4>${ranked(byDay
          .map(row => ({ label: dayLabel(row.date), value: row.outbound_skids, shown: `${num(row.outbound_skids)} skids out` })), { max: 6 })}</section>
      </div><p class="hint">The two lists rarely hold the same days, and where they do is where the floor was busiest in both directions at once.</p></div>
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
  return `<div class="panel">
      <div class="panel__head"><h3 class="panel__title">The shape of the day</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="panel__body">${hourStrip(byHour)}</div>
    </div>
    <div class="panel"><div class="panel__head"><h3 class="panel__title">How hard the doors worked</h3><div class="panel__actions">${formSwitch('dock-read', [{ id: 'dial', label: 'Dials' }, { id: 'shape', label: 'Fill' }])}<span class="sub">${escapeHtml(siteRange())}</span></div></div>
      ${readings('dock-read', [
        { percent: num(s.occupied_utilization_percent), label: 'Dock time used', note: 'of the hours the doors were open', shape: 'door' },
        { percent: s.available_dock_minutes ? (num(s.blocked_minutes) / num(s.available_dock_minutes)) * 100 : null, label: 'Time blocked off', note: 'maintenance, breaks, events', shape: 'clock' },
        { percent: num(s.active_docks) ? (num(s.booked_minutes) / 60) / num(s.active_docks) / Math.max(1, (state.data.by_day || []).length) / 9.5 * 100 : null, label: 'Busiest door share', note: 'booked hours per door per day', good: 'none', shape: 'door' },
      ])}</div>
    <div class="kpis" style="--kpi-cols:4">
      <article class="kpi kpi--signal"><span class="kpi__label">Dock time used</span><span class="kpi__value">${num(s.occupied_utilization_percent).toFixed(1)}<span>%</span></span></article>
      <article class="kpi"><span class="kpi__label">Booked hours</span><span class="kpi__value">${compact(num(s.booked_minutes) / 60)}</span></article>
      <article class="kpi kpi--stop"><span class="kpi__label">Blocked hours</span><span class="kpi__value">${compact(num(s.blocked_minutes) / 60)}</span></article>
      <article class="kpi kpi--out"><span class="kpi__label">Active docks</span><span class="kpi__value">${num(s.active_docks)}</span></article>
    </div>
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Busiest start hours</h3><div class="panel__actions"><span class="sub">${compact(num(s.available_dock_minutes) / 60)} dock-hours available</span></div></div>
      <div class="panel__body"><div class="chart2">
        <section><h4 class="chart2__t">Busiest hours of the day</h4>${ranked(byHour.map(row => ({ label: row.label, value: row.appointments, shown: `${compact(num(row.appointments))} trucks · ${compact(num(row.skids))} skids` })))}</section>
        <section><h4 class="chart2__t">What the doors did with the day</h4>${ring([
          { label: 'Booked', value: Math.round(num(s.booked_minutes) / 60) },
          { label: 'Standing empty', value: Math.max(0, Math.round((num(s.available_dock_minutes) - num(s.booked_minutes) - num(s.blocked_minutes)) / 60)) },
        ], 'dock-hours')}</section>
      </div><p class="hint">The eight busiest booking hours, heaviest first, and the same hours as a share of every dock-hour the site had open. Time blocked off for maintenance or a break is in neither slice; it was never available to book. The full hour-by-hour record is in the table below.</p>
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
  const trucks = rows.reduce((sum, row) => sum + num(row.trucks), 0);
  const late = rows.reduce((sum, row) => sum + num(row.late), 0);
  const noShows = rows.reduce((sum, row) => sum + num(row.no_shows), 0);
  const cancelled = rows.reduce((sum, row) => sum + num(row.cancelled), 0);
  const verd = verdict(overall);
  const who = kind === 'location' ? 'site' : 'vendor';
  // Late by how much, not just how often. A carrier ten minutes late forty times and one
  // two hours late twice are the same on-time percentage and are not the same problem.
  const worstLate = rows
    .filter(row => row.avg_minutes_late !== null && row.avg_minutes_late !== undefined && num(row.late) > 0)
    .map(row => ({ label: row.partner_name, value: Number(row.avg_minutes_late), shown: `${format.duration(row.avg_minutes_late)} × ${num(row.late)}` }));
  // Ranked by how far short of perfect, so the worst offender is the longest bar and the
  // top row — a chart sorted by on-time percentage puts the partner you need to ring at
  // the bottom, which is exactly backwards. The bar is the shortfall; the label is the
  // percentage itself, because that is the number people quote.
  const busiest = rows.map(row => ({ label: row.partner_name, value: row.trucks, shown: `${compact(num(row.trucks))} trucks · ${compact(num(row.skids))} skids` }));
  const form = formOf(`score-${kind}`, 'bars');
  return `<div class="kpis" style="--kpi-cols:4">
      <article class="kpi kpi--ok"><span class="kpi__label">On time <span class="vd vd--${verd.key}">${verd.glyph}${escapeHtml(verd.words)}</span></span><span class="kpi__value">${overall === null ? '–' : overall.toFixed(1)}<span>%</span></span></article>
      <article class="kpi"><span class="kpi__label">${kind === 'location' ? 'Sites' : 'Vendors'}</span><span class="kpi__value">${rows.length}</span></article>
      <article class="kpi kpi--out"><span class="kpi__label">Trucks</span><span class="kpi__value">${compact(trucks)}</span></article>
      <article class="kpi kpi--stop"><span class="kpi__label">No shows</span><span class="kpi__value">${noShows}</span></article>
    </div>
    <div class="panel">
      <div class="panel__head"><h3 class="panel__title">How the ${who}s are doing</h3><div class="panel__actions">${formSwitch(`read-${kind}`, [{ id: 'dial', label: 'Dials' }, { id: 'shape', label: 'Fill' }])}<span class="sub">${escapeHtml(siteRange())}</span></div></div>
      ${readings(`read-${kind}`, [
        { percent: overall, label: 'Turned up on time', note: 'within 15 minutes of the booking', good: 'high', shape: 'clock' },
        { percent: trucks ? ((trucks - noShows - cancelled) / trucks) * 100 : null, label: 'Trucks that came', note: 'of every booking made', good: 'high', shape: 'truck' },
        { percent: arrived ? (late / arrived) * 100 : null, label: 'Arrived late', note: 'of the trucks that came', good: 'zero', shape: 'late' },
      ])}
    </div>
    <div class="panel">
      <div class="panel__head"><h3 class="panel__title">Punctual against busy</h3>
        <div class="panel__actions">${formSwitch(`score-${kind}`, [{ id: 'bars', label: 'Bars' }, { id: 'ring', label: 'Split' }])}<span class="sub">${compact(arrived)} arrivals</span></div></div>
      <div class="panel__body">${form === 'ring'
        ? `<div class="chart2">
            <section><h4 class="chart2__t">Every arrival</h4>${ring([{ label: 'On time', value: onTime }, { label: 'Late', value: late }], 'arrivals')}</section>
            <section><h4 class="chart2__t">Every booking</h4>${ring([{ label: 'Turned up', value: Math.max(0, trucks - noShows - cancelled) }, { label: 'No show or cancelled', value: noShows + cancelled }], 'booked')}</section>
          </div>`
        : `<div class="chart2">
            <section><h4 class="chart2__t">Missed the window, worst first</h4>${partnerCards(rows, who)}</section>
            <section><h4 class="chart2__t">Busiest ${who}s</h4>${ranked(busiest, { max: 8 })}</section>
          </div>`}
        <p class="hint">${form === 'ring'
          ? 'Two ways a booking can go wrong and they are not the same: a truck that came late took a door it was not booked for, and a truck that never came left a door empty.'
          : `The cards on the left are the punctuality call, worst first. The bars on the right are how much each ${who} actually moves. A bad card next to a long bar is where a conversation is worth having; a bad card next to a short one usually is not worth the phone call.`}</p></div>
    </div>
    ${worstLate.length ? `<div class="panel">
      <div class="panel__head"><h3 class="panel__title">When they are late, how late</h3><div class="panel__actions"><span class="sub">${compact(late)} late arrivals</span></div></div>
      <div class="panel__body">${ranked(worstLate, { max: 8, outOf: 60 })}<p class="hint">Average minutes late, over the trucks that arrived late, against a full hour, so a full bar means an hour or worse. The count beside each bar is how many times.</p></div>
    </div>` : ''}
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">${kind === 'location' ? 'Max site scorecard' : 'Vendor &amp; carrier scorecard'}</h3><div class="panel__actions"><span class="sub">${escapeHtml(siteRange())}</span></div></div>
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
            <td class="data">${row.avg_minutes_late === null || row.avg_minutes_late === undefined ? '–' : format.duration(row.avg_minutes_late)}</td>
            <td class="data">${num(row.no_shows)}</td>
            <td class="data">${num(row.cancelled)}</td>
            <td class="data">${row.avg_dwell_minutes === null || row.avg_dwell_minutes === undefined ? '–' : format.duration(row.avg_dwell_minutes)}</td>
            <td class="data cell-elide" title="${escapeHtml(row.truck_types || '')}">${escapeHtml(row.truck_types || '–')}</td>
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
  const fullTrucks = rows.reduce((sum, row) => sum + num(row.full_trucks), 0);
  const trucks = rows.reduce((sum, row) => sum + num(row.trucks), 0);
  // One trailer standing for every trailer that ran. Scaled to a 53 ft so the picture is
  // of a real truck: the same ratio drawn against 26 skids is the same reading, and it is
  // the truck everybody in the operation pictures when they say "the trailer went out half
  // empty".
  const asOne = overall === null ? null : Math.round((overall / 100) * 26);
  const emptiest = rows
    .filter(row => row.fullness_pct !== null && row.fullness_pct !== undefined && num(row.trucks) > 1)
    .map(row => ({ label: row.partner_name, value: Math.max(0.01, 100 - Number(row.fullness_pct)), shown: `${Number(row.fullness_pct).toFixed(0)}% · ${num(row.trucks)} trucks` }));
  const combining = rows
    .filter(row => num(row.loads_absorbed) > 0)
    .map(row => ({ label: row.partner_name, value: row.loads_absorbed, shown: `${num(row.loads_absorbed)} onto ${num(row.combined_trucks)} truck${num(row.combined_trucks) === 1 ? '' : 's'}` }));
  return `<div class="panel"><div class="panel__head"><h3 class="panel__title">How full the trucks ran</h3><div class="panel__actions">${formSwitch('fullness-read', [{ id: 'dial', label: 'Dials' }, { id: 'shape', label: 'Fill' }])}<span class="sub">${escapeHtml(siteRange())}</span></div></div>
      <div class="panel__body">${asOne === null
        ? '<p class="hint">No truck type in this range has a skid capacity entered, so how full the trucks ran is not known. It is set per site under Settings › Capacity.</p>'
        : `<div class="trucks">${truckFill({
          skids: asOne,
          capacity: 26,
          label: '53 ft Trailer',
          note: `average load, across ${compact(measured)} trucks`,
          wide: true,
        })}</div>`}
        <p class="hint">Every measured truck in the range averaged into one 53 ft trailer. The room at the doors is the room that was paid for and not used, and it is what combining is for.</p></div>
      ${readings('fullness-read', [
        { percent: overall, label: 'Trailer used', note: 'skids against what the trailers hold', good: 'high', shape: 'truck' },
        { percent: measured ? (fullTrucks / measured) * 100 : null, label: 'Trucks that ran full', note: '90% or more', good: 'high', shape: 'truck' },
        { percent: savedPct, label: 'Trucks saved by combining', note: 'of what would have run', good: 'none', shape: 'combine' },
      ])}
    </div>
    <div class="panel">
      <div class="panel__head"><h3 class="panel__title">Which lanes are wasting space</h3><div class="panel__actions"><span class="sub">${compact(trucks)} trucks on ${rows.length} lane${rows.length === 1 ? '' : 's'}</span></div></div>
      <div class="panel__body"><div class="chart2">
        <section><h4 class="chart2__t">Emptiest lanes, worst first</h4>${ranked(emptiest, { max: 8, outOf: 100 })}</section>
        <section><h4 class="chart2__t">${combining.length ? 'What combining already saved' : 'Full against not'}</h4>${combining.length
          ? ranked(combining, { max: 8 })
          : ring([{ label: 'Ran full', value: fullTrucks }, { label: 'Had room', value: Math.max(0, measured - fullTrucks) }], 'trucks')}</section>
      </div><p class="hint">${combining.length
        ? 'The bar on the left is the empty half of the trailer, so the longest bar is the lane to look at first. On the right is what has already been merged onto another truck.'
        : 'The bar on the left is the empty half of the trailer, so the longest bar is the lane to look at first. Nothing on these lanes has been combined yet; the ring is how many trucks left full anyway.'}</p></div>
    </div>
    <div class="kpis" style="--kpi-cols:4">
      <article class="kpi kpi--ok"><span class="kpi__label">Trailer used</span><span class="kpi__value">${overall === null ? '–' : overall.toFixed(1)}<span>%</span></span></article>
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
          <td class="data">${row.trucks_saved_pct === null || row.trucks_saved_pct === undefined ? '–' : `${Number(row.trucks_saved_pct).toFixed(1)}%`}</td>
          <td>${fullnessCell(row)}</td>
        </tr>`).join('') : '<tr><td colspan="8" class="data">No trucks ran on any lane in this range.</td></tr>'
      }</tbody></table></div>
      <p class="hint hint--wide">Fullness is the skids on a truck against what that truck type holds at this site, set under Settings › Capacity, per site, because the same trailer is stacked differently in different buildings. A truck whose type has no capacity set is counted as a truck and left out of the percentage rather than counted as empty. Full is 90% or more. Trucks saved is the loads that were combined onto another truck as a share of the trucks that would otherwise have run.</p>
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
  const busiestPct = busiest && busiest.utilization_percent !== null && busiest.utilization_percent !== undefined ? Number(busiest.utilization_percent) : null;
  return `<div class="panel"><div class="panel__head"><h3 class="panel__title">What the day asked of the crew</h3><div class="panel__actions">${formSwitch('labour-read', [{ id: 'dial', label: 'Dials' }, { id: 'shape', label: 'Fill' }])}<span class="sub">${escapeHtml(siteRange())}</span></div></div>
      ${readings('labour-read', [
        { percent: overall, label: 'Crew used', note: 'hours on trucks against hours available', shape: 'crew' },
        { percent: busiestPct, label: 'Busiest day', note: busiest ? dayLabel(busiest.work_date) : 'no day measured', shape: 'day' },
        { percent: rows.length ? (recorded / rows.length) * 100 : null, label: 'Days with a real count', note: 'the rest come off the shift roster', good: 'high', shape: 'day' },
      ])}
      <div class="panel__body"><div class="chart2">
        <section><h4 class="chart2__t">Hardest days on the crew</h4>${ranked(worked
          .filter(row => row.utilization_percent !== null && row.utilization_percent !== undefined)
          .map(row => ({ label: dayLabel(row.work_date), value: Number(row.utilization_percent), shown: `${Number(row.utilization_percent).toFixed(0)}% · ${num(row.trucks)} trucks` })), { max: 8, outOf: 100 })}</section>
        <section><h4 class="chart2__t">The crew's hours</h4>${ring([
          { label: 'On trucks', value: Math.round(truckHours) },
          { label: 'Everything else', value: Math.max(0, Math.round(available - truckHours)) },
        ], 'hours')}</section>
      </div><p class="hint">A day over 100% is a day the trucks asked for more crew than the shift had: overtime, or a queue at the door. "Everything else" is not idle time: it is put-away, cycle counts and every other job that is not standing at a trailer.</p></div>
    </div>
    <div class="kpis" style="--kpi-cols:4">
      <article class="kpi kpi--ok"><span class="kpi__label">Crew used</span><span class="kpi__value">${overall === null ? '–' : overall.toFixed(1)}<span>%</span></span></article>
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
      <p class="hint hint--wide">Hours on trucks is every booked window multiplied by the crew a truck takes, the same arithmetic the operations brief uses, so the two cannot disagree. Cancelled and no-show loads are left out; nobody worked them. Available hours come from the day's recorded crew where somebody recorded one, and from the shift roster under Settings › Labour where nobody did, which is what the Crew figures column says. There is no fudge factor in it: it is the shifts running that weekday, each one's length times the people on it. ${recorded} of ${rows.length} day${rows.length === 1 ? '' : 's'} in this range ${recorded === 1 ? 'has' : 'have'} recorded hours.${busiest && busiest.utilization_percent !== null ? ` Busiest day was ${escapeHtml(dayLabel(busiest.work_date))} at ${Number(busiest.utilization_percent).toFixed(1)}%.` : ''}</p>
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
  // Land on something this account may actually open. The default is Overview, and a role that
  // has every report but that one would otherwise arrive at a blank page with its own view
  // missing from the picker. Checked here rather than only at startup, because a role's
  // permissions can change under an open tab.
  const allowed = permittedViews();
  if (allowed.length && !allowed.some(view => view.id === state.view)) state.view = allowed[0].id;
  if (!allowed.length) {
    state.elements.host.innerHTML = '<p class="hint">No report has been made available to your role. A System Admin can grant them one at a time under Users, Role access.</p>';
    return;
  }
  const renderers = {
    overview: renderOverview, 'truck-flow': renderTruckFlow, 'skid-movement': renderSkidMovement,
    'dock-utilisation': renderDockUtilisation,
    'scorecard-company': () => renderScorecard('company'),
    'scorecard-location': () => renderScorecard('location'),
    fullness: renderFullness, labour: renderLabour,
  };
  // The mark is folded in here rather than by each renderer, so every view carries one and
  // none of them has to remember.
  state.elements.host.innerHTML = withViewMark((renderers[state.view] || renderOverview)());
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
    const [data, scorecard, fullness, labour, capacities] = await Promise.all([
      fetchReport(),
      fanOut('get_partner_scorecard',
        id => ({ p_location_id: id, p_start_date: state.from, p_end_date: state.to }),
        'reports:scorecard').then(mergeScorecard).catch(() => []),
      fanOut('get_truck_fullness_scorecard',
        id => ({ p_location_id: id, p_start_date: state.from, p_end_date: state.to }),
        'reports:fullness').then(mergeFullness).catch(() => []),
      // Only asked for by an account allowed to see it. The RPC refuses anyone
      // else anyway, but a report nobody may read is not a request worth making.
      state.context.can('reports.view_labour')
        ? fanOut('get_labour_utilization',
          id => ({ p_location_id: id, p_from: state.from, p_to: state.to }),
          'reports:labour').then(mergeLabour).catch(() => [])
        : Promise.resolve([]),
      // What each truck type holds at each chosen site, so a truck type can be drawn as a
      // trailer with the right amount of room in it. Read straight off the table under
      // row-level security rather than through an RPC, the way Settings reads it, and
      // advisory: a report still stands up without it, minus the trailers.
      Promise.all(state.locationIds.map(id => db.select('location_truck_types',
        q => q.select('truck_type_code,skid_capacity').eq('location_id', id),
        { key: `reports:capacity:${id}`, cache: 300000 }).catch(() => []))).catch(() => []),
    ]);
    state.data = data;
    state.scorecard = Array.isArray(scorecard) ? scorecard : [];
    state.fullness = Array.isArray(fullness) ? fullness : [];
    state.labour = Array.isArray(labour) ? labour : [];
    state.capacity = {};
    for (const site of (capacities || [])) {
      for (const row of (site || [])) {
        if (!num(row.skid_capacity)) continue;
        (state.capacity[row.truck_type_code] ||= []).push(num(row.skid_capacity));
      }
    }
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
  // The page's own subtitle says which sites, not which site the top bar is on.
  state.elements.subtitle.textContent = siteRange();
  state.siteMenu?.sync?.();
}

// A select can only hold one answer, so this is a button that opens a list of ticks.
// The button carries .select so it is the same height, border and arrow as the three
// controls beside it — one control height across the band, whatever is behind it.
//
// The report is not refetched on every tick. Twelve sites means twelve ticks and would
// mean up to forty-eight round trips; it reloads once, when the list closes, and only
// if the selection actually changed.
function sitePicker() {
  const sites = allSites();
  const all = sites.length > 1 && state.locationIds.length === sites.length;
  return `<div class="multipick" data-sites>
    <button class="select multipick__btn" type="button" id="report-sites" data-sites-toggle aria-expanded="false" aria-haspopup="true">
      <span data-sites-summary>${escapeHtml(siteName())}</span>
    </button>
    <div class="multipick__menu" data-sites-menu hidden>
      ${sites.length > 1 ? `<label class="dock-check"><input type="checkbox" data-sites-all ${all ? 'checked' : ''}><span><b>All sites</b></span></label>
      <div class="multipick__rule"></div>` : ''}
      ${sites.map(site => `<label class="dock-check"><input type="checkbox" data-site-id="${escapeHtml(site.id)}" ${state.locationIds.includes(site.id) ? 'checked' : ''}><span>${escapeHtml(site.name)}</span></label>`).join('')}
    </div>
  </div>`;
}

// The list is open, a tick changed, or somebody clicked away. One place, so the button
// text and the report can never disagree about what is selected.
function siteMenu(root) {
  const host = root.querySelector('[data-sites]');
  const menu = root.querySelector('[data-sites-menu]');
  const toggle = root.querySelector('[data-sites-toggle]');
  const summary = root.querySelector('[data-sites-summary]');
  if (!host) return { close: () => {} };
  let openedWith = '';

  const sync = () => {
    const sites = allSites();
    summary.textContent = siteName();
    const all = root.querySelector('[data-sites-all]');
    if (all) all.checked = sites.length > 1 && state.locationIds.length === sites.length;
    for (const box of menu.querySelectorAll('[data-site-id]')) box.checked = state.locationIds.includes(box.dataset.siteId);
  };

  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    // Only if it changed. Closing a list you opened and left alone should cost nothing.
    if (state.locationIds.join(',') !== openedWith) { syncControls(); reload(); }
  }

  function open() {
    openedWith = state.locationIds.join(',');
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', () => (menu.hidden ? open() : close()));
  menu.addEventListener('change', event => {
    const all = event.target.closest('[data-sites-all]');
    if (all) {
      state.locationIds = all.checked ? allSites().map(site => site.id) : [allSites()[0]?.id].filter(Boolean);
      sync();
      return;
    }
    const box = event.target.closest('[data-site-id]');
    if (!box) return;
    const id = box.dataset.siteId;
    const next = box.checked ? [...new Set([...state.locationIds, id])] : state.locationIds.filter(other => other !== id);
    // A report of no sites has nothing to say and no name to print, so the last tick
    // cannot come off. Untick it and it goes straight back on.
    if (!next.length) { sync(); return; }
    // Kept in the order the sites are listed, not the order they were ticked, so the
    // label reads the same however somebody arrived at the same selection.
    state.locationIds = allSites().map(site => site.id).filter(siteId => next.includes(siteId));
    sync();
  });
  document.addEventListener('click', event => { if (!host.contains(event.target)) close(); });
  menu.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); toggle.focus(); } });
  return { close, sync };
}

function buildShell(root) {
  root.innerHTML = `
    ${pageHead('Reports', { actions: ['export', 'print', 'customize'] })}
    ${controlsBar({
      label: 'Report controls',
      filters: `<div class="ctrl-field"><label for="report-sites">Sites</label>${sitePicker()}</div>
      <div class="ctrl-field"><label for="report-view">View</label><select class="select" id="report-view" data-view>${permittedViews().map(view => `<option value="${view.id}"${view.id === state.view ? ' selected' : ''}>${view.label}</option>`).join('')}</select></div>
      <div class="ctrl-field"><label for="report-preset">Range</label><select class="select" id="report-preset" data-preset>${PRESETS.map(preset => `<option value="${preset.id}">${preset.label}</option>`).join('')}</select></div>
      <div class="ctrl-field"><label for="report-from">From</label><input class="input input--date" type="date" id="report-from" data-from></div>
      <div class="ctrl-field"><label for="report-to">To</label><input class="input input--date" type="date" id="report-to" data-to></div>
      <button class="btn btn--primary" type="button" data-apply>Apply</button>`,
      actions: [],
    })}
    <div class="reportstack" data-report-host></div>`;
  state.elements = {
    root,
    subtitle: root.querySelector('[data-subtitle]'),
    sites: root.querySelector('[data-sites]'),
    view: root.querySelector('[data-view]'),
    preset: root.querySelector('[data-preset]'),
    from: root.querySelector('[data-from]'),
    to: root.querySelector('[data-to]'),
    host: root.querySelector('[data-report-host]'),
  };
}

function wireEvents(root) {
  root.addEventListener('click', event => {
    // Which form a panel is drawn in. Kept per browser rather than per account: it is a
    // reading preference, like the text size, not a setting anybody else is affected by.
    const form = event.target.closest('[data-form]');
    if (form) {
      state.forms[form.dataset.form] = form.dataset.formValue;
      try { localStorage.setItem('maxdock:report-forms', JSON.stringify(state.forms)); } catch { /* private mode */ }
      renderView();
      return;
    }
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
    state.locationIds = [context.location.id];
    document.title = `Reports · ${context.location.name} · MaxDock`;
    buildShell(context.pageRoot);
    state.siteMenu = siteMenu(context.pageRoot);
    wireEvents(context.pageRoot);
    state.customizePanel = await createCustomizePanel({
      preferenceKey: 'report-cards',
      options: KPI_CARDS.map(card => ({ id: card.id, group: 'Metric cards', label: card.label })),
      defaultIds: DEFAULT_CARDS,
      max: KPI_CARDS.length,
      onChange: selected => { state.visibleCards = selected; renderView(); },
    });
    state.visibleCards = state.customizePanel.selected;
    try { state.forms = JSON.parse(localStorage.getItem('maxdock:report-forms') || '{}') || {}; } catch { state.forms = {}; }
    applyPreset('last30');
    syncControls();
    await reload();
  },
  refresh() {},
  destroy() { state.customizePanel?.destroy(); },
};

startPage(page);
export const { mount, refresh, destroy } = page;
