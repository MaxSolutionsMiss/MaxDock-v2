// A sheet of loads, imported from Data integration, in a real browser.
//
// The static gate beside this one proves the import cannot become a second way to
// create an appointment. This proves it works: that a file a site would actually
// send back is read, judged row by row against that site's own configuration, and
// booked through the ordinary booking with the arguments the wizard would have
// sent.
//
// The sheet deliberately contains rows that must be refused — a date nobody can
// parse, a truck type this site does not run, a missing PO — because an import
// that books six of six rows has not been tested, it has only been demonstrated.
const { chromium } = await import('playwright')
  .catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8736;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(PORT, resolve));
const STUB = fs.readFileSync(path.join(ROOT, 'scripts/audit-supabase-stub.js'), 'utf8');

// A date far enough out that no booking window refuses it, written the two ways a
// site writes dates. The stub location is Pickering and Guelph is one of its Max
// sites, so row 4 has to become a routed movement.
const day = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10);
const [year, month, date] = day.split('-');
const SHEET = [
  '# MaxDock appointment import — Pickering',
  '# Lines starting with a hash are ignored.',
  'Date,Time,Direction,Company or site,Company type,Appointment type,Truck type,Skids,Handling,PO / BOL / job,Carrier,Priority,Requester name,Requester email,Notes',
  `${day},08:00,Outbound,Haleon – Oakhill,Customer,Finished Goods,53 ft Trailer,18,Live load,PO-5501,Day & Ross,No,A. Planner,planner@example.com,`,
  // The other way round, with a 12-hour clock and a spacing nobody agreed.
  `${month}/${date}/${year},2:30 PM,inbound,Haleon – Oakhill,Vendor,raw material,48ft trailer,6,live unload,BOL-5502,,yes,A. Planner,planner@example.com,Tail lift`,
  // A Max site at the other end: this one must book the run at both ends.
  `${day},10:00,Outbound,Guelph,,WIP,53 ft Trailer,22,Live load,JOB-5503,,No,A. Planner,planner@example.com,`,
  // Refusals, one reason each.
  `not-a-date,08:00,Outbound,Haleon – Oakhill,Customer,Finished Goods,53 ft Trailer,4,Live load,PO-5504,,No,A. Planner,planner@example.com,`,
  `${day},09:00,Outbound,Haleon – Oakhill,Customer,Finished Goods,Flatbed,4,Live load,PO-5505,,No,A. Planner,planner@example.com,`,
  `${day},09:30,sideways,Haleon – Oakhill,Customer,Finished Goods,53 ft Trailer,4,Live load,,,No,A. Planner,planner@example.com,`,
].join('\n');

const failures = [];
const check = (ok, detail) => { if (!ok) failures.push(detail); return ok; };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, timezoneId: 'America/Toronto', locale: 'en-CA' });
await context.addInitScript(STUB);
await context.route('**/cdn.jsdelivr.net/**', route => route.abort());
const page = await context.newPage();
const crashes = [];
page.on('pageerror', error => crashes.push(String(error)));

// Data integration, System Admin only, rather than the dock board — importing a
// fortnight of somebody's appointments is an administrator's job while the trial is
// finding its feet.
await page.goto(`http://127.0.0.1:${PORT}/app/data.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-section]', { timeout: 15000 });
await page.click('[data-section="appointments"]');
await page.waitForSelector('[data-open-appointment-import]', { timeout: 8000 });

const action = page.locator('[data-open-appointment-import]');
check(await action.isVisible().catch(() => false), 'Data integration has no Import appointments action.');
await action.click();
await page.waitForSelector('#appt-import-title', { state: 'visible', timeout: 8000 });
const dialog = page.locator('.scrim:not([hidden])', { has: page.locator('#appt-import-title') });

// A site has to be able to get the sheet before it can send one back.
check(await dialog.locator('[data-import-template]').isVisible(), 'There is no template for a site to fill in.');
check(await dialog.locator('[data-import-run]').isDisabled(), 'The book button is live before any sheet has been read.');

await dialog.locator('[data-import-file]').setInputFiles({ name: 'next-week.csv', mimeType: 'text/csv', buffer: Buffer.from(SHEET) });
await page.waitForSelector('[data-import-preview] table', { timeout: 8000 });

const summary = (await dialog.locator('.form-message').first().textContent()) || '';
check(/3 of 6 rows ready/.test(summary), `The sheet was not judged correctly. It says: "${summary}"`);
check(/3 to fix in the sheet/.test(summary), `Refused rows are not counted back. It says: "${summary}"`);

const body = await dialog.locator('[data-import-preview] tbody').innerText();
// Each refusal names its own reason rather than a single "invalid row".
check(/is not a date/.test(body), 'A row with an unparseable date does not say so.');
check(/Truck type "Flatbed" is not enabled at this site/.test(body), 'A truck type this site does not run is not named.');
check(/No PO \/ BOL \/ job/.test(body), 'A row with no PO is not named.');
check(/Direction has to be Inbound or Outbound/.test(body), 'A row with a nonsense direction is not named.');
// The two date spellings and the 12-hour clock both landed on the same day.
check((body.match(new RegExp(`${month}/${date}/${year}`, 'g')) || []).length === 0,
  'A slashed date was shown back raw rather than as the date it was read as.');
check(/14:30/.test(body), 'A time written as 2:30 PM was not read as 14:30.');
// Case-insensitive: a .tag is uppercased by the stylesheet, so innerText reads it
// back as MAX SITE however it was written.
check(/max site/i.test(body), 'A Max site at the other end is not marked as one.');

const runLabel = (await dialog.locator('[data-import-run]').textContent()) || '';
check(/Book 3 appointments/.test(runLabel), `The button does not say what it will do. It says: "${runLabel}"`);

await dialog.locator('[data-import-run]').click();
await page.waitForSelector('[data-import-download]', { timeout: 20000 });

// ── What was actually asked of the database ───────────────────────────────────
const calls = await page.evaluate(() => globalThis.__bookCalls);
check(calls.length === 3, `${calls.length} bookings were made; three rows were ready.`);
check(calls.filter(call => call.name === 'book_appointment').length === 2,
  `${calls.filter(c => c.name === 'book_appointment').length} outside companies were booked as ordinary appointments; two were.`);
check(calls.filter(call => call.name === 'book_routed_appointment').length === 1,
  'The Guelph row was not booked as a routed movement.');

const routed = calls.find(call => call.name === 'book_routed_appointment');
check(routed?.args?.p_requester_location_id === 'loc-2', `A routed movement must carry the other site's id. It carried: ${routed?.args?.p_requester_location_id}`);
check(routed?.args?.p_company_name === 'Guelph', `A routed movement must name the other site. It named: ${routed?.args?.p_company_name}`);

const first = calls.find(call => call.args?.p_external_reference === 'PO-5501');
check(first?.args?.p_date === day, `The date was not passed as written. It passed: ${first?.args?.p_date}`);
check(first?.args?.p_start_time === '08:00', `The time was not passed as written. It passed: ${first?.args?.p_start_time}`);
check(first?.args?.p_direction === 'outbound', `The direction was not passed. It passed: ${first?.args?.p_direction}`);
check(first?.args?.p_truck_type_code === 'trailer_53', `A truck named "53 ft Trailer" must go as its code. It went as: ${first?.args?.p_truck_type_code}`);
check(first?.args?.p_appointment_type_code === 'finished_goods', `An appointment type must go as its code. It went as: ${first?.args?.p_appointment_type_code}`);
check(first?.args?.p_handling_type_code === 'live_load', `Handling must go as its code. It went as: ${first?.args?.p_handling_type_code}`);
check(first?.args?.p_skid_count === 18, `Skids must go as a number. They went as: ${JSON.stringify(first?.args?.p_skid_count)}`);
check(first?.args?.p_requester_email === 'planner@example.com', 'The requester email was not passed.');
check(first?.args?.p_is_priority === false, 'A row that says No to priority must not be priority.');

const messy = calls.find(call => call.args?.p_external_reference === 'BOL-5502');
check(messy?.args?.p_date === day, `A slashed date must be read as month/day. It passed: ${messy?.args?.p_date}`);
check(messy?.args?.p_start_time === '14:30', `A 12-hour time must be read as 24-hour. It passed: ${messy?.args?.p_start_time}`);
check(messy?.args?.p_direction === 'inbound', 'A lower-case direction must still be read.');
check(messy?.args?.p_truck_type_code === 'trailer_48', 'A truck written "48ft trailer" must still match.');
check(messy?.args?.p_is_priority === true, 'A row that says yes to priority must be priority.');

// The one thing a sheet is never allowed to decide for a site.
check(calls.every(call => call.args?.p_after_hours_confirmed === false),
  'A sheet confirmed an after-hours booking. That is a decision taken on the screen, one load at a time.');

// ── What the person is told afterwards ────────────────────────────────────────
const done = (await dialog.locator('.form-message').first().textContent()) || '';
check(/3 of 3 appointments booked/.test(done), `The result is wrong. It says: "${done}"`);
const results = await dialog.locator('[data-import-preview] tbody').innerText();
check(/MXD-2026-000143/.test(results) && /MXD-2026-000145/.test(results),
  'The references MaxDock handed back are not shown against their rows.');
check(await dialog.locator('[data-import-file]').isDisabled(), 'The file can still be swapped after the import ran.');
check(await dialog.locator('[data-import-run]').isHidden(), 'The book button is still live after the import ran.');

await browser.close();
server.close();

if (crashes.length) failures.push(...crashes.map(error => `Uncaught page error: ${error}`));
if (failures.length) {
  console.error('\nverify-import-end-to-end failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error('');
  process.exit(1);
}
console.log('Appointment import verification passed: sheet → verdict per row → booked through the ordinary booking.');
