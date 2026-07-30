#!/usr/bin/env node
// Bulk appointment import: the rules that make a spreadsheet of loads safe to run.
//
// A site coming onto MaxDock has next week already written down somewhere, and
// typing forty loads into a wizard is why it never gets written down here. So a
// sheet can be imported. What must stay true, or the import becomes a second way
// to create an appointment with a second set of rules:
//
//   Every row goes through `book_appointment` or `book_routed_appointment` — the
//   same functions the wizard calls — so the notice period, the booking window,
//   the capacity check, the direction windows, the duration rules and the dock
//   choice are the ones that already exist. Never a write to `appointments`, and
//   never `update_appointment_details` to fix one up afterwards.
//
//   Nothing is booked until the sheet has been read back on screen with a verdict
//   against every row, and rows with problems are not booked at all.
//
//   After hours is never granted by a sheet. It is a decision somebody takes with
//   their name against it, on the screen, one load at a time.
//
//   The file is read in the browser. A customer's shipment list is not sent
//   anywhere to be parsed.
import { readFileSync, existsSync } from 'node:fs';

const errors = [];
const read = path => readFileSync(path, 'utf8');
const require_ = (text, pattern, message) => { if (!pattern.test(text)) errors.push(message); };

for (const file of ['js/ui/appointment-import.js', 'js/ui/sheet.js', 'js/pages/board.js', 'js/ui/pagehead.js']) {
  if (!existsSync(file)) errors.push(`Missing ${file}`);
}

if (!errors.length) {
  const importer = read('js/ui/appointment-import.js');
  const board = read('js/pages/board.js');
  const head = read('js/ui/pagehead.js');

  // Reachable, from the screen where somebody is looking at the schedule.
  require_(head, /importAppointments/, 'There is no Import appointments action.');
  require_(head, /data-import-appointments/, 'The import action has nothing to open it.');
  require_(board, /data-import-appointments/, 'The dock board does not offer the appointment import.');
  require_(board, /createAppointmentImport/, 'The dock board does not open the import dialog.');
  require_(board, /importAppointments', can\('appointment\.create'\)/, 'The import must be offered only to an account that may book.');

  // One way to book, and this is not a new one.
  require_(importer, /book_routed_appointment.*book_appointment|book_appointment.*book_routed_appointment/s,
    'An imported row must be booked by the same functions the booking screen calls.');
  if (/db\.insert\(\s*'appointments'|db\.update\(\s*'appointments'|from\(\s*'appointments'\s*\)/.test(importer)) {
    errors.push('An imported appointment must not be written straight to the appointments table.');
  }
  if (/update_appointment_details|change_appointment_status|block_dock_time/.test(importer)) {
    errors.push('The import must not reach for another appointment function to finish a row off.');
  }
  require_(importer, /function bookingArgs/, 'The import does not build the booking arguments the RPCs take.');
  require_(importer, /p_requester_location_id: routed/, 'A Max site at the other end must be booked as a routed movement.');

  // Read back before anything happens, and refused rows stay unbooked.
  require_(importer, /function readRows/, 'The sheet is not read into rows the dialog has checked.');
  require_(importer, /function renderPreview/, 'A sheet must be shown back on screen before anything is booked.');
  require_(importer, /rows\.filter\(record => !record\.errors\.length\)/, 'Rows with problems must not be booked.');
  require_(importer, /els\.run\.disabled = running \|\| !good\.length/, 'The button must be dead until at least one row is ready.');
  require_(importer, /function renderResults/, 'An import must say what it booked and what it did not.');
  require_(importer, /data-import-download/, 'An import must hand back its result.');

  // The one permission a sheet cannot grant itself.
  require_(importer, /p_after_hours_confirmed: false/, 'A sheet must never confirm an after-hours booking.');

  // Checked against this site's own configuration, not against a list in the code.
  require_(importer, /appointmentTypes|truckTypes|handlingTypes/, 'Rows are not checked against the types enabled at this location.');
  require_(board, /reference: \(\) =>/, 'The import is not given this location\'s enabled types to check against.');

  // A customer's shipment list is read here and goes nowhere else.
  if (/fetch\(|XMLHttpRequest|https?:\/\/|db\.edge\(/.test(importer)) {
    errors.push('The import must not send the sheet anywhere.');
  }
  require_(importer, /readSheet/, 'The import must read the file through the one sheet reader.');
}

if (errors.length) {
  console.error('Bulk appointment import verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Bulk appointment import verification passed');
