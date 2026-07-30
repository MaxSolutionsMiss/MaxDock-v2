// What each role sees, arranged on the settings screen and read back off the rail.
//
// The static gate beside this one proves the rules. This proves the behaviour, in
// the only order that matters: a rail that is untouched by default, a tick that
// comes off, and the link gone from the role it was taken from and still there for
// the role that must never lose it.
const { chromium } = await import('playwright')
  .catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8738;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(PORT, resolve));
const STUB = fs.readFileSync(path.join(ROOT, 'scripts/audit-supabase-stub.js'), 'utf8');

// The live permission set for a Coordinator, so the rail under test is the one the
// application actually produces rather than one invented for the test.
const COORDINATOR = ['ai.insights', 'appointment.assign', 'appointment.cancel_own', 'appointment.complete', 'appointment.create', 'appointment.update', 'appointment.view', 'appointment.view_own', 'audit.view', 'dock.view', 'location.view', 'notifications.view', 'operations.queue.view', 'reports.view', 'appointment.check_in'];

const failures = [];
const check = (ok, detail) => { if (!ok) failures.push(detail); return ok; };
const crashes = [];

const browser = await chromium.launch();

async function openPage({ role = null, permissions = null, hidden = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'America/Toronto', locale: 'en-CA' });
  await context.addInitScript(`globalThis.__auditRole = ${JSON.stringify(role ? { role, permissions } : null)};`
    + `globalThis.__auditHiddenPages = ${JSON.stringify(hidden)};`);
  await context.addInitScript(STUB);
  await context.route('**/cdn.jsdelivr.net/**', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => crashes.push(String(error)));
  return { context, page };
}
const railOf = page => page.$$eval('.rail__link', links => links.map(link => link.textContent.trim()));

// ── Untouched by default ──────────────────────────────────────────────────────
{
  const { context, page } = await openPage();
  await page.goto(`http://127.0.0.1:${PORT}/app/settings.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-section]', { timeout: 15000 });
  const rail = await railOf(page);
  check(rail.includes('Reports') && rail.includes('Dock board') && rail.includes('Settings'),
    `A rail with nothing hidden must be the whole rail. It was: ${JSON.stringify(rail)}`);

  const sections = await page.$$eval('[data-section]', items => items.map(item => item.textContent.trim()));
  check(sections.includes('What each role sees'), `A System Admin has no window for arranging rails. Sections: ${JSON.stringify(sections)}`);

  // ── The grid says which of those are even possible ──────────────────────────
  await page.click('[data-section="roles"]');
  await page.waitForSelector('[data-section-form="roles"] table', { timeout: 8000 });
  const rows = await page.$$eval('[data-section-form="roles"] tbody tr', trs => trs.map(tr => tr.querySelector('td')?.textContent.trim()));
  check(rows.length >= 8, `The grid should list every rail page. It listed: ${JSON.stringify(rows)}`);
  check(rows.includes('Dock board') && rows.includes('Data integration'), 'The grid does not list the whole rail.');

  // A page a role cannot open is a dash, not an empty box — the two say different
  // things and an empty box would say the wrong one.
  const coordinatorSettings = await page.$$eval('[data-section-form="roles"] tbody tr', (trs) => {
    const row = trs.find(tr => tr.querySelector('td')?.textContent.trim() === 'Settings');
    return row ? [...row.querySelectorAll('td')].slice(1).map(td => (td.querySelector('input') ? 'box' : td.textContent.trim())) : null;
  });
  check(JSON.stringify(coordinatorSettings) === JSON.stringify(['box', 'box', '—']),
    `Settings must be a dash for a Coordinator and a box for the two roles that hold settings.view. It was: ${JSON.stringify(coordinatorSettings)}`);

  // ── Take Reports off the Coordinator's rail ─────────────────────────────────
  check(await page.locator('[data-section-form="roles"] [type="submit"]').isDisabled(),
    'The roles window is editable before Edit was pressed.');
  await page.locator('[data-section-form="roles"] [data-edit-section]').click();
  const box = page.locator('[data-role-page="coordinator"][value="reports"]');
  check(await box.isChecked(), 'Reports is not ticked for a Coordinator to begin with.');
  await box.uncheck();
  await page.locator('[data-section-form="roles"] [type="submit"]').click();
  await page.waitForTimeout(900);

  const saved = await page.evaluate(() => globalThis.__savedVisibility || []);
  const coordinator = saved.filter(call => call.p_role_code === 'coordinator').at(-1);
  check(JSON.stringify(coordinator?.p_hidden_page_codes) === JSON.stringify(['reports']),
    `The Coordinator's hidden list is wrong: ${JSON.stringify(coordinator?.p_hidden_page_codes)}`);
  // Every role is sent, so a page added to the rail later cannot end up half set up.
  check(saved.some(call => call.p_role_code === 'site_admin') && saved.some(call => call.p_role_code === 'shipping_manager'),
    'Saving must state every configurable role, not only the one that changed.');
  check(!saved.some(call => call.p_role_code === 'system_admin'),
    'A System Admin\'s rail was sent for saving. It is not configurable.');
  await context.close();
}

// ── The Coordinator loses the link ────────────────────────────────────────────
{
  const { context, page } = await openPage({ role: 'coordinator', permissions: COORDINATOR, hidden: [['coordinator', 'reports']] });
  await page.goto(`http://127.0.0.1:${PORT}/app/board.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const rail = await railOf(page);
  check(!rail.includes('Reports'), `A Coordinator with Reports hidden still has the link: ${JSON.stringify(rail)}`);
  check(rail.includes('Dock board') && rail.includes('Operations queue'),
    `Hiding one page must not disturb the rest of the rail: ${JSON.stringify(rail)}`);
  // Not by permission — the role still holds reports.view, which is what makes this
  // a tidiness layer rather than a lock.
  check(await page.evaluate(() => Boolean(globalThis.__auditRole?.permissions?.includes('reports.view'))),
    'This case no longer proves anything: the Coordinator has lost reports.view as well.');
  await context.close();
}

// ── And the System Admin never does ───────────────────────────────────────────
{
  const { context, page } = await openPage({ hidden: [['system_admin', 'reports'], ['system_admin', 'settings']] });
  await page.goto(`http://127.0.0.1:${PORT}/app/board.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const rail = await railOf(page);
  check(rail.includes('Reports') && rail.includes('Settings'),
    `A System Admin must see everything however the table is written. The rail was: ${JSON.stringify(rail)}`);
  await context.close();
}

await browser.close();
server.close();

if (crashes.length) failures.push(...crashes.map(error => `Uncaught page error: ${error}`));
if (failures.length) {
  console.error('\nverify-rail-end-to-end failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error('');
  process.exit(1);
}
console.log('Per-role rail verification passed: arranged in Settings, gone from the role, never from a System Admin.');
