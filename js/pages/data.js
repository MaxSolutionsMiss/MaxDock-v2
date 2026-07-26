import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { renderState } from '../ui/empty.js';
import { pageHead } from '../ui/pagehead.js';
import { format } from '../format.js';

const DATABASE_TYPES = [
  ['sql_server', 'SQL Server'],
  ['postgresql', 'PostgreSQL'],
  ['mysql', 'MySQL'],
  ['oracle', 'Oracle'],
  ['other', 'Other'],
];

const state = {
  context: null,
  isSystemAdmin: false,
  settings: null,
  runs: [],
  locations: [],
  elements: {},
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

async function fetchAll() {
  const [settings, runs, locations] = await Promise.all([
    db.rpc('admin_get_mis_integration_settings', {}, { key: 'data:settings', cache: 0 }),
    db.rpc('admin_list_mis_import_runs', {}, { key: 'data:runs', cache: 0 }),
    db.select('locations', q => q.select('code,name').eq('is_active', true).order('name'), { key: 'locations:codes', cache: 300000 }),
  ]);
  state.settings = settings || {};
  state.runs = runs || [];
  state.locations = locations || [];
}

function renderConnections() {
  const enabled = state.settings.is_enabled;
  const lastSuccess = state.settings.last_success_at ? format.timestamp(state.settings.last_success_at, state.context.location) : 'Never run';
  return `<div class="card">
    <h3 class="card__title">Connections</h3>
    <div class="integ">
      <span class="integ__ico">MIS</span>
      <div><div class="integ__name">MIS inventory feed</div><div class="integ__meta">${enabled ? `Enabled · last import ${escapeHtml(lastSuccess)}` : 'Not enabled'}</div></div>
      <span class="integ__st">${enabled ? '<span class="tag tag--ok">Enabled</span>' : '<span class="tag tag--quiet">Off</span>'}</span>
    </div>
    <div class="integ">
      <span class="integ__ico">@</span>
      <div><div class="integ__name">Transactional email</div><div class="integ__meta">No provider connected — invitation links and confirmations are delivered by copying a link or opening a mailto draft</div></div>
      <span class="integ__st"><span class="tag tag--stop">Not configured</span></span>
    </div>
    <div class="integ">
      <span class="integ__ico">QR</span>
      <div><div class="integ__name">Check-in codes</div><div class="integ__meta">Generated locally in the browser, no third-party service — a dedicated scan-in verification page has not been built yet</div></div>
      <span class="integ__st"><span class="tag tag--quiet">Partial</span></span>
    </div>
  </div>`;
}

function renderMisForm() {
  const s = state.settings;
  const isBridge = s.sync_mode === 'secure_bridge';
  return `<div class="card">
    <form data-mis-form>
      <h3 class="card__title">MIS connection settings<button class="btn btn--primary btn--sm" type="submit">Save</button></h3>
      <div class="frow">
        <div class="field field--md"><span class="field__label">Database type</span><select class="select" name="database_type">${DATABASE_TYPES.map(([code, label]) => `<option value="${code}" ${s.database_type === code ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <div class="field field--md"><span class="field__label">Sync mode</span><select class="select" name="sync_mode" data-sync-mode>
          <option value="manual_csv" ${s.sync_mode === 'manual_csv' ? 'selected' : ''}>Manual CSV import</option>
          <option value="secure_bridge" ${isBridge ? 'selected' : ''}>Secure database bridge</option>
        </select></div>
        <div class="field field--md"><span class="field__label">Daily sync time</span><input class="input" type="time" name="daily_sync_time" value="${escapeHtml(s.daily_sync_time || '05:00')}"></div>
      </div>
      <div class="frow" data-bridge-fields ${isBridge ? '' : 'hidden'}>
        <div class="field field--lg"><span class="field__label">Server name</span><input class="input" name="server_name" value="${escapeHtml(s.server_name || '')}"></div>
        <div class="field field--xs"><span class="field__label">Port</span><input class="input" type="number" min="1" max="65535" name="server_port" value="${s.server_port ?? ''}"></div>
        <div class="field field--md"><span class="field__label">Database name</span><input class="input" name="database_name" value="${escapeHtml(s.database_name || '')}"></div>
      </div>
      <div class="frow" data-bridge-fields ${isBridge ? '' : 'hidden'}>
        <div class="field field--lg"><span class="field__label">Source table / view name</span><input class="input" name="source_name" value="${escapeHtml(s.source_name || '')}"></div>
        <div class="field field--lg"><span class="field__label">Credential secret name</span><input class="input" name="credential_secret_name" value="${escapeHtml(s.credential_secret_name || '')}" placeholder="e.g. mis-db-password"></div>
      </div>
      <p class="hint">The credential itself is never entered here — this is only the name of a secret stored server-side. The secure bridge is not active until a real network route and credential are configured with a MaxDock administrator.</p>
      <div class="setrow"><div><div class="setrow__t">Enabled</div><div class="setrow__d">Turn the MIS feed on for this connection mode</div></div><button type="button" class="switch ${s.is_enabled ? '' : 'switch--off'}" data-enabled-switch aria-pressed="${Boolean(s.is_enabled)}" aria-label="MIS feed enabled"></button></div>
    </form>
  </div>`;
}

function renderImport() {
  const codes = state.locations.map(location => `${location.code} (${location.name})`).join(', ');
  return `<div class="card">
    <h3 class="card__title">Inventory snapshot import<button class="btn btn--quiet btn--sm" type="button" data-download-template">Download CSV template</button></h3>
    <p class="hint">Columns: <code>location_code, snapshot_at, occupied_skids, total_skid_capacity, reserve_skids, notes</code>. Location codes: ${escapeHtml(codes)}. Up to 1,000 rows per import.</p>
    <div class="frow">
      <label class="field field--xl"><span class="field__label">CSV file</span><input class="input" type="file" accept=".csv,text/csv" data-import-file></label>
      <div class="field field--md" style="justify-content:end"><button class="btn btn--primary btn--block" type="button" data-run-import>Run import now</button></div>
    </div>
    <p class="form-message" data-import-message aria-live="polite"></p>
  </div>`;
}

function renderRuns() {
  const rows = state.runs.map(run => `<tr>
    <td class="data">#${escapeHtml(run.id)}</td>
    <td class="data">${escapeHtml(format.timestamp(run.created_at, state.context.location))}</td>
    <td class="data">${escapeHtml(run.file_name || '—')}</td>
    <td class="data">${escapeHtml(run.row_count)}</td>
    <td>${run.status === 'completed' ? '<span class="tag tag--ok">Success</span>' : `<span class="tag tag--stop">${escapeHtml(run.status)}</span>`}</td>
    <td class="data">${escapeHtml(run.imported_by_name)}</td>
  </tr>`).join('') || '<tr><td colspan="6" class="data">No import runs yet.</td></tr>';
  return `<div class="card">
    <h3 class="card__title">Recent import runs</h3>
    <div class="tablewrap"><table class="table"><thead><tr><th>Run</th><th>Started</th><th>File</th><th>Rows</th><th>Result</th><th>By</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

function render() {
  state.elements.host.innerHTML = `${renderConnections()}${renderMisForm()}${renderImport()}${renderRuns()}`;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length);
  if (!lines.length) return [];
  const splitLine = line => {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (inQuotes) {
        if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
        else if (char === '"') inQuotes = false;
        else current += char;
      } else if (char === '"') inQuotes = true;
      else if (char === ',') { cells.push(current); current = ''; }
      else current += char;
    }
    cells.push(current);
    return cells.map(cell => cell.trim());
  };
  const headers = splitLine(lines[0]).map(header => header.toLowerCase());
  return lines.slice(1).map(line => {
    const cells = splitLine(line);
    const row = {};
    headers.forEach((header, index) => { row[header] = cells[index] ?? ''; });
    return row;
  });
}

function downloadTemplate() {
  const sampleCode = state.locations[0]?.code || 'pickering';
  const csv = ['location_code,snapshot_at,occupied_skids,total_skid_capacity,reserve_skids,notes', `${sampleCode},2026-07-26T06:00:00,42,120,10,`].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'maxdock-inventory-template.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function runImport() {
  const fileInput = state.elements.host.querySelector('[data-import-file]');
  const message = state.elements.host.querySelector('[data-import-message]');
  const file = fileInput.files?.[0];
  if (!file) { toast('Choose a CSV file first.', 'error'); return; }
  message.textContent = '';
  message.classList.remove('form-message--success');
  try {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) throw { userMessage: 'The CSV file has no data rows.' };
    const result = await db.rpc('admin_import_inventory_snapshots', { p_rows: rows, p_file_name: file.name }, { key: `data:import:${crypto.randomUUID()}`, retry: 0 });
    db.invalidate('data:runs');
    db.invalidate('data:settings');
    db.invalidate('settings:row:');
    await fetchAll();
    render();
    toast(`Imported ${result.imported_rows} row${result.imported_rows === 1 ? '' : 's'}.`, 'success');
    fileInput.value = '';
  } catch (error) {
    message.textContent = error.userMessage || error.message || 'The import could not be completed.';
    toast(error.userMessage || error.message || 'The import could not be completed.', 'error');
  }
}

async function saveMisSettings(event) {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  const enabled = form.querySelector('[data-enabled-switch]').getAttribute('aria-pressed') === 'true';
  submit.disabled = true;
  try {
    const settings = await db.rpc('admin_save_mis_integration_settings', {
      p_database_type: data.get('database_type'),
      p_server_name: data.get('server_name') || null,
      p_server_port: data.get('server_port') ? Number(data.get('server_port')) : null,
      p_database_name: data.get('database_name') || null,
      p_source_name: data.get('source_name') || null,
      p_sync_mode: data.get('sync_mode'),
      p_daily_sync_time: data.get('daily_sync_time'),
      p_is_enabled: enabled,
      p_credential_secret_name: data.get('credential_secret_name') || null,
    }, { key: `data:save:${crypto.randomUUID()}`, retry: 0 });
    state.settings = settings;
    render();
    toast('MIS settings saved.', 'success');
  } catch (error) {
    toast(error.userMessage || error.message || 'The MIS settings could not be saved.', 'error');
  } finally {
    submit.disabled = false;
  }
}

function wireEvents(root) {
  root.addEventListener('click', event => {
    if (event.target.closest('[data-print]')) { globalThis.print(); return; }
    if (event.target.closest('[data-run-import]')) { runImport(); return; }
    if (event.target.closest('[data-download-template]')) { downloadTemplate(); return; }
    const toggle = event.target.closest('.switch');
    if (toggle && !toggle.disabled) {
      const off = toggle.classList.toggle('switch--off');
      toggle.setAttribute('aria-pressed', String(!off));
    }
  });
  root.addEventListener('change', event => {
    if (event.target.matches('[data-sync-mode]')) {
      const isBridge = event.target.value === 'secure_bridge';
      root.querySelectorAll('[data-bridge-fields]').forEach(field => { field.hidden = !isBridge; });
    }
  });
  root.addEventListener('submit', event => {
    if (event.target.matches('[data-mis-form]')) saveMisSettings(event);
  });
}

const page = {
  code: 'data',
  async mount(context) {
    state.context = context;
    state.isSystemAdmin = context.profile.role_code === 'system_admin';
    document.title = 'Data integration · MaxDock';
    if (!state.isSystemAdmin) {
      context.pageRoot.innerHTML = '<div class="pagehead"><div><h1 class="pagehead__title">Data integration</h1></div></div>';
      renderState(context.pageRoot, {
        type: 'locked',
        title: 'System Admin required',
        message: 'Only a MaxDock System Admin can view or manage data integration settings.',
      });
      return;
    }
    context.pageRoot.innerHTML = `${pageHead('Data integration', { subtitle: 'System · MIS imports & connections', actions: ['print'] })}<div data-data-host></div>`;
    state.elements = { host: context.pageRoot.querySelector('[data-data-host]') };
    wireEvents(context.pageRoot);
    await fetchAll();
    render();
  },
  refresh() {},
  destroy() {},
};

startPage(page);
export const { mount, refresh, destroy } = page;
