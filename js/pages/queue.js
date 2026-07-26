import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { renderState } from '../ui/empty.js';
import { format } from '../format.js';
import { createCustomizePanel } from '../ui/customize.js';

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
  state.elements.kpis.style.gridTemplateColumns = `repeat(${Math.max(1, state.visibleCards.length)},1fr)`;
  state.elements.kpis.innerHTML = KPI_CARDS.filter(card => state.visibleCards.includes(card.id)).map(card => {
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

function renderBriefCard() {
  const host = state.elements.brief;
  if (state.briefLoading) {
    host.innerHTML = `<span class="brief__ico">AI</span><div class="brief__body"><div class="brief__t">Generating today's brief…</div></div>`;
    return;
  }
  if (!state.brief) {
    host.innerHTML = `<span class="brief__ico">AI</span><div class="brief__body"><div class="brief__t">Brief unavailable</div><div class="brief__x">The operations brief could not be generated for this date.</div></div>`;
    return;
  }
  const { brief, mode } = state.brief;
  const modeLabel = mode === 'ai' ? 'AI-generated' : 'MaxDock rules analysis';
  host.innerHTML = `<span class="brief__ico">AI</span><div class="brief__body"><div class="brief__t">${escapeHtml(brief.title || "Today's brief")} <span class="tag tag--quiet">${escapeHtml(modeLabel)}</span></div><div class="brief__x">${escapeHtml(brief.summary || '')}</div></div><button class="brief__x linkBtn" type="button" data-share-brief>Share with team</button>`;
}

function shareBrief() {
  const brief = state.brief?.brief;
  if (!brief) { toast('No brief to share yet.', 'error'); return; }
  const lines = [brief.summary, '', ...(brief.pressures || []).map(item => `• ${item}`), '', ...(brief.actions || []).map(item => `• ${item.action}`)];
  const href = `mailto:?subject=${encodeURIComponent(`${state.context.location.name} operations brief · ${state.date}`)}&body=${encodeURIComponent(lines.join('\n'))}`;
  globalThis.open(href, '_self');
}

function renderAll() {
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

function openBroadcastWindow() {
  const popup = globalThis.open('', 'maxdock-queue-broadcast', 'popup=yes,width=1280,height=760');
  if (!popup) { toast('Allow pop-ups to open the broadcast window.', 'error'); return; }
  const cssHref = new URL('../assets/maxdock.css', globalThis.location.href).href;
  const rows = visibleRecords().slice(0, 18).map(record => `<tr><td>${escapeHtml(dockName(record.dock_id))}</td><td>${escapeHtml(format.time(record.start_at, state.context.location))}</td><td>${escapeHtml(record.booking_reference || 'Appointment')}</td><td><span class="tag ${isLate(record) ? 'tag--stop' : 'tag--quiet'}">${escapeHtml(format.role(record.status))}</span></td></tr>`).join('');
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="en" data-text="larger"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(state.context.location.name)} · Operations queue</title><link rel="stylesheet" href="${cssHref}"></head><body class="wall"><header class="wall__head"><div class="wall__title">${escapeHtml(state.context.location.name)} · Operations queue</div><div class="wall__clock">${escapeHtml(format.currentTimeLabel())}</div></header><table><thead><tr><th>Dock</th><th>Time</th><th>Reference</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Nothing scheduled</td></tr>'}</tbody></table></body></html>`);
  popup.document.close();
}

async function refreshData() {
  const data = await fetchQueueData();
  state.docks = data.docks;
  state.hours = data.hours;
  state.records = data.records;
  state.returnLoads = data.returnLoads;
  renderAll();
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
    <div class="pagehead">
      <div><h1 class="pagehead__title">Operations queue</h1><p class="pagehead__sub" data-subtitle></p></div>
      <div class="pagehead__actions">
        <button class="btn btn--quiet btn--icon" type="button" data-customize title="Customize this page" aria-label="Customize this page"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"></path></svg></button>
        <button class="btn btn--quiet btn--icon" type="button" data-export title="Export CSV" aria-label="Export CSV"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v3h14v-3"></path></svg></button>
        <button class="btn btn--quiet" type="button" data-fullscreen title="Full screen — opens a broadcast window"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path></svg><span>Full screen</span></button>
        ${can('appointment.create') ? '<button class="btn btn--primary" type="button" data-open-booking><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Book appointment</button>' : ''}
      </div>
    </div>
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
      min: 1,
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
