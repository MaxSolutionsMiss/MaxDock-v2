#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const check = (condition, file, message) => {
  if (!condition) failures.push({ file, message });
};
const read = path => readFileSync(join(root, path), 'utf8');

const required = [
  'app/my-appointments.html',
  'js/pages/my-appointments.js',
  'js/ui/modal.js',
  'js/format.js',
  'assets/maxdock.css',
];
for (const file of required) check(existsSync(join(root, file)), file, 'Required Stage 2 file is missing.');

if (!failures.length) {
  const html = read('app/my-appointments.html');
  const page = read('js/pages/my-appointments.js');
  const modal = read('js/ui/modal.js');
  const format = read('js/format.js');
  const css = read('assets/maxdock.css');

  check(/assets\/maxdock\.css/.test(html), 'app/my-appointments.html', 'The page must use the canonical stylesheet.');
  check(/js\/pages\/my-appointments\.js/.test(html), 'app/my-appointments.html', 'The Stage 2 page module is not loaded.');
  check(/list_my_appointments/.test(page), 'js/pages/my-appointments.js', 'The customer-safe appointment RPC is not used.');
  check(/cancel_my_appointment/.test(page), 'js/pages/my-appointments.js', 'Secure own-appointment cancellation is not wired.');
  check(/get_user_preference/.test(page) && /save_user_preference/.test(page), 'js/pages/my-appointments.js', 'The default appointment view is not persisted.');
  check(/interval:\s*5000/.test(page), 'js/pages/my-appointments.js', 'My Appointments must refresh every five seconds.');
  check(/export const \{ mount, refresh, destroy \}/.test(page), 'js/pages/my-appointments.js', 'The common page-module contract is incomplete.');
  check(/createModal/.test(page), 'js/pages/my-appointments.js', 'The shared accessible modal is not used.');
  check(!/\bDate\s*\.|new\s+Date\s*\(/.test(page), 'js/pages/my-appointments.js', 'Page code must not perform date work outside format.js.');
  check(!/\b(?:dock_id|dock_name|counterpart_dock_id|block_reason|after_hours_confirmed_by)\b/.test(page), 'js/pages/my-appointments.js', 'An internal scheduling field appears in the customer-facing page module.');
  check(!/db\.select\s*\(\s*['"]appointments['"]/.test(page), 'js/pages/my-appointments.js', 'The page must not query the appointments table directly.');
  // Changing a booking is one server call that re-checks the window with the load
  // as it will be. A page that edited the fields and moved the time separately
  // could leave a truck booked for longer than the slot it holds.
  check(/update_my_appointment/.test(page), 'js/pages/my-appointments.js', 'Editing an appointment must go through the single update RPC.');
  check(/data-edit-skids/.test(page) && /data-edit-truck/.test(page) && /data-edit-type/.test(page), 'js/pages/my-appointments.js', 'The edit dialog must cover the load, not only the time.');
  check(!/reschedule_my_appointment/.test(page), 'js/pages/my-appointments.js', 'Two ways to move an appointment is one too many — use the update RPC.');
  check(/poll\.suspend/.test(modal) && /poll\.resume/.test(modal), 'js/ui/modal.js', 'Opening a modal must suspend polling and closing it must resume polling.');
  check(/event\.key\s*!==\s*['"]Tab['"]/.test(modal) && /event\.key\s*===\s*['"]Escape['"]/.test(modal), 'js/ui/modal.js', 'The modal must trap Tab and support Escape.');
  check(/returnFocus/.test(modal), 'js/ui/modal.js', 'The modal must restore focus after closing.');
  check(/nowEpoch\(\)/.test(format), 'js/format.js', 'Current-time arithmetic must be provided by format.js.');
  check(/\.card/.test(css) && /\.kpis/.test(css) && /\.table/.test(css), 'assets/maxdock.css', 'Approved composed appointment layout styles are missing.');

  // ── The check-in code belongs to whoever holds the booking ──────────────────
  //
  // It lived only on the dock board, which is the one screen an outside company cannot open,
  // so a customer whose driver had lost the code had to telephone the plant. That is the call
  // this product exists to remove. The database was never the obstacle:
  // get_appointment_check_in_token already admits the creator and anybody whose email matches
  // the requester, not only staff holding appointment.view. This screen simply never asked.
  check(/get_appointment_check_in_token/.test(page), 'js/pages/my-appointments.js',
    'My appointments never asks for the check-in code, so the people who cannot open the dock board have no way to get it to a driver.');
  check(/renderQr\(/.test(page), 'js/pages/my-appointments.js',
    'The check-in code is fetched and then never drawn.');
  check(/navigator\.share/.test(page), 'js/pages/my-appointments.js',
    'There is no way to pass an appointment on from the screen that holds it.');
  // Share must carry the check-in link rather than the page: a link to My appointments is
  // useless to a driver with no MaxDock account, and the token link works in anybody's hands.
  // Read out of the share handler itself rather than by proximity. A window of characters
  // matched checkInUrl in the handler *above* this one, so replacing the share link with the
  // current page URL left this green -- the precise fault it exists to catch.
  const shareBody = page.slice(page.indexOf("share.addEventListener('click'"), page.indexOf('element.append(head'));
  check(/checkInUrl\(currentRecord\)/.test(shareBody), 'js/pages/my-appointments.js',
    'Share does not send the check-in link, so it hands somebody a page they cannot open.');
  // A share the person cancelled is them changing their mind, not a fault to report at them.
  check(/AbortError/.test(page), 'js/pages/my-appointments.js',
    'A share the person cancelled is reported back to them as a failure.');

  // ── A booking does not disappear on the day it belongs to ───────────────────
  //
  // isUpcoming used to read "not in a terminal status AND the start time has not passed", and
  // it took a card out from under the person who had just acted on it, two ways at once.
  // Marking a load Shipped sets status completed, which counted as terminal, so it vanished the
  // moment the truck pulled away -- on the road, due today, and no longer findable by whoever
  // scanned it. Separately, a truck booked at 09:00 and being unloaded at 09:30 had already
  // failed the start-time test, so a load standing at the dock was not upcoming either.
  check(!/TERMINAL_STATUSES/.test(page), 'js/pages/my-appointments.js',
    'A set of terminal statuses decides what is upcoming again, which is what made a load disappear the moment somebody marked it Shipped.');
  check(/format\.inputDate\(record\.start_at, location\) === format\.todayInput\(location\)/.test(page),
    'js/pages/my-appointments.js',
    'A load that has started or finished today is not kept in view for the rest of its day, so acting on a booking makes it vanish.');
  // Cancelled is the one thing held back, and that is not a disappearance: it has its own view
  // and its own count, which is where somebody goes looking for it.
  check(/normaliseStatus\(record\.status\) === 'cancelled'\) return false/.test(page),
    'js/pages/my-appointments.js',
    'Cancelled bookings are mixed into Upcoming, so the list somebody works from fills with loads that are not happening.');
}

console.log('\nMaxDock Stage 2 My Appointments verification');
console.log('─'.repeat(58));
for (const failure of failures) console.log(`  ✗ ${failure.file} · ${failure.message}`);
console.log('─'.repeat(58));
if (failures.length) {
  console.log(`  ${failures.length} failure(s).\n`);
  process.exit(1);
}
console.log('  Stage 2 My Appointments structure is valid.\n');
