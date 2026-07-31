#!/usr/bin/env node
// The rollback file, and the reasons it is checked by the build rather than trusted.
//
//   A migration applies to the shared live Supabase project the moment it runs, and closing a
//   pull request does not undo it. docs/ROLLBACK.md is the only thing standing between that and
//   an owner who needs today's state back. A rollback document is also the one document nobody
//   reads until the day it has to be right, which is the worst possible time to discover that
//   somebody reformatted a code block eighteen commits ago.
//
//   So the saved RPC definitions are hashed. The hashes were taken from the live database with
//   pg_get_functiondef before any change was made, and they are pinned here. If the saved copy
//   is edited — reindented, "tidied", partially pasted over — the hash moves and this fails.
//   That is the whole point: the file is worth exactly as much as its fidelity.
//
//   Note the hashes describe the BASELINE definitions, not the current ones. After the
//   up-migration runs, the live database will not match them, and must not. This checks the
//   document against what it claims to preserve, which is a fact fixed in the past.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const errors = [];
const DOC = 'docs/ROLLBACK.md';

if (!existsSync(DOC)) {
  console.error('Rollback verification failed');
  console.error(`- ${DOC} is missing. It is a deliverable, not a nicety: without it a database change that has already been applied to the live project has no written way back.`);
  process.exit(1);
}

const doc = readFileSync(DOC, 'utf8');
const need = (pattern, message) => { if (!pattern.test(doc)) errors.push(message); };

// ── The baseline, stated once and exactly ──────────────────────────────────────
const BASELINE = '72cfb56d3705f8207d93f4c1b594a9c578bf9f8d';
need(new RegExp(BASELINE),
  `The baseline commit ${BASELINE} is not recorded. "Roll back to before this work" is not a runnable instruction without it.`);

// ── The reverse SQL, written before the forward SQL ────────────────────────────
need(/drop column if exists service_started_at/i,
  'The down-migration does not drop service_started_at, so the reverse of the migration is incomplete.');
need(/drop column if exists departed_at/i,
  'The down-migration does not drop departed_at, so the reverse of the migration is incomplete.');
need(/drop column if exists track_service_start/i,
  'The down-migration does not drop the Start toggle column.');
need(/drop column if exists track_departure/i,
  'The down-migration does not drop the Departed toggle column.');
// A rollback nobody can run twice is a rollback that fails halfway and cannot be resumed.
if (/alter table public\.appointments\s*\n\s*drop column (?!if exists)/i.test(doc)) {
  errors.push('The down-migration drops a column without IF EXISTS, so it cannot be re-run after a partial failure.');
}

// ── Nothing destructive may hide in a document about safety ────────────────────
//
// Scanned over the instructions, not over the saved function bodies. A restored definition is
// whatever the function actually was, and some of these functions legitimately delete their own
// rows — save_role_permissions clears the permissions a role no longer holds, which is how
// saving works. Refusing that text would mean the document could not record the function it
// exists to restore, and the way people "fix" a check like that is to reword the copy, which is
// exactly what the hashes above are there to prevent.
//
// So the saved blocks are cut out first. Everything else — the down-migration, the numbered
// procedure, every line a reader is told to paste and run — is still scanned, which is where a
// destructive statement would actually do harm.
const instructions = doc.replace(/```sql\nCREATE OR REPLACE FUNCTION public\.\w+\([\s\S]*?\$function\$\n```/g, '');
for (const [pattern, what] of [
  [/drop table/i, 'a DROP TABLE'],
  [/truncate/i, 'a TRUNCATE'],
  [/delete from public\./i, 'a DELETE'],
  [/drop column if exists (checked_in_at|completed_at|cancelled_at|status)\b/i, 'a drop of a pre-existing column'],
]) {
  if (pattern.test(instructions)) errors.push(`The rollback document contains ${what} in the SQL it tells somebody to run. Rolling back must not destroy anything that existed at the baseline.`);
}

// ── The saved definitions, hashed rather than eyeballed ────────────────────────
const SAVED = {
  change_appointment_status: { md5: '38690f2ece47b9e9b3f2db69a10f9b77', chars: 2441 },
  receive_appointment: { md5: '892af0bc89b64b7b8bf48f122dc23753', chars: 2251 },
  // The two that decide who may read a load's history and its check-in code. Captured before
  // the either-end change, for the same reason as the others: these are the functions a
  // rollback has to put back, and a copy nobody hashed is a copy nobody can trust.
  get_appointment_history: { md5: '58951c308c7e8af25fdff12ab029e3c3', chars: 6571 },
  get_appointment_check_in_token: { md5: '4c3cf60c43f1c9b40e19168eab6a6942', chars: 862 },
  // The two the role editor writes through. Captured before System Admin became editable —
  // these are the definitions that refuse to touch it at all, which is what a rollback puts
  // back.
  save_role_permissions: { md5: '0a111f654a458f01b4f655aecbda26f6', chars: 1604 },
  save_role_page_visibility: { md5: '9733737e45d1ba27cc4f127568605d03', chars: 1336 },
};
const blocks = [...doc.matchAll(/```sql\n(CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?\$function\$)\n```/g)];
const seen = new Set();
for (const [, body, name] of blocks) {
  seen.add(name);
  const expected = SAVED[name];
  if (!expected) continue;
  // Same normalisation the database side used: carriage returns stripped, trailing blank lines
  // trimmed. Postgres treats both line endings identically, so this compares what actually
  // matters — the text of the function — and not which editor last touched the file.
  const normalised = body.replace(/\r/g, '').replace(/\n+$/, '');
  const md5 = createHash('md5').update(normalised).digest('hex');
  if (md5 !== expected.md5 || normalised.length !== expected.chars) {
    errors.push(`The saved definition of ${name} no longer matches the one captured from the live database at the baseline (document ${md5}/${normalised.length} chars, expected ${expected.md5}/${expected.chars}). Restoring from an edited copy would not restore the function that was actually there.`);
  }
}
for (const name of Object.keys(SAVED)) {
  if (!seen.has(name)) errors.push(`The prior definition of ${name} is not saved in ${DOC}, so a function this work modifies cannot be restored word for word.`);
}
// The table of hashes is what a person checks by hand; it must agree with what the build checks.
for (const [name, { md5, chars }] of Object.entries(SAVED)) {
  if (!doc.includes(md5)) errors.push(`The checksum for ${name} is not printed in the document, so nobody can verify the copy by hand.`);
  if (!new RegExp(`\\b${chars}\\b`).test(doc)) errors.push(`The character count for ${name} is not printed in the document.`);
}

// ── A procedure, not a description ─────────────────────────────────────────────
need(/##\s*8\.\s*The procedure/i, 'There is no numbered procedure section.');
const procedure = doc.slice(doc.search(/##\s*8\.\s*The procedure/i));
const steps = (procedure.match(/^\s*\d+\.\s+\S/gm) || []).length;
if (steps < 8) errors.push(`The rollback procedure has ${steps} numbered steps. It has to carry somebody through settings, the pull request and the SQL editor on their own.`);
need(/SQL Editor/i, 'The procedure never says where in Supabase to run the SQL, which is the step somebody who does not use Supabase daily will stall on.');
need(/default(s)? off|ship \*\*off\*\*|ships? \*\*off\*\*/i,
  'The document does not state that the new actions default to off, which is the instant rollback that needs no code and no SQL.');

// ── The layer that needs no permission from anybody ────────────────────────────
need(/Layer 3/, 'The operational layer (the per-location toggles) is not described.');
need(/Layer 2/, 'The database layer is not described.');
need(/Layer 1/, 'The code layer is not described.');

if (errors.length) {
  console.error('Rollback verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Rollback verification passed: baseline ${BASELINE.slice(0, 7)}, ${blocks.length} saved definition(s) match their captured checksums`);
