#!/usr/bin/env node
// What the dock board and the operations queue show, and what they no longer show.
//
//   A cancelled load is not work. It is dropped before either page sees it — not filtered in
//   one view and left in another — because the worst case is exactly the one that matters: a
//   combine cancels half of itself, and that half would otherwise sit on the schedule beside
//   the truck now carrying its freight. Two entries, one load, and the wrong one on top.
//
//   A no-show is not a cancellation. The truck was expected and did not come, which is
//   something the day has to account for, so it stays.
//
//   Trucks and skids are different questions. Twenty trucks carrying two skids each is not
//   the day that twenty trucks carrying twenty is, so both counts exist and either can be
//   switched off — which means being in the picker's option list, not only on the strip.
import { readFileSync, existsSync } from 'node:fs';

const errors = [];
const read = path => readFileSync(path, 'utf8');
const need = (text, pattern, message) => { if (!pattern.test(text)) errors.push(message); };
const forbid = (text, pattern, message) => { if (pattern.test(text)) errors.push(message); };

const FILES = ['js/pages/board.js', 'js/pages/queue.js'];
for (const file of FILES) if (!existsSync(file)) errors.push(`Missing ${file}`);

// The card definition for one metric, so a check can look at what it actually counts
// rather than only at whether the name appears somewhere in the file.
const cardLine = (source, id) => source.split('\n').find(line => line.includes(`id: '${id}'`)) || '';

if (!errors.length) {
  const board = read('js/pages/board.js');
  const queue = read('js/pages/queue.js');

  // ── Cancelled loads never reach either page ─────────────────────────────────
  // The filter has to sit where the records are built. Doing it in one view leaves the
  // cancelled row in every other consumer of the same list — the metric cards, the
  // day brief, the wall display — which is how a load gets counted twice.
  const boardBuild = board.slice(board.indexOf('records: (scheduleRows'), board.indexOf('async function loadEnabledTypes'));
  need(boardBuild, /isCancelled\(record\)|status !== 'cancelled'/,
    'The dock board builds its records without dropping cancelled loads. Filtering later leaves them in the metric cards and the wall.');
  need(board, /const isCancelled = record =>[^\n]*'cancelled'[^\n]*merged_into_appointment_id/,
    'The board has no single test for a cancelled load covering both an outright cancellation and the half a combine cancels.');

  const queueBuild = queue.slice(queue.indexOf('const records = (scheduleRows'), queue.indexOf('const records = (scheduleRows') + 600);
  need(queueBuild, /status !== 'cancelled'/,
    'The operations queue builds its records without dropping cancelled loads.');
  need(queueBuild, /merged_into_appointment_id/,
    'The queue drops cancelled loads but not the half a combine absorbed, which is the case that matters.');

  // A status filter offering a group nothing can ever be in is a dead control.
  forbid(board, /<option value="cancelled">/,
    'The dock board still offers a Cancelled status filter. Nothing can match it now, so it is a control that always empties the board.');

  // ── A no-show is not a cancellation ─────────────────────────────────────────
  forbid(board, /const isCancelled = record =>[^\n]*no_show/,
    'A no-show is treated as a cancellation and dropped. The truck was expected and did not come — that belongs on the day, not deleted from it.');
  forbid(queueBuild, /no_show/,
    'The queue drops no-shows along with cancellations.');

  // ── Inbound and outbound truck counts, on both pages and in the brief ───────
  for (const [name, source] of [['dock board', board], ['operations queue', queue]]) {
    for (const id of ['inboundTrucks', 'outboundTrucks']) {
      const line = cardLine(source, id);
      if (!line) { errors.push(`The ${name} has no ${id} metric card.`); continue; }
      // Counting skids here would be the plausible mistake — the file already has an
      // inbound card that sums them, one line away.
      forbid(line, /skid_count/, `The ${name}'s ${id} card counts skids, not trucks.`);
      need(line, /\.length/, `The ${name}'s ${id} card does not count the loads it filtered.`);
    }
    need(source, /const DEFAULT_CARDS = KPI_CARDS\.map/,
      `The ${name}'s default metric strip is a hand-written list, so the new counts are off until somebody finds the picker.`);
    need(source, /KPI_CARDS\.map\(card => \(\{ id: card\.id/,
      `The ${name}'s Customize picker is not built from the card list, so the new counts cannot be switched on or off.`);
  }

  // The queue's day brief is a separate strip with its own figures and its own picker.
  const brief = queue.slice(queue.indexOf('const BRIEF_FIGURES'), queue.indexOf('const DEFAULT_BRIEF_FIGURES'));
  for (const id of ['inboundTrucks', 'outboundTrucks']) {
    need(brief, new RegExp(`id: '${id}'`),
      `Today at a glance cannot show ${id} — the figure is missing from the picker's list.`);
    need(queue, new RegExp(`\\{ id: '${id}', label: '\\w+ trucks', value: `),
      `Today at a glance lists ${id} in the picker but never produces a value for it.`);
  }
  need(queue, /const DEFAULT_BRIEF_FIGURES = BRIEF_FIGURES\.map/,
    'The brief\'s default figures are a hand-written list, so the new truck counts are off by default.');
}

// ── A load reads differently at the end that is waiting for it ─────────────────
//
// A Max-to-Max movement is one appointment row holding both ends, and
// list_location_schedule mirrors it onto the counterpart's board with the direction flipped
// and is_linked_movement set. The status came across untouched, which meant the moment
// Mississauga finished loading, Guelph's board called the incoming truck "Completed" -- a load
// still standing in another yard, described to the site waiting for it as finished.
//
// Completed belongs to the end that did the work. departed_at is what says the truck has set
// off, and it was already on the row: no column and no status was added to fix this.
const fmt = read('js/format.js');
need(fmt, /movementStatus\(record = \{\}\)/,
  'Nothing translates a movement status for the end that is reading it, so a counterpart site sees the origin\'s word for a load that has not reached it.');
// The early return itself, not the mere mention of the flag. Matching is_linked_movement
// anywhere passed while the guard clause was deleted, because the sibling helper below
// mentions it too -- and without that clause the owning site's own board would have its
// statuses rewritten as though it were the one waiting.
need(fmt, /if \(!record\.is_linked_movement\) return this\.role\(record\.status\);/,
  'The translation does not return early on a load the reading site owns, so it would rewrite a status on the board that did the work.');
need(fmt, /departed_at \? 'En route' : 'Loaded'/,
  'A completed load is not distinguished by whether it has actually left, which is the one fact the receiving site cannot otherwise learn.');
for (const [file, label] of [['js/pages/board.js', 'dock board'], ['js/pages/queue.js', 'operations queue'], ['js/ui/appointment-details.js', 'appointment window']]) {
  need(read(file), /format\.movementStatus\(/,
    `The ${label} prints the raw status, so a Max-to-Max load reads as Completed at the site still waiting for it.`);
}
// The origin has to be able to say it has gone, and on an internal movement that cannot sit
// behind a switch that ships off: the other site has nothing else to read.
const recv = read('js/pages/receiving.js');
need(recv, /const isInternal = record => Boolean\(record\?\.requester_location_id\)/,
  'Receiving cannot tell an internal movement from a customer load, so it cannot treat the handoff differently.');
need(recv, /step\.id === 'departed' && isInternal\(record\)/,
  'Departed stays behind the per-site switch on an internal movement, so the receiving Max site is left guessing whether the truck has set off.');
need(recv, /'Departed, en route'/,
  'The departure button says the same thing for an internal handoff as for a customer truck leaving for good.');

if (errors.length) {
  console.error('Schedule metrics verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Schedule metrics verification passed');
