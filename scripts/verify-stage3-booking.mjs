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
  requireText(page, /Go back and combine/, 'Same-day consolidation “Go back and combine” choice is missing.');
  requireText(page, /Continue separately/, 'Same-day consolidation “Continue separately” choice is missing.');
  requireText(page, /poll\.suspend\(SLOT_SUSPENSION\)/, 'The five-second poll is not suspended while the slot picker is open.');
  requireText(page, /poll\.resume\(SLOT_SUSPENSION\)/, 'The slot-picker poll suspension is not released.');
  requireText(page, /p_after_hours_confirmed:\s*isStaff\(\)/, 'After-hours confirmation is not guarded as staff-only.');
  requireText(page, /Copy confirmation/, 'Copy confirmation action is missing.');
  requireText(page, /Open email draft/, 'Open email draft action is missing.');
  requireText(page, /renderQr\(/, 'Local QR rendering is not connected to the confirmation panel.');
  requireText(qr, /no appointment data leaves the browser/i, 'The local QR module attribution/privacy note is missing.');
  requireText(css, /\/\* Stage 3 — Booking \*\//, 'Stage 3 booking styles are missing from the canonical stylesheet.');
  requireText(db, /async insert\(/, 'db.js is missing the insert mutation wrapper.');
  requireText(db, /async remove\(/, 'db.js is missing the delete mutation wrapper.');
  requireText(router, /code:\s*'book'/, 'Booking route is missing from the shell.');

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
