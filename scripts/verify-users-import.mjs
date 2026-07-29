#!/usr/bin/env node
// Bulk user import: the rules that make a spreadsheet of people safe to run.
//
// Fifty locations fill in one template and send it back. What must stay true:
// every row goes through the same edge function a hand-made account goes through
// (so the checks, the audit trail and the temporary-password rules are the same
// ones), nothing is created until the sheet has been shown back on screen with a
// verdict per row, and the file is read in the browser — a sheet of names,
// emails and passwords is not sent anywhere to be parsed.
import { readFileSync, existsSync } from 'node:fs';

const errors = [];
const read = path => readFileSync(path, 'utf8');
const require_ = (text, pattern, message) => { if (!pattern.test(text)) errors.push(message); };

for (const file of ['js/pages/users.js', 'js/ui/sheet.js']) {
  if (!existsSync(file)) errors.push(`Missing ${file}`);
}

if (!errors.length) {
  const page = read('js/pages/users.js');
  const sheet = read('js/ui/sheet.js');

  require_(page, /data-import-users/, 'The Users page offers no bulk import.');
  require_(page, /data-import-template/, 'There is no template for a location to fill in.');
  require_(page, /function readImportRows/, 'The sheet is not read into rows the page has checked.');
  require_(page, /function renderImportPreview/, 'A sheet must be shown back on screen before anything is created.');
  // Every row is an account creation. Going straight to the table, or to
  // auth.admin, would skip the checks the invite function makes and leave no
  // audit trail — the same account created two different ways.
  require_(page, /maxdock-invite-user/, 'Imported rows must be created through the same edge function as Add user.');
  if (/db\.insert\(\s*'profiles'|auth\.admin/.test(page)) errors.push('An imported user must not be written straight to the database.');
  require_(page, /record\.errors\.length/, 'Rows with problems must not be created.');
  require_(page, /downloadImportResults|data-import-download/, 'An import must hand back the sign-ins it created.');

  // A file with names, emails and passwords on it is read here, not uploaded to
  // anything to be converted first.
  require_(sheet, /DecompressionStream/, 'An .xlsx must be opened in the browser.');
  require_(sheet, /export async function readSheet/, 'sheet.js must expose one way to read a file.');
  if (/fetch\(|XMLHttpRequest|https?:\/\//.test(sheet)) errors.push('sheet.js must not send the file anywhere.');
}

if (errors.length) {
  console.error('Bulk user import verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Bulk user import verification passed');
