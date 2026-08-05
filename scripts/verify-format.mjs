// Date arithmetic regression tests.
//
// The board's forward button did nothing and its back button skipped two days,
// because addDaysInput stepped a UTC-midnight instant and then reformatted it in
// the location's zone — and UTC midnight is still the previous day everywhere in
// North America. Nothing caught it: the layout audit renders a page, it does not
// press a button and check the date changed.
//
// A date input is a calendar day, so these assertions pin the result to being the
// same in every zone.
import { format } from '../js/format.js';

const failures = [];
const check = (label, actual, expected) => {
  if (actual !== expected) failures.push(`${label}: got ${actual}, expected ${expected}`);
};

for (const timezone of ['America/Toronto', 'America/Vancouver', 'America/Los_Angeles', 'America/New_York', 'UTC']) {
  const location = { timezone };
  check(`${timezone} +1`, format.addDaysInput('2026-07-20', 1, location), '2026-07-21');
  check(`${timezone} -1`, format.addDaysInput('2026-07-20', -1, location), '2026-07-19');
  check(`${timezone} 0`, format.addDaysInput('2026-07-20', 0, location), '2026-07-20');
  check(`${timezone} month end`, format.addDaysInput('2026-07-31', 1, location), '2026-08-01');
  check(`${timezone} year end`, format.addDaysInput('2026-01-01', -1, location), '2025-12-31');
  check(`${timezone} leap`, format.addDaysInput('2028-02-28', 1, location), '2028-02-29');
  // Stepping forward and back must land where it started, at a DST boundary too.
  const forward = format.addDaysInput('2026-03-08', 1, location);
  check(`${timezone} round trip over DST`, format.addDaysInput(forward, -1, location), '2026-03-08');
  // A full timestamp is read as the calendar day it starts on. Reports passed one
  // and got its own string back, which left the range start blank on the page.
  check(`${timezone} timestamp`, format.addDaysInput('2026-07-27T12:00:00Z', -29, location), '2026-06-28');
  check(`${timezone} timestamp no step`, format.addDaysInput('2026-07-27T00:00:00.000Z', 0, location), '2026-07-27');
}

// Every date the app hands to the API or prints on screen is a plain calendar day.
// A timestamp leaking through is the defect this catches.
for (const [label, value] of [['last7', format.addDaysInput('2026-07-27', -6)], ['last30', format.addDaysInput('2026-07-27', -29)]]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) failures.push(`${label}: ${value} is not a plain calendar day`);
}

if (failures.length) {
  console.error('Date arithmetic failures:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('Date arithmetic verifier passed.');
