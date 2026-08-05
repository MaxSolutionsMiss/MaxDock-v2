#!/usr/bin/env node
// Which truck a combined run needs.
//
// This is arithmetic that decides whether a booking is refused, so it is tested directly
// rather than only through a browser. The module imports nothing, which is why it can be.
//
// The cases that matter are the ones where a plausible-looking answer is wrong: the next
// truck up that still does not fit, a site where nothing is big enough, and a truck whose
// capacity nobody has entered — where the honest answer is "no opinion", not "it fits".
import { truckUpgrade, upgradeMessage } from '../js/truck-ladder.js';

const errors = [];
const check = (ok, detail) => { if (!ok) errors.push(detail); };

// A Max site's real ladder, as stacked at that site.
const SITE = [
  { code: 'trailer_53', name: '53 ft Trailer', skid_capacity: 26 },
  { code: 'trailer_48', name: '48 ft Trailer', skid_capacity: 20 },
  { code: 'straight_truck_26', name: '26 ft Straight Truck', skid_capacity: 10 },
  { code: 'cube_van', name: 'Cube Van', skid_capacity: 2 },
  { code: 'courier_van', name: 'Courier Van', skid_capacity: 1 },
];

// ── Nothing to fix ────────────────────────────────────────────────────────────
check(truckUpgrade(SITE, 'trailer_53', 26) === null, 'A run exactly filling the trailer is not over capacity.');
check(truckUpgrade(SITE, 'trailer_53', 25) === null, 'A run inside the trailer must not be offered an upgrade.');
check(truckUpgrade(SITE, 'trailer_48', 20) === null, 'Exactly full on a 48 is not over.');

// ── The ordinary case: one step up ────────────────────────────────────────────
{
  const up = truckUpgrade(SITE, 'trailer_48', 24);
  check(up !== null, 'Twenty-four skids on a twenty-skid trailer is over capacity.');
  check(up?.over === 4, `Over by ${up?.over}; twenty-four into twenty is four.`);
  check(up?.fits?.code === 'trailer_53', `Offered ${up?.fits?.code}; a 53 ft holds 26 and takes it.`);
}

// ── The case a naive "next size up" gets wrong ────────────────────────────────
// Thirty-four skids on a 26 ft straight truck. The next truck up is the 48, which holds
// twenty and still does not fit. The answer is the 53.
{
  const up = truckUpgrade(SITE, 'straight_truck_26', 24);
  check(up?.fits?.code === 'trailer_53',
    `A 24-skid run on a 26 ft truck was offered ${up?.fits?.code}; the 48 holds 20 and does not fit, so it must be the 53.`);
}
{
  const up = truckUpgrade(SITE, 'cube_van', 15);
  check(up?.fits?.code === 'trailer_48',
    `Fifteen skids off a cube van was offered ${up?.fits?.code}; the smallest that holds 15 is the 48, not the 53.`);
}

// ── Nothing at this site is big enough ────────────────────────────────────────
{
  const up = truckUpgrade(SITE, 'trailer_48', 40);
  check(up !== null, 'Forty skids on a twenty-skid trailer is over capacity.');
  check(up?.fits === null, 'Forty skids fits nothing here, so no truck may be offered.');
  check(up?.biggest?.code === 'trailer_53', 'The largest trailer must be named so the message can say what it holds.');
  const message = upgradeMessage(up);
  check(/26/.test(message) && /more than one truck/.test(message),
    `The message must say what the largest holds and that the run needs splitting. It says: "${message}"`);
}

// ── A capacity nobody entered is not "it fits" ────────────────────────────────
{
  const unset = [
    { code: 'trailer_53', name: '53 ft Trailer', skid_capacity: null },
    { code: 'trailer_48', name: '48 ft Trailer', skid_capacity: 20 },
  ];
  check(truckUpgrade(unset, 'trailer_53', 40) === null,
    'With no capacity entered for the booked truck there is no opinion to give — guessing either way is worse than silence.');
  // And a type with no capacity is never the answer, because moving a load onto a trailer
  // whose capacity is unknown does not make it fit; it makes it unmeasured.
  const up = truckUpgrade(unset, 'trailer_48', 24);
  check(up?.fits === null, `A truck with no capacity entered was offered as the fix (${up?.fits?.code}).`);
}

// ── A truck type that is not at this site at all ──────────────────────────────
check(truckUpgrade(SITE, 'flatbed', 40) === null, 'An unknown truck type has no capacity here, so no opinion.');
check(truckUpgrade([], 'trailer_53', 40) === null, 'A site with no truck types configured cannot be advised.');
check(truckUpgrade(SITE, 'trailer_48', 0) === null, 'A run of nothing is not over capacity.');

// ── The message names the numbers a person would check ────────────────────────
{
  const message = upgradeMessage(truckUpgrade(SITE, 'trailer_48', 24));
  for (const part of ['24 skids', '4 more', '48 ft Trailer', '20', '53 ft Trailer', '26']) {
    check(message.includes(part), `The offer must contain "${part}". It says: "${message}"`);
  }
}
check(upgradeMessage(null) === '', 'No upgrade means no sentence.');

if (errors.length) {
  console.error('Truck ladder verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('Truck ladder verification passed');
