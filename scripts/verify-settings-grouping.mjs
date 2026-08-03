#!/usr/bin/env node
// One subject to a settings section, and the three subjects that were split across two.
//
//   The pre-release audit found these by reading the screen's own help text, which is the
//   part worth keeping. A section that has to tell you where the rest of itself lives has
//   been divided in the wrong place, and that sentence is evidence a build can check for:
//
//     "Setup minutes here override the truck type's default for this location only.
//      Skids per truck is under Capacity."
//     "Fewer trucks on one date ... Standing limits live under Dock assignment."
//
//   Both of those cross-references are now gone, because both subjects were reunited. So
//   this file guards the destination AND forbids the sentence coming back, since the
//   sentence returning would mean the split had.
//
//   The third was a naming fault rather than a placement one: the standing limit was
//   "Most at once" and the per-date override was "At once" — the same idea under two
//   labels in two sections.
import { readFileSync } from 'node:fs';

const errors = [];
const settings = readFileSync('js/pages/settings.js', 'utf8');
// Comments stripped before anything is forbidden. The first run of this file failed on two
// sentences that exist only in the comment above SECTIONS, where they are quoted as the
// history of what was moved and why. A guard that cannot tell a rendered string from a note
// about the past punishes writing the note down, which is the opposite of what is wanted.
const rendered = settings.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const need = (pattern, message) => { if (!pattern.test(settings)) errors.push(message); };
const forbid = (pattern, message) => { if (pattern.test(rendered)) errors.push(message); };

// The body of a top-level function, so a containment test is exact rather than a guess at
// how many characters apart two things are. The first version of this file used a character
// window and reported Trucks at once as missing from Capacity when it was 51 lines below it.
function bodyOf(name) {
  const start = settings.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const next = settings.indexOf('\nfunction ', start + 1);
  return settings.slice(start, next < 0 ? settings.length : next);
}

// ── Eight sections, each named for one subject ──────────────────────────────
const list = settings.slice(settings.indexOf('const SECTIONS = ['), settings.indexOf('];', settings.indexOf('const SECTIONS = [')));
const ids = [...list.matchAll(/id:\s*'([\w-]+)'/g)].map(match => match[1]);
const EXPECTED = ['hours', 'timing', 'booking', 'capacity', 'docks', 'trucks', 'labour', 'quickqr'];
if (ids.join(',') !== EXPECTED.join(',')) {
  errors.push(`The settings sections are ${ids.join(', ')}. They should be ${EXPECTED.join(', ')} — one subject each, in the order a site is set up.`);
}
// Every id has to be reachable, or a section is in the nav and opens nothing.
for (const id of EXPECTED) {
  if (!new RegExp(`\\b${id}:\\s*render`).test(settings)) {
    errors.push(`The "${id}" section is offered in the nav but the panel map has no renderer for it, so choosing it draws the wrong screen.`);
  }
}

// ── Skids per truck belongs with the trucks ────────────────────────────────
if (!/renderTruckCapacity\(/.test(bodyOf('renderTruckTypes'))) {
  errors.push('Skids per truck is not rendered with the truck types, so a manager setting up a trailer still has to visit two sections to finish one job.');
}
forbid(/Skids per truck is under Capacity/,
  'The truck types section still points at Capacity for skids per truck. That sentence is the evidence the subject is split; it should not need saying.');

// ── The two limits are one subject under one name ──────────────────────────
need(/function renderTrucksAtOnce/,
  'The standing truck limit and the per-date cap are not rendered together.');
if (!/renderTrucksAtOnce\(/.test(bodyOf('renderCapacity'))) {
  errors.push('Trucks at once is not under Capacity & limits, which is where a limit belongs.');
}
forbid(/Standing limits live under Dock assignment/,
  'The day cap still points at Dock assignment for the standing limit. Both are limits and they are in one place now, so the cross-reference is a lie.');
forbid(/field__label">Most at once</,
  'The standing limit is still called "Most at once" while the per-date one is called "At once". Same idea, one name.');
// The day cap must have left Labour. A limit on how many trucks may be booked is not a
// labour setting, and it was only ever there because the crew feels the consequence.
if (/data-section-form="day-cap"/.test(bodyOf('renderLabour'))) {
  errors.push('Cap a day is still rendered inside Labour. It is a booking limit, not a labour setting.');
}

// ── Booking rules exists, and dock assignment is findable ──────────────────
need(/function renderBookingRules/, 'There is no Booking rules section.');
if (!/renderAssignment\(/.test(bodyOf('renderBookingRules'))) {
  errors.push('Dock assignment is not under Booking rules. It was invisible before — rendered at the bottom of the Docks table and named nowhere — so anybody looking for how MaxDock picks a door had to find it by accident.');
}
if (/renderAssignment\(/.test(bodyOf('renderDocks'))) {
  errors.push('Dock assignment is still rendered inside the Docks section as well, so the same form appears twice.');
}

// ── Nothing may be saved by a form the page no longer draws ────────────────
// Moving a form between sections is safe precisely because saving keys off the form
// name rather than the section, but a renamed form with no matching branch would save
// nothing and say it saved. Checked both ways.
const forms = new Set([...settings.matchAll(/data-section-form="([\w-]+)"/g)].map(match => match[1]));
const saves = new Set([...settings.matchAll(/kind === '([\w-]+)'/g)].map(match => match[1]));
for (const form of forms) {
  if (!saves.has(form)) errors.push(`The "${form}" form has no save branch, so its Save button does nothing.`);
}
for (const save of saves) {
  if (!forms.has(save)) errors.push(`There is a save branch for "${save}" but no form by that name, so the branch is dead.`);
}

if (errors.length) {
  console.error('Settings grouping verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Settings grouping verification passed: ${EXPECTED.length} sections, ${forms.size} forms, every one saved by a branch that exists`);
