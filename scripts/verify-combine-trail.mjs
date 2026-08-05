#!/usr/bin/env node
// Where a combined load's freight went, and where it came from.
//
// A merge cancels one booking and moves its freight onto another. The cancelled number is
// never reused, so somebody is going to turn up holding it weeks later, and the only useful
// answer is the number of the truck the freight is actually on. That answer has to survive
// in three places, and each of them has failed at least once:
//
//   The database writes it. merge_appointments records a row naming every reference it
//   absorbed, because the row-level trigger can only say the skid count changed and
//   "Appointment details updated" is not an answer to "where did my load go".
//
//   The history hands it back. get_appointment_history puts combined_from into details as
//   well as into the summary sentence, or the window can render the words but cannot use
//   the facts.
//
//   The window shows it on the load, not only in the activity. Somebody asking "what is on
//   this truck" and somebody chasing a cancelled reference are the same person, and they
//   should not have to read a log to find out.
import { readFileSync, existsSync } from 'node:fs';

const errors = [];
const read = path => readFileSync(path, 'utf8');
const need = (text, pattern, message) => { if (!pattern.test(text)) errors.push(message); };

for (const file of ['js/ui/appointment-details.js', 'scripts/audit-supabase-stub.js']) {
  if (!existsSync(file)) errors.push(`Missing ${file}`);
}

if (!errors.length) {
  const details = read('js/ui/appointment-details.js');
  const stub = read('scripts/audit-supabase-stub.js');

  // ── The window puts it on the load ──────────────────────────────────────────
  need(details, /combined_from/,
    'The appointment window never reads combined_from, so a combined load says nothing about what came onto it.');
  need(details, /cell\((\s|\S)*Combined from/,
    'The numbers that came onto this truck are not shown with the load itself, only in the activity underneath it.');
  // It is added after the history resolves, so a slow or forbidden history call cannot hold
  // up the rest of the panel. Reading it before the fetch would simply always be empty.
  const openFn = details.slice(details.indexOf('async function open(record'));
  const historyAt = openFn.indexOf('get_appointment_history');
  const cellAt = openFn.indexOf('Combined from');
  if (historyAt < 0 || cellAt < 0 || cellAt < historyAt) {
    errors.push('The Combined from line is built before the history is fetched, so it can only ever be empty.');
  }

  // ── A combine is not an ordinary edit ───────────────────────────────────────
  need(details, /entry\.details\?\.is_merge/,
    'A combine is coloured like any other edit in the activity, which is the one line somebody chasing a load is scanning for.');

  // ── The browser walk actually exercises it ──────────────────────────────────
  // Without a merge in the stub's history, every screenshot and every audit run proves only
  // that the window renders appointments that were never combined.
  need(stub, /combined_from:\s*\[/,
    'The stub history contains no combine, so no browser check ever renders the case this exists for.');
}

if (errors.length) {
  console.error('Combine trail verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Combine trail verification passed');
