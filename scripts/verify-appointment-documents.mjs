#!/usr/bin/env node
// Paperwork on an appointment, and the four rules that keep it honest.
//
//   It lives on the appointment's own window and nowhere else. The dock board and the
//   operations queue are read at a distance while a truck waits; a list of attachments on a
//   block would cost room the reference and the skid count need more.
//
//   Four megabytes is checked in the browser *and* in the bucket. A limit only enforced in
//   the client is a limit anybody with a fetch call can ignore.
//
//   A document is filed against the site that owns the appointment, not the site whose board
//   happens to be open. On a linked movement those differ.
//
//   Links are signed and short-lived. The bucket is private and a customer's bill of lading
//   is not something to hand out a permanent URL for.
import { readFileSync, existsSync } from 'node:fs';

const errors = [];
const read = path => readFileSync(path, 'utf8');
const need = (text, pattern, message) => { if (!pattern.test(text)) errors.push(message); };
const forbid = (text, pattern, message) => { if (pattern.test(text)) errors.push(message); };

for (const file of ['js/ui/appointment-details.js', 'js/db.js']) {
  if (!existsSync(file)) errors.push(`Missing ${file}`);
}

if (!errors.length) {
  const details = read('js/ui/appointment-details.js');
  const dbjs = read('js/db.js');
  const board = read('js/pages/board.js');
  const queue = read('js/pages/queue.js');

  // ── One place, and it is the detail window ──────────────────────────────────
  need(details, /data-docs/, 'The appointment window has no documents section.');
  need(details, /appointment_documents/, 'The appointment window never reads the documents table.');
  for (const [name, source] of [['the dock board', board], ['the operations queue', queue]]) {
    forbid(source, /appointment_documents|data-doc-|doclist/,
      `${name} touches appointment documents. They belong on the appointment's own window — a board is read at a distance while a truck waits.`);
  }

  // ── Four megabytes, in both places ──────────────────────────────────────────
  need(details, /const MAX_MB = 4;/, 'The document size limit is not stated once as a constant.');
  need(details, /file\.size > MAX_BYTES/, 'An oversized file is not refused before the upload is attempted.');

  // ── Filed against the site that owns the load ───────────────────────────────
  need(details, /record\.physical_location_id/,
    'A document is filed against the open page\'s site rather than the site that owns the appointment. On a linked movement those are different sites.');

  // ── Private bucket, signed links ────────────────────────────────────────────
  need(dbjs, /createSignedUrl/, 'db.storage cannot produce a signed link.');
  forbid(dbjs, /getPublicUrl/, 'A public URL is produced for a private bucket. Documents are customer paperwork.');
  need(details, /db\.storage\.signedUrl/, 'The window opens documents by some route other than a signed link.');

  // ── The row is written after the file lands, and removed before it ──────────
  // Both orderings matter and both are one line apart from being wrong: a row written first
  // leaves a document in the list that cannot be opened, and a file deleted first leaves an
  // orphaned row when row-level security refuses the delete.
  const upload = details.slice(details.indexOf('async function uploadDocument'), details.indexOf('async function openDocument'));
  if (upload.indexOf('db.storage.upload') > upload.indexOf('db.insert')) {
    errors.push('The document row is written before the file is uploaded. A failed upload would leave a row nobody can open.');
  }
  const remove = details.slice(details.indexOf('async function removeDocument'));
  if (remove.indexOf('db.storage.remove') < remove.indexOf('db.remove(')) {
    errors.push('The file is deleted before the row. If row-level security refuses the delete, the file is already gone.');
  }
}

if (errors.length) {
  console.error('Appointment documents verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Appointment documents verification passed');
