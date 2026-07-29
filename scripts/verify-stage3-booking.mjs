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
  requireText(page, /Load[\s\S]*Vehicle[\s\S]*Time[\s\S]*Contact[\s\S]*Confirm/, 'The five-step booking order is missing.');
  requireText(page, /list_capacity_aware_appointment_slots/, 'Capacity-aware slot RPC is missing.');
  requireText(page, /CUSTOMER_SLOT_PROJECTION/, 'Customer-safe slot response projection is missing.');
  requireText(page, /list_routed_appointment_slots/, 'Routed slot RPC is missing.');
  requireText(page, /book_appointment/, 'Standard booking RPC is missing.');
  requireText(page, /book_routed_appointment/, 'Routed booking RPC is missing.');
  requireText(page, /booking_templates/, 'Booking template persistence is missing.');
  requireText(page, /View existing appointment/, 'Same-day consolidation “View existing” choice is missing.');
  requireText(page, /Choose loads to combine/, 'Same-day consolidation “Choose loads to combine” choice is missing.');
  requireText(page, /Continue separately/, 'Same-day consolidation “Continue separately” choice is missing.');
  requireText(page, /data-combine-shelf/, 'The combine picker is missing from the time step.');
  requireText(page, /function combinedSkids/, 'Slot search does not account for combined loads.');
  requireText(page, /p_skid_count: combinedSkids\(\)/, 'The slot search still asks for this load alone, not the combined load.');
  requireText(page, /function combinedNotes/, 'Combined loads are not recorded on the booking.');
  // Ticking loads has to end with one truck, not a note about several. The merge
  // moves the skids across, grows the window and cancels what it absorbed, and it
  // is the whole point of combining — a picker that only annotates leaves exactly
  // the duplicate trucks the owner is trying to stop.
  requireText(page, /merge_appointments/, 'Ticked loads are never merged — combining only annotates the booking.');
  requireText(page, /function fullnessBar/, 'A combined truck must say how full it ended up.');
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
