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
  // ── The glance is four named sections, and it fits ─────────────────────────
  //
  // Each column used to carry a large drawing above its heading. It read from across a desk
  // and it cost about forty pixels of a card that has a ceiling and scrolls once it is
  // reached, so on a laptop the fourth column's last bullet — the Combining lane and the
  // button that acts on it — sat below the fold of the card itself. The heading took the
  // job over: body size rather than caption size, uppercase, and in MaxDock blue. So what is
  // guarded here is the *height*, not the drawing.
  for (const group of ['Trucks', 'Labour', 'Combining', 'Attention']) {
    need(queue, new RegExp(`title: '${group}'`),
      `The glance has no ${group} section. The card is four named sections and it is four whether or not today has anything in one of them.`);
  }
  forbid(queue, /briefcol__m/,
    'The glance columns carry a drawing above the heading again. It is about forty pixels each on a card with a ceiling, which is what pushed the Combining action below the card\'s own scroll line.');
  forbid(queue, /title: '(?:Trucks|Labour|Combining|Attention)',\s*\n?\s*mark:/,
    'A glance section names a mark again. Nothing draws it, so it is dead weight that will grow a gutter back the next time somebody wires it up.');
  forbid(css, /\.briefcol__m/,
    'The glance still styles a mark gutter, so the next thing to add one gets the height back for free.');
  forbid(css, /\.briefcol\{[^}]*grid-template-columns:auto/,
    'The glance column still reserves a gutter beside its text, which costs every bullet width for a drawing that is no longer there.');
  // The whole point of removing the drawing was to let the heading do the telling apart, so
  // the heading has to actually be a heading. --t-base is 14.5px against the --t-micro 11.5px
  // it was, a quarter bigger, which is the change that was asked for.
  need(css, /\.briefcol__t\{font-size:var\(--t-base\)/,
    'The glance headings are back at caption size. With no mark beside them that leaves four columns of near-identical grey text and nothing to tell them apart.');
  need(css, /\.briefcol__t\{[^}]*color:var\(--dock\)/,
    'The glance headings are grey, the same weight of colour as the points under them. Colour is what tells them apart now that nothing is drawn.');
  // A rule under each heading said "this is a heading" in four more lines, on a card that
  // already carries three verticals and a border. The owner struck them: too many lines makes
  // a summary card look busy, and blue says the same thing without drawing anything.
  forbid(css, /\.briefcol__t\{[^}]*border-bottom/,
    'Each glance heading is ruled off again. That is four more lines on a card that already has three verticals and a border, which is what made it read as busy.');
  // The columns are stretched to the tallest of the four, and a grid with auto rows spreads
  // its spare height between them unless told not to — so a short column sat halfway down its
  // box and no two sections started their points at the same height.
  need(css, /\.briefcol\{[^}]*align-content:start/,
    'The glance sections are not anchored to the top of their row, so a column with less in it floats to the middle and the four sets of points no longer start on one line.');

  // ── The queue's filters ride on the title line, not in a band ───────────────
  //
  // The queue is a fixed-height page: every pixel above the schedule is a pixel the schedule
  // does not get, and the glance card is what gives way. A band cost about seventy of them to
  // hold controls that fit beside the three buttons already on the title line. Removing it is
  // what let the reading come up onto the screen.
  forbid(queue, /controlsBar\(/,
    'The operations queue has grown a controls band again. It is about seventy pixels on a page that cannot scroll, and it holds a control that fits on the title line.');
  need(queue, /pageHead\('Operations queue',[\s\S]{0,400}controls:/, 'The queue\'s find is not on its title line.');
  need(queue, /data-filter-search/, 'There is no way to find one load on the screen whose job is finding the load that needs somebody.');
  // No direction on this page. It is the whole day at one site and the reason somebody opens
  // it is to see all of it; inbound against outbound is the dock board's question and the
  // board has the control. Checked in both places, because a select left in the markup with
  // nothing reading it is worse than either answer.
  forbid(queue, /data-filter-direction/,
    'The queue has a direction filter again. That question belongs to the dock board, and two controls asking it is one too many.');
  forbid(queue, /state\.direction/,
    'The queue still filters by direction. Either the control came back or the code behind a control that is gone did not.');
  // A stacked caption is what makes a field taller than a button, and one taller control is
  // what turns a single line back into two. The name lives on the control instead.
  need(queue, /bare: true/, 'The queue\'s search still carries a stacked caption, which makes it taller than the buttons beside it and wraps the head onto a second line.');
  // A placeholder that does not fit is worse than a shorter one: the box cuts it mid-word and
  // the reader is left with "Reference, PO, comp". Measured in the browser against the real
  // face at both text settings — at Larger the same box holds a third fewer characters — and
  // "Ref, PO, company" is the longest of the candidates that clears 14em at both.
  need(queue, /placeholder: 'Ref, PO, company'/,
    'The queue\'s search placeholder is not the one measured to fit its box. Anything longer is cut off mid-word at 14em, and cut worse again at the Larger text setting.');
  // The width and the placeholder are one decision, so they are guarded together: 14em is what
  // the owner asked for once the direction select left the row, and the placeholder above is
  // the longest that clears 14em. Widening this without revisiting the other leaves a field
  // stated at one size and filled for another.
  need(css, /\.ctrl-field--bare\{flex:0 1 14em/,
    'The head search is not at the width its placeholder was measured against.');
  need(css, /\.pagehead__actions\{flex:1 1 auto/,
    'The page head\'s action row sizes itself again. Left to do that it measured 633px against 974px of free row and wrapped its own contents, which is an 80px head with three hundred pixels of empty space beside it.');
  need(css, /\.pagehead__actions\{[^}]*align-items:center/,
    'The head row stretches its children, so a select or a search box beside the buttons stops being one control tall.');
  // The magnifier was ruled off but not filled. On the title line it stands in a row of
  // pressable things, and a bare glyph on a white field read as decoration on the input.
  need(css, /\.searchbox__go\{[\s\S]{0,240}background:var\(--surface-sunk\)/,
    'The magnifier has no ground of its own, so in a row beside Export and Full screen it reads as a mark printed on the field rather than as something to press.');
  // Live filtering means the button is not needed to search — which is exactly why it is easy
  // to leave unwired. It was, on this page, until it moved somewhere people would press it.
  need(queue, /data-search-go[\s\S]{0,200}renderTable\(\)/,
    'The queue\'s magnifier does nothing when it is pressed.');
  // ── The report mark is knocked out of the brand blue ───────────────────────
  //
  // A pale disc with a dark mark in it is decoration on the page. Reversed out of solid
  // MaxDock blue it is a plate, and the same object as the MaxDock tile in the corner of the
  // rail, which is what the owner asked it to match.
  need(css, /\.panel__mark\{background:var\(--dock\);color:#fff\}/,
    'The report mark sits in a wash again instead of being reversed out of the brand blue.');
  // --dock, not --dock-deep. The deep one is the hover and the ink colour; the mark is meant
  // to be the Max Solutions blue itself.
  forbid(css, /\.panel__mark\{background:var\(--dock-deep\)/,
    'The report mark uses the deep blue rather than the brand blue it was asked to match.');
  // Reversed, the second tone needs more of itself: 42% white on solid blue is most of the way
  // back to the ground, and the trailer band, the pallet foot and the second worker vanish.
  need(css, /\.panel__mark \.mk \.mk__b\{opacity:\.5\d\}/,
    'The mark\'s second tone is left at the value tuned for a pale badge. On solid blue that is nearly the background, so half of every mark disappears.');
  // The empty and error badge is the same shape doing the opposite job: it introduces an empty
  // list or a failure, and a solid brand-blue disc shouts at somebody just told nothing is there.
  need(css, /\.state__icon,\.panel__mark\{[^}]*background:var\(--dock-wash\)/,
    'The empty-state badge lost its wash. A solid brand-blue disc is the wrong volume for "nothing here" and "this failed".');

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
