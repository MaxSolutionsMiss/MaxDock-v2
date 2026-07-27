import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { renderState } from '../ui/empty.js';
import { format } from '../format.js';
import { createCustomizePanel } from '../ui/customize.js';
import { openWall, paintWall } from '../ui/wall.js';
import { pageHead } from '../ui/pagehead.js';

const LATE_GRACE_MINUTES = 15;
const BACK_TO_BACK_MINUTES = 20;
const ACTIVE_STATUSES = new Set(['arrived', 'in_progress']);
const EXPECTED_STATUSES = new Set(['scheduled', 'confirmed']);

const KPI_CARDS = [
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
  elements: {},
  customizePanel: null,
  wall: null,
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const can = permission => state.context?.can?.(permission);

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
  const [scheduleRows, docks, hours, returnLoads] = await Promise.all([
    db.rpc('list_location_schedule', { p_location_id: locationId }, { key: `queue:schedule:${locationId}`, cache: 0, retry: 1 }),
    db.select('docks', q => q.select('id,name,sort_order').eq('location_id', locationId).eq('is_active', true).order('sort_order').order('name'), { key: `queue:docks:${locationId}`, cache: 30000 }),
    db.select('location_operating_hours', q => q.select('is_open,open_time,close_time').eq('location_id', locationId).eq('day_of_week', day).maybeSingle(), { key: `queue:hours:${locationId}:${day}`, cache: 30000 }),
    // Advisory only — a failure here must not take the operational queue down with it.
    db.rpc('list_return_load_opportunities', { p_location_id: locationId, p_date_from: state.date, p_date_to: state.date }, { key: `queue:returns:${locationId}:${state.date}`, cache: 30000, retry: 1 }).catch(() => []),
  ]);
  const records = (scheduleRows || []).map(normalizeRecord).filter(record => record.start_at && format.sameLocalDate(record.start_at, state.date, state.context.location));
  return { docks: docks || [], hours: hours || null, records, returnLoads: returnLoads || [] };
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
    if (state.view === 'expected') return EXPECTED_STATUSES.has(record.status);
    if (state.view === 'onsite') return ACTIVE_STATUSES.has(record.status);
    if (state.view === 'completed') return record.status === 'completed';
    return true;
  });
  return byTab.sort((a, b) => format.compareChronologically(a.start_at, b.start_at));
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

function renderTable() {
  const records = visibleRecords();
  state.elements.tabSummary.textContent = `${state.records.filter(r => r.entry_kind !== 'block').length} movements · updated ${format.currentTimeLabel()}`;
  state.elements.rows.innerHTML = records.map(record => {
    const late = isLate(record);
    const statusText = late ? 'Late' : format.role(record.status);
    const colorVar = late ? 'var(--stop)' : ACTIVE_STATUSES.has(record.status) ? 'var(--ok)' : record.status === 'completed' ? 'var(--ink-faint)' : 'var(--signal)';
    let action = '';
    if (EXPECTED_STATUSES.has(record.status) && can('appointment.update')) action = `<button class="btn btn--quiet btn--sm" type="button" data-arrive="${record.id}">Arrive</button>`;
    else if (ACTIVE_STATUSES.has(record.status) && can('appointment.complete')) action = `<button class="btn btn--quiet btn--sm" type="button" data-complete="${record.id}">Complete</button>`;
    return `<tr>
      <td class="data data--strong">${escapeHtml(format.time(record.start_at, state.context.location))}</td>
      <td class="data">${escapeHtml(record.booking_reference || '—')}</td>
      <td class="data">${escapeHtml(dockName(record.dock_id))}</td>
      <td>${escapeHtml(record.company_name || record.display_counterpart_location_name || record.requester_name || '—')}</td>
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
  const rows = state.docks.map(dock => {
    const cells = hours.map(hour => {
      const count = appointments.filter(record => record.dock_id === dock.id && Math.floor(format.localTimeMinutes(record.start_at, state.context.location) / 60) === hour % 24).length;
      return `<span class="hc" style="--v:${Math.min(5, count)}" title="${count} movement${count === 1 ? '' : 's'}"></span>`;
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
          body: `${format.time(dockRecords[index - 1].start_at, state.context.location)} and ${format.time(dockRecords[index].start_at, state.context.location)} — tight turnaround.`,
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
  return [
    { label: 'Trucks today', value: appointments.length },
    { label: 'Inbound', value: `${inbound.length} · ${skids(inbound)} skids` },
    { label: 'Outbound', value: `${outbound.length} · ${skids(outbound)} skids` },
    { label: 'Still to come', value: expected.length },
    { label: 'On site now', value: onSite.length },
    { label: 'Completed', value: done.length },
    ...(priority.length ? [{ label: 'Priority', value: priority.length, tone: 'signal' }] : []),
    ...(late.length ? [{ label: 'Running late', value: late.length, tone: 'stop' }] : []),
    ...(busiest ? [{ label: 'Busiest hour', value: `${String(busiest[0]).padStart(2, '0')}:00 · ${busiest[1]}` }] : []),
  ];
}

// Two or three sentences someone can read out in a morning meeting, built from the
// schedule rather than a service call, so the brief is never empty.
function localNarrative() {
  const appointments = state.records.filter(record => record.entry_kind !== 'block');
  if (!appointments.length) return 'Nothing is scheduled at this location today.';
  const skids = rows => rows.reduce((sum, row) => sum + Number(row.skid_count || 0), 0);
  const inbound = appointments.filter(record => record.direction === 'inbound');
  const outbound = appointments.filter(record => record.direction === 'outbound');
  const late = appointments.filter(record => isLate(record));
  const priority = appointments.filter(record => record.is_priority);
  const remaining = appointments.filter(record => EXPECTED_STATUSES.has(record.status));
  const heaviest = [...appointments].sort((a, b) => Number(b.skid_count || 0) - Number(a.skid_count || 0))[0];
  const sentences = [
    `${appointments.length} truck${appointments.length === 1 ? '' : 's'} today — ${inbound.length} in with ${skids(inbound)} skids and ${outbound.length} out with ${skids(outbound)}.`,
    remaining.length
      ? `${remaining.length} still to arrive${priority.length ? `, ${priority.length} of them priority` : ''}.`
      : 'Everything booked has already arrived or finished.',
  ];
  if (late.length) sentences.push(`${late.length} running late — check ${late.slice(0, 2).map(record => record.booking_reference || 'an unreferenced booking').join(' and ')}.`);
  else if (heaviest && Number(heaviest.skid_count || 0) > 0) sentences.push(`Heaviest load is ${heaviest.booking_reference || 'an unreferenced booking'} at ${heaviest.skid_count} skids.`);
  return sentences;
}

function renderBriefCard() {
  const host = state.elements.brief;
  const figures = briefFigures()
    .map(item => `<div class="brieffig${item.tone ? ` brieffig--${item.tone}` : ''}"><span class="brieffig__v">${escapeHtml(String(item.value))}</span><span class="brieffig__l">${escapeHtml(item.label)}</span></div>`)
    .join('');
  const points = [...localNarrative(), ...(state.brief?.brief?.summary ? [state.brief.brief.summary] : [])];
  const narrative = state.briefLoading
    ? '<span class="brief__x">Generating today’s narrative…</span>'
    : `<ul class="briefpoints">${points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>${state.brief?.brief ? `<span class="tag tag--quiet">${escapeHtml(state.brief.mode === 'ai' ? 'AI-generated' : 'MaxDock rules analysis')}</span>` : ''}`;
  host.innerHTML = `<div class="brief__head"><span class="brief__ico">AI</span><div class="brief__t">${escapeHtml(state.context.location.name)} · today at a glance</div><button class="linkBtn" type="button" data-share-brief style="margin-left:auto">Share with team</button></div>
    <div class="brieffigs">${figures}</div>
    <div class="brief__body">${narrative}</div>`;
}

function shareBrief() {
  const brief = state.brief?.brief || { summary: '' };
  const lines = [
    ...briefFigures().map(item => `${item.label}: ${item.value}`),
    '',
    ...localNarrative(),
    brief.summary,
    '',
    ...(brief.pressures || []).map(item => `• ${item}`),
    ...(brief.actions || []).map(item => `• ${item.action}`),
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
      title: record.company_name || record.display_counterpart_location_name || record.requester_name || 'Scheduled movement',
      subtitle: record.booking_reference || '',
      meta: record.booking_reference || '',
      note: `${format.role(record.status || '')}${late ? ' · LATE' : ''}`,
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
  renderAll();
  if (state.wall && !state.wall.closed) paintWall(state.wall, wallPayload());
}

async function changeStatus(appointmentId, newStatus) {
  try {
    await db.rpc('change_appointment_status', { p_appointment_id: appointmentId, p_new_status: newStatus, p_reason: null }, { key: `queue:status:${appointmentId}:${crypto.randomUUID()}`, retry: 0 });
    db.invalidate('queue:schedule:');
    db.invalidate('board:schedule:');
    toast(newStatus === 'arrived' ? 'Marked arrived.' : 'Marked complete.', 'success');
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
        <div class="heat"><h3 class="heat__t">Dock heatmap</h3><div class="heatgrid" data-heat></div><p class="hint">Darker = busier.</p></div>
        <div class="watch" style="margin-top:var(--s3)"><h3 class="watch__t">Watch for</h3><div data-watch></div></div>
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
    if (event.target.closest('[data-customize]')) state.customizePanel.open(event.target.closest('[data-customize]'));
    const tab = event.target.closest('[data-tabs] button');
    if (tab) {
      state.view = tab.dataset.view;
      for (const item of root.querySelectorAll('[data-tabs] button')) item.setAttribute('aria-pressed', String(item === tab));
      renderTable();
    }
    const arrive = event.target.closest('[data-arrive]');
    if (arrive) changeStatus(arrive.dataset.arrive, 'arrived');
    const complete = event.target.closest('[data-complete]');
    if (complete) changeStatus(complete.dataset.complete, 'completed');
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
    state.customizePanel = await createCustomizePanel({
      preferenceKey: 'queue-cards',
      options: KPI_CARDS.map(card => ({ id: card.id, label: card.label })),
      defaultIds: DEFAULT_CARDS,
      max: KPI_CARDS.length,
      onChange: selected => { state.visibleCards = selected; renderKpis(); },
    });
    state.visibleCards = state.customizePanel.selected;
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
    renderAll();
  },
  destroy() { state.customizePanel?.destroy(); },
};

startPage(page);
export const { mount, refresh, destroy } = page;
