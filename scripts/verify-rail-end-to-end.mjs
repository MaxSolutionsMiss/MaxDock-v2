// Role access, arranged under Users and read back off the rail.
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
  // Users, not Settings: a role applies to every site, and Settings is where one
  // site's operating rules live.
  await page.goto(`http://127.0.0.1:${PORT}/app/users.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-section]', { timeout: 15000 });
  const rail = await railOf(page);
  check(rail.includes('Reports') && rail.includes('Dock board') && rail.includes('Settings'),
    `A rail with nothing hidden must be the whole rail. It was: ${JSON.stringify(rail)}`);

  const sections = await page.$$eval('[data-section]', items => items.map(item => item.textContent.trim()));
  check(JSON.stringify(sections) === JSON.stringify(['Users', 'Role access']),
    `Users should carry its own two sections. It carries: ${JSON.stringify(sections)}`);

  // ── One row a role, not a matrix nobody reads ───────────────────────────────
  await page.click('[data-section="roles"]');
  await page.waitForSelector('[data-edit-role]', { timeout: 8000 });
  const roleRows = await page.$$eval('[data-edit-role]', items => items.map(item => item.dataset.editRole));
  check(roleRows.includes('system_admin') && roleRows.includes('coordinator'),
    `Every role should be listed. Listed: ${JSON.stringify(roleRows)}`);

  // A System Admin can be looked at and not changed.
  await page.locator('[data-edit-role="system_admin"]').click();
  await page.waitForSelector('#role-access-title', { state: 'visible', timeout: 8000 });
  check(await page.locator('[data-role-save]').isHidden(), 'A System Admin is offered a save action.');
  check(/cannot be changed/.test(await page.locator('[data-role-locked]').textContent() || ''),
    'The dialog does not say why a System Admin cannot be changed.');
  await page.locator('.scrim:not([hidden]) [data-role-close]').first().click();
  await page.waitForTimeout(300);

  // ── Take Reports off the Coordinator's rail ─────────────────────────────────
  await page.locator('[data-edit-role="coordinator"]').click();
  await page.waitForSelector('#role-access-title', { state: 'visible', timeout: 8000 });
  const dialog = page.locator('.scrim:not([hidden])', { has: page.locator('#role-access-title') });
  // Both halves are on screen, and in this order: what it may do is the boundary,
  // what it sees depends on it.
  const headings = await dialog.locator('.watch__t').allTextContents();
  check(JSON.stringify(headings) === JSON.stringify(['What it sees', 'What it may do']),
    `The dialog must carry both halves, in that order. It carries: ${JSON.stringify(headings)}`);
  // The permissions are grouped by subject rather than listed as twenty-seven codes.
  const groups = await dialog.locator('fieldset legend').allTextContents();
  check(groups.length >= 4, `The permissions should be grouped by subject. Groups: ${JSON.stringify(groups)}`);

  const screen = dialog.locator('[data-role-screen="reports"]');
  check(await screen.isChecked(), 'Reports is not ticked for a Coordinator to begin with.');
  // Settings is a screen a Coordinator holds no permission for, so it cannot be
  // ticked into existence here.
  check(await dialog.locator('[data-role-screen="settings"]').isDisabled(),
    'A screen the role has no permission for is offered as though a tick could grant it.');
  await screen.uncheck();

  // Removing the permission behind a screen takes the screen with it, rather than
  // leaving a rail arranged for access the role does not have.
  await dialog.locator('[data-role-permission="reports.view"]').uncheck();
  await page.waitForTimeout(250);
  check(await dialog.locator('[data-role-screen="reports"]').isDisabled(),
    'Removing reports.view left the Reports screen still tickable.');

  // Put it back, so what is saved is a hidden screen rather than a lost permission.
  await dialog.locator('[data-role-permission="reports.view"]').check();
  await page.waitForTimeout(250);
  await dialog.locator('[data-role-screen="reports"]').uncheck();
  await dialog.locator('[data-role-save]').click();
  await page.waitForTimeout(900);

  const saved = await page.evaluate(() => globalThis.__savedVisibility || []);
  const coordinator = saved.filter(call => call.p_role_code === 'coordinator').at(-1);
  check(JSON.stringify(coordinator?.p_hidden_page_codes) === JSON.stringify(['reports']),
    `The Coordinator's hidden list is wrong: ${JSON.stringify(coordinator?.p_hidden_page_codes)}`);
  const permissions = await page.evaluate(() => globalThis.__savedPermissions || []);
  const held = permissions.filter(call => call.p_role_code === 'coordinator').at(-1);
  check((held?.p_permission_codes || []).includes('reports.view'),
    'The permission behind a merely hidden screen must be left alone.');
  check(!saved.some(call => call.p_role_code === 'system_admin') && !permissions.some(call => call.p_role_code === 'system_admin'),
    'A System Admin was sent for saving. It is not configurable.');
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
console.log('Role access verification passed: arranged under Users, gone from the role, never from a System Admin.');
