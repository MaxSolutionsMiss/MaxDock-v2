#!/usr/bin/env node
// Reading a settings section, and editing one, are two modes with two sets of buttons.
//
// The screen used to show all three at once — Reset, Save, Edit — and grey out the two that
// did not apply. That put a blue Save next to a blue Edit with one of them dead, and a
// disabled primary button reads as broken rather than as "not yet". With two of them
// nobody could tell which one the screen was asking for.
//
// So: reading offers one thing, Edit. Editing offers two, throw it away or keep it, and
// exactly one of them is primary. The buttons that do not apply are not on screen at all.
//
// And the word is Cancel. Reset means back to defaults, which is a different and much more
// frightening promise than discarding the change somebody just made.
import { readFileSync, existsSync } from 'node:fs';

const errors = [];
const need = (text, pattern, message) => { if (!pattern.test(text)) errors.push(message); };
const forbid = (text, pattern, message) => { if (pattern.test(text)) errors.push(message); };

for (const file of ['js/pages/settings.js', 'assets/maxdock.css']) {
  if (!existsSync(file)) errors.push(`Missing ${file}`);
}

if (!errors.length) {
  const settings = readFileSync('js/pages/settings.js', 'utf8');
  const css = readFileSync('assets/maxdock.css', 'utf8');
  const foot = settings.slice(settings.indexOf('function saveFoot('), settings.indexOf('function applyLocks('));
  const locks = settings.slice(settings.indexOf('function applyLocks('), settings.indexOf('function editSection('));

  // ── One primary, and only the buttons that apply ────────────────────────────
  const primaries = (foot.match(/btn--primary/g) || []).length;
  if (primaries !== 1) {
    errors.push(`A section footer carries ${primaries} primary buttons. Editing has one outcome worth pushing towards, so exactly one of them is primary.`);
  }
  need(foot, /data-edit-section[^>]*>Edit</, 'Reading a section does not offer Edit.');
  need(foot, /type="submit" hidden/, 'Save is on screen while the section is locked. A greyed-out Save beside a live Edit is two controls where there is one decision.');
  need(foot, /data-reset hidden/, 'Cancel is on screen while there is nothing to cancel.');

  // ── Swapped, not disabled ───────────────────────────────────────────────────
  need(locks, /\[data-edit-section\]'\)\.hidden = editing/, 'Edit is disabled rather than removed when the section opens.');
  need(locks, /\[type="submit"\]'\)\.hidden = !editing/, 'Save is disabled rather than removed while the section is locked.');
  forbid(locks, /\[data-edit-section\]'\)\.disabled/, 'Edit is still being disabled, which is the pattern that put two blue buttons side by side.');
  forbid(locks, /\[type="submit"\]'\)\.disabled/, 'Save is still being disabled rather than hidden.');

  // ── The word, and the state ─────────────────────────────────────────────────
  need(foot, />Cancel</, 'The discard button says something other than Cancel. "Reset" promises back-to-defaults, which is not what it does.');
  forbid(foot, />Reset</, 'The discard button still says Reset, which reads as a promise to restore defaults.');
  need(foot, /data-edit-flag/, 'Nothing says the section is open except the buttons at the bottom of it.');
  need(locks, /classList\.toggle\('secform--on'/, 'An open section is not marked, so only its footer changes when it unlocks.');
  need(css, /\.secform--on\{/, 'An open section has no styling to distinguish it from a locked one.');
}

if (errors.length) {
  console.error('Settings edit mode verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Settings edit mode verification passed');
