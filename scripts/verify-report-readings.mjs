#!/usr/bin/env node
// How a reading is drawn, and the things that must stay true whichever way it is drawn.
//
//   A reading has one verdict. It is now drawn two ways — as a dial, and as the outline of
//   what it measures filling up — and the fastest way to make that worse than either would
//   be to let the two decide their own bands. So the decision lives in one function and
//   both drawings call it.
//
//   The filled shape wears the trailer's classes rather than a second set of its own. That
//   is the point rather than the economy: it is the trailer treatment applied to shapes
//   that are not trailers, so the well, the level and the outline should be the same well,
//   level and outline. A parallel namespace would be two things to keep in step.
//
//   Painting order is the whole trick, and it is one line away from being wrong: the empty
//   body, then the level clipped to it, then the outline last carrying no fill. An outline
//   with a fill drawn after the level paints the level out — which is exactly what the
//   first version of the trailer did, and it drew an empty truck at 77% full.
//
//   The view's mark belongs to the section it introduces. It used to sit in a band above,
//   repeating the site and dates that section's own header already carried.
import { readFileSync, existsSync } from 'node:fs';

const errors = [];
const read = path => readFileSync(path, 'utf8');
const need = (text, pattern, message) => { if (!pattern.test(text)) errors.push(message); };
const forbid = (text, pattern, message) => { if (pattern.test(text)) errors.push(message); };

const FILES = ['js/pages/reports.js', 'js/ui/fillfigure.js', 'js/pages/queue.js', 'assets/maxdock.css'];
for (const file of FILES) if (!existsSync(file)) errors.push(`Missing ${file}`);

if (!errors.length) {
  const reports = read('js/pages/reports.js');
  const fig = read('js/ui/fillfigure.js');
  const queue = read('js/pages/queue.js');
  const css = read('assets/maxdock.css');

  // ── One verdict, whichever way it is drawn ──────────────────────────────────
  need(reports, /function readingBand\(/, 'There is no single place deciding which band a reading falls in.');
  const dialFn = reports.slice(reports.indexOf('function dial('), reports.indexOf('function shapeOf('));
  need(dialFn, /readingBand\(/, 'The dial decides its own bands instead of asking readingBand.');
  const shapeFn = reports.slice(reports.indexOf('function shapeOf('), reports.indexOf('function readings('));
  need(shapeFn, /readingBand\(/, 'The filled shape decides its own bands instead of asking readingBand.');
  // A second band table anywhere is the drift this is guarding against.
  forbid(fig, /over capacity|near capacity|not acceptable|on target/,
    'The drawing module carries verdict wording of its own. It draws; readingBand judges.');
  forbid(fig, /value >= 90|value > 100/, 'The drawing module decides bands from the number. That belongs to readingBand.');

  // ── The filled shape is the trailer, standing up ────────────────────────────
  need(fig, /class="truck truck--fig/, 'The filled shape does not wear the trailer\'s classes.');
  need(fig, /truck__well/, 'The filled shape draws no empty body behind the level.');
  need(fig, /truck__load truck__load--/, 'The level is not drawn with the trailer\'s load fills.');
  forbid(css, /\.fillfig/, 'A second drawing namespace exists in the stylesheet. The filled shape is the trailer\'s own vocabulary.');
  // The four reading bands and the four load fills are the same four colours in the same
  // order. Mapping them is what makes reusing the trailer's fills correct rather than lucky.
  need(fig, /const LOAD = \{ low: 'full', mid: 'part', high: 'light', over: 'over' \}/,
    'The reading bands are not mapped onto the trailer\'s load fills, so a green reading could draw amber.');

  // ── Painting order, and an outline that carries no fill ─────────────────────
  const draw = fig.slice(fig.indexOf('function drawing('));
  const well = draw.indexOf('truck__well');
  const load = draw.indexOf('truck__load');
  const box = draw.indexOf('truck__box');
  if (!(well >= 0 && load > well && box > load)) {
    errors.push('The filled shape is painted out of order. Empty body, then the level, then the outline last — an outline drawn before the level is hidden by it, and one carrying a fill paints the level out.');
  }
  need(css, /\.truck__box\{fill:none/, 'The outline has a fill of its own. Drawn last, it paints the level out.');
  // Two figures on one page must not share a clip path.
  need(fig, /let seq = 0/, 'Clip path ids are not unique per figure; the second figure would be clipped by the first\'s shape.');
  need(fig, /`ff\$\{\+\+seq\}`/, 'Clip path ids do not advance, so every figure on the page shares one.');

  // ── The view mark belongs to its section ────────────────────────────────────
  forbid(reports, /viewhead/, 'The standalone view band is still built. It repeated the dates its first section already carried.');
  forbid(css, /\.viewhead/, 'The standalone view band still has styles.');
  need(reports, /function withViewMark\(/, 'Nothing folds the view\'s mark into the section it introduces.');
  need(reports, /innerHTML = withViewMark\(/, 'The view mark is defined but never applied.');
  need(reports, /panel__head--lead/, 'The lead section head has no marker class, so it cannot be laid out differently from the rest.');

  // ── The day brief: what is on each truck, and a mark per category ───────────
  need(queue, /skids a truck on average/,
    'The brief counts trucks but never says what is on them. Twelve trucks at four skids and twelve at twenty read the same otherwise.');
  need(queue, /const each = rows => \(rows\.length \?/,
    'The skids-per-truck average is not guarded against a direction with no trucks in it.');
  need(queue, /briefcol__m/, 'The brief\'s categories carry no mark.');
  for (const [group, mark] of [['Trucks', 'truck'], ['Labour', 'crew'], ['Combining', 'load'], ['Attention', 'warn']]) {
    need(queue, new RegExp(`title: '${group}',\\s*\\n?\\s*mark: '${mark}'`),
      `The brief's ${group} column has no ${mark} mark, so the four columns are told apart by their headings alone.`);
  }
  // The mark sits on the title line. A gutter of its own cost the points width and left
  // the column looking half empty, so the heading carries it and the points run full width
  // directly underneath, with no gap and no rule between them.
  need(queue, /<h4 class="briefcol__t"><span class="briefcol__m"/,
    'The brief\'s mark is not on the title line, so it is taking a gutter the points need.');
  need(css, /\.briefcol__t\{[^}]*color:var\(--dock-deep\)/,
    'The brief\'s category headings are not in MaxDock blue.');
  need(css, /\.briefcol__t\{[^}]*margin:0[;}]/,
    'There is a gap under each category heading, pushing its points away from it.');
  forbid(css, /\.brief__body\{[^}]*border-top/,
    'A rule still sits above the brief\'s columns. The figures are already in cards; a second boundary costs a whole row.');
}

if (errors.length) {
  console.error('Report readings verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Report readings verification passed');
