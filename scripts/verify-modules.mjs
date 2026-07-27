// Every shipped module must parse.
//
// This exists because a syntax error in js/pages/booking.js reached a browser: the
// router imports the booking page inside a try/catch and replaces the dialog with
// "The booking form could not be loaded", so the fault surfaced as a polite message
// rather than as a failure. `node --check` did not catch it either — it parses a
// .js file as CommonJS, where the error sat in a branch it never reached.
//
// Importing each module in Node throws for two different reasons: a parse error,
// which is a real defect, and a missing browser global, which is expected outside a
// browser. Only the first fails this gate.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

function modules(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return modules(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

const failures = [];
for (const file of modules(path.join(ROOT, 'js'))) {
  try {
    await import(pathToFileURL(file).href);
  } catch (error) {
    if (error instanceof SyntaxError) failures.push(`${path.relative(ROOT, file)} — ${error.message}`);
  }
}

if (failures.length) {
  console.error('Modules that do not parse:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('Module parse check passed.');
