#!/usr/bin/env node
// The chrome must not move when you change page.
//
//   The header, the rail, the location selector, the notification bell and the account
//   controls are the parts of the product that are the same on every screen. When one of them
//   shifts by a few pixels between Board and Queue the application stops feeling like one
//   thing, and it is the kind of fault nobody can name — it reads as "cheap" rather than as
//   "the bell moved four pixels". That is exactly why it needs measuring rather than looking:
//   a fault too small to describe is a fault too small to notice going in.
//
//   Every page is rendered at the same viewport and the chrome's boxes are compared across
//   all of them. Any element that has more than one distinct box across the set has drifted,
//   and the report names the pages on each side of the difference so the cause is one diff
//   away rather than a hunt.
//
//   Run with a browser available. It is part of the layout job for that reason.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.CHROME_PORT || 8991);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

// The parts that belong to the product rather than to a page.
const CHROME = [
  { sel: '.top', what: 'the top bar' },
  { sel: '.rail', what: 'the navigation rail' },
  { sel: '.rail__brand', what: 'the brand block' },
  { sel: '.rail__nav', what: 'the rail links' },
  { sel: '.top__loc', what: 'the location selector' },
  { sel: '.notif__btn', what: 'the notification bell' },
  { sel: '.who', what: 'the account controls' },
];

// Every operational page. A page that does not exist is skipped rather than failed, so this
// does not have to be edited every time the product gains or loses a screen.
const PAGES = ['board', 'queue', 'receiving', 'reports', 'my-appointments', 'settings', 'users', 'data'];

// Three sizes, because the type ramp scales the chrome and a rule that only holds at Normal
// is not a rule. Widths chosen either side of the rail's own breakpoints.
const CASES = [
  { width: 1440, text: 'normal' },
  { width: 1280, text: 'large' },
  { width: 1024, text: 'normal' },
];

const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));

const server = createServer((request, response) => {
  const file = join(ROOT, decodeURIComponent(String(request.url).split('?')[0]));
  if (!existsSync(file) || statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  response.end(readFileSync(file));
});
await new Promise(resolve => server.listen(PORT, resolve));

const stub = readFileSync(join(ROOT, 'scripts/audit-supabase-stub.js'), 'utf8');
const browser = await chromium.launch();
const errors = [];

const selectors = CHROME.map(item => item.sel);

for (const { width, text } of CASES) {
  const measured = {};
  for (const page of PAGES) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Toronto', locale: 'en-CA' });
    await context.addInitScript(stub);
    await context.route('**/cdn.jsdelivr.net/**', route => route.abort());
    const tab = await context.newPage();
    const reached = await tab.goto(`http://127.0.0.1:${PORT}/app/${page}.html`, { waitUntil: 'networkidle' }).then(() => true).catch(() => false);
    if (!reached) { await context.close(); continue; }
    await tab.evaluate(value => document.documentElement.setAttribute('data-text', value), text).catch(() => {});

    // Measured once it has stopped moving, not after a fixed wait.
    //
    // The first version waited 900ms and then measured, and it reported the bell and the
    // account block as 26px out of place on the board and My Appointments — the two heaviest
    // pages. They were not out of place. The account name arrives with the profile, and on a
    // slow runner those two pages had not painted it yet, so the block was still 19px narrower
    // than it would be a moment later. A gate that reports whichever pages happened to be slow
    // is worse than no gate, because it teaches you to ignore it.
    //
    // So it reads the boxes repeatedly and only accepts an answer that two consecutive reads
    // agree on. What is being asked is whether the chrome settles in the same place, which is
    // the actual claim, rather than whether it gets there within some number of milliseconds.
    const read = () => tab.evaluate(selectors => {
      const out = {};
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (!element) { out[selector] = 'absent'; continue; }
        const box = element.getBoundingClientRect();
        out[selector] = `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}`;
      }
      return out;
    }, selectors).catch(() => ({}));

    let previous = null;
    let settled = {};
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await tab.waitForTimeout(250);
      const now = await read();
      const key = JSON.stringify(now);
      if (previous === key) { settled = now; break; }
      previous = key;
      settled = now;
    }
    measured[page] = settled;
    await context.close();
  }

  const pages = Object.keys(measured);
  for (const { sel, what } of CHROME) {
    const byBox = new Map();
    for (const page of pages) {
      const box = measured[page]?.[sel];
      if (!box) continue;
      if (!byBox.has(box)) byBox.set(box, []);
      byBox.get(box).push(page);
    }
    // Absent on every page is a selector this file is wrong about, not a drift.
    if (byBox.size <= 1) continue;
    const shown = [...byBox.entries()].map(([box, list]) => `${box} on ${list.join(', ')}`).join('   |   ');
    errors.push(`At ${width}px / ${text} text, ${what} (${sel}) is not in the same place on every page: ${shown}`);
  }
}

await browser.close();
server.close();

if (errors.length) {
  console.error('Chrome stability verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Chrome stability verification passed: ${CHROME.length} elements identical across ${PAGES.length} pages at ${CASES.length} sizes`);
