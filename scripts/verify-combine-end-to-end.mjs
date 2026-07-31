// Combining, walked from a block on the dock board to the load leaving both boards.
//
// The two halves of combining were built weeks apart and neither was ever driven
// through to the end: the merge existed, the dialog existed, and no appointment in
// the database had ever been combined. The reason was reach — the only way in was a
// line in the operations brief, so a coordinator looking at the board had no way to
// say "these two are the same run". This proves the way in exists and that pressing
// it finishes the job.
//
// What is asserted, in the order it happens:
//
//   1. A block on the board opens the movement, and the movement offers to combine —
//      naming the run, not just saying "Combine", because pressing it cancels real
//      bookings.
//   2. The dialog offers every load on the lane, says which one survives, and draws
//      the trailer. The trailer is the reason Mississauga's skid capacities had to be
//      entered: with no capacity there is nothing to draw the load against and no
//      answer to "does this fit".
//   3. Combining calls merge_appointments — the one merge in this application.
//   4. The absorbed load leaves the dock board.
//   5. The absorbed load leaves the operations queue, and the survivor is marked as
//      carrying more than one load on both.
//
// The stub is put into its stateful mode for this run: merge_appointments records the
// merge and the schedule is answered through it, the way the real function writes the
// table and list_location_schedule reads it back. So steps 4 and 5 are measured
// against a schedule that actually changed rather than against a fixed answer that
// would pass whatever the pages did with it.
const { chromium } = await import('playwright')
  .catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8734;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(PORT, resolve));

const STUB = fs.readFileSync(path.join(ROOT, 'scripts/audit-supabase-stub.js'), 'utf8');

const failures = [];
const check = (ok, detail) => { if (!ok) failures.push(detail); return ok; };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Toronto', locale: 'en-CA' });
// Set before the stub reads it. In this mode the stub keeps every merge it was asked
// for, so the call can be checked as well as its effect.
await context.addInitScript('globalThis.__auditStatefulMerge = true;');
await context.addInitScript(STUB);
const page = await context.newPage();
const crashes = [];
page.on('pageerror', error => crashes.push(String(error)));

// ── The dock board ────────────────────────────────────────────────────────────
await page.goto(`http://127.0.0.1:${PORT}/app/board.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-open-record]', { timeout: 15000 });

// The 12:00 Guelph load. Clicking a block is how an operator asks about one truck.
const guelphBlock = page.locator('[data-open-record]', { hasText: 'MXD-2026-000146' }).first();
check(await guelphBlock.count() > 0, 'The board did not draw the Guelph load the lane is built from.');
await guelphBlock.click();
await page.waitForSelector('#appt-details-title', { state: 'visible', timeout: 5000 });

const combineButton = page.locator('.scrim:not([hidden]) [data-combine]');
const combineLabel = (await combineButton.textContent().catch(() => '')) || '';
check(await combineButton.isVisible().catch(() => false), 'The dock board offers no way to combine a load: [data-combine] is not visible on the appointment.');
check(/Combine 2 loads to Guelph/.test(combineLabel), `The combine action does not name the run. It says: "${combineLabel}"`);

// A load with nothing to combine with must not be offered the action, or the button
// becomes noise and then a refusal.
await page.locator('.scrim:not([hidden]) [data-close]').first().click();
await page.waitForTimeout(300);
const loneBlock = page.locator('[data-open-record]', { hasText: 'MXD-2026-000141' }).first();
if (await loneBlock.count()) {
  await loneBlock.click();
  await page.waitForSelector('#appt-details-title', { state: 'visible', timeout: 5000 });
  check(!(await page.locator('.scrim:not([hidden]) [data-combine]').isVisible().catch(() => false)),
    'A load travelling alone is still offered a combine action.');
  await page.locator('.scrim:not([hidden]) [data-close]').first().click();
  await page.waitForTimeout(300);
}

// ── The dialog ────────────────────────────────────────────────────────────────
await guelphBlock.click();
await page.waitForSelector('#appt-details-title', { state: 'visible', timeout: 5000 });
await page.locator('.scrim:not([hidden]) [data-combine]').click();
await page.waitForSelector('#combine-title', { state: 'visible', timeout: 5000 });

const dialog = page.locator('.scrim:not([hidden])', { has: page.locator('#combine-title') });
const picks = dialog.locator('[data-combine-pick]');
check(await picks.count() === 2, `The dialog offered ${await picks.count()} loads on the lane; the lane has two.`);
check(await picks.nth(0).isChecked() && await picks.nth(1).isChecked(), 'The lane\'s loads are not ticked when the dialog opens.');

// Which load keeps its booking is a choice, and the earliest is only the suggestion.
const keeps = dialog.locator('[data-combine-keep]');
check(await keeps.count() === 2, `Every load on the run must be offerable as the one that keeps the booking. Found ${await keeps.count()}.`);
check(await keeps.nth(0).isChecked(), 'The earliest load is not suggested as the one that keeps the booking.');
// Each row says whether the whole run fits that particular truck — the thing the
// choice should be made on.
const listText = await dialog.locator('[data-combine-list]').innerText();
check(/the run fits: 20 of 26/.test(listText), `A row does not say whether the run fits that truck. It says: "${listText.replace(/\n/g, ' | ')}"`);
check(/holds 26/.test(listText), 'A row does not say what its own trailer holds.');
check(/53 ft Trailer, holds 26/.test(listText), 'A row does not name its trailer beside what it holds.');

const summary = (await dialog.locator('[data-combine-summary]').textContent()) || '';
check(/MXD-2026-000146/.test(summary), `The dialog does not name the surviving load. It says: "${summary}"`);
check(/20 skids/.test(summary), `The dialog does not add the lane's skids up. It says: "${summary}"`);
// The trailer is the point of entering skid capacities. Without a capacity there is
// nothing to draw the load against, and the dialog says so instead of drawing a truck.
// Three things are checked, because a picture that is merely present proves nothing: the
// drawing is there, the loaded part of it is the right length, and the caption says the
// same numbers the drawing shows.
const truck = dialog.locator('.truck');
check(await truck.count() > 0, 'The trailer did not render, so no capacity reached the dialog.');
const caption = (await dialog.locator('.truck__cap').textContent().catch(() => '')) || '';
check(/20 of 26 skids/.test(caption), `The trailer's caption is wrong. It says: "${caption}"`);
check(/room for 6 more/.test(caption), `The trailer should say what room is left. It says: "${caption}"`);
// A drawing that says the right number underneath while showing the wrong amount of load is
// worse than no drawing, so the geometry is measured rather than assumed.
//
// Measured as a proportion of the trailer's own interior, not against a remembered width. The
// first version of this check carried the interior width as a constant, and redrawing the rig
// on the owner's reference silhouette — a change to how the truck looks and to nothing else —
// failed it twice for a reason that had nothing to do with whether the load is drawn correctly.
// What has to be true is that the loaded part is 20/26 of the space a load goes into, at
// whatever size that space is now.
const wellWidth = Number(await dialog.locator('.truck__well').first().getAttribute('width'));
const loadWidth = Number(await dialog.locator('.truck__load').first().getAttribute('width'));
const share = wellWidth ? loadWidth / wellWidth : 0;
check(Math.abs(share - 20 / 26) < 0.012,
  `The loaded part of the trailer is ${loadWidth} of ${wellWidth} units, which is ${(share * 100).toFixed(1)} per cent; 20 of 26 is 76.9.`);
check(/truck__load--part/.test(await dialog.locator('.truck__load').first().getAttribute('class') || ''),
  'A trailer at 77% should be drawn in the part-loaded band.');

// Choosing the later load moves everything onto it, which is the whole point of the
// choice: the truck with the room is not always the earliest.
await keeps.nth(1).check();
await page.waitForTimeout(200);
const afterSwap = (await dialog.locator('[data-combine-summary]').textContent()) || '';
check(/MXD-2026-000147/.test(afterSwap), `Choosing the later load did not move the booking onto it. It says: "${afterSwap}"`);
// And back, so the rest of this walk measures the suggested keeper.
await dialog.locator('[data-combine-keep]').first().check();
await page.waitForTimeout(200);

// ── Combining ─────────────────────────────────────────────────────────────────
await dialog.locator('[data-combine-run]').click();
await page.waitForSelector('#combine-title', { state: 'hidden', timeout: 8000 });

const calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__auditMerges') || '[]'));
check(calls.length === 1, `merge_appointments was called ${calls.length} times; combining is one call.`);
check(calls[0]?.keep === 'a7', `The wrong load survived. Kept: ${calls[0]?.keep} — the earliest on the lane is a7.`);
check(JSON.stringify(calls[0]?.absorb) === JSON.stringify(['a8']), `The wrong loads were absorbed: ${JSON.stringify(calls[0]?.absorb)}`);

// ── The absorbed load leaves the board ────────────────────────────────────────
await page.waitForTimeout(1200);
const boardText = await page.locator('[data-board-host]').innerText();
check(!boardText.includes('MXD-2026-000147'), 'The absorbed load is still on the dock board after combining.');
check(boardText.includes('MXD-2026-000146'), 'The surviving load left the dock board after combining.');
// The mark is drawn on the block rather than written in front of the reference: a ⧉ character
// is a font's opinion at whatever size the block happens to be, and it disappeared entirely for
// a reader who had switched the reference field off. So the mark is looked for where it now
// lives — its own slot on the surviving block — and by the thing that makes it useful, which is
// that it says in words what it means to anybody who cannot resolve an 18px glyph on a wall.
const survivor = page.locator('.tlb', { hasText: 'MXD-2026-000146' }).first();
check(await survivor.locator('.tlb__f[aria-label="More than one load on this truck"]').count() > 0,
  'The surviving load is not marked as carrying combined loads on the board.');
check(/1 load combined in/.test(boardText), 'The surviving block does not say how many loads it took on.');

// The combined skid count, read where it is always legible. The block itself may
// have dropped its truck-and-skids line to fit — that is the board's documented
// behaviour at small block sizes and not something to assert against — but the
// movement behind it must report the load one truck is now carrying.
await page.locator('[data-open-record]', { hasText: 'MXD-2026-000146' }).first().click();
await page.waitForSelector('#appt-details-title', { state: 'visible', timeout: 5000 });
const detailsText = await page.locator('.scrim:not([hidden]) [data-grid]').innerText();
check(/20 skids/.test(detailsText), `The surviving movement does not carry the combined load. It says: "${detailsText.replace(/\n/g, ' | ')}"`);
// And it is no longer a lane of two, so the offer is gone.
check(!(await page.locator('.scrim:not([hidden]) [data-combine]').isVisible().catch(() => false)),
  'The survivor is still offered a combine after the lane was combined.');
await page.locator('.scrim:not([hidden]) [data-close]').first().click();

// ── And leaves the operations queue ───────────────────────────────────────────
await page.goto(`http://127.0.0.1:${PORT}/app/queue.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-rows] tr', { timeout: 15000 });
await page.waitForTimeout(600);
const queueText = await page.locator('[data-rows]').innerText();
check(!queueText.includes('MXD-2026-000147'), 'The absorbed load is still in the operations queue after combining.');
check(/⧉\s*MXD-2026-000146/.test(queueText), 'The operations queue does not mark the surviving load as combined.');

// The brief's own way in must survive the move to shared lane rules.
const briefText = await page.locator('[data-brief]').innerText();
check(/Combining/.test(briefText) || !/loads to Guelph/.test(briefText),
  'The operations brief lost its Combining column.');

// Sharing the brief threw a ReferenceError before this pass, so nothing was ever
// sent. There is no mail client here; what is checked is that the handler runs.
await page.evaluate(() => { globalThis.open = () => null; });
await page.locator('[data-share-brief]').click();
await page.waitForTimeout(200);
await page.close();

// ── The footer holds three buttons on a phone ─────────────────────────────────
// Combining put a third action in a modal footer that had two, and the label names
// the run so it is the longest of them. The full layout sweep measures every dialog
// at four widths; this measures the one this pass changed, at the width it is most
// likely to break, so a regression here does not wait for the whole sweep.
for (const width of [1440, 390]) {
  const phone = await browser.newContext({ viewport: { width, height: 880 }, timezoneId: 'America/Toronto', locale: 'en-CA' });
  await phone.addInitScript('globalThis.__auditStatefulMerge = true;');
  await phone.addInitScript(STUB);
  const view = await phone.newPage();
  await view.goto(`http://127.0.0.1:${PORT}/app/board.html`, { waitUntil: 'networkidle' });
  await view.waitForSelector('[data-open-record]', { timeout: 15000 });
  await view.locator('[data-open-record]', { hasText: 'MXD-2026-000146' }).first().click();
  await view.waitForSelector('#appt-details-title', { state: 'visible', timeout: 5000 });
  await view.waitForTimeout(250);

  // The same four rules the layout sweep applies, on this footer: nothing clipped,
  // nothing pushed outside a box that hides its overflow, every action the one
  // control height the application has, and no action too small to hit.
  const faults = await view.evaluate(() => {
    const foot = document.querySelector('.scrim:not([hidden]) .modal__foot');
    if (!foot) return ['The appointment footer is not on screen.'];
    const found = [];
    const wanted = Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-h')) || 0);
    if (foot.scrollWidth > foot.clientWidth + 1) found.push(`The footer is ${foot.scrollWidth - foot.clientWidth}px wider than its box.`);
    for (const button of foot.querySelectorAll('.btn')) {
      const box = button.getBoundingClientRect();
      const label = (button.textContent || '').trim().slice(0, 48);
      if (button.scrollWidth > button.clientWidth + 1) found.push(`"${label}" is clipped by ${button.scrollWidth - button.clientWidth}px.`);
      if (wanted && Math.abs(Math.round(box.height) - wanted) > 1) found.push(`"${label}" is ${Math.round(box.height)}px tall; every control is ${wanted}px.`);
      if (box.height < 32) found.push(`"${label}" is only ${Math.round(box.height)}px tall to hit.`);
      const panel = foot.closest('.modal').getBoundingClientRect();
      if (box.right - panel.right > 1 || panel.left - box.left > 1) found.push(`"${label}" sits outside the dialog.`);
    }
    return found;
  });
  for (const fault of faults) check(false, `Appointment footer at ${width}px: ${fault}`);
  await phone.close();
}

await browser.close();
server.close();

const script = 'verify-combine-end-to-end';
if (crashes.length) failures.push(...crashes.map(error => `Uncaught page error: ${error}`));
if (failures.length) {
  console.error(`\n${script} failed:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error('');
  process.exit(1);
}
console.log('Combine end-to-end verification passed: board → dialog → merge → gone from both boards.');
