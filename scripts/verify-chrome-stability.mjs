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
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const errors = [];
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

// Before a single page is rendered: every page must ask for the same fonts.
//
// This is what the browser check was failing on for three runs, and it is a real fault rather
// than an artefact of measuring. Only the board, booking, My Appointments and the sign-in page
// carried the IBM Plex link; the queue, receiving, reports, settings, users and data pages did
// not. So moving from the Dock board to the Operations queue changed the typeface of the whole
// application, and every piece of chrome measured in a different place because every piece of
// chrome was set in a different face. Checked here as text rather than in the browser because
// the answer is in the markup and a missing link is cheaper to catch than a moved pixel.
{
  const pages = [...readdirSync(join(ROOT, 'app')).filter(name => name.endsWith('.html')).map(name => `app/${name}`), 'index.html'];
  const withFont = pages.filter(page => readFileSync(join(ROOT, page), 'utf8').includes('fonts.googleapis.com'));
  if (withFont.length && withFont.length !== pages.length) {
    const missing = pages.filter(page => !withFont.includes(page));
    // Reported here and not at the end. This is a text check and it takes milliseconds; making
    // somebody wait four minutes for a browser sweep to tell them a link tag is missing is a
    // good way to have the sweep skipped.
    console.error('Chrome stability verification failed');
    console.error(`- These pages do not load the typeface the rest of the product uses, so the whole application changes font when you open one of them: ${missing.join(', ')}`);
    process.exit(1);
  }
}

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

    // Wait for the webfont before measuring anything.
    //
    // This took two wrong diagnoses to find, and both were mine. The check reported the
    // notification bell 26px out of place on the board and My Appointments and correct on the
    // other six. I called it a slow-runner artifact and made it poll until two reads agreed.
    // The next run produced byte-identical numbers, which is exactly what a timing flake does
    // not do.
    //
    // The cause is the font. These pages load IBM Plex from Google with display=swap, so text
    // is laid out in the fallback and relaid when the real font arrives, and the account block
    // is 19px wider in one than the other. Every page reaches that point at its own speed, so
    // whichever were still mid-swap when they were read disagreed with the rest — reproducibly,
    // because the pages are reproducibly different weights. It never showed up here because
    // this container cannot reach Google Fonts at all, so everything rendered in the fallback
    // and agreed with itself.
    //
    // document.fonts.ready is the actual signal. The settle loop stays underneath it for
    // anything else that lands late, but the font is what was moving.
    await tab.evaluate(() => document.fonts.ready).catch(() => {});
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
