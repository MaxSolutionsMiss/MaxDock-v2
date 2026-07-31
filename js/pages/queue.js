import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { renderState } from '../ui/empty.js';
import { format } from '../format.js';
import { createCustomizePanel } from '../ui/customize.js';
import { openWall, paintWall } from '../ui/wall.js';
import { pageHead } from '../ui/pagehead.js';
import { mark } from '../ui/marks.js';
import { createCombineDialog, combinableLanes, laneFullness, laneDescription, laneForRecord } from '../ui/combine-loads.js';
import { createAppointmentDetails } from '../ui/appointment-details.js';

const LATE_GRACE_MINUTES = 15;
const BACK_TO_BACK_MINUTES = 20;
const ACTIVE_STATUSES = new Set(['arrived', 'in_progress']);
const EXPECTED_STATUSES = new Set(['scheduled', 'confirmed']);

const KPI_CARDS = [
  // How many trucks are coming in and how many are going out is the first thing
  // asked of a shift, ahead of where any of them are in it — so both counts lead,
  // and either can be switched off with the rest.
  { id: 'inboundTrucks', label: 'Inbound trucks', className: 'kpi--out', suffix: '', compute: recs => recs.filter(r => r.direction === 'inbound').length },
  { id: 'outboundTrucks', label: 'Outbound trucks', className: 'kpi--ok', suffix: '', compute: recs => recs.filter(r => r.direction === 'outbound').length },
  { id: 'expected', label: 'Expected', className: 'kpi--signal', suffix: '', compute: recs => recs.filter(r => EXPECTED_STATUSES.has(r.status)).length },
  { id: 'onsite', label: 'On site', className: 'kpi--out', suffix: '', compute: recs => recs.filter(r => ACTIVE_STATUSES.has(r.status)).length },
  { id: 'completed', label: 'Completed', className: 'kpi--ok', suffix: '', compute: recs => recs.filter(r => r.status === 'completed').length },
  {
    id: 'avgDuration', label: 'Avg duration', className: '', suffix: 'm',
    compute: recs => {
      const durations = recs.filter(r => r.status === 'completed' && r.completed_at).map(r => format.minutesBetween(r.start_at, r.completed_at));
      return durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;
    },
  },
  { id: 'late', label: 'Late', className: 'kpi--stop', suffix: '', compute: recs => recs.filter(isLate).length },
];
const DEFAULT_CARDS = KPI_CARDS.map(card => card.id);

const state = {
  context: null,
  date: format.todayInput(),
  view: 'all',
  docks: [],
  hours: null,
  records: [],
  returnLoads: [],
  brief: null,
  briefLoading: false,
  visibleCards: DEFAULT_CARDS,
  visibleBriefFigures: [],
  elements: {},
  customizePanel: null,
  wall: null,
  blockFields: [],
  truckTypeNames: new Map(),
  truckCapacity: new Map(),
  combineLanes: [],
  combineDialog: null,
  labour: null,
  shifts: [],
  detailsModal: null,
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const can = permission => state.context?.can?.(permission);
// What one truck of that type holds at this site, from Settings › Capacity. Zero
// means nobody has entered it, which is a different thing from an empty trailer
// and is why the fullness figures say so rather than guessing.
const capacityFor = code => Number(state.truckCapacity.get(code) || 0);

function isLate(record) {
  if (!EXPECTED_STATUSES.has(record.status)) return false;
  return format.epoch(record.start_at) < Date.now() - LATE_GRACE_MINUTES * 60000;
}

function normalizeRecord(row) {
  const record = row?.schedule_record || row || {};
  return {
    ...record,
    id: record.id || record.appointment_id,
    dock_id: record.display_dock_id || record.dock_id,
    direction: record.display_direction || record.direction || 'inbound',
    entry_kind: record.entry_kind || 'appointment',
    status: record.status || 'scheduled',
  };
}

async function fetchQueueData() {
  const locationId = state.context.location.id;
  const day = format.dayOfWeek(state.date);
  const [, scheduleRows, docks, hours, returnLoads, truckTypes, truckCapacities, labour, shifts] = await Promise.all([
    // Settle first, so the schedule that comes back already reflects any load whose
    // booked time has run out. There is no pg_cron on this project, so the screens
    // that are always open are what move a received truck to complete.
    db.rpc('settle_due_appointments', { p_location_id: locationId }, { key: `queue:settle:${locationId}`, cache: 0, retry: 0 }).catch(() => 0),
    db.rpc('list_location_schedule', { p_location_id: locationId }, { key: `queue:schedule:${locationId}`, cache: 0, retry: 1 }),
    db.select('docks', q => q.select('id,name,sort_order').eq('location_id', locationId).eq('is_active', true).order('sort_order').order('name'), { key: `queue:docks:${locationId}`, cache: 30000 }),
    db.select('location_operating_hours', q => q.select('is_open,open_time,close_time').eq('location_id', locationId).eq('day_of_week', day).maybeSingle(), { key: `queue:hours:${locationId}:${day}`, cache: 30000 }),
    // Advisory only — a failure here must not take the operational queue down with it.
    db.rpc('list_return_load_opportunities', { p_location_id: locationId, p_date_from: state.date, p_date_to: state.date }, { key: `queue:returns:${locationId}:${state.date}`, cache: 30000, retry: 1 }).catch(() => []),
    db.select('truck_types', q => q.select('code,name').eq('is_active', true), { key: 'queue:truck-type-names', cache: 300000 }),
    // What each truck holds here, and how the site is staffed: both are what turn
    // a list of appointments into "you need six people and there are two trucks
    // going to the same place".
    db.select('location_truck_types', q => q.select('truck_type_code,skid_capacity').eq('location_id', locationId), { key: `queue:truck-capacity:${locationId}`, cache: 60000 }).catch(() => []),
    db.select('location_settings', q => q.select('handlers_per_truck,max_concurrent_appointments,track_service_start,track_departure').eq('location_id', locationId).maybeSingle(), { key: `queue:labour:${locationId}`, cache: 60000 }).catch(() => null),
    // The shifts this site runs. The brief divides by the same roster the
    // Labour hours report divides by, so the two cannot disagree about what today
    // had to spend.
    db.select('location_shifts', q => q.select('name,start_time,end_time,people,days_of_week,is_active').eq('location_id', locationId).eq('is_active', true), { key: `queue:shifts:${locationId}`, cache: 60000 }).catch(() => []),
  ]);
  // Cancelled loads are dropped before the queue ever sees them — including the
  // half that a combine cancels, which would otherwise sit in the list beside
  // the truck now carrying its freight. Its trail lives in the appointment
  // window, which is still reachable by the cancelled number.
  const records = (scheduleRows || []).map(normalizeRecord)
    .filter(record => record.status !== 'cancelled' && !record.merged_into_appointment_id)
    .filter(record => record.start_at && format.sameLocalDate(record.start_at, state.date, state.context.location));
  return {
    docks: docks || [],
    hours: hours || null,
    records,
    returnLoads: returnLoads || [],
    truckTypeNames: new Map((truckTypes || []).map(type => [type.code, type.name])),
    truckCapacity: new Map((truckCapacities || []).map(row => [row.truck_type_code, Number(row.skid_capacity || 0)])),
    labour: labour || null,
    shifts: shifts || [],
  };
}

async function fetchBrief() {
  state.briefLoading = true;
  renderBriefCard();
  try {
    const result = await db.edge('maxdock-ai-brief', {
      locationId: state.context.location.id,
      startDate: state.date,
      endDate: state.date,
    }, { key: `queue:brief:${state.context.location.id}:${state.date}`, cache: 300000, retry: 0 });
    state.brief = result;
  } catch {
    state.brief = null;
  } finally {
    state.briefLoading = false;
    renderBriefCard();
  }
}

function visibleRecords() {
  const byTab = state.records.filter(record => {
    if (record.entry_kind === 'block') return false;
    // Combined away: part of another truck now, not a movement of its own.
    if (record.merged_into_appointment_id) return false;
    if (state.view === 'expected') return EXPECTED_STATUSES.has(record.status);
    if (state.view === 'onsite') return ACTIVE_STATUSES.has(record.status);
    if (state.view === 'completed') return record.status === 'completed';
    return true;
  });
  // Late first, then the clock. A queue sorted purely by time buries the truck that needed
  // somebody twenty minutes ago underneath eight that are not due yet, and the whole reason
  // to look at this screen is to find the one that is going wrong. Within each group the
  // order is still chronological, so it never becomes a list nobody can predict.
  return byTab.sort((a, b) => {
    const urgency = Number(isLate(b)) - Number(isLate(a));
    return urgency || format.compareChronologically(a.start_at, b.start_at);
  });
}

function renderKpis() {
  const appointments = state.records.filter(record => record.entry_kind !== 'block');
  const cards = KPI_CARDS.filter(card => state.visibleCards.includes(card.id));
  // With every card turned off the strip leaves no trace — an empty bordered band
  // would read as a rendering failure rather than a choice.
  state.elements.kpis.hidden = cards.length === 0;
  const page = state.elements.kpis.closest('.page');
  page?.style.setProperty('--kpi-cols', String(Math.max(2, cards.length)));
  state.elements.kpis.innerHTML = cards.map(card => {
    const value = card.compute(appointments);
    return `<article class="kpi ${card.className}"><span class="kpi__label">${card.label}</span><span class="kpi__value">${value}${card.suffix ? `<span>${card.suffix}</span>` : ''}</span></article>`;
  }).join('');
}

function dockName(dockId) {
  return state.docks.find(dock => dock.id === dockId)?.name || 'Unassigned';
}

// The next permitted step for a load, or nothing when it is somebody else's turn.
//
// Start and Departed appear only where the site asked for them. Both are off everywhere until
// somebody turns them on, and with them off this returns exactly the two answers it returned
// before any of it existed: Arrive for a load that has not turned up, Complete for one at the
// door. That is the whole guarantee, expressed in one function rather than scattered through
// the markup.
function nextAction(record) {
  const clock = state.labour || {};
  const status = String(record.status || '');
  if (EXPECTED_STATUSES.has(status)) {
    return can('appointment.update') ? { to: 'arrived', label: 'Arrive' } : null;
  }
  if (status === 'arrived') {
    if (clock.track_service_start === true) {
      return can('appointment.update') ? { to: 'in_progress', label: 'Start' } : null;
    }
    return can('appointment.complete') ? { to: 'completed', label: 'Complete' } : null;
  }
  if (status === 'in_progress') {
    return can('appointment.complete') ? { to: 'completed', label: 'Complete' } : null;
  }
  if (status === 'completed' && clock.track_departure === true) {
    // Not a status. The load stays complete; this only records when the truck pulled off.
    return can('appointment.update') ? { to: 'departed', label: 'Departed' } : null;
  }
  return null;
}

function renderTable() {
  const records = visibleRecords();
  // What is on screen against what there is. "24 movements" beside a filtered list of six is
  // a number about a different thing than the one being looked at.
  const total = state.records.filter(r => r.entry_kind !== 'block' && !r.merged_into_appointment_id).length;
  state.elements.tabSummary.textContent = records.length === total
    ? `${total} movement${total === 1 ? '' : 's'} · updated ${format.currentTimeLabel()}`
    : `Showing ${records.length} of ${total} movements · updated ${format.currentTimeLabel()}`;
  state.elements.rows.innerHTML = records.map(record => {
    const late = isLate(record);
    const statusText = late ? 'Late' : format.role(record.status);
    const colorVar = late ? 'var(--stop)' : ACTIVE_STATUSES.has(record.status) ? 'var(--ok)' : record.status === 'completed' ? 'var(--ink-faint)' : 'var(--signal)';
    // A truck that never turns up has to be closed off by somebody. Without this
    // it stays "Late" for the rest of the day, keeps a dock nominally reserved,
    // and counts against every figure on the page — the status existed in the
    // database and there was no way in the application to set it.
    // One button: the next thing this load is waiting for. Which rung that is depends on the
    // status and on what the site has switched on, so a site running Arrived then Complete
    // sees exactly the two it saw before, and a site recording work and departures sees four
    // rungs across the day rather than four buttons at once.
    const actions = [];
    const next = nextAction(record);
    if (next) actions.push(`<button class="btn btn--quiet btn--sm" type="button" data-step="${record.id}" data-to="${next.to}">${escapeHtml(next.label)}</button>`);
    if (late && can('appointment.cancel')) actions.push(`<button class="btn btn--danger btn--sm" type="button" data-no-show="${record.id}" data-reference="${escapeHtml(record.booking_reference || '')}">No show</button>`);
    const action = `<div class="rowactions">${actions.join('')}</div>`;
    // The whole row opens the movement. Somebody asking "where is this one" is
    // the commonest thing done on this screen and it had no answer here.
    return `<tr data-open-record="${escapeHtml(record.id)}" tabindex="0">
      <td class="data data--strong">${escapeHtml(format.time(record.start_at, state.context.location))}</td>
      <td class="data" title="${Number(record.combined_from_count || 0) ? `${record.combined_from_count} loads combined onto this truck` : ''}">${Number(record.combined_from_count || 0) ? '⧉ ' : ''}${escapeHtml(record.booking_reference || '–')}</td>
      <td class="data">${escapeHtml(dockName(record.dock_id))}</td>
      <td>${escapeHtml(record.company_name || record.display_counterpart_location_name || record.requester_name || '–')}</td>
      <td class="data">${escapeHtml(record.skid_count ?? 0)} sk</td>
      <td><span class="statusdot" style="--c:${colorVar}">${escapeHtml(statusText)}</span></td>
      <td>${action}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="data">Nothing scheduled for this view.</td></tr>';
}

function heatmapHours() {
  const open = state.hours?.is_open !== false ? (state.hours?.open_time || '06:00:00') : '06:00:00';
  const start = Math.floor(format.clockMinutes(open) / 60);
  return Array.from({ length: 10 }, (_, index) => start + index);
}

function renderHeatmap() {
  const hours = heatmapHours();
  const appointments = state.records.filter(record => record.entry_kind !== 'block');
  const header = `<span class="hh"></span>${hours.map(hour => `<span class="hh">${String(hour % 24).padStart(2, '0')}</span>`).join('')}`;
  const countAt = (dock, hour) => appointments.filter(record => record.dock_id === dock.id
    && Math.floor(format.localTimeMinutes(record.start_at, state.context.location) / 60) === hour % 24).length;
  // Scaled to the busiest cell on the day, not to a fixed five.
  //
  // A dock holds one truck at a time and a movement takes the better part of an hour, so a
  // dock-hour realistically holds one or two. Against a hard scale of five, that painted the
  // whole grid at a fifth or two fifths opacity — a heat map with no heat in it, whatever the
  // day looked like. Now the busiest cell is the darkest, and the rest are read against it.
  //
  // The floor of two is what stops a quiet day looking like a crisis: with one movement
  // anywhere and a scale of one, every occupied cell would be solid.
  const busiest = Math.max(2, ...state.docks.flatMap(dock => hours.map(hour => countAt(dock, hour))));
  const rows = state.docks.map(dock => {
    const cells = hours.map(hour => {
      const count = countAt(dock, hour);
      return `<span class="hc" style="--v:${count};--peak:${busiest}" title="${count} movement${count === 1 ? '' : 's'}"></span>`;
    }).join('');
    return `<span class="hd">${escapeHtml(dock.name)}</span>${cells}`;
  }).join('');
  state.elements.heat.innerHTML = header + rows;
}

function watchItems() {
  const items = [];
  const appointments = state.records.filter(record => record.entry_kind !== 'block').sort((a, b) => format.compareChronologically(a.start_at, b.start_at));

  for (const record of appointments) {
    if (!isLate(record)) continue;
    items.push({
      title: `Late ${record.direction} · ${dockName(record.dock_id)}`,
      body: `${record.booking_reference || 'Appointment'} was due ${format.time(record.start_at, state.context.location)}. Carrier not arrived.`,
    });
  }

  for (const dock of state.docks) {
    const dockRecords = appointments.filter(record => record.dock_id === dock.id);
    for (let index = 1; index < dockRecords.length; index += 1) {
      const gap = format.minutesBetween(dockRecords[index - 1].end_at, dockRecords[index].start_at);
      if (dockRecords[index - 1].end_at && gap <= BACK_TO_BACK_MINUTES) {
        items.push({
          title: `Back-to-back on ${dock.name}`,
          body: `${format.time(dockRecords[index - 1].start_at, state.context.location)} and ${format.time(dockRecords[index].start_at, state.context.location)}: tight turnaround.`,
        });
      }
    }
  }

  for (const match of state.returnLoads.slice(0, 3)) {
    items.push({
      title: 'Return-load match',
      body: match.recommendation || `${match.first_booking_reference} could pair with ${match.second_booking_reference}.`,
    });
  }

  return items.slice(0, 6);
}

function renderWatch() {
  const items = watchItems();
  state.elements.watch.innerHTML = items.map(item => `<div class="watchitem"><span class="wdot" style="--c:var(--signal)"></span><div><b>${escapeHtml(item.title)}</b>${escapeHtml(item.body)}</div></div>`).join('')
    || '<div class="watchitem"><span class="wdot" style="--c:var(--ok)"></span><div><b>All clear</b>Nothing needs attention right now.</div></div>';
}

// The numbers a supervisor would otherwise read off the board one at a time before
// a production meeting: what is coming, which way it moves, how heavy it is, what
// is already late. Counted locally from the same records the page is showing, so
// it is right even when the AI service is unavailable — that call only supplies
// the narrative on top.
function applyVisible(selected) {
  state.visibleBriefFigures = selected.filter(id => id.startsWith('brief:')).map(id => id.slice(6));
  state.blockFields = selected.filter(id => id.startsWith('block:')).map(id => id.slice(6));
  state.visibleCards = selected.filter(id => !id.startsWith('brief:') && !id.startsWith('block:'));
}

function briefFigures() {
  const appointments = state.records.filter(record => record.entry_kind !== 'block');
  const skids = rows => rows.reduce((sum, row) => sum + Number(row.skid_count || 0), 0);
  const inbound = appointments.filter(record => record.direction === 'inbound');
  const outbound = appointments.filter(record => record.direction === 'outbound');
  const done = appointments.filter(record => record.status === 'completed');
  const onSite = appointments.filter(record => ACTIVE_STATUSES.has(record.status));
  const expected = appointments.filter(record => EXPECTED_STATUSES.has(record.status));
  const late = appointments.filter(record => isLate(record));
  const priority = appointments.filter(record => record.is_priority);
  const busiest = [...appointments.reduce((map, record) => {
    const hour = format.localTimeMinutes(record.start_at, state.context.location);
    const key = Math.floor(hour / 60);
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map())].sort((a, b) => b[1] - a[1])[0];
  // The same accents the metric cards above carry, so "Completed" is the same
  // green in the brief as it is on the card strip and on the board.
  return [
    { id: 'trucks', label: 'Trucks today', value: appointments.length },
    { id: 'inboundTrucks', label: 'Inbound trucks', value: inbound.length, className: 'kpi--out' },
    { id: 'outboundTrucks', label: 'Outbound trucks', value: outbound.length, className: 'kpi--ok' },
    { id: 'inbound', label: 'Inbound skids', value: skids(inbound), className: 'kpi--out' },
    { id: 'outbound', label: 'Outbound skids', value: skids(outbound), className: 'kpi--ok' },
    { id: 'expected', label: 'Still to come', value: expected.length, className: 'kpi--signal' },
    { id: 'onsite', label: 'On site now', value: onSite.length, className: 'kpi--out' },
    { id: 'completed', label: 'Completed', value: done.length, className: 'kpi--ok' },
    ...(priority.length ? [{ id: 'priority', label: 'Priority', value: priority.length, className: 'kpi--signal' }] : []),
    ...(late.length ? [{ id: 'late', label: 'Running late', value: late.length, className: 'kpi--stop' }] : []),
    // The hour is the figure. How many trucks were in it is a second number and
    // would make this the one card carrying two, so it is left to the timeline.
    ...(busiest ? [{ id: 'busiest', label: 'Busiest hour', value: `${String(busiest[0]).padStart(2, '0')}:00` }] : []),
  ].filter(item => state.visibleBriefFigures.includes(item.id));
}

// Every figure the brief can show, listed independently of today's data so the
// picker offers all of them even on a quiet day.
const BRIEF_FIGURES = [
  { id: 'trucks', label: 'Trucks today' },
  { id: 'inboundTrucks', label: 'Inbound trucks' },
  { id: 'outboundTrucks', label: 'Outbound trucks' },
  { id: 'inbound', label: 'Inbound skids' },
  { id: 'outbound', label: 'Outbound skids' },
  { id: 'expected', label: 'Still to come' },
  { id: 'onsite', label: 'On site now' },
  { id: 'completed', label: 'Completed' },
  { id: 'priority', label: 'Priority' },
  { id: 'late', label: 'Running late' },
  { id: 'busiest', label: 'Busiest hour' },
];
const DEFAULT_BRIEF_FIGURES = BRIEF_FIGURES.map(figure => figure.id);

// The facts each block on the broadcast wall carries. Same vocabulary as the
// dock board's, chosen separately: a wall read from across the floor holds far
// fewer lines than a screen someone is sitting in front of.
const BLOCK_FIELDS = [
  { id: 'reference', label: 'Reference' },
  { id: 'status', label: 'Status' },
  { id: 'route', label: 'From / To' },
  { id: 'time', label: 'Time' },
  { id: 'truck', label: 'Truck type' },
  { id: 'skids', label: 'Skids' },
  { id: 'carrier', label: 'Carrier' },
  { id: 'po', label: 'PO / BOL / job' },
  { id: 'combined', label: 'Combined loads' },
];
const DEFAULT_BLOCK_FIELDS = ['reference', 'status', 'route', 'time', 'skids', 'combined'];

// What the day actually asks of this site, in the four groups a shipping manager
// thinks in. Built from the schedule already on screen rather than from a service
// call, so it is never empty and never waiting.
//
// Trucks is the shape of the day. Labour is the question behind "can somebody have
// Thursday off". Combining is the duplication nobody has spotted yet. Attention is
// what is going wrong right now.
// A bullet is either a sentence or a sentence with a second line under it. The second line
// carries what somebody needs to be able to read off the card but never acts on from here:
// the references behind a combining lane. Two of them inside the sentence is what made that
// bullet run to six lines, and putting them on a line of their own in smaller type is what
// lets them be on the card at all. Both the card and the email go through these, so the two
// cannot show different bullets.
const pointText = point => (typeof point === 'string' ? point : point.text);
const pointSub = point => (typeof point === 'string' ? '' : point.sub || '');

function briefGroups() {
  const appointments = state.records.filter(record => record.entry_kind !== 'block' && !record.merged_into_appointment_id);
  if (!appointments.length) return [{ title: 'Trucks', points: ['Nothing is scheduled at this location today.'] }];
  const skids = rows => rows.reduce((sum, row) => sum + Number(row.skid_count || 0), 0);
  const inbound = appointments.filter(record => record.direction === 'inbound');
  const outbound = appointments.filter(record => record.direction === 'outbound');
  const late = appointments.filter(record => isLate(record));
  const priority = appointments.filter(record => record.is_priority);
  const remaining = appointments.filter(record => EXPECTED_STATUSES.has(record.status));

  // How much is on each of them, not only how many there are. Twelve trucks at four skids
  // apiece and twelve at twenty are the same line otherwise, and only one of them is a
  // problem worth walking over to look at.
  const each = rows => (rows.length ? Math.round(skids(rows) / rows.length) : 0);
  const groups = [{
    title: 'Trucks',
    mark: 'truck',
    points: [
      `${appointments.length} truck${appointments.length === 1 ? '' : 's'} today: ${inbound.length} in with ${skids(inbound)} skids, ${outbound.length} out with ${skids(outbound)}.`,
      `${each(appointments)} skids a truck on average: ${inbound.length ? `${each(inbound)} in` : 'nothing in'}, ${outbound.length ? `${each(outbound)} out` : 'nothing out'}.`,
      remaining.length ? `${remaining.length} still to arrive.` : 'Everything booked has arrived or finished.',
    ],
  }];

  const labour = labourPoints(appointments);
  if (labour.length) groups.push({ title: 'Labour', mark: 'crew', points: labour });
  const combining = combinePoints(appointments);
  state.combineLanes = combining;
  // The only group whose bullets are worth acting on: everything else on this card
  // is something to know, this is something to do.
  // Always a section, even with nothing in it. The card is four quadrants and it is four
  // whether or not today has anything to combine — a column that comes and goes moves the
  // other three every time it does, and "nothing to combine today" is itself an answer
  // somebody came to this card for. Silence would read as "not checked yet".
  groups.push({
    title: 'Combining',
    mark: 'combine',
    points: combining.length
      ? combining.map(lane => ({ text: lane.text, sub: lane.refs }))
      : ['No combining opportunity today.'],
    action: combining.length && can('appointment.create')
      ? { label: 'Combine', attribute: 'data-combine-lane' }
      : null,
  });

  const attention = [];
  if (late.length) attention.push(`${late.length} running late: ${late.slice(0, 2).map(record => record.booking_reference || 'an unreferenced booking').join(', ')}.`);
  if (priority.length) attention.push(`${priority.length} marked priority.`);
  if (state.brief?.brief?.summary) attention.push(state.brief.brief.summary);
  // A clock when the thing to look at is the clock. Trucks running late and a load marked
  // priority both land in this column, but they are not the same kind of problem, and a
  // hazard triangle over "3 running late" overstates one and understates the other.
  if (!attention.length) attention.push('Nothing needs watching. Nothing late, nothing marked priority.');
  groups.push({ title: 'Attention', mark: late.length ? 'late' : 'warn', points: attention });
  return groups;
}

// The staffing question a site actually asks is not "how many bodies at the worst
// moment" — it is "is there room in this day". So the brief reports the hours the
// day's bookings cost against the hours the crew has, and says how much is left.
// That is the number to look at before agreeing to a day off next Thursday.
//
// Cost: every truck's window multiplied by the crew a truck takes. The window is
// not typed in anywhere — it is what the timing rules already worked out for that
// load — so this is derived, not guessed.
//
// Available: the shifts running today, each one's length times the people on it.
// This used to be crew × shift length × a percentage, and the percentage was a
// number nobody had measured that scaled the whole answer. A roster is a fact.
function labourPoints(appointments) {
  const perTruck = Number(state.labour?.handlers_per_truck ?? 0);
  if (!perTruck) return [];
  const minutes = appointments.reduce((sum, record) => sum + format.minutesBetween(record.start_at, record.end_at), 0);
  const bookedHours = Math.round((minutes * perTruck) / 60 * 10) / 10;
  const today = format.dayOfWeek(state.date);
  const running = (state.shifts || []).filter(shift => (shift.days_of_week || []).map(Number).includes(today));
  const availableHours = Math.round(running.reduce((sum, shift) => sum + Number(shift.people || 0) * format.shiftHours(shift.start_time, shift.end_time), 0) * 10) / 10;
  const people = running.reduce((sum, shift) => sum + Number(shift.people || 0), 0);

  // No roster for today: say what the day costs and leave capacity alone rather
  // than inventing a number the site never gave.
  if (!availableHours) {
    return [
      `${bookedHours} hours of dock labour booked today, ${perTruck} people per truck across ${appointments.length} truck${appointments.length === 1 ? '' : 's'}.`,
      'No shift covers today. Set the roster under Settings › Labour to see this against what the day has.',
    ];
  }

  const spare = Math.round((availableHours - bookedHours) * 10) / 10;
  const used = Math.round((bookedHours / availableHours) * 100);
  const perPerson = people ? availableHours / people : 0;
  const points = [
    `${bookedHours} of ${availableHours} dock hours booked today, ${used}% of the crew's day.`,
    `${people} on across ${running.length} shift${running.length === 1 ? '' : 's'}, ${perTruck} people per truck.`,
  ];
  if (spare < 0) points.push(`${Math.abs(spare)} hours short. The day needs ${perPerson ? Math.ceil(Math.abs(spare) / perPerson) : 1} more on the floor, or trucks moved off it.`);
  else points.push(`${spare} hours spare, room for about ${perPerson ? Math.floor(spare / perPerson) : 0} of the crew to be off and still clear the day.`);
  return points;
}

// The duplication nobody has spotted: two or more trucks going the same way to the
// same place on the same day, with room on one of them for the rest. Named, so it
// can be acted on rather than wondered about.
//
// Which loads share a lane is decided in `combine-loads.js`, beside the dialog that
// merges them and beside the board that offers the same thing on a block. The
// sentence is this screen's own — a brief is prose — but the arithmetic behind it
// is not, so the board and the brief cannot disagree about whether a run fits.
function combinePoints(appointments) {
  return combinableLanes(appointments).slice(0, 3).map(lane => {
    const { total, biggest, fits } = laneFullness(lane, capacityFor);
    // The references are not in the sentence, but they are on the card: they sit under it
    // on a line of their own, in smaller type. Inside the sentence, two sixteen-character
    // references made this the one bullet that ran to six lines. On their own line they
    // cost one line and answer the question the sentence raises, which is "which loads".
    // Acting on them still happens in the dialog the Combine button opens.
    return {
      ...lane,
      refs: lane.rows.map(row => row.booking_reference).filter(Boolean).join(', '),
      // Short on purpose. This is a bullet in a card three across, and the long form ran to
      // four lines of eighteen characters at every width. It says the decision and nothing
      // else: how many, where to, how full, does it fit. The dialog behind the button
      // lists the references and ticks them, which is where anybody acts on them.
      text: biggest > 0
        ? `${lane.rows.length} ${lane.direction === 'outbound' ? 'to' : 'from'} ${lane.partner}: ${total} of ${biggest} skids${fits ? ', one truck' : ', over one truck'}.`
        : `${lane.rows.length} ${lane.direction === 'outbound' ? 'to' : 'from'} ${lane.partner}: ${total} skids.`,
    };
  });
}

function renderBriefCard() {
  const host = state.elements.brief;
  const figures = briefFigures()
    // A metric card, not a lookalike. Same element, same classes and therefore the
    // same size, weight and alignment as the strip above it and as every other
    // page — there is one metric card in this application and this is it.
    .map(item => `<article class="kpi${item.className ? ` ${item.className}` : ''}"><span class="kpi__label">${escapeHtml(item.label)}</span><span class="kpi__value">${escapeHtml(String(item.value))}</span></article>`)
    .join('');
  // Named columns across the width instead of one stack of bullets down the left.
  // The card is as wide as the screen and the reader is looking for one kind of
  // answer at a time — how the day looks, who is needed, what is duplicated, what
  // is going wrong.
  const narrative = state.briefLoading
    ? '<span class="brief__x">Generating today’s narrative…</span>'
    // A large mark in a gutter of its own, with the heading and the points sharing one
    // left edge beside it. Four columns of near-identical grey text are told apart by
    // shape before a word of them is read, which is the whole job of the card, and the
    // shape is the subject: a truck, a person, a load, a warning. On the title line it
    // was too small to do that job from across a desk.
    : `<div class="briefcols">${briefGroups().map(group => `<section class="briefcol">
        <span class="briefcol__m" aria-hidden="true">${mark(group.mark || 'chart')}</span>
        <div class="briefcol__c">
          <h4 class="briefcol__t">${escapeHtml(group.title)}</h4>
          <ul class="briefpoints">${group.points.map((point, index) => `<li>${escapeHtml(pointText(point))}${pointSub(point) || group.action ? `<small class="briefpoint__s">${pointSub(point) ? escapeHtml(pointSub(point)) : ''}${group.action ? `<button class="linkBtn linkBtn--tight" type="button" ${group.action.attribute}="${index}">${escapeHtml(group.action.label)}</button>` : ''}</small>` : ''}</li>`).join('')}</ul>
        </div>
      </section>`).join('')}</div>`;
  host.innerHTML = `<div class="brief__head"><span class="brief__ico">AI</span><div class="brief__t">${escapeHtml(state.context.location.name)} · today at a glance</div><button class="linkBtn" type="button" data-share-brief>Share with team</button></div>
    <div class="brieffigs">${figures}</div>
    <div class="brief__body">${narrative}</div>`;
}

// The card, in an email, reading the same way. It shared a narrative that had been
// renamed to `briefGroups` some time ago, so every press of this button threw
// before it reached the mail client and the brief could not be sent at all. It
// builds from the same four groups the card draws, so the two cannot drift again.
function shareBrief() {
  const brief = state.brief?.brief || {};
  const lines = [
    ...briefFigures().map(item => `${item.label}: ${item.value}`),
    ...briefGroups().flatMap(group => ['', `${group.title}`,
      ...group.points.map(point => `• ${pointText(point)}${pointSub(point) ? ` (${pointSub(point)})` : ''}`)]),
    // Whatever the AI service adds beyond the summary the Attention column already
    // carries. Absent when that call failed, which is not a reason to send nothing.
    ...(brief.pressures?.length ? ['', 'Pressures', ...brief.pressures.map(item => `• ${item}`)] : []),
    ...(brief.actions?.length ? ['', 'Suggested actions', ...brief.actions.map(item => `• ${item.action || item}`)] : []),
  ];
  const href = `mailto:?subject=${encodeURIComponent(`${state.context.location.name} operations brief · ${state.date}`)}&body=${encodeURIComponent(lines.join('\n'))}`;
  globalThis.open(href, '_self');
}

function renderAll() {
  renderBriefCard();
  renderKpis();
  renderTable();
  renderHeatmap();
  renderWatch();
}

function exportCsv() {
  const rows = [['Time', 'Reference', 'Dock', 'Company', 'Skids', 'Status']];
  for (const record of visibleRecords()) {
    rows.push([format.time(record.start_at, state.context.location), record.booking_reference || '', dockName(record.dock_id), record.company_name || record.display_counterpart_location_name || '', record.skid_count || 0, record.status]);
  }
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `maxdock-queue-${state.date}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function queueWindow() {
  const open = format.clockMinutes(state.hours?.open_time || '06:00:00');
  const close = format.clockMinutes(state.hours?.close_time || '18:00:00');
  let start = Math.min(open, close - 60);
  let end = Math.max(close, start + 60);
  for (const record of visibleRecords()) {
    if (!record.start_at || !record.end_at) continue;
    const from = format.localTimeMinutes(record.start_at, state.context.location);
    const to = from + Math.max(5, format.minutesBetween(record.start_at, record.end_at));
    start = Math.min(start, Math.floor(from / 60) * 60);
    end = Math.max(end, Math.ceil(to / 60) * 60);
  }
  return { start: Math.max(0, start), end: Math.min(24 * 60, end) };
}

// Late is not a status the database stores, it is a comparison against the
// clock — so it replaces the status on the wall rather than sitting beside it.
// Nobody reading a wall needs to be told a truck is both scheduled and late.
function blockLines(record, late) {
  const show = id => state.blockFields.includes(id);
  const load = [
    show('truck') && state.truckTypeNames?.get(record.truck_type_code),
    show('skids') && `${Number(record.skid_count || 0)} skids`,
  ].filter(Boolean).join(' · ');
  // Marked on the reference itself so it cannot be turned off: this block is not
  // one load, and that changes what comes back up to the door.
  const combined = Number(record.combined_from_count || 0);
  return [
    show('reference') && `${combined ? '⧉ ' : ''}${record.booking_reference}`,
    combined && show('combined') && `${combined} load${combined === 1 ? '' : 's'} combined in`,
    show('status') && (late ? 'LATE' : format.role(record.status || '')),
    show('route') && `${record.direction === 'outbound' ? 'To' : 'From'} ${record.company_name || record.display_counterpart_location_name || record.requester_name || 'unnamed'}`,
    show('time') && format.time(record.start_at, state.context.location),
    load,
    show('carrier') && record.carrier_name,
    show('po') && record.external_reference,
  ].filter(Boolean);
}

function wallPayload() {
  const window = queueWindow();
  const lanes = state.docks.map(dock => ({ id: dock.id, name: dock.name, note: '' }));
  // Anything without a dock still has to appear, or the wall quietly under-reports
  // the yard. It gets its own lane at the end.
  const known = new Set(lanes.map(lane => lane.id));
  const unassigned = { id: '__unassigned', name: 'Unassigned', note: 'no dock yet' };
  const blocks = visibleRecords().filter(record => record.start_at && record.end_at).map(record => {
    const startMin = format.localTimeMinutes(record.start_at, state.context.location);
    const late = isLate(record);
    return {
      laneId: known.has(record.dock_id) ? record.dock_id : unassigned.id,
      startMin,
      endMin: startMin + Math.max(5, format.minutesBetween(record.start_at, record.end_at)),
      tone: late ? 'tlb--pri' : record.status === 'completed' ? 'tlb--done' : record.direction === 'outbound' ? 'tlb--out' : 'tlb--in',
      lines: blockLines(record, late),
      attrs: '',
    };
  });
  if (blocks.some(block => block.laneId === unassigned.id)) lanes.push(unassigned);
  return {
    lanes,
    blocks,
    windowStart: window.start,
    windowEnd: window.end,
    granularity: 30,
    subtitle: `${blocks.length} movement${blocks.length === 1 ? '' : 's'} · live`,
    clock: format.currentTimeLabel(),
  };
}

function openBroadcastWindow() {
  state.wall = openWall({
    name: 'maxdock-queue-broadcast',
    title: `${state.context.location.name} · Operations queue`,
    cssHref: new URL('../assets/maxdock.css', globalThis.location.href).href,
    onNoWindow: () => toast('Allow pop-ups to open the broadcast window.', 'error'),
    ...wallPayload(),
  });
}

async function refreshData() {
  const data = await fetchQueueData();
  state.docks = data.docks;
  state.hours = data.hours;
  state.records = data.records;
  state.returnLoads = data.returnLoads;
  state.truckTypeNames = data.truckTypeNames || state.truckTypeNames;
  state.truckCapacity = data.truckCapacity || state.truckCapacity;
  state.labour = data.labour ?? state.labour;
  state.shifts = data.shifts ?? state.shifts;
  renderAll();
  if (state.wall && !state.wall.closed) paintWall(state.wall, wallPayload());
}

async function changeStatus(appointmentId, newStatus) {
  try {
    await db.rpc('change_appointment_status', { p_appointment_id: appointmentId, p_new_status: newStatus, p_reason: null }, { key: `queue:status:${appointmentId}:${crypto.randomUUID()}`, retry: 0 });
    db.invalidate('queue:schedule:');
    db.invalidate('board:schedule:');
    toast({ arrived: 'Marked arrived.', completed: 'Marked complete.', no_show: 'Marked as a no-show. The dock is released.' }[newStatus] || 'Status updated.', 'success');
    await refreshData();
  } catch (error) {
    toast(error.userMessage || 'The status could not be changed.', 'error');
  }
}

function buildShell(root) {
  root.innerHTML = `
    ${pageHead('Operations queue', { actions: ['export', 'print', 'fullscreen', 'customize'] })}
    <div class="brief" data-brief></div>
    <div class="kpis" data-kpis></div>
    <div class="split">
      <div class="panel panel--fill">
        <div class="panel__head">
          <div class="tabs" data-tabs>
            <button type="button" data-view="all" aria-pressed="true">All</button>
            <button type="button" data-view="expected" aria-pressed="false">Expected</button>
            <button type="button" data-view="onsite" aria-pressed="false">On site</button>
            <button type="button" data-view="completed" aria-pressed="false">Completed</button>
          </div>
          <div class="panel__actions"><span class="sub" data-tab-summary></span></div>
        </div>
        <div class="panel__scroll"><table class="table"><thead><tr><th>Time</th><th>Reference</th><th>Dock</th><th>Company</th><th>Load</th><th>Status</th><th></th></tr></thead><tbody data-rows></tbody></table></div>
      </div>
      <div>
        <div class="heat"><h3 class="heat__t">Dock heatmap</h3><div class="heatgrid" data-heat></div><p class="hint">Darker = busier, against the busiest hour on this board today.</p></div>
        <div class="watch"><h3 class="watch__t">Watch for</h3><div data-watch></div></div>
      </div>
    </div>`;
  state.elements = {
    root,
    subtitle: root.querySelector('[data-subtitle]'),
    brief: root.querySelector('[data-brief]'),
    kpis: root.querySelector('[data-kpis]'),
    tabs: root.querySelector('[data-tabs]'),
    tabSummary: root.querySelector('[data-tab-summary]'),
    rows: root.querySelector('[data-rows]'),
    heat: root.querySelector('[data-heat]'),
    watch: root.querySelector('[data-watch]'),
  };
}

function wireEvents(root) {
  root.addEventListener('click', async event => {
    if (event.target.closest('[data-open-booking]')) globalThis.dispatchEvent(new CustomEvent('maxdock:open-booking', { detail: { trigger: event.target } }));
    if (event.target.closest('[data-export]')) exportCsv();
    if (event.target.closest('[data-print]')) globalThis.print();
    if (event.target.closest('[data-fullscreen]')) openBroadcastWindow();
    if (event.target.closest('[data-share-brief]')) shareBrief();
    const lane = event.target.closest('[data-combine-lane]');
    if (lane) {
      const found = state.combineLanes[Number(lane.dataset.combineLane)];
      if (found) {
        state.combineDialog.open(found.rows,
          `${found.rows.length} ${found.direction} loads ${found.direction === 'outbound' ? 'to' : 'from'} ${found.partner} today`,
          lane);
      }
      return;
    }
    if (event.target.closest('[data-customize]')) state.customizePanel.open(event.target.closest('[data-customize]'));
    const tab = event.target.closest('[data-tabs] button');
    if (tab) {
      state.view = tab.dataset.view;
      for (const item of root.querySelectorAll('[data-tabs] button')) item.setAttribute('aria-pressed', String(item === tab));
      renderTable();
    }
    const step = event.target.closest('[data-step]');
    if (step) changeStatus(step.dataset.step, step.dataset.to);
    // A row click opens the movement, but not when the click was on one of the
    // row's own action buttons — those act, they do not navigate.
    const row = event.target.closest('[data-open-record]');
    if (row && !event.target.closest('button')) {
      const record = state.records.find(item => String(item.id) === row.dataset.openRecord);
      if (record) state.detailsModal.open(record, { trigger: row, canEdit: false });
      return;
    }
    const noShow = event.target.closest('[data-no-show]');
    // Asked for rather than done on one tap: a no-show is a black mark against a
    // carrier and it cannot be undone from this screen.
    if (noShow && globalThis.confirm(`Mark ${noShow.dataset.reference || 'this appointment'} as a no-show? The dock is released and the carrier's record shows a missed appointment.`)) {
      changeStatus(noShow.dataset.noShow, 'no_show');
    }
  });
}

const page = {
  code: 'queue',
  permission: 'operations.queue.view',
  async mount(context) {
    state.context = context;
    state.date = format.todayInput(context.location);
    document.title = `Operations queue · ${context.location.name} · MaxDock`;
    buildShell(context.pageRoot);
    wireEvents(context.pageRoot);
    state.elements.subtitle.textContent = `${context.location.name} · today · live`;
    // One gear, both rows: the brief's figures at a glance and the metric cards
    // under it. They were two strips of numbers with only one of them adjustable.
    state.combineDialog = createCombineDialog({
      location: context.location,
      capacityFor: record => capacityFor(record.truck_type_code),
      truckName: code => state.truckTypeNames.get(code),
      // Every truck type at this site with its capacity, so the dialog can work out which
      // trailer a combined run actually needs rather than only that it does not fit.
      truckTypes: () => [...state.truckCapacity.entries()].map(([code, skid_capacity]) => ({
        code, skid_capacity, name: state.truckTypeNames.get(code) || code,
      })),
      onDone: () => refreshData(),
    });
    // The same offer the brief makes, on the row somebody has just opened. One
    // dialog behaving one way wherever it is opened from: a movement that can be
    // combined says so on the board and on the queue, not on whichever screen the
    // feature happened to be built for.
    state.detailsModal = createAppointmentDetails({
      location: context.location,
      truckName: code => state.truckTypeNames.get(code),
      laneFor: record => (can('appointment.create') ? laneForRecord(record, state.records) : null),
      onCombine: lane => state.combineDialog.open(lane.rows, laneDescription(lane), state.elements.rows),
    });
    state.customizePanel = await createCustomizePanel({
      // A new key rather than queue-cards: the saved list now carries the wall's
      // block fields too, and an old list read against the new options would
      // turn every one of them off without anybody asking for that.
      preferenceKey: 'queue-view',
      options: [
        // Three strips, so three named groups. Prefixing every label with which
        // strip it belonged to made twenty near-identical lines; the group
        // heading says it once and the names go back to being readable.
        ...BRIEF_FIGURES.map(figure => ({ id: `brief:${figure.id}`, group: 'Today at a glance', label: figure.label })),
        ...KPI_CARDS.map(card => ({ id: card.id, group: 'Metric cards', label: card.label })),
        ...BLOCK_FIELDS.map(field => ({ id: `block:${field.id}`, group: 'Full-screen blocks', label: field.label })),
      ],
      defaultIds: [...DEFAULT_BRIEF_FIGURES.map(id => `brief:${id}`), ...DEFAULT_CARDS, ...DEFAULT_BLOCK_FIELDS.map(id => `block:${id}`)],
      max: BRIEF_FIGURES.length + KPI_CARDS.length + BLOCK_FIELDS.length,
      onChange: selected => { applyVisible(selected); renderKpis(); renderBriefCard(); if (state.wall && !state.wall.closed) paintWall(state.wall, wallPayload()); },
    });
    applyVisible(state.customizePanel.selected);
    await refreshData();
    if (can('ai.insights')) fetchBrief();
    else state.elements.brief.hidden = true;
  },
  poll: { interval: 20000, fetch: fetchQueueData },
  async refresh(data) {
    state.docks = data.docks;
    state.hours = data.hours;
    state.records = data.records;
    state.returnLoads = data.returnLoads;
    state.truckTypeNames = data.truckTypeNames || state.truckTypeNames;
    state.truckCapacity = data.truckCapacity || state.truckCapacity;
    state.labour = data.labour ?? state.labour;
  state.shifts = data.shifts ?? state.shifts;
    renderAll();
  },
  destroy() { state.customizePanel?.destroy(); state.detailsModal?.destroy(); state.combineDialog?.destroy(); },
};

startPage(page);
export const { mount, refresh, destroy } = page;
