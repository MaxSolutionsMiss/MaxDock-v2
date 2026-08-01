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

const FILES = ['js/pages/reports.js', 'js/ui/reading-tile.js', 'js/pages/queue.js', 'assets/maxdock.css'];
for (const file of FILES) if (!existsSync(file)) errors.push(`Missing ${file}`);

if (!errors.length) {
  const reports = read('js/pages/reports.js');
  const fig = read('js/ui/reading-tile.js');
  const queue = read('js/pages/queue.js');
  const css = read('assets/maxdock.css');

  // ── One verdict, whichever way it is drawn ──────────────────────────────────
  need(reports, /function readingBand\(/, 'There is no single place deciding which band a reading falls in.');
  const dialFn = reports.slice(reports.indexOf('function dial('), reports.indexOf('function tileOf('));
  need(dialFn, /readingBand\(/, 'The dial decides its own bands instead of asking readingBand.');
  const tileFn = reports.slice(reports.indexOf('function tileOf('), reports.indexOf('function readings('));
  need(tileFn, /readingBand\(/, 'The reading tile decides its own bands instead of asking readingBand.');
  // A second band table anywhere is the drift this is guarding against.
  forbid(fig, /over capacity|near capacity|not acceptable|on target/,
    'The drawing module carries verdict wording of its own. It draws; readingBand judges.');
  forbid(fig, /value >= 90|value > 100/, 'The drawing module decides bands from the number. That belongs to readingBand.');

  // ── The Fill view is a chart, not a pictogram ───────────────────────────────
  // The owner retired the filled outlines: a silhouette filling up is a worse encoding of a
  // percentage than a bar, because three of them in a row have three different area-to-value
  // curves and so cannot be compared with each other at all. What replaced them has to stay a
  // chart, and these guards are what stop a pictogram creeping back in.
  need(fig, /class="stat stat--/, 'The Fill view does not draw the reading tile.');
  need(fig, /class="stat__track"/, 'There is no track behind the fill, so nothing says what the bar is measured against and a low reading looks like a missing one.');
  need(fig, /class="stat__fill" style="width:/, 'The reading is not drawn as a length against that track.');
  forbid(fig, /clipPath|clip-path|<path|viewBox/,
    'The tile has gone back to drawing outlines. A percentage is drawn as a length, not as a shape filling up.');
  forbid(css, /\.fillfig|\.truck--fig/, 'The retired pictogram vocabulary is still in the stylesheet.');

  // ── Colour is earned, and never rests on hue ───────────────────────────────
  // The defect this replaced: the filled shapes coloured themselves from the trailer's load
  // bands, so "Crew used 62%" printed green because 62% of a trailer is a healthy load. That
  // asserted a verdict the metric had never defined.
  need(reports, /const tone = good === 'none' \? 'flat'/,
    'readingBand reaches no tone, so each drawing has to pick its own colour and two renderings of one number can disagree.');
  need(reports, /\{ low: 'flat', mid: 'flat', high: 'warn', over: 'bad' \}\[band\]/,
    'A capacity reading colours its lower bands. A lightly used dock is not a pass and a busy one is not a fail; only the ceiling is a verdict.');
  need(css, /\.stat\{--c:var\(--chart-a\)/,
    'The tile has no neutral default, so a reading with no target still draws in a status colour.');
  forbid(fig, /tone === |'good'|'warn'|'bad'/,
    'The drawing module decides its own tone. It draws; readingBand judges.');
  need(fig, /note \|\| words/,
    'The verdict never reaches the caption, so a red bar would be the only thing saying a reading failed.');

  // ── The target is on the track ─────────────────────────────────────────────
  need(reports, /const target = good === 'high' \? 90 : good === 'zero' \? 10 : good === 'none' \? null : 100/,
    'No target is worked out, so a reading is drawn against nothing.');
  need(fig, /target !== null && target > 0 && target < 100/,
    'A target off the scale still draws a mark, which puts a line on the end cap pretending to be a threshold.');
  need(css, /\.stat__mark\{position:absolute/, 'The target mark is not drawn on the track.');

  // ── Over a hundred is not the same as full ─────────────────────────────────
  need(reports, /over: value > 100/,
    'Nothing works out that a reading is past its ceiling, so the drawing would have to decide it and become a second judge.');
  need(fig, /over = false/, 'The tile cannot be told a reading is over its ceiling.');
  need(fig, /\$\{over \? ' stat--over' : ''\}/, 'The tile is told, and draws it no differently.');
  need(css, /\.stat--over \.stat__track::after/,
    'A reading past 100 draws a full bar and nothing else, so 108% and exactly 100% are the same picture.');

  // ── Never measured is not zero ─────────────────────────────────────────────
  need(fig, /not measured/,
    'A reading that was never taken draws as an empty bar, which reads as a finding when it is a gap in the data.');

  // A target of none is not a capacity. On the capacity scale, 62% of arrivals late read
  // "healthy" — and with a badge on it, that verdict became a green tick.
  need(reports, /good === 'zero' \? \(value <= 10 \? 'low' : value <= 25 \? 'mid' : 'high'\)/,
    'There is no scale for a reading whose target is none at all, so lateness is judged as though it were a capacity with a comfortable middle.');
  for (const label of ['Arrived late', 'Cancelled']) {
    need(reports, new RegExp(`label: '${label}'[^}]*good: 'zero'`),
      `${label} is judged on the capacity scale, where a third of the trucks going wrong still reads as light.`);
  }

  // ── The view mark belongs to its section ────────────────────────────────────
  forbid(reports, /viewhead/, 'The standalone view band is still built. It repeated the dates its first section already carried.');
  forbid(css, /\.viewhead/, 'The standalone view band still has styles.');
  need(reports, /function withViewMark\(/, 'Nothing folds the view\'s mark into the section it introduces.');
  need(reports, /innerHTML = withViewMark\(/, 'The view mark is defined but never applied.');
  need(reports, /panel__head--lead/, 'The lead section head has no marker class, so it cannot be laid out differently from the rest.');

  // ── The brief can be read for a day that is not today ──────────────────────
  // A coordinator who can only see today finds out about two loads going to the same place on
  // the morning they go, which is the one morning it is too late to combine them. The whole
  // page already keyed off state.date; what was missing was a way to move it.
  need(queue, /data-queue-date/, 'The brief has no day picker, so the queue can only ever be read for today.');
  need(queue, /async function goToDate\(/, 'Nothing changes the day.');
  need(queue, /const isToday = \(\) =>/,
    'Nothing works out whether the day being read is today, so every screen that has to say "today" has to decide for itself.');
  // The brief is cached per location and date. Left unasked, the narrative under a Thursday
  // queue would still be Tuesday's, which is worse than no narrative.
  need(queue, /goToDate[\s\S]{0,400}fetchBrief\(\)/,
    'Changing the day reloads the queue but never asks for that day\'s brief, so the narrative and the numbers under it describe different days.');
  // Arriving a truck due on Thursday is a write somebody has to undo.
  need(queue, /function nextAction\(record\) \{[\s\S]{0,400}if \(!isToday\(\)\) return null;/,
    'A load on a day that is not today still offers Arrive and Complete, so one tap writes a status onto a truck that has not turned up.');

  // ── The day brief: what is on each truck, and a mark per category ───────────
  need(queue, /skids a truck on average/,
    'The brief counts trucks but never says what is on them. Twelve trucks at four skids and twelve at twenty read the same otherwise.');
  need(queue, /const each = rows => \(rows\.length \?/,
    'The skids-per-truck average is not guarded against a direction with no trucks in it.');
  need(queue, /briefcol__m/, 'The brief\'s categories carry no mark.');
  const FIXED = [['Trucks', 'truck'], ['Labour', 'crew'], ['Combining', 'combine']];
  for (const [group, mark] of FIXED) {
    need(queue, new RegExp(`title: '${group}',\\s*\\n?\\s*mark: '${mark}'`),
      `The brief's ${group} column has no ${mark} mark, so the four columns are told apart by their headings alone.`);
  }
  // Attention is the one column whose mark depends on what is in it: a clock when the
  // column is reporting trucks running late, the hazard triangle otherwise. So the rule
  // is checked rather than the spelling — every mark it can take must be a real drawing,
  // and none of them may be another column's, which is the thing this section exists to
  // protect. Pinning one literal would have said the conditional was wrong when it is not,
  // and would still have passed a typo that names a mark nothing draws.
  const attention = queue.match(/title: 'Attention',\s*\n?\s*mark: ([\s\S]+?),\s*\n?\s*points:/);
  if (!attention) {
    errors.push('The brief\'s Attention column names no mark, so the four columns are told apart by their headings alone.');
  } else {
    const drawn = new Set([...read('js/ui/marks.js').matchAll(/^\s{2}([a-z_0-9]+):/gm)].map(match => match[1]));
    const taken = new Set(FIXED.map(([, mark]) => mark));
    const named = [...attention[1].matchAll(/'([a-z_0-9]+)'/g)].map(match => match[1]);
    if (!named.length) errors.push('The brief\'s Attention column has a mark expression that names no mark at all.');
    for (const name of named) {
      if (!drawn.has(name)) errors.push(`The brief's Attention column asks for a '${name}' mark, which js/ui/marks.js does not draw. It would fall back to the bar chart and the column would be marked as a report.`);
      if (taken.has(name)) errors.push(`The brief's Attention column uses '${name}', which is already another column's mark. Two columns wearing one mark is the fault this section exists to catch.`);
    }
  }
  // The mark stands in a gutter of its own, big enough to tell four grey columns apart
  // from across a desk, with the heading and the points sharing one left edge beside it.
  // On the title line it could only ever be text-sized.
  need(queue, /<span class="briefcol__m"[\s\S]{0,120}<div class="briefcol__c">/,
    'The brief\'s mark is not in a gutter beside the column, so it cannot be more than text-sized.');
  need(css, /\.briefcol\{[^}]*grid-template-columns:auto/,
    'The brief column is not laid out with a gutter for its mark.');
  need(css, /\.briefcol__m svg\{width:[23]\.\d+em/,
    'The brief\'s mark is sized in px or is text-sized; it should be several em so it grows with the type and reads from a distance.');
  need(css, /\.briefcol__m\{[^}]*color:var\(--dock/,
    'The brief\'s marks are not in MaxDock blue.');
  // One outline around the whole glance, with the groups as columns inside it. Giving each
  // group its own card made a page of nothing but metric cards, which is a lot of border
  // for what is really one summary; a tinted panel behind cards was a box around boxes.
  need(css, /\.brief\{background:var\(--surface\);border:1px solid var\(--dock\)/,
    'The glance has no outline of its own in MaxDock blue, so its title, figures and groups do not read as one thing set apart from the schedule below.');
  forbid(css, /\.brief\{[^}]*linear-gradient/,
    'The brief sits on a tinted panel, which puts a box around a row of boxes.');
  forbid(css, /\.briefcol\{background:var\(--surface\);border:1px solid/,
    'Every group carries its own card border inside a card, which is a page of nothing but metric cards.');
  need(css, /\.briefcol\{[^}]*border-left:1px solid var\(--rule\)/,
    'Nothing separates one group from the next inside the outline.');
  need(css, /@container \(min-width:\d+em\)\{\.briefcols/,
    'The brief\'s column count is chosen by window width rather than by whether the card has room for the text, so Larger text keeps three columns on a window that has not grown.');
  forbid(css, /\.brief__body\{[^}]*max-height/,
    'The brief\'s body is bounded rather than the card. That is what crushed it to zero height and made the Combine action unclickable.');
  // Space, not a rule. This guard used to demand a border-top, and the owner struck the line:
  // a horizontal rule the full width of the card, above four columns that are already ruled
  // off from each other by their own verticals, cut one card into two boxes. The requirement
  // it was protecting is still real — the first bullet must not read as a caption on the
  // figure above it — so the guard now asks for the separation and refuses the line.
  need(css, /\.brief__body\{[^}]*padding-top:\s*\d/,
    'The figures and the groups run together. Inside one outline they are two bands and need clear air between them.');
  forbid(css, /\.brief__body\{[^}]*border-top/,
    'The band between the figures and the groups is drawn as a rule across the whole card. The owner struck that line: the gap separates them, and the columns carry the only rules on the card.');
}

if (errors.length) {
  console.error('Report readings verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Report readings verification passed');
