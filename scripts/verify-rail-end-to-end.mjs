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
const COORDINATOR = ['ai.insights', 'appointment.assign', 'appointment.cancel_own', 'appointment.check_in', 'appointment.complete', 'appointment.create', 'appointment.update', 'appointment.view', 'appointment.view_own', 'audit.view', 'dock.view', 'location.view', 'notifications.view', 'operations.queue.view', 'reports.view', 'reports.view_dock_hours', 'reports.view_fullness', 'reports.view_overview', 'reports.view_skid_movement', 'reports.view_truck_flow'];

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

// The role dialog shows one subject at a time, chosen from a rail down its side, so a tick has
// to be brought on screen before it can be touched. Walking it this way is the point rather than
// an inconvenience: it is how an administrator reaches the same tick.
async function openGroup(dialog, title) {
  const id = title === 'Screens on the rail' ? 'screens' : title;
  const tab = dialog.locator(`[data-role-section="${id}"]`);
  await tab.click();
  await dialog.locator(`[data-role-section="${id}"][aria-selected="true"]`).waitFor({ timeout: 5000 });
}

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

  // A System Admin can be changed like any other role, except for the way back in.
  // The tick that opens this very page is drawn as fixed rather than left to be
  // unticked and refused on save.
  await page.locator('[data-edit-role="system_admin"]').click();
  await page.waitForSelector('#role-access-title', { state: 'visible', timeout: 8000 });
  const adminDialog = page.locator('.scrim:not([hidden])', { has: page.locator('#role-access-title') });
  check(await page.locator('[data-role-save]').isVisible(), 'A System Admin cannot be saved at all.');
  check(/way back in/.test(await page.locator('[data-role-locked]').textContent() || ''),
    'The dialog does not say which parts of a System Admin are held fast.');
  const usersScreen = adminDialog.locator('[data-role-screen="users"]');
  check(await usersScreen.isChecked() && await usersScreen.isDisabled(),
    'The Users screen must be on and held fast for a System Admin: it is where this dialog lives.');
  await openGroup(adminDialog, 'People and the system');
  const manageUsers = adminDialog.locator('[data-role-permission="user.manage"]');
  check(await manageUsers.isChecked() && await manageUsers.isDisabled(),
    'Manage Users must be held fast for a System Admin: without it nothing here can be undone.');
  await page.locator('.scrim:not([hidden]) [data-role-close]').first().click();
  await page.waitForTimeout(300);

  // ── Take Reports off the Coordinator's rail ─────────────────────────────────
  await page.locator('[data-edit-role="coordinator"]').click();
  await page.waitForSelector('#role-access-title', { state: 'visible', timeout: 8000 });
  const dialog = page.locator('.scrim:not([hidden])', { has: page.locator('#role-access-title') });
  // One subject at a time, chosen from a rail down the side: the screens strip first,
  // because what a role sees depends on what it may do, then a tab a subject. Each one
  // says how much of its subject this role holds without being opened.
  const tabs = (await dialog.locator('[data-role-section]').allTextContents()).map(text => text.replace(/\s+/g, ' ').trim());
  check(/^Screens on the rail/.test(tabs[0] || ''),
    `The screens strip must be the first thing in the dialog. The tabs are: ${JSON.stringify(tabs)}`);
  check(tabs.length >= 5, `The permissions should be grouped by subject. Tabs: ${JSON.stringify(tabs)}`);
  check(tabs.every(tab => /\d+ of \d+$/.test(tab)),
    `Every tab should say how much of its subject the role holds. Tabs: ${JSON.stringify(tabs)}`);

  const screen = dialog.locator('[data-role-screen="reports"]');
  check(await screen.isChecked(), 'Reports is not ticked for a Coordinator to begin with.');
  // Settings is a screen a Coordinator holds no permission for, so it cannot be
  // ticked into existence here.
  check(await dialog.locator('[data-role-screen="settings"]').isDisabled(),
    'A screen the role has no permission for is offered as though a tick could grant it.');
  await screen.uncheck();

  // Removing the permission behind a screen takes the screen with it, rather than
  // leaving a rail arranged for access the role does not have.
  await openGroup(dialog, 'Reports and history');
  await dialog.locator('[data-role-permission="reports.view"]').uncheck();
  await page.waitForTimeout(250);
  await openGroup(dialog, 'Screens on the rail');
  check(await dialog.locator('[data-role-screen="reports"]').isDisabled(),
    'Removing reports.view left the Reports screen still tickable.');

  // Put it back, so what is saved is a hidden screen rather than a lost permission.
  await openGroup(dialog, 'Reports and history');
  await dialog.locator('[data-role-permission="reports.view"]').check();
  await page.waitForTimeout(250);
  await openGroup(dialog, 'Screens on the rail');
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

// ── A System Admin's rail hides like any other, except the way back in ────────
//
// This case used to assert the opposite: that a System Admin sees every link whatever the table
// says. That blanket exemption quietly defeated the feature — an administrator could take Reports
// off this role, the database would store it, and the link would still be on their own rail, which
// reads as the setting not working. Only Users is held back, and it is held back in the database
// too, by a check constraint on role_visible_pages: it is the screen this is all arranged from, so
// hiding it would leave the only role that could put it back with no way to reach the dialog.
{
  const { context, page } = await openPage({ hidden: [['system_admin', 'reports'], ['system_admin', 'users']] });
  await page.goto(`http://127.0.0.1:${PORT}/app/board.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const rail = await railOf(page);
  check(!rail.includes('Reports'),
    `A System Admin who hid Reports still has the link: ${JSON.stringify(rail)}`);
  check(rail.includes('Users'),
    `Users must stay on a System Admin's rail: it is where this is undone. The rail was: ${JSON.stringify(rail)}`);
  check(rail.includes('Dock board') && rail.includes('Settings'),
    `Hiding one page must not disturb the rest of the rail: ${JSON.stringify(rail)}`);
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
console.log('Role access verification passed: arranged under Users, gone from the role, and Users never gone from a System Admin.');
