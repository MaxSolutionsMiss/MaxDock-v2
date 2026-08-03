#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';

const required = [
  'app/book.html',
  'js/pages/booking.js',
  'js/ui/qr.js',
  'assets/maxdock.css',
  'js/db.js',
  'js/router.js',
];
const errors = [];
const read = path => readFileSync(path, 'utf8');
const requireText = (text, pattern, message) => {
  if (!pattern.test(text)) errors.push(message);
};

for (const file of required) {
  if (!existsSync(file)) errors.push(`Missing ${file}`);
}

if (!errors.length) {
  const html = read('app/book.html');
  const page = read('js/pages/booking.js');
  const qr = read('js/ui/qr.js');
  const details = read('js/ui/appointment-details.js');
  const css = read('assets/maxdock.css');
  const db = read('js/db.js');
  const router = read('js/router.js');

  requireText(html, /js\/pages\/booking\.js/, 'Booking page module is not declared in app/book.html.');
  // The step order, read off the declaration rather than sniffed out of the file.
  //
  // This line used to be /Load[\s\S]*Vehicle[\s\S]*Time[\s\S]*Contact[\s\S]*Confirm/ against the
  // whole module, and it gave false confidence for as long as it existed: [\s\S]* spans
  // anything, so it was satisfied by those five words appearing in that order anywhere across
  // a hundred kilobytes. When the wizard went from five steps to three it still passed --
  // matching renderLoadStep, renderVehicleStep, renderTimeStep and renderConfirmStep strung
  // across 3,860 characters of unrelated code, with the word Contact somewhere in the middle.
  // A guard that cannot notice two steps being removed was never testing the order.
  const steps = page.match(/const STEPS = Object\.freeze\(\[([^\]]*)\]\)/);
  if (!steps) {
    requireText(page, /$a/, 'The booking wizard does not declare its steps as a frozen list, so nothing can check what they are.');
  } else {
    const names = [...steps[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
    const EXPECTED = ['Load & truck', 'Time', 'Confirm'];
    if (names.join(' | ') !== EXPECTED.join(' | ')) {
      requireText(page, /$a/, `The booking wizard runs ${names.join(', ')}. It should run ${EXPECTED.join(', ')} -- what is on the truck and which truck it is are one question, and the requester is prefilled from the account so it belongs in the summary rather than on a step of its own.`);
    }
  }
  // A step nothing renders is a dead end, and a renderer no step reaches is dead code.
  // A call, not a mention. The first version of this matched `renderVehicleStep(` and was
  // therefore satisfied by the function's own declaration, so dropping the call from the step
  // dispatch left it green -- the exact failure it exists to catch.
  for (const renderer of ['renderLoadStep', 'renderVehicleStep', 'renderTimeStep', 'renderConfirmStep']) {
    requireText(page, new RegExp(`(?<!function )\\b${renderer}\\(`), `${renderer} is never called, so a step of the booking wizard draws nothing.`);
  }
  requireText(page, /data-field="requester_email"/, 'The requester email is nowhere in the wizard, so a booking cannot be attributed.');

  // ── No bare step numbers ────────────────────────────────────────────────────
  //
  // This exists because the wizard's step indices drifted twice in one day. Five steps became
  // three and three call sites kept counting the old ones -- setStep returned before the slot
  // fetch and findSlots refused to look for times until a time had been chosen, so nobody could
  // book an appointment. Two more survived the first fix, and the worse of them was
  // attemptBooking calling validateStep(4): a step that no longer existed, matching no branch,
  // so the last gate before submitting validated nothing.
  //
  // Every one of those was a literal integer standing in for a step. They are named constants
  // now, and a bare number coming back fails the build rather than waiting to be found by
  // somebody trying to book a truck.
  const codeOnly = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // `target` as well as `step`. The first draft of this guard matched only the word "step" and
  // therefore sailed past `if (target !== 1) return;` -- which is setStep's own parameter, and
  // the single line that stopped anybody booking. A guard that misses the bug it was written
  // for is worse than none, because it certifies the thing it cannot see.
  const bareSteps = [...codeOnly.matchAll(/(?:\b(?:step|target)\s*[=!]==?\s*|setStep\(|validateStep\(|maxStep,\s*)(\d+)/g)];
  if (bareSteps.length) {
    requireText(page, /$a/, `The booking wizard compares a step against a bare number (${bareSteps.map(match => match[0].trim()).join(', ')}). Use the STEP constants: a literal here has silently pointed at a step that no longer existed twice, once leaving nobody able to book at all.`);
  }
  requireText(page, /const STEP = Object\.freeze\(\{[^}]*LOAD[^}]*TIME[^}]*CONFIRM/,
    'The booking steps are not named, so every reference to one is a number that can drift out of step with the list.');
  // The final gate must walk the whole list rather than name one index, or it goes stale the
  // next time a step is added or removed -- which is exactly how it came to validate nothing.
  requireText(page, /STEPS\.map\(\(label, index\) => validateStep\(index\)\)/,
    'The check before a booking is submitted names a single step instead of walking them all, so it will validate nothing the next time the steps change.');
  requireText(page, /list_capacity_aware_appointment_slots/, 'Capacity-aware slot RPC is missing.');
  requireText(page, /CUSTOMER_SLOT_PROJECTION/, 'Customer-safe slot response projection is missing.');
  requireText(page, /list_routed_appointment_slots/, 'Routed slot RPC is missing.');
  requireText(page, /book_appointment/, 'Standard booking RPC is missing.');
  requireText(page, /book_routed_appointment/, 'Routed booking RPC is missing.');
  requireText(page, /booking_templates/, 'Booking template persistence is missing.');
  requireText(page, /data-action="view-existing"/, 'Same-day consolidation offers no way to look at the appointment it is asking about, so the choice has to be made blind.');
  // Both answers, and both reachable. The rule is that combining is offered and declining it is
  // one press away — not the exact wording, which changed when the two buttons became a plain
  // yes and no. What must never happen is a dialog that offers only the combine.
  requireText(page, /data-action="combine-load"/, 'Same-day consolidation offers no way to combine.');
  requireText(page, /data-action="continue-separately"/, 'Same-day consolidation offers no way to decline and book separately. Combining must never be the only way out of this dialog.');
  requireText(page, /never (do it on its own|combine them automatically)/, 'The dialog does not say that MaxDock will not combine loads on its own, which is the assurance that makes the offer safe to show.');
  requireText(page, /data-combine-shelf/, 'The combine picker is missing from the time step.');
  requireText(page, /function combinedSkids/, 'Slot search does not account for combined loads.');
  requireText(page, /p_skid_count: combinedSkids\(\)/, 'The slot search still asks for this load alone, not the combined load.');
  requireText(page, /function combinedNotes/, 'Combined loads are not recorded on the booking.');
  // Ticking loads has to end with one truck, not a note about several. The merge
  // moves the skids across, grows the window and cancels what it absorbed, and it
  // is the whole point of combining — a picker that only annotates leaves exactly
  // the duplicate trucks the owner is trying to stop.
  requireText(page, /merge_appointments/, 'Ticked loads are never merged — combining only annotates the booking.');
  // Drawn as the trailer, not as a bar. The guard names the drawing rather than the bar it
  // replaced, because what has to survive is that the booking shows how full the truck ended
  // up in the same picture the report will show it in — not that it uses any one widget.
  requireText(page, /function fullnessFigure/, 'A combined truck must say how full it ended up.');
  requireText(page, /truckFill\(\{/, 'The booking draws fullness as its own widget rather than as the trailer every other screen draws.');
  // Two places offer combining — the booking wizard, and the operations brief for
  // loads already on the board — and they must be two doors onto one function.
  // A second implementation would be a second set of rules about who may cancel
  // whose load, which is exactly the thing that went wrong the first time.
  const combineDialog = read('js/ui/combine-loads.js');
  requireText(combineDialog, /merge_appointments/, 'Combining from the board must call the same merge as booking.');
  if (/update\(\s*'appointments'|db\.remove\(/.test(combineDialog)) {
    errors.push('Combining must not cancel or edit appointments directly — that is the merge function\u2019s job.');
  }
  // A repeating booking is a pattern the server turns into ordinary appointments
  // through the ordinary booking function. If the page ever books the dates
  // itself, every rule a single booking obeys stops applying to a repeat.
  requireText(page, /create_appointment_series/, 'The repeat pattern is not sent to the series RPC.');
  requireText(page, /format\.repeatingDates/, 'Repeat dates must be worked out in format.js, not with local date maths.');
  requireText(page, /data-repeat-day/, 'The repeat day picker is missing.');
  // The check-in code goes through the RPC, not a table read: reading the column
  // needs appointment.view, which the customer booking their own shipment — the
  // one account that most needs a code for a driver — does not hold.
  requireText(page, /get_appointment_check_in_token/, 'The check-in code must be read through its RPC.');
  requireText(details, /get_appointment_check_in_token/, 'Every appointment must offer its check-in code, not only a freshly booked one.');
  requireText(page, /combineReviewed/, 'The consolidation prompt must not ask again once the picker has been used.');
  // A shortcut is a saved booking plus a way to reach it without a keyboard. The
  // link is the booking page with a location and a template on it — the pair the
  // page has understood since templates were built — and the QR is drawn here.
  // Quick QR is its own screen under Settings, not another control on the last
  // step of the booking wizard. The card is drawn from the shortcut it points at,
  // so editing a code changes what every printed copy of it books.
  const shortcutCard = read('js/ui/shortcut-card.js');
  const settings = read('js/pages/settings.js');
  requireText(shortcutCard, /renderQr\(/, 'The quick code must be drawn in the browser.');
  requireText(settings, /function renderQuickQr/, 'Settings is missing the Quick QR section.');
  requireText(settings, /data-print-shortcut/, 'Quick QR offers no printable code.');
  requireText(settings, /is_shared: true/, 'A code on a wall has to work for whoever scans it.');
  // A quick code can choose its own time. The lead is the whole point of the
  // setting — the gap that leaves room to make the truck up or to combine the
  // load — so a code set to choose must carry one, and choosing must go through
  // the ordinary slot search rather than inventing a time.
  requireText(settings, /auto_time/, 'A quick code cannot be told to choose its own time.');
  requireText(settings, /lead_minutes/, 'A code that chooses its own time must carry the gap it has to leave.');
  requireText(page, /function autoPickSlot/, 'Nothing picks the time for a code set to choose it.');
  requireText(page, /await findSlots\(\{ quiet: true \}\)/, 'An automatic time must come from the slot search, not from arithmetic.');
  if (/qrserver|chart\.googleapis/i.test(shortcutCard)) errors.push('A quick code must not be drawn by a third-party service.');
  requireText(page, /poll\.suspend\(SLOT_SUSPENSION\)/, 'The five-second poll is not suspended while the slot picker is open.');
  requireText(page, /poll\.resume\(SLOT_SUSPENSION\)/, 'The slot-picker poll suspension is not released.');
  requireText(page, /p_after_hours_confirmed:\s*isStaff\(\)/, 'After-hours confirmation is not guarded as staff-only.');
  requireText(page, /Copy confirmation/, 'Copy confirmation action is missing.');
  requireText(page, /Open email draft/, 'Open email draft action is missing.');
  requireText(page, /renderQr\(/, 'Local QR rendering is not connected to the confirmation panel.');
  requireText(qr, /no appointment data leaves the browser/i, 'The local QR module attribution/privacy note is missing.');
  requireText(css, /\.modal/.test(css) ? /\.steps/ : /$a/, 'Approved booking modal styles are missing from the canonical stylesheet.');
  requireText(db, /async insert\(/, 'db.js is missing the insert mutation wrapper.');
  requireText(db, /async remove\(/, 'db.js is missing the delete mutation wrapper.');
  requireText(router, /data-open-booking|maxdock:open-booking/, 'Booking modal action is missing from the shell.');

  if (/\bconfirm\s*\(/.test(page)) errors.push('Native confirm() is not permitted for consolidation.');
  if (/qrserver\.com|api\.qrserver/i.test(page + qr)) errors.push('A third-party QR service is referenced.');
  if (/MutationObserver/.test(page)) errors.push('MutationObserver is not permitted in booking.');
}

if (errors.length) {
  console.error('Stage 3 Booking verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Stage 3 Booking verification passed');
