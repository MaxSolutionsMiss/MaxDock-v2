import { startPage } from '../router.js';
import { db } from '../db.js';
import { toast } from '../ui/toast.js';
import { renderState } from '../ui/empty.js';
import { pageHead } from '../ui/pagehead.js';
import { createAppointmentImport } from '../ui/appointment-import.js';
import { format } from '../format.js';

const DATABASE_TYPES = [
  ['sql_server', 'SQL Server'],
  ['postgresql', 'PostgreSQL'],
  ['mysql', 'MySQL'],
  ['oracle', 'Oracle'],
  ['other', 'Other'],
];

// Two jobs, not three. How the MIS feed is configured is not a separate subject
// from whether it is connected — it is the same row on the Connections list, so
// the settings open under it rather than sitting behind their own nav item an
// administrator has to know to go and find.
const SECTIONS = [
  { id: 'connections', label: 'Connections' },
  { id: 'import', label: 'Inventory import' },
  // A sheet of loads. It began on the dock board, where it was the fifth button in
  // the controls band and the reason that band wrapped. While the trial is finding
  // its feet, importing a fortnight of somebody's appointments is an administrator's
  // job rather than something left on the screen a coordinator works from all day.
  { id: 'appointments', label: 'Appointment import' },
];

const state = {
  context: null,
  isSystemAdmin: false,
  settings: null,
  runs: [],
  locations: [],
  section: 'connections',
  importDialog: null,
  reference: null,
  // null until an administrator opens or closes it themselves; before that the
  // panel follows whether the feed is on, so a connected feed shows its settings.
  misOpen: null,
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

// The one question this page kept failing to answer: once the feed is switched on,
// where does the data actually come from? It is one of two things and the page now
// says which, in the words an administrator would use.
function feedExplanation(syncMode) {
  return syncMode === 'secure_bridge'
    ? 'MaxDock reads it. Once a day at the sync time it opens the table or view named below in your MIS database and takes a snapshot. Nothing is uploaded by hand.'
    : 'You feed it. Export a snapshot from your MIS and upload the file under Inventory import. MaxDock never connects to your database in this mode.';
}

function renderConnections() {
  const enabled = state.settings.is_enabled;
  const open = state.misOpen === null ? Boolean(enabled) : state.misOpen;
  const lastSuccess = state.settings.last_success_at ? format.timestamp(state.settings.last_success_at, state.context.location) : 'Never run';
  return `<div class="card">
    <h3 class="card__title">Connections</h3>
    <div class="integ">
      <span class="integ__ico">MIS</span>
      <div><div class="integ__name">MIS inventory feed</div><div class="integ__meta">${enabled ? `Last import ${escapeHtml(lastSuccess)}` : 'Not enabled'} · ${escapeHtml(state.settings.sync_mode === 'secure_bridge' ? 'Secure database bridge' : 'Manual CSV import')}</div></div>
      <span class="integ__st"><button class="linkBtn" type="button" data-mis-toggle>${open ? 'Hide settings' : 'Settings'}</button><button type="button" class="switch ${enabled ? '' : 'switch--off'}" data-feed-switch aria-pressed="${Boolean(enabled)}" aria-label="MIS inventory feed enabled"></button></span>
    </div>
    ${open ? `<div class="integ__panel">${renderMisForm()}</div>` : ''}
    <div class="integ">
      <span class="integ__ico">@</span>
      <div><div class="integ__name">Transactional email</div><div class="integ__meta">No provider connected</div></div>
      <span class="integ__st"><span class="tag tag--stop">Not configured</span></span>
    </div>
    <div class="integ">
      <span class="integ__ico">QR</span>
      <div><div class="integ__name">Check-in codes</div><div class="integ__meta">Generated in the browser</div></div>
      <span class="integ__st"><span class="tag tag--quiet">Partial</span></span>
    </div>
  </div>`;
}

function renderMisForm() {
  const s = state.settings;
  const isBridge = s.sync_mode === 'secure_bridge';
  return `<form data-mis-form>
      <p class="hint hint--measure" data-feed-explanation>${escapeHtml(feedExplanation(s.sync_mode))}</p>
      <div class="frow">
        <div class="field field--sm"><span class="field__label">Database type</span><select class="select" name="database_type">${DATABASE_TYPES.map(([code, label]) => `<option value="${code}" ${s.database_type === code ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <div class="field field--sm"><span class="field__label">Sync mode</span><select class="select" name="sync_mode" data-sync-mode>
          <option value="manual_csv" ${s.sync_mode === 'manual_csv' ? 'selected' : ''}>Manual CSV import</option>
          <option value="secure_bridge" ${isBridge ? 'selected' : ''}>Secure database bridge</option>
        </select></div>
        <div class="field field--xs"><span class="field__label">Daily sync time</span><input class="input" type="time" name="daily_sync_time" value="${escapeHtml(s.daily_sync_time || '05:00')}"></div>
      </div>
      <div class="frow" data-bridge-fields ${isBridge ? '' : 'hidden'}>
        <div class="field field--md"><span class="field__label">Server name</span><input class="input" name="server_name" value="${escapeHtml(s.server_name || '')}"></div>
        <div class="field field--xs"><span class="field__label">Port</span><input class="input" type="number" min="1" max="65535" name="server_port" value="${s.server_port ?? ''}"></div>
        <div class="field field--sm"><span class="field__label">Database name</span><input class="input" name="database_name" value="${escapeHtml(s.database_name || '')}"></div>
      </div>
      <div class="frow" data-bridge-fields ${isBridge ? '' : 'hidden'}>
        <div class="field field--md"><span class="field__label">Source table / view name</span><input class="input" name="source_name" value="${escapeHtml(s.source_name || '')}"></div>
        <div class="field field--md"><span class="field__label">Credential secret name</span><input class="input" name="credential_secret_name" value="${escapeHtml(s.credential_secret_name || '')}" placeholder="e.g. mis-db-password"></div>
      </div>
      <p class="hint" data-bridge-fields ${isBridge ? '' : 'hidden'}>The credential itself is never entered here — this is only the name of a secret stored server-side. The secure bridge is not active until a real network route and credential are configured with a MaxDock administrator.</p>
      <div class="form-actions"><button class="btn btn--primary" type="submit">Save</button></div>
    </form>`;
}

function renderImport() {
  return `<div class="card">
    <h3 class="card__title">Inventory snapshot import<button class="btn btn--quiet btn--sm" type="button" data-download-template">Download CSV template</button></h3>
    <p class="hint">Up to 1,000 rows. Download the template for the column names and location codes.</p>
    <div class="inline-controls">
      <label class="field"><span class="field__label">CSV file</span><input class="input" type="file" accept=".csv,text/csv" data-import-file></label>
      <button class="btn btn--primary" type="button" data-run-import>Run import now</button>
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

// The import itself is the shared dialog every other screen would have used, opened
// from here. What this section draws is why you would open it, and for which site —
// the dialog books into one location and the picker in the top bar is what says which.
function renderAppointmentImport() {
  return `<div class="card">
    <h3 class="card__title">Appointment import</h3>
    <p class="hint hint--wide">A spreadsheet of loads, booked one at a time through the ordinary booking — so notice periods, opening hours, capacity, direction windows and dock choice all apply, and a row that would be turned down at the counter is turned down here and says why. Nothing is booked until every row has been read back on screen with a verdict against it.</p>
    <p class="hint hint--wide">Loads are booked into <b>${escapeHtml(state.context.location?.name || 'the selected site')}</b>, which is the site chosen in the top bar. A Max site named at the other end of a row books the run at both ends.</p>
    <div class="form-actions"><button class="btn btn--primary" type="button" data-open-appointment-import>Import appointments</button></div>
  </div>`;
}

function renderSection() {
  if (state.section === 'import') return `${renderImport()}${renderRuns()}`;
  if (state.section === 'appointments') return renderAppointmentImport();
  return renderConnections();
}

function render() {
  state.elements.nav.innerHTML = SECTIONS.map(section => `<button type="button" data-section="${section.id}" aria-current="${section.id === state.section}">${section.label}</button>`).join('');
  state.elements.panel.innerHTML = renderSection();
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

async function setFeedEnabled(enabled) {
  const previous = state.settings;
  try {
    state.settings = await db.rpc('admin_save_mis_integration_settings', {
      p_database_type: previous.database_type,
      p_server_name: previous.server_name || null,
      p_server_port: previous.server_port ?? null,
      p_database_name: previous.database_name || null,
      p_source_name: previous.source_name || null,
      p_sync_mode: previous.sync_mode,
      p_daily_sync_time: previous.daily_sync_time,
      p_is_enabled: enabled,
      p_credential_secret_name: previous.credential_secret_name || null,
    }, { key: `data:feed:${crypto.randomUUID()}`, retry: 0 });
    render();
    toast(`MIS inventory feed ${enabled ? 'enabled' : 'turned off'}.`, 'success');
  } catch (error) {
    state.settings = previous;
    render();
    toast(error.userMessage || error.message || 'The MIS feed could not be changed.', 'error');
  }
}

async function saveMisSettings(event) {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  // On or off is the switch on the connection row, not a second switch buried in
  // the form saying the same thing in a different place.
  const enabled = Boolean(state.settings.is_enabled);
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

async function loadEnabledTypes(mappingTable, codeColumn, masterTable) {
  const locationId = state.context.location.id;
  const mappings = await db.select(mappingTable, query => query.select(codeColumn).eq('location_id', locationId).eq('is_active', true), {
    key: `data:${mappingTable}:${locationId}`, cache: 300000, retry: 1,
  });
  const codes = (mappings || []).map(row => row[codeColumn]);
  if (!codes.length) return [];
  return db.select(masterTable, query => query.select('code,name,sort_order').in('code', codes).eq('is_active', true).order('sort_order'), {
    key: `data:${masterTable}:${locationId}`, cache: 300000, retry: 1,
  });
}

async function openAppointmentImport(trigger) {
  if (!state.reference) {
    const [appointmentTypes, truckTypes, handlingTypes] = await Promise.all([
      loadEnabledTypes('location_appointment_types', 'appointment_type_code', 'appointment_types'),
      loadEnabledTypes('location_truck_types', 'truck_type_code', 'truck_types'),
      loadEnabledTypes('location_handling_types', 'handling_type_code', 'handling_types'),
    ]);
    state.reference = { appointmentTypes: appointmentTypes || [], truckTypes: truckTypes || [], handlingTypes: handlingTypes || [] };
  }
  if (!state.importDialog) {
    state.importDialog = createAppointmentImport({
      location: state.context.location,
      // Only the sites this account can reach: a Max site at the other end of a row
      // books the run at both ends, and offering one it has no access to would be a
      // row certain to be refused.
      locations: state.context.locations || [],
      reference: () => state.reference,
      onDone: async () => { await fetchAll(); render(); },
    });
  }
  state.importDialog.open(trigger);
}

function wireEvents(root) {
  root.addEventListener('click', event => {
    if (event.target.closest('[data-print]')) { globalThis.print(); return; }
    const openImport = event.target.closest('[data-open-appointment-import]');
    if (openImport) { openAppointmentImport(openImport); return; }
    const section = event.target.closest('[data-section]');
    if (section) { state.section = section.dataset.section; render(); return; }
    if (event.target.closest('[data-run-import]')) { runImport(); return; }
    if (event.target.closest('[data-download-template]')) { downloadTemplate(); return; }
    if (event.target.closest('[data-mis-toggle]')) {
      state.misOpen = !(state.misOpen === null ? Boolean(state.settings.is_enabled) : state.misOpen);
      render();
      return;
    }
    const feedSwitch = event.target.closest('[data-feed-switch]');
    if (feedSwitch && !feedSwitch.disabled) {
      setFeedEnabled(feedSwitch.getAttribute('aria-pressed') !== 'true');
      return;
    }
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
      const explanation = root.querySelector('[data-feed-explanation]');
      if (explanation) explanation.textContent = feedExplanation(event.target.value);
    }
  });
  root.addEventListener('submit', event => {
    if (event.target.matches('[data-mis-form]')) saveMisSettings(event);
  });
}

const page = {
  code: 'data',
  permission: 'system.manage',
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
    context.pageRoot.innerHTML = `${pageHead('Data integration', { subtitle: 'System · MIS imports & connections', actions: ['print'] })}
      <div class="setlayout">
        <nav class="setnav" data-data-nav aria-label="Data integration sections"></nav>
        <div class="setpanel" data-data-panel></div>
      </div>`;
    state.elements = {
      nav: context.pageRoot.querySelector('[data-data-nav]'),
      panel: context.pageRoot.querySelector('[data-data-panel]'),
    };
    state.elements.host = state.elements.panel;
    wireEvents(context.pageRoot);
    await fetchAll();
    render();
  },
  refresh() {},
  destroy() { state.importDialog?.destroy(); state.importDialog = null; },
};

startPage(page);
export const { mount, refresh, destroy } = page;
