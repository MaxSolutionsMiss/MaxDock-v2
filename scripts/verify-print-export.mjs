#!/usr/bin/env node
// Where Print goes, where Export goes, and what happens on paper.
//
//   The owner's ruling, and it is a rule about what each button is FOR rather than a
//   preference about toolbars: Print belongs on Reports and nowhere else, because a
//   report is the only thing anybody carries into a meeting. Every other screen holds
//   data somebody reconciles in a spreadsheet, so it gets Export instead — and Export
//   belongs on every screen that has data at all.
//
//   Before this, seven screens offered Print and the stylesheet had zero @media print
//   rules, so every one of those buttons put the navigation rail, the top bar, the
//   filter row and the connection dot on the paper in screen colours. That was not a
//   decision anybody made. It was the absence of one, and nothing in the build could
//   see it, because there was nothing written down to read.
//
//   So both halves are guarded: the placement, and the fact that the one screen still
//   printing has rules telling it how.
import { readFileSync } from 'node:fs';

const errors = [];
const read = path => readFileSync(path, 'utf8');
const need = (text, pattern, message) => { if (!pattern.test(text)) errors.push(message); };
const forbid = (text, pattern, message) => { if (pattern.test(text)) errors.push(message); };

const css = read('assets/maxdock.css');

// ── Print, on Reports and nowhere else ──────────────────────────────────────────
//
// Checked by looking for the handler rather than the button. A page could carry the
// button with nothing behind it and that would be worse, not better.
const PRINTS = 'js/pages/reports.js';
const NO_PRINT = [
  'js/pages/board.js', 'js/pages/queue.js', 'js/pages/my-appointments.js',
  'js/pages/settings.js', 'js/pages/users.js', 'js/pages/data.js',
];
need(read(PRINTS), /\[data-print\]/,
  'Reports has no Print. It is the one screen that should have it: a report is what somebody carries into a meeting.');
for (const path of NO_PRINT) {
  forbid(read(path), /\[data-print\]/,
    `${path} still prints. Print belongs on Reports alone; a page of data is reconciled in a spreadsheet, so this screen wants Export.`);
}

// ── Export, on every screen that holds data ─────────────────────────────────────
const EXPORTS = [
  'js/pages/board.js', 'js/pages/queue.js', 'js/pages/reports.js', 'js/pages/users.js',
  'js/pages/my-appointments.js', 'js/pages/settings.js', 'js/pages/data.js',
];
for (const path of EXPORTS) {
  need(read(path), /\[data-export\]/,
    `${path} holds data and cannot export it. Export is the button that has to be everywhere there is something to take away.`);
}
// A button with nothing behind it is worse than no button, so the two screens that
// gained one are checked for the function as well as the wiring.
need(read('js/pages/settings.js'), /function exportCsv\(\)/,
  'Settings offers Export with nothing behind it.');
need(read('js/pages/data.js'), /function exportCsv\(\)/,
  'Data integration offers Export with nothing behind it.');

// ── What actually reaches the paper ─────────────────────────────────────────────
need(css, /@media print/,
  'There are no print rules at all, so the one screen that still prints puts the whole application on the page.');
// The chrome is the entire point. A printout carrying the navigation rail is the
// defect this block exists to fix, and it is one careless edit from returning.
for (const [selector, what] of [
  [/\.rail[^{]*\{[^}]*display:\s*none/, 'the navigation rail'],
  [/\.top[,\s][^{]*\{[^}]*display:\s*none/, 'the top bar'],
  [/\.controls[,\s][^{]*\{[^}]*display:\s*none/, 'the filter row'],
]) {
  const block = css.slice(css.indexOf('@media print'));
  if (!selector.test(block)) errors.push(`The print rules do not hide ${what}, so it prints on the report.`);
}
const printBlock = css.slice(css.indexOf('@media print'));
// Named against .panel__scroll specifically. A looser test for "overflow: visible
// anywhere in the block" passed while the scrolling panel itself was left locked,
// because the page wrapper above it happens to say the same thing.
need(printBlock, /\.panel__scroll[^{]*\{[^}]*overflow:\s*visible/,
  'A panel that scrolls on screen keeps its scroll on paper, so the printout is one screenful and a cropped chart.');
need(printBlock, /break-inside:\s*avoid/,
  'Nothing stops a card or a chart being split down the middle by a page break.');
need(printBlock, /thead\s*\{[^}]*table-header-group/,
  'A table running over two pages leaves the second page without column headings.');
// The unprefixed property, which is the one every current browser reads. Matching
// "print-color-adjust" loosely was satisfied by the -webkit- copy alone, so the
// standard declaration could be deleted and this would still have passed.
need(printBlock, /(^|[^-])print-color-adjust:\s*exact/m,
  'The printer is not told to keep the chart fills, so a bar chart prints as an empty axis.');

if (errors.length) {
  console.error('Print and export verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Print and export verification passed: print on Reports alone, export on all 7 data screens, chrome off the page');
