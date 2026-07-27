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
  { id: 'dock-utilisation', label: 'Dock utilisation' },
];

const PRESETS = [
  { id: 'last7', label: 'Past 7 days', days: 7 },
  { id: 'last30', label: 'Past 30 days', days: 30 },
  { id: 'month', label: 'This month', days: null },
  { id: 'custom', label: 'Custom range', days: null },
];

const state = {
  context: null,
  view: 'overview',
  preset: 'last30',
  from: '',
  to: '',
  data: null,
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
  if (presetId === 'last7') { state.from = format.addDaysInput(`${today}T12:00:00Z`, -6, state.context.location); state.to = today; }
  else if (presetId === 'last30') { state.from = format.addDaysInput(`${today}T12:00:00Z`, -29, state.context.location); state.to = today; }
  else if (presetId === 'month') { state.from = `${today.slice(0, 7)}-01`; state.to = today; }
}

async function fetchReport() {
  return db.rpc('get_ai_operations_context', {
    p_location_id: state.context.location.id,
    p_start_date: state.from,
    p_end_date: state.to,
  }, { key: `reports:${state.context.location.id}:${state.from}:${state.to}`, cache: 60000, retry: 1, userMessage: 'The report data could not be loaded.' });
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
  return `<div class="kpis">${cards.map(card => `<article class="kpi ${card.className}"><span class="kpi__label">${escapeHtml(card.label)}</span><span class="kpi__value">${escapeHtml(card.compute(summary))}</span></article>`).join('')}</div>`;
}

function barChart(rows, valueKey, altKey) {
  if (!rows.length) return '<p class="hint">No data in this range.</p>';
  const max = Math.max(1, ...rows.map(row => Math.max(num(row[valueKey]), altKey ? num(row[altKey]) : 0)));
  return `<div class="chart">${rows.map(row => {
    const primary = `<div class="bar" style="height:${(num(row[valueKey]) / max * 100).toFixed(1)}%" title="${escapeHtml(row.date || row.label || row.name)}: ${num(row[valueKey])}"></div>`;
    const secondary = altKey ? `<div class="bar bar--alt" style="height:${(num(row[altKey]) / max * 100).toFixed(1)}%" title="${escapeHtml(row.date || row.label || row.name)}: ${num(row[altKey])}"></div>` : '';
    return primary + secondary;
  }).join('')}</div>`;
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
      <div class="panel__head"><h3 class="panel__title">Appointments per day</h3><div class="panel__actions"><span class="sub">${escapeHtml(state.from)} – ${escapeHtml(state.to)}</span></div></div>
      <div style="padding:var(--s4)">${barChart(byDay, 'appointments')}<p class="hint">Daily booked appointment count, cancellations included.</p></div>
      <div class="panel__scroll">${table(['Date', 'Appointments', 'Cancelled', 'Priority', 'Inbound skids', 'Outbound skids'], byDay.map(row => [row.date, num(row.appointments), num(row.cancelled), num(row.priority), num(row.inbound_skids), num(row.outbound_skids)]))}</div>
    </div>`;
}

function renderTruckFlow() {
  const byVehicle = state.data.by_vehicle || [];
  return `${kpiRow()}
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Vehicle mix</h3><div class="panel__actions"><span class="sub">${escapeHtml(state.from)} – ${escapeHtml(state.to)}</span></div></div>
      <div style="padding:var(--s4)">${barChart(byVehicle, 'appointments')}<p class="hint">Appointments by truck type across the selected range.</p></div>
      <div class="panel__scroll">${table(['Truck type', 'Appointments', 'Skids'], byVehicle.map(row => [row.name, num(row.appointments), num(row.skids)]))}</div>
    </div>`;
}

function renderSkidMovement() {
  const byDay = state.data.by_day || [];
  const s = state.data.summary || {};
  return `${kpiRow()}
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Skid movement per day</h3><div class="panel__actions"><span class="sub">${compact(s.inbound_skids)} in · ${compact(s.outbound_skids)} out</span></div></div>
      <div style="padding:var(--s4)">${barChart(byDay, 'inbound_skids', 'outbound_skids')}<p class="hint">Blue = inbound, green = outbound.</p></div>
      <div class="panel__scroll">${table(['Date', 'Inbound skids', 'Outbound skids', 'Net change'], byDay.map(row => [row.date, num(row.inbound_skids), num(row.outbound_skids), num(row.inbound_skids) - num(row.outbound_skids)]))}</div>
    </div>`;
}

function renderDockUtilisation() {
  const s = state.data.summary || {};
  const byHour = state.data.by_hour || [];
  const compatibility = state.data.compatibility || {};
  const warnings = [];
  if (num(compatibility.docks_without_vehicle_types) > 0) warnings.push(`${compatibility.docks_without_vehicle_types} active dock(s) accept no configured truck type.`);
  if (num(compatibility.vehicle_types_without_docks) > 0) warnings.push(`${compatibility.vehicle_types_without_docks} enabled truck type(s) have no compatible dock.`);
  return `<div class="kpis kpis--4">
      <article class="kpi kpi--signal"><span class="kpi__label">Occupied utilisation</span><span class="kpi__value">${num(s.occupied_utilization_percent).toFixed(1)}<span>%</span></span></article>
      <article class="kpi"><span class="kpi__label">Booked hours</span><span class="kpi__value">${compact(num(s.booked_minutes) / 60)}</span></article>
      <article class="kpi kpi--stop"><span class="kpi__label">Blocked hours</span><span class="kpi__value">${compact(num(s.blocked_minutes) / 60)}</span></article>
      <article class="kpi kpi--out"><span class="kpi__label">Active docks</span><span class="kpi__value">${num(s.active_docks)}</span></article>
    </div>
    <div class="panel panel--fill">
      <div class="panel__head"><h3 class="panel__title">Busiest start hours</h3><div class="panel__actions"><span class="sub">${compact(num(s.available_dock_minutes) / 60)} dock-hours available</span></div></div>
      <div style="padding:var(--s4)">${barChart(byHour, 'appointments')}<p class="hint">Appointment start times across the selected range.</p>
        ${warnings.length ? `<p class="form-message">${warnings.map(escapeHtml).join(' ')}</p>` : ''}</div>
      <div class="panel__scroll">${table(['Hour', 'Appointments', 'Skids'], byHour.map(row => [row.label, num(row.appointments), num(row.skids)]))}</div>
    </div>`;
}

function renderView() {
  if (!state.data) return;
  const renderers = { overview: renderOverview, 'truck-flow': renderTruckFlow, 'skid-movement': renderSkidMovement, 'dock-utilisation': renderDockUtilisation };
  state.elements.host.innerHTML = (renderers[state.view] || renderOverview)();
}

function csvRowsForView() {
  const data = state.data || {};
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
    state.data = await fetchReport();
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
  state.elements.subtitle.textContent = `${state.context.location.name} · ${state.from} – ${state.to}`;
}

function buildShell(root) {
  root.innerHTML = `
    ${pageHead('Reports')}
    ${controlsBar({
      label: 'Report controls',
      lead: '<button class="btn btn--primary btn--sm" type="button" data-apply>Apply</button>',
      filters: `<div class="ctrl-field"><label for="report-view">View</label><select class="select" id="report-view" data-view>${VIEWS.map(view => `<option value="${view.id}">${view.label}</option>`).join('')}</select></div>
      <div class="ctrl-field"><label for="report-preset">Range</label><select class="select" id="report-preset" data-preset>${PRESETS.map(preset => `<option value="${preset.id}">${preset.label}</option>`).join('')}</select></div>
      <div class="ctrl-field"><label for="report-from">From</label><input class="input input--date" type="date" id="report-from" data-from></div>
      <div class="ctrl-field"><label for="report-to">To</label><input class="input input--date" type="date" id="report-to" data-to></div>`,
      actions: ['export', 'print', 'customize'],
    })}
    <div data-report-host></div>`;
  state.elements = {
    root,
    subtitle: root.querySelector('[data-subtitle]'),
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
    document.title = `Reports · ${context.location.name} · MaxDock`;
    buildShell(context.pageRoot);
    wireEvents(context.pageRoot);
    state.customizePanel = await createCustomizePanel({
      preferenceKey: 'report-cards',
      options: KPI_CARDS.map(card => ({ id: card.id, label: card.label })),
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
