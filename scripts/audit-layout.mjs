// Renders every MaxDock page — and every dialog opened from it — in a real browser
// against a stubbed Supabase, and checks the result against the layout rules the
// owner signed off across DB64–DB66: labels beside their fields, one spacing
// rhythm, KPI cards filling their row, consistent action placement, nothing
// clipped, nothing overflowing.
//
// This exists so layout defects are caught here instead of by the owner.
// Resolve playwright from wherever it lives: the sandbox has it globally, CI installs it locally.
const { chromium } = await import('playwright')
  .catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8731;
// Phone and tablet widths included: the owner found mismatched field heights on a
// phone that a desktop-only sweep never would have surfaced.
// AUDIT_FAST trims the sweep to the widths that catch most faults, for use while
// iterating. The full sweep — every width, plus the role and text-size passes —
// runs before a push and in CI. Running the full thing after every small edit cost
// more waiting than it caught.
const FAST = Boolean(process.env.AUDIT_FAST);
const WIDTHS = FAST ? [1440, 768, 390] : [1440, 1280, 1024, 834, 768, 430, 390];
// Dialogs are audited at a subset — one desktop, one laptop, one tablet, one phone.
// They are opened inside the page load that is already running, so this costs
// interactions rather than navigations.
const MODAL_WIDTHS = new Set([1440, 1024, 768, 390]);
// Login is where every user starts and book.html is the standalone booking route a
// customer is sent to; neither was audited at all until now.
const PAGES = ['board', 'queue', 'my-appointments', 'settings', 'reports', 'users', 'data', 'book', 'receiving'];
const ROOT_PAGES = { login: 'index.html' };
const PAGE_QUERY = { receiving: '?t=00000000-0000-4000-8000-0000000000c0' };
// The owner's own acceptance gate requires the rail to hold one line at Normal,
// Large and Larger. Nothing checked that, so every run only ever proved Normal.
const TEXT_SIZES = ['normal', 'large', 'larger'];
// A Customer sees fewer actions and different columns. That is exactly where a
// header goes lopsided or a toolbar collapses, and one role proves nothing about
// the others.
// Copied from the live role_permissions table, not invented. The previous sets
// were a guess and granted permissions no role actually holds while omitting
// appointment.cancel_own, which every role does hold — so the role sweep was
// exercising an app configuration that does not exist. site_admin included
// because it is the role most Max Solutions sites are administered under.
const ROLES = {
  system_admin: null,
  site_admin: ['ai.insights', 'appointment.assign', 'appointment.cancel', 'appointment.cancel_own', 'appointment.complete', 'appointment.create', 'appointment.update', 'appointment.view', 'appointment.view_own', 'audit.view', 'block.manage', 'dock.manage', 'dock.view', 'location.view', 'notifications.view', 'operations.queue.view', 'reports.view', 'reports.view_labour', 'settings.manage', 'settings.manage_labour', 'settings.view', 'user.manage', 'user.view', 'appointment.check_in'],
  shipping_manager: ['ai.insights', 'appointment.assign', 'appointment.cancel', 'appointment.cancel_own', 'appointment.complete', 'appointment.create', 'appointment.update', 'appointment.view', 'appointment.view_own', 'audit.view', 'block.manage', 'dock.view', 'location.view', 'notifications.view', 'operations.queue.view', 'reports.view', 'reports.view_labour', 'settings.manage_labour', 'settings.view', 'appointment.check_in'],
  coordinator: ['ai.insights', 'appointment.assign', 'appointment.cancel_own', 'appointment.complete', 'appointment.create', 'appointment.update', 'appointment.view', 'appointment.view_own', 'audit.view', 'dock.view', 'location.view', 'notifications.view', 'operations.queue.view', 'reports.view', 'appointment.check_in'],
  customer: ['appointment.cancel_own', 'appointment.create', 'appointment.view_own', 'location.view', 'notifications.view'],
};

// Dialogs reachable from each page, with the control that opens them. Every one of
// these is a place a field can clip or a row can fall out of alignment, and until
// now none of them were rendered by the audit at all — which is exactly where the
// owner found the original Add user defect.
const MODALS = {
  board: [
    { name: 'block-dock-time', trigger: '[data-block-time]' },
    { name: 'appointment-details', trigger: '[data-open-record]' },
    // Combining a load already on the board, offered on the movement itself — so the
    // movement has to be opened before the action exists. Same dialog the operations
    // brief opens; measured from here too because this is where it is reached from.
    // Named rather than "the first block": the first one on the board is travelling
    // alone and is deliberately not offered the action, so opening it would measure
    // an absence. MXD-2026-000146 is one of the two Guelph loads in the fixture.
    { name: 'combine-loads', prepare: '[data-open-record]:has-text("MXD-2026-000146")', trigger: '[data-combine]' },
    { name: 'book-appointment', trigger: '[data-open-booking]', walkSteps: 3 },
    { name: 'notifications', trigger: '.notif__btn' },
    // The printable card behind a saved booking: a QR, the run in words, and the
    // link under it. Opened from inside the booking dialog, so the booking dialog
    // has to be opened first.
  ],
  // The queue is a status screen, not a booking screen — it deliberately has no
  // Book appointment action.
  queue: [
    { name: 'customize', trigger: '[data-customize]' },
    { name: 'appointment-details', trigger: 'tr[data-open-record]' },
    // Combining loads already on the board, offered from the lane the brief found.
    { name: 'combine-loads', trigger: '[data-combine-lane]' },
  ],
  'my-appointments': [
    // Not the first one on the page — the first one belongs to a past appointment
    // and is deliberately disabled. The audit wants a row the action is live on.
    { name: 'cancel-appointment', trigger: '.btn--danger:not([disabled])' },
    { name: 'move-appointment', trigger: '[data-move-appointment]:not([disabled])' },
    { name: 'book-appointment', trigger: '[data-open-booking]', walkSteps: 3 },
    { name: 'customize', trigger: '[data-customize]' },
  ],
  // Add dock lives in the Docks & truck types section, so the section has to be
  // opened before the control exists.
  settings: [
    { name: 'add-dock', prepare: '[data-section="docks"]', trigger: '[data-add-dock]' },
    { name: 'add-truck-type', prepare: '[data-section="trucks"]', trigger: '[data-add-truck-type]' },
    { name: 'new-quick-qr', prepare: '[data-section="quickqr"]', trigger: '[data-add-shortcut]' },
    // The printable card: a code, the run in words and the link under it.
    { name: 'quick-qr-card', prepare: '[data-section="quickqr"]', trigger: '[data-print-shortcut]' },
  ],
  // The bell is on every page; the panel it opens carries a list, a sound switch
  // and two actions, and was never measured.
  reports: [{ name: 'notifications', trigger: '.notif__btn' }],
  // A sheet of loads, from the System Admin screen it now belongs to. Measured empty:
  // the file input, the template action and the sentence saying what pressing the
  // button will do are the layout; a preview table is the same .table as everywhere.
  data: [{ name: 'import-appointments', prepare: '[data-section="appointments"]', trigger: '[data-open-appointment-import]' }],
  users: [
    { name: 'add-user', trigger: '[data-add-user]' },
    { name: 'edit-user', trigger: '[data-edit-user]' },
    { name: 'import-users', trigger: '[data-import-users]' },
  ],
};

// Some pages have more than one state worth measuring and no dialog to open. The
// receiving screen is one layout before a load is found, another when a typed
// booking number matches several, and another once one is picked — auditing only
// the state a query string lands on leaves the other two unmeasured.
const FLOWS = {
  // Six sections, and only the one open on load was ever measured — which is
  // exactly where a card collapsed to the width of its title and the whole sweep
  // still reported clean.
  settings: [
    { name: 'docks', query: '', act: async page => { await page.click('[data-section="docks"]'); await page.waitForTimeout(250); await page.locator('[data-edit-section] >> visible=true').first().click({ timeout: 2000 }).catch(() => {}); }, expect: '.stack--table .table' },
    { name: 'hours', query: '', act: async page => { await page.click('[data-section="hours"]'); await page.waitForTimeout(250); await page.locator('[data-edit-section] >> visible=true').first().click({ timeout: 2000 }).catch(() => {}); }, expect: '.stack .dirwin' },
    { name: 'holidays', query: '', act: async page => { await page.click('[data-section="hours"]'); await page.waitForTimeout(250); await page.locator('[data-section-form="holidays"] [data-edit-section]').click({ timeout: 2000 }).catch(() => {}); }, expect: '[name="holiday_calendar"]' },
    // Capacity, hours and docks each draw one window with ruled parts rather than
    // a card per part, so .card is the wrong thing to wait for — it is .stack.
    { name: 'capacity', query: '', act: async page => { await page.click('[data-section="capacity"]'); await page.waitForTimeout(250); await page.locator('[data-edit-section] >> visible=true').first().click({ timeout: 2000 }).catch(() => {}); }, expect: '.stack' },
    // Combining and Notice are two forms inside Booking rules now, not sections of
    // their own, so each is unlocked by its own Edit rather than by whichever one
    // happens to be first on the panel.
    { name: 'combining', query: '', act: async page => { await page.click('[data-section="booking"]'); await page.waitForTimeout(250); await page.locator('[data-section-form="combining"] [data-edit-section]').click({ timeout: 2000 }).catch(() => {}); }, expect: '.card' },
    { name: 'trucks', query: '', act: async page => { await page.click('[data-section="trucks"]'); await page.waitForTimeout(250); await page.locator('[data-edit-section] >> visible=true').first().click({ timeout: 2000 }).catch(() => {}); }, expect: '.card--table' },
    // Three forms in one section, so each is unlocked by its own Edit rather than
    // by position — the positions moved once and took the sweep with them.
    { name: 'labour', query: '', act: async page => { await page.click('[data-section="labour"]'); await page.waitForTimeout(250); await page.locator('[data-section-form="labour"] [data-edit-section]').click({ timeout: 2000 }).catch(() => {}); }, expect: '[name="handlers_per_truck"]' },
    { name: 'labour-shifts', query: '', act: async page => { await page.click('[data-section="labour"]'); await page.waitForTimeout(250); await page.locator('[data-section-form="shifts"] [data-edit-section]').click({ timeout: 2000 }).catch(() => {}); await page.locator('[data-add-shift]').click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(200); }, expect: '.shiftrow [data-shift-name]' },
    // How many trucks a day takes is a limit rather than a crew question, so it sits
    // under Capacity & limits with the rest of them now. Named for where it is.
    { name: 'capacity-day-cap', query: '', act: async page => { await page.click('[data-section="capacity"]'); await page.waitForTimeout(250); await page.locator('[data-section-form="day-cap"] [data-edit-section]').click({ timeout: 2000 }).catch(() => {}); }, expect: '[name="max_concurrent"]' },
    { name: 'labour-day', query: '', act: async page => { await page.click('[data-section="labour"]'); await page.waitForTimeout(250); await page.locator('[data-section-form="labour-day"] [data-edit-section]').click({ timeout: 2000 }).catch(() => {}); }, expect: '[name="hours_each"]' },
    { name: 'quickqr', query: '', act: async page => { await page.click('[data-section="quickqr"]'); await page.waitForTimeout(250); await page.locator('[data-edit-section] >> visible=true').first().click({ timeout: 2000 }).catch(() => {}); }, expect: '[data-print-shortcut]' },
    { name: 'notice', query: '', act: async page => { await page.click('[data-section="booking"]'); await page.waitForTimeout(250); await page.locator('[data-section-form="notice"] [data-edit-section]').click({ timeout: 2000 }).catch(() => {}); }, expect: '.card' },
    { name: 'timing', query: '', act: async page => { await page.click('[data-section="timing"]'); await page.waitForTimeout(250); await page.locator('[data-edit-section] >> visible=true').first().click({ timeout: 2000 }).catch(() => {}); }, expect: '.card' },
  ],
  // Each report view is its own table and chart; the tab that is open on load was
  // the only one ever measured.
  reports: [
    { name: 'scorecard-company', query: '', act: async page => { await page.selectOption('[data-view]', 'scorecard-company'); }, expect: '.table' },
    { name: 'scorecard-location', query: '', act: async page => { await page.selectOption('[data-view]', 'scorecard-location'); }, expect: '.table' },
    { name: 'truck-flow', query: '', act: async page => { await page.selectOption('[data-view]', 'truck-flow'); }, expect: '.table' },
    { name: 'fullness', query: '', act: async page => { await page.selectOption('[data-view]', 'fullness'); }, expect: '.fullness__bar' },
    { name: 'labour', query: '', act: async page => { await page.selectOption('[data-view]', 'labour'); }, expect: '.fullness__bar' },
  ],
  // A user row closed is four columns; open it is a strip of labelled values
  // underneath. The open state is a second layout and is measured as one.
  users: [
    {
      name: 'row-expanded',
      query: '',
      act: async page => { await page.locator('[data-expand-user]').first().click(); await page.waitForTimeout(200); },
      expect: '.userdetail',
    },
  ],
  receiving: [
    { name: 'idle', query: '' },
    {
      name: 'matches',
      query: '',
      act: async page => { await page.fill('[data-token]', '41'); await page.click('[data-lookup]'); },
      expect: '[data-pick]',
    },
    {
      name: 'picked',
      query: '',
      act: async page => {
        await page.fill('[data-token]', '41');
        await page.click('[data-lookup]');
        await page.waitForTimeout(350);
        await page.click('[data-pick="0"]');
      },
      expect: '[data-status]',
    },
  ],
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, r));

// Stub the Supabase browser client so the real page modules boot and render.
const STUB = fs.readFileSync(path.join(ROOT, 'scripts/audit-supabase-stub.js'), 'utf8');

const findings = [];
const add = (where, width, rule, detail) => findings.push({ where, width, rule, detail });

// The layout rules, run inside the browser. `scope` is a selector for the subtree
// being judged — null for the whole page, the open dialog when auditing a modal.
// A dialog is measured on its own terms: page-level rules like the band rhythm
// belong to the page, not to a 560px panel floating above it.
function collect(scope) {
  const root = scope ? document.querySelector(scope) : document;
  const out = { clipped: [], smallTargets: [], ctlHeights: [], rawTimestamps: [], blockTextCut: [], hiddenButShown: [], unreachable: [], rowFill: [], kpi: [], gaps: [], overflowX: 0, labelStyles: [], cutOff: [], rowUneven: [], modal: [], collapsed: [], narrow: [], selectCut: [], labelRagged: [], bandSpill: [] };
  if (!root) return out;
  const vis = el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';

  if (!scope) out.overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;

  // Content wider than its box — the "fields are cut off" defect.
  root.querySelectorAll('.input,.select,td,th,.field__label,.setrow__d,.kpi__label,.rail__link,.btn,.step').forEach(el => {
    // A cell that deliberately truncates with an ellipsis and carries the full
    // text in its title is doing the right thing, not clipping by accident.
    if (!vis(el) || ((el.classList.contains('cell-elide') || el.classList.contains('cell-cap')) && el.title)) return;
    // A single-line free-text field whose typed value is longer than the box is
    // the browser scrolling inside it, which is what a text input does and what a
    // caret is for. No width satisfies it — a 120-character note cannot fit a
    // 390px phone — so the rule cannot be met there and does not apply.
    //
    // It still applies to everything with a bounded value: a number, a time, a
    // date, a select, a table cell, a label. Those overflowing means the box is
    // genuinely too narrow, which is the defect this rule exists to catch.
    const freeText = el.tagName === 'INPUT' && ['text', 'search', 'email', 'tel', 'url', ''].includes((el.getAttribute('type') || '').toLowerCase());
    if (freeText && el.value && el.value.length > 20) return;
    if (el.scrollWidth > el.clientWidth + 1) {
      out.clipped.push({ text: (el.textContent || el.value || '').trim().slice(0, 44), over: el.scrollWidth - el.clientWidth, sel: el.className });
    }
  });

  // Content pushed outside an ancestor that hides its overflow. The page-level
  // scrollWidth check cannot see this: overflow:hidden clips silently, with no
  // scrollbar, so a button can sit half off-screen and nothing reports it.
  root.querySelectorAll('.btn,.iconbtn,.tag,.kpi,.pagehead__title,.field,.notif,.step').forEach(el => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const st = getComputedStyle(a);
      const scrollable = /auto|scroll/.test(st.overflowX) || /auto|scroll/.test(st.overflow);
      // Reachable by scrolling is not the same as cut off. Stop looking.
      if (scrollable) break;
      if (st.overflowX !== 'hidden' && st.overflow !== 'hidden') continue;
      const ar = a.getBoundingClientRect();
      const over = Math.round(Math.max(r.right - ar.right, ar.left - r.left));
      if (over > 1) out.cutOff.push({ text: (el.textContent || '').trim().slice(0, 28) || el.className, over, by: a.className || a.tagName });
      break;
    }
  });

  // A group in the controls band wider than the column it was given.
  //
  // The band is three tracks: the page's own control, its filters, the actions. The outer
  // two are `auto`, so they take their content and the filters get what is left — which on
  // the dock board at 1024px was 66px for two selects and a search box. All three
  // overflowed to the right, across the actions, and the button underneath stopped being
  // clickable.
  //
  // That fault reached CI as "modal-trigger-unreachable: [data-block-time] could not be
  // clicked", which is true and three steps removed from the cause. It had also been
  // overflowing for some time while missing the button's centre by eleven pixels, so
  // nothing had reported it. This measures the overflow itself: a group that does not fit
  // its column is a fault whether or not it currently lands on something.
  for (const group of root.querySelectorAll('.controls__lead,.controls__filters,.controls__end')) {
    if (!vis(group)) continue;
    const spill = group.scrollWidth - Math.round(group.getBoundingClientRect().width);
    if (spill > 2) out.bandSpill.push({ sel: group.className, spill, width: Math.round(group.getBoundingClientRect().width) });
  }

  // Interactive controls below a comfortable hit size. A small checkbox inside a
  // padded <label> is fine — the label is what the pointer actually hits — so
  // measure the effective target, not just the control box.
  root.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea').forEach(el => {
    if (!vis(el)) return;
    const wrapper = el.closest('label');
    const target = wrapper && wrapper.contains(el) ? wrapper : el;
    const h = Math.round(Math.max(el.getBoundingClientRect().height, target.getBoundingClientRect().height));
    if (h > 0 && h < 32) out.smallTargets.push({ text: (el.textContent || el.getAttribute('aria-label') || el.type || '').trim().slice(0, 32), h, sel: el.className });
  });

  // One control height everywhere. The owner's first rule of consistency: every
  // button, select and single-line input is exactly --ctl-h tall on every page,
  // in every dialog, for every role.
  //
  // Two exemptions, both deliberate and both about a screen being read at a distance
  // rather than at a desk. The wall display scales its whole type ramp to the screen
  // it is broadcast on. And .input--jumbo is the booking-number box on Receiving,
  // which the owner asked to be twice the height and twice the text: it is typed by a
  // receiver standing at a dock with gloves on and a phone in the other hand, and a
  // 36px box was the wrong size for the one field on that screen that matters. An
  // exemption named for its suffix, so a third one has to be argued for the same way.
  // The camera button beside it carries .btn--jumbo for the same reason and is exempt on
  // the same grounds: the two controls on that screen are a matched pair.
  const ctlH = Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-h')) || 0);
  if (ctlH) {
    root.querySelectorAll('.btn,.select,.input,.seg button,.iconbtn,.notif__btn,.linkBtn,.modal__x').forEach(el => {
      if (!vis(el) || el.closest('.wall') || el.tagName === 'TEXTAREA') return;
      if (/--jumbo/.test(el.className)) return;
      const h = Math.round(el.getBoundingClientRect().height);
      if (Math.abs(h - ctlH) > 1) {
        out.ctlHeights.push({ h, want: ctlH, text: (el.textContent || el.getAttribute('aria-label') || el.value || el.type || '').trim().slice(0, 28), sel: el.className });
      }
    });
  }

  // A raw ISO timestamp printed at an operator. Dates on screen go through the
  // format helpers; one that skipped them is a defect, not a style preference.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue || '').trim();
    if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) continue;
    const host = node.parentElement;
    if (!host || !vis(host) || host.closest('script,style')) continue;
    out.rawTimestamps.push({ text: text.slice(0, 48), sel: host.className || host.tagName });
  }

  // An element the page has hidden that is still on screen. A component that sets
  // its own `display` beats the browser's [hidden] rule at equal specificity, so
  // `element.hidden = true` can silently do nothing — which is how the Add user
  // dialog showed a Coordinator the customer-only fields.
  root.querySelectorAll('[hidden]').forEach(el => {
    if (el.getClientRects().length === 0) return;
    out.hiddenButShown.push({ sel: el.className || el.tagName, text: (el.textContent || '').trim().slice(0, 40) });
  });

  // Content that ends below the fold with nothing able to scroll to it. The
  // owner hit this on Locations & docks: the truck-types panel simply stopped
  // below the window and no ancestor scrolled, so it could not be reached at all.
  if (!scope) {
    const fold = document.documentElement.clientHeight;
    const scrolls = el => {
      for (let a = el; a; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (/auto|scroll/.test(style.overflowY) && a.scrollHeight > a.clientHeight + 1) return true;
      }
      return document.documentElement.scrollHeight > document.documentElement.clientHeight + 1;
    };
    root.querySelectorAll('.page .card,.page .panel,.page .setrow,.page .form-actions').forEach(el => {
      if (!vis(el)) return;
      const below = Math.round(el.getBoundingClientRect().bottom - fold);
      if (below > 1 && !scrolls(el)) {
        out.unreachable.push({ below, sel: el.className, text: (el.textContent || '').trim().slice(0, 40) });
      }
    });
  }

  // A timeline block showing half a line of text. The generic clipping rules
  // cannot see this: the block hides its overflow, so a partly-drawn last line
  // reports no scroll and no overflow anywhere. Two things have to hold — every
  // line's box sits inside the block, and where text is being hidden, the box
  // that hides it is a whole number of lines tall, so the reader either gets the
  // line or does not see it started.
  root.querySelectorAll('.tlb').forEach(block => {
    if (!vis(block)) return;
    const blockStyle = getComputedStyle(block);
    const floor = block.getBoundingClientRect().bottom - parseFloat(blockStyle.paddingBottom || 0);
    for (const line of block.children) {
      const style = getComputedStyle(line);
      if (style.display === 'none') continue;
      const label = (line.textContent || '').trim().slice(0, 36);
      const past = Math.round(line.getBoundingClientRect().bottom - floor);
      if (past > 1) { out.blockTextCut.push({ over: past, text: label, sel: line.className, why: 'sits past the bottom of its block' }); continue; }
      const lineHeight = parseFloat(style.lineHeight);
      if (!(lineHeight > 0) || line.scrollHeight <= line.clientHeight + 1) continue;
      const spare = line.clientHeight % lineHeight;
      if (spare > 1 && lineHeight - spare > 1) out.blockTextCut.push({ over: Math.round(spare), text: label, sel: line.className, why: 'is cut mid-line' });
    }
  });

  // Controls sitting side by side must be the same height and sit on the same
  // baseline. A label that wraps to two lines silently makes its field taller.
  root.querySelectorAll('.frow, .controls, .pagehead__actions, .panel__actions, .modal__foot, .form-actions').forEach(row => {
    if (!vis(row)) return;
    const kids = [...row.children].filter(vis);
    if (kids.length < 2) return;
    const tops = kids.map(k => Math.round(k.getBoundingClientRect().top));
    const sameLine = Math.max(...tops) - Math.min(...tops) < 6;
    if (!sameLine) return;
    const boxes = kids.map(k => ({ h: Math.round(k.getBoundingClientRect().height), t: (k.textContent || '').trim().slice(0, 20) }));
    const spread = Math.max(...boxes.map(b => b.h)) - Math.min(...boxes.map(b => b.h));
    if (spread > 2) out.rowUneven.push({ spread, boxes: boxes.map(b => `${b.t || '?'}:${b.h}`) });
    // The controls themselves must also line up, not just their wrappers.
    const ctrls = kids.map(k => k.querySelector('.input,.select,textarea,.btn')).filter(Boolean).filter(vis);
    if (ctrls.length > 1) {
      const ct = ctrls.map(c => Math.round(c.getBoundingClientRect().top));
      if (Math.max(...ct) - Math.min(...ct) > 2) out.rowUneven.push({ spread: Math.max(...ct) - Math.min(...ct), boxes: ['controls not on a shared baseline'] });
    }
  });

  // A band that has content but no height to show it in. Nothing overflows the
  // viewport when this happens, so every other rule stays quiet — which is how a
  // dock board collapsed to four pixels on a phone and still audited clean.
  out.collapsed = [];
  root.querySelectorAll('.board,.panel,.card,.tablewrap,.appointment-list,.board__scroll,.panel__scroll,.kpis,.modal__body').forEach(el => {
    if (!vis(el)) return;
    const h = el.getBoundingClientRect().height;
    if (h >= 32 || el.scrollHeight <= 80) return;
    out.collapsed.push({ sel: el.className, h: Math.round(h), needs: el.scrollHeight });
  });

  // The width counterpart, and the one that was missing: a block with room for
  // only a word or two per line. Nothing overflows, nothing is clipped, and the
  // band gets *taller* rather than shorter, so both the overflow rules and the
  // height rule above stay quiet. That is how a settings card shrank to the
  // width of its own title and every sentence inside it stacked one word to a
  // line, all the way down the page, and still audited clean.
  // Counted off the text's own line boxes rather than by dividing the block's height by its
  // line-height. The arithmetic version could not tell a wrapped sentence from a control: a
  // bullet in the operations brief carries a 36px action button under it, and 36px of hit area
  // read as two more lines of text, which reported a perfectly ordinary bullet as wrapping at
  // thirteen characters. A Range over each text node gives one rectangle per line the browser
  // actually drew, which is the thing this rule has always been about.
  out.narrow = [];
  root.querySelectorAll('p,.hint,td,.setrow__t,.card__title,.integ__name,li,legend').forEach(el => {
    if (!vis(el)) return;
    const text = (el.textContent || '').trim();
    if (text.length < 40) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let lines = 0;
    let chars = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = (node.textContent || '').trim();
      if (!value) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const boxes = [...range.getClientRects()].filter(box => box.width > 0 && box.height > 0);
      // Only text that actually wrapped. A run that fits on one line is not evidence of
      // anything: an expanded user row is fifteen little labelled values, each its own text
      // node on its own line, and counting those as fifteen lines of eleven characters called
      // a 953px row a narrow column. What this rule is looking for is a sentence broken into
      // stubs, and a sentence broken into stubs has more than one line box.
      if (boxes.length < 2) continue;
      lines += boxes.length;
      chars += value.length;
    }
    if (lines < 4 || chars < 40) return;
    const perLine = chars / lines;
    if (perLine >= 14) return;
    out.narrow.push({ sel: el.className || el.tagName, w: Math.round(rect.width), lines, perLine: Math.round(perLine) });
  });

  // A select too narrow for the option it is showing. This is invisible to the
  // clipping rule: a <select> does not report overflow, the browser just cuts the
  // text off with the arrow still drawn, so "Balanced across docks" reads as
  // "Balanced across d" and audits clean. Measured by laying the text out in a
  // span with the control's own font and comparing against the box less its
  // padding and the arrow.
  out.selectCut = [];
  root.querySelectorAll('select').forEach(el => {
    if (!vis(el)) return;
    const style = getComputedStyle(el);
    const ruler = document.createElement('span');
    ruler.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font}`;
    ruler.textContent = el.options[el.selectedIndex]?.text || '';
    document.body.append(ruler);
    const needed = ruler.getBoundingClientRect().width;
    ruler.remove();
    // The arrow and the padding are not available to the text. 28px covers the
    // glyph and its gap in this stylesheet.
    const room = el.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 28;
    if (needed > room + 8) out.selectCut.push({ text: ruler.textContent.slice(0, 40), over: Math.round(needed - room), sel: el.className });
  });

  // A label that wraps while the labels beside it do not. The row still lines its
  // boxes up, so nothing overflows and nothing is clipped — but one field's box
  // starts a line lower than its neighbours', which is exactly the ragged form row
  // the owner keeps finding. Compared within a row, because a label wrapping on a
  // phone where they all wrap is the page working, not failing.
  out.labelRagged = [];
  root.querySelectorAll('.frow').forEach(row => {
    if (!vis(row)) return;
    const labels = [...row.querySelectorAll('.field__label')].filter(vis);
    if (labels.length < 2) return;
    const heights = labels.map(el => Math.round(el.getBoundingClientRect().height));
    const shortest = Math.min(...heights);
    labels.forEach((el, index) => {
      if (heights[index] > shortest * 1.5) {
        out.labelRagged.push({ text: (el.textContent || '').trim().slice(0, 36), h: heights[index], others: shortest });
      }
    });
  });

  // A form row should use its width, not stop short and leave the rest empty.
  root.querySelectorAll('.frow').forEach(row => {
    if (!vis(row)) return;
    const rw = row.getBoundingClientRect().width;
    const kids = [...row.children].filter(vis);
    if (!kids.length || rw < 200) return;
    const right = Math.max(...kids.map(k => k.getBoundingClientRect().right));
    const unused = Math.round(row.getBoundingClientRect().right - right);
    // Two of twelve columns. The old quarter-of-the-row threshold let a row that
    // was three columns short pass on a rounding margin, which is how the settings
    // rows in the owner's screenshots audited clean while visibly stopping short.
    // A row made entirely of number boxes is meant to stop short. "Base 30 min,
    // per skid 1.5 min, buffer 10 min" sized to fill a 921px row is the very
    // defect the owner reported as long fields for two numbers — so measuring
    // those rows against the same standard as a row of names and addresses
    // reports the correct layout as a fault.
    // A row is only "meant to fill" if something in it holds a long value — a
    // name, an address, a note. A row of number boxes and short selects is
    // compact on purpose: "Daily capacity 2000 skids, reserve 50, when over
    // capacity warn" stretched across 921px is the long-fields-for-two-numbers
    // complaint that started all of this. Judge by whether the row contains a
    // wide field at all, rather than by how much space is left over.
    const hasWideField = kids.some(k => k.classList.contains('field--lg') || k.classList.contains('field--xl') || k.classList.contains('field--full'));
    if (!hasWideField) return;
    if (unused > rw * 0.15) out.rowFill.push({ unused, rowWidth: Math.round(rw), fields: kids.length });
  });

  // KPI cards must fill their row evenly (DB65/DB66).
  root.querySelectorAll('.kpis').forEach(strip => {
    if (!vis(strip)) return;
    // Only the cards. The strip also carries its customize control, which is
    // deliberately a different shape.
    const cards = [...strip.querySelectorAll(':scope > .kpi')].filter(vis);
    if (cards.length < 2) return;
    const widths = cards.map(c => Math.round(c.getBoundingClientRect().width));
    const heights = cards.map(c => Math.round(c.getBoundingClientRect().height));
    if (Math.max(...widths) - Math.min(...widths) > 2) out.kpi.push({ issue: 'cards not equal width', widths });
    if (Math.max(...heights) - Math.min(...heights) > 2) out.kpi.push({ issue: 'cards not equal height', heights });
    const trailing = strip.querySelector(':scope > .kpis__gear');
    const right = Math.max(...[...cards, ...(trailing ? [trailing] : [])].map(c => c.getBoundingClientRect().right));
    const unused = Math.round(strip.getBoundingClientRect().right - right);
    if (unused > 4) out.kpi.push({ issue: 'strip does not fill row', unused });
  });

  // One vertical rhythm between the major page bands. Page-level only.
  if (!scope) {
    const bands = [...document.querySelectorAll('.page > *')].filter(vis);
    const seen = new Set();
    for (let i = 1; i < bands.length; i += 1) {
      const gap = Math.round(bands[i].getBoundingClientRect().top - bands[i - 1].getBoundingClientRect().bottom);
      if (gap >= 0 && gap < 80) seen.add(gap);
    }
    if (seen.size > 2) out.gaps.push({ distinctGaps: [...seen].sort((a, b) => a - b) });
  }

  // Field labels must all be styled the same way.
  const styles = new Set();
  root.querySelectorAll('.field__label, .dock-checks > legend').forEach(el => {
    if (!vis(el)) return;
    const s = getComputedStyle(el);
    styles.add(`${s.fontSize}|${s.textTransform}|${s.fontWeight}`);
  });
  if (styles.size > 1) out.labelStyles.push({ variants: [...styles] });

  // Dialog-only rules. A dialog is its own viewport-sized surface: if it is wider
  // than the screen, or taller with nothing scrollable inside it, part of the form
  // simply cannot be reached — and its footer buttons are the ones that matter most.
  if (scope) {
    const r = root.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (r.width > vw + 1) out.modal.push(`dialog is ${Math.round(r.width - vw)}px wider than the ${vw}px viewport`);
    if (r.left < -1 || r.right > vw + 1) out.modal.push(`dialog sits ${Math.round(Math.max(-r.left, r.right - vw))}px outside the viewport horizontally`);
    const body = root.querySelector('.modal__body');
    const bodyScrolls = body && /auto|scroll/.test(getComputedStyle(body).overflowY);
    if (r.height > vh + 1 && !bodyScrolls) out.modal.push(`dialog is ${Math.round(r.height - vh)}px taller than the ${vh}px viewport with no scrollable body`);
    // The dialog's *own* action row, which is its footer wherever it has one. This used to
    // be `querySelector('.modal__foot, .form-actions')`, and querySelector returns the first
    // match in document order — so the moment a dialog grew a .form-actions inside its body
    // (the upload row on the appointment window) the rule started measuring that instead,
    // and reported the footer as 540px below the fold on a dialog whose footer was pinned
    // and visible the whole time.
    //
    // A row inside a scrolling body is also not a fold problem by definition: it is content,
    // and content in a scroll region is reached by scrolling. Only a row that is meant to
    // stay put can be below the fold.
    const foot = root.querySelector('.modal__foot')
      || [...root.querySelectorAll('.form-actions')].find(row => !(bodyScrolls && body.contains(row)))
      || null;
    if (foot) {
      const fr = foot.getBoundingClientRect();
      if (fr.bottom > vh + 1) out.modal.push(`the action row is ${Math.round(fr.bottom - vh)}px below the fold`);
      if (fr.right > vw + 1 || fr.left < -1) out.modal.push('the action row is outside the viewport horizontally');
    }
    if (body && bodyScrolls && body.scrollWidth > body.clientWidth + 1) out.modal.push(`dialog body scrolls sideways by ${body.scrollWidth - body.clientWidth}px`);
  }

  return out;
}

// Tag the dialog that is currently open so the rules can scope to it, and report
// which one it is. Modals are separate backdrops; the last visible one is on top.
function markOpenDialog() {
  document.querySelectorAll('[data-audit-open]').forEach(el => el.removeAttribute('data-audit-open'));
  const open = [...document.querySelectorAll('.scrim')].filter(s => !s.hidden && getComputedStyle(s).display !== 'none');
  const dialog = open.length ? (open[open.length - 1].querySelector('[role="dialog"]') || open[open.length - 1].firstElementChild) : null;
  if (!dialog) return null;
  dialog.setAttribute('data-audit-open', '1');
  return (dialog.querySelector('.modal__title')?.textContent || 'dialog').trim().slice(0, 40);
}

// Fill whatever the open step needs so the wizard will advance. Deliberately
// generic: it sets each control to its first plausible value rather than encoding
// the booking form's field list, so it keeps working as that form changes.
function fillOpenDialog() {
  const root = document.querySelector('[data-audit-open]');
  if (!root) return;
  const fire = el => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  root.querySelectorAll('select').forEach(el => {
    if (el.disabled || el.value) return;
    const option = [...el.options].find(o => o.value && !o.disabled);
    if (option) { el.value = option.value; fire(el); }
  });
  const seenRadio = new Set();
  root.querySelectorAll('input:not([type=hidden]),textarea').forEach(el => {
    if (el.disabled || el.readOnly) return;
    if (el.type === 'radio') {
      if (seenRadio.has(el.name) || root.querySelector(`input[name="${el.name}"]:checked`)) { seenRadio.add(el.name); return; }
      seenRadio.add(el.name); el.checked = true; fire(el); return;
    }
    if (el.type === 'checkbox') return;
    if (el.value) return;
    if (el.type === 'date') { const d = new Date(); d.setDate(d.getDate() + 2); el.value = d.toISOString().slice(0, 10); }
    else if (el.type === 'time') el.value = '09:00';
    else if (el.type === 'number') el.value = '10';
    else if (el.type === 'email') el.value = 'audit@maxpkgsolutions.com';
    else if (el.type === 'tel') el.value = '905-555-0142';
    // A company the fixture already has appointments for, so the booking
    // dialog's combine picker has something to list instead of staying empty.
    else if (el.dataset.field === 'company_name') el.value = 'Haleon – Oakhill';
    else el.value = 'AUDIT-0001';
    fire(el);
  });
  root.querySelector('[data-slot]')?.click();
}

function roleScript(role, permissions) {
  if (!permissions) return '';
  return `globalThis.__auditRole = ${JSON.stringify({ role, permissions })};`;
}

const browser = await chromium.launch();

// Sweep one: every page at every width, as System Admin at normal text.
for (const name of PAGES) {
  for (const width of WIDTHS) {
    // Pinned so the run is identical on a UTC CI runner and a laptop: the board
    // places a card by its local time, so an unpinned zone renders an empty grid
    // and the audit would score a page it never actually drew.
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Toronto', locale: 'en-CA' });
    await context.addInitScript(STUB);
    // The pages load the real Supabase client from a CDN, and it assigns the same
    // global the stub uses. In this sandbox the CDN is unreachable so the stub
    // survived; on a CI runner it loads, replaces the stub, finds no session and
    // sends every page to the login screen — where the audit found nothing to
    // measure and reported a clean run. Block it so both behave the same.
    await context.route('**/cdn.jsdelivr.net/**', route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/app/${name}.html${PAGE_QUERY[name] || ''}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    for (const e of errors) add(name, width, 'page-error', e.slice(0, 160));

    // Every rule below is a "this must not be wrong" check, so a page that renders
    // nothing satisfies all of them. Assert the page actually drew before trusting
    // a clean result — a silent boot failure once made this whole job pass empty.
    const rendered = await page.evaluate(() => {
      const root = document.querySelector('.page');
      return { has: Boolean(root), controls: document.querySelectorAll('.page .btn,.page .input,.page .select,.page td,.page .setnav button').length };
    });
    if (!rendered.has || rendered.controls < 3) {
      add(name, width, 'page-did-not-render', rendered.has ? `.page holds ${rendered.controls} controls` : 'no .page element — the app never booted');
      await context.close();
      continue;
    }

    report(name, width, await page.evaluate(collect, null));

    if (MODAL_WIDTHS.has(width)) {
      for (const flow of FLOWS[name] || []) {
        const where = `${name} › ${flow.name}`;
        await page.goto(`http://127.0.0.1:${PORT}/app/${name}.html${flow.query}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(600);
        if (flow.act) {
          try {
            await flow.act(page);
          } catch (error) {
            add(where, width, 'flow-step-unreachable', String(error.message).split('\n')[0].slice(0, 120));
            continue;
          }
          await page.waitForTimeout(500);
        }
        // The same trap as the dialogs: every rule below is "must not be wrong",
        // so a state that never appeared passes them all. Name what each step is
        // supposed to produce and check it is there before measuring.
        if (flow.expect && !(await page.locator(flow.expect).count())) {
          add(where, width, 'flow-state-missing', `${flow.expect} never appeared`);
          continue;
        }
        report(where, width, await page.evaluate(collect, null));
      }
      await page.goto(`http://127.0.0.1:${PORT}/app/${name}.html${PAGE_QUERY[name] || ''}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
    }

    if (MODAL_WIDTHS.has(width)) {
      for (const spec of MODALS[name] || []) {
        const where = `${name} › ${spec.name}`;
        if (spec.prepare) {
          await page.locator(spec.prepare).first().click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(400);
        }
        // Visible ones only. A page can hold several matches where the first in
        // DOM order is legitimately hidden — a card for a truck that has already
        // arrived correctly offers neither Cancel nor Move — and .first() picked
        // that one and timed out clicking it. Which card came first depended on
        // the clock, because the fixture's times are relative to now, so this
        // passed locally and failed on CI an hour later. Auditing a control a
        // user could not click proves nothing either way.
        const trigger = page.locator(`${spec.trigger} >> visible=true`).first();
        if (!(await trigger.count())) { add(where, width, 'modal-trigger-missing', `no visible ${spec.trigger} on the page`); continue; }
        try {
          await trigger.click({ timeout: 4000 });
        } catch (error) {
          add(where, width, 'modal-trigger-unreachable', `${spec.trigger} could not be clicked — ${String(error.message).split('\n')[0].slice(0, 100)}`);
          continue;
        }
        await page.waitForTimeout(450);

        const steps = spec.walkSteps || 1;
        for (let step = 0; step < steps; step += 1) {
          const title = await page.evaluate(markOpenDialog);
          if (!title) {
            if (step === 0) add(where, width, 'modal-did-not-open', `clicking ${spec.trigger} opened nothing`);
            break;
          }
          // A dialog that opened but only contains an error message is a failure the
          // rules below cannot see — they check that nothing is misplaced, and a
          // one-line apology is perfectly well laid out. This is how a syntax error
          // in the booking page reached a browser with the audit still clean.
          const broken = await page.evaluate(() => {
            const root = document.querySelector('[data-audit-open]');
            if (!root) return null;
            const controls = root.querySelectorAll('input,select,textarea,.slotpick button,[data-action]').length;
            const message = root.querySelector('.form-message')?.textContent?.trim() || '';
            return controls < 2 && message ? message.slice(0, 120) : null;
          });
          if (broken) { add(where, width, 'modal-failed-to-load', broken); break; }
          const label = steps > 1 ? `${where} (step ${step + 1})` : where;
          report(label, width, await page.evaluate(collect, '[data-audit-open]'));
          // Ticking a load to combine adds a summary line and re-fetches the
          // times beneath it. That is a different shape from the step with
          // nothing to combine, so it gets measured on its own.
          const combined = await page.evaluate(() => {
            const box = document.querySelector('[data-audit-open] [data-combine]');
            if (!box || box.checked) return false;
            box.click();
            return true;
          });
          if (combined) {
            await page.waitForTimeout(900);
            report(`${label} combined`, width, await page.evaluate(collect, '[data-audit-open]'));
          }
          // The repeat pattern is a second shape for the confirm step — a row of
          // seven day boxes and a summary line that is not there until it is
          // ticked, and was therefore never measured.
          const repeating = await page.evaluate(() => {
            const box = document.querySelector('[data-audit-open] [data-field="repeat_on"]');
            if (!box || box.checked) return false;
            box.click();
            const until = document.querySelector('[data-audit-open] [data-field="repeat_until"]');
            if (until) {
              const day = new Date();
              day.setDate(day.getDate() + 21);
              until.value = day.toISOString().slice(0, 10);
              until.dispatchEvent(new Event('input', { bubbles: true }));
              until.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
          });
          if (repeating) {
            await page.waitForTimeout(350);
            report(`${label} repeating`, width, await page.evaluate(collect, '[data-audit-open]'));
          }
          if (step === steps - 1) break;
          await page.evaluate(fillOpenDialog);
          // The time step asks for slots only once a date is set, so they appear
          // after the fill. Pick one now that they exist.
          await page.waitForTimeout(700);
          await page.evaluate(() => {
            const root = document.querySelector('[data-audit-open]');
            if (root && !root.querySelector('[data-slot][aria-pressed="true"],[data-slot].slot--sel')) root.querySelector('[data-slot]')?.click();
          });
          await page.waitForTimeout(250);
          const next = page.locator('[data-audit-open] [data-action="continue"]').first();
          if (!(await next.count())) break;
          await next.click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(600);
          // If the wizard did not advance, every later pass would re-audit the same
          // step and report the same finding as if it were a new one. Say so instead.
          const now = await page.evaluate(() => [...document.querySelectorAll('.steps .step')].findIndex(s => s.classList.contains('step--now')));
          if (now === step) {
            const why = await page.evaluate(() => document.querySelector('[data-booking-message]')?.textContent?.trim() || '');
            add(where, width, 'wizard-step-blocked', `step ${step + 1} would not advance${why ? ` — "${why}"` : ''}`);
            break;
          }
        }

        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(250);
        if (await page.evaluate(markOpenDialog)) {
          await page.locator('[data-audit-open] [data-close-add],[data-audit-open] [data-close-edit],[data-audit-open] [data-close-block],[data-audit-open] [data-close-dock],[data-audit-open] [data-notif-close],[data-audit-open] [data-action="close-booking"],[data-audit-open] [data-close],[data-audit-open] .modal__x')
            .first().click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(250);
        }
        for (const e of errors.splice(0)) add(where, width, 'page-error', e.slice(0, 160));
      }
    }

    await context.close();
  }
}

// Sweep two: the text sizes the owner's acceptance gate names, and the roles that
// see a different set of controls. One width each — these look for a different
// class of fault than the width sweep, and repeating seven widths per combination
// would treble the job for no extra signal.
const ROLE_PAGES = FAST ? ['board', 'my-appointments', 'book'] : PAGES;
const ROLE_TEXT_SIZES = FAST ? ['normal'] : TEXT_SIZES;
for (const textSize of ROLE_TEXT_SIZES) {
  for (const [role, permissions] of Object.entries(ROLES)) {
    if (textSize !== 'normal' && role !== 'system_admin') continue;
    for (const name of (textSize === 'normal' ? ROLE_PAGES : PAGES)) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Toronto', locale: 'en-CA' });
      await context.addInitScript(roleScript(role, permissions) + STUB);
      await context.route('**/cdn.jsdelivr.net/**', route => route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${PORT}/app/${name}.html${PAGE_QUERY[name] || ''}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      // Set after boot, not in an init script: at document-start there is no
      // documentElement to set it on, and the app writes this attribute itself
      // from the saved preference, so an early write would be overwritten anyway.
      // Both halves of what session.setTextSize does. The attribute alone is only
      // half a text-size change: anything sized by measurement rather than by CSS
      // is told by the event, and a sweep that skipped it was testing a state the
      // app never actually produces.
      await page.evaluate(size => {
        document.documentElement.dataset.text = size;
        document.dispatchEvent(new CustomEvent('maxdock:text-size', { detail: { textSize: size } }));
      }, textSize);
      await page.waitForTimeout(250);
      const where = `${name} · ${role}${textSize === 'normal' ? '' : ` · ${textSize}`}`;
      for (const e of errors) add(where, 1280, 'page-error', e.slice(0, 160));
      const rendered = await page.evaluate(() => ({
        page: Boolean(document.querySelector('.page')),
        failure: document.querySelector('.state--error, .state--warning')?.textContent?.trim().slice(0, 90) || '',
      }));
      if (rendered.failure) { add(where, 1280, 'page-shows-an-error', rendered.failure); await context.close(); continue; }
      if (!rendered.page) { add(where, 1280, 'page-did-not-render', 'no .page element'); await context.close(); continue; }
      // The rail must hold one line at every text size — the owner's own gate.
      const wrapped = await page.evaluate(() => [...document.querySelectorAll('.rail__link')]
        .filter(el => el.offsetParent !== null && el.getBoundingClientRect().height > 60)
        .map(el => el.textContent.trim().slice(0, 24)));
      for (const label of wrapped) add(where, 1280, 'rail-label-wraps', `"${label}" wraps at ${textSize}`);
      report(where, 1280, await page.evaluate(collect, null));
      await context.close();
    }
  }
}

// The sidebar closed. It is a second layout for every page — 132px of width comes
// back and the rail's own contents change — so it is swept like any other, rather
// than trusted because the width sweep passed with the rail open.
// Receiving is the kiosk screen a driver scans into. It has no rail to close, so
// it is not swept for one.
const RAIL_PAGES = (FAST ? ['board', 'queue'] : PAGES).filter(name => name !== 'receiving');
for (const name of RAIL_PAGES) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Toronto', locale: 'en-CA' });
  await context.addInitScript(STUB);
  await context.route('**/cdn.jsdelivr.net/**', route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/app/${name}.html${PAGE_QUERY[name] || ''}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  // Through the control, not by setting the attribute: pressing it is what the
  // reader does, and a sweep that wrote the attribute would not notice a button
  // that had stopped being wired to anything.
  const toggle = await page.$('[data-rail-toggle]');
  const where = `${name} · rail closed`;
  if (!toggle) { add(where, 1280, 'rail-toggle-missing', 'no [data-rail-toggle] in the top bar'); await context.close(); continue; }
  await toggle.click();
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => ({
    rail: document.documentElement.dataset.rail,
    width: document.querySelector('.rail')?.getBoundingClientRect().width || 0,
    labelled: [...document.querySelectorAll('.rail__link')].some(el => el.getBoundingClientRect().width > 90),
  }));
  if (state.rail !== 'mini') add(where, 1280, 'rail-did-not-close', `data-rail is "${state.rail}"`);
  if (state.width > 90) add(where, 1280, 'rail-still-wide', `rail is ${Math.round(state.width)}px closed`);
  if (state.labelled) add(where, 1280, 'rail-labels-still-shown', 'a link is still full width with its label');
  for (const e of errors) add(where, 1280, 'page-error', e.slice(0, 160));
  report(where, 1280, await page.evaluate(collect, null));
  await context.close();
}

await browser.close();
server.close();

function report(where, width, result) {
  if (result.overflowX > 1) add(where, width, 'page-scrolls-sideways', `${result.overflowX}px`);
  for (const b of result.bandSpill) add(where, width, 'controls-band-overflows-its-column', `.${String(b.sel).split(' ')[0]} needs ${b.spill}px more than the ${b.width}px column it was given`);
  for (const m of result.modal) add(where, width, 'dialog-does-not-fit', m);
  for (const c of [...new Map(result.collapsed.map(c => [c.sel, c])).values()].slice(0, 4)) add(where, width, 'band-collapsed', `.${c.sel} is ${c.h}px tall but holds ${c.needs}px of content`);
  for (const n of [...new Map((result.narrow || []).map(x => [x.sel, x])).values()].slice(0, 4)) add(where, width, 'text-column-too-narrow', `.${n.sel} is ${n.w}px wide — ${n.lines} lines at about ${n.perLine} characters each`);
  for (const s of [...new Map((result.selectCut || []).map(x => [x.text, x])).values()].slice(0, 6)) add(where, width, 'select-too-narrow', `"${s.text}" needs ${s.over}px more than its select shows`);
  for (const l of [...new Map((result.labelRagged || []).map(x => [x.text, x])).values()].slice(0, 6)) add(where, width, 'label-wraps-alone', `"${l.text}" is ${l.h}px tall beside labels of ${l.others}px — its field starts a line lower`);
  for (const c of [...new Map(result.cutOff.map(c => [c.text + c.over, c])).values()].slice(0, 5)) add(where, width, 'cut-off-by-hidden-overflow', `"${c.text}" is ${c.over}px outside .${c.by}`);
  for (const c of result.clipped.slice(0, 6)) add(where, width, 'content-clipped', `"${c.text}" overflows by ${c.over}px (${c.sel})`);
  for (const t of [...new Map(result.smallTargets.map(t => [t.sel + t.h, t])).values()].slice(0, 6)) add(where, width, 'hit-target-too-small', `"${t.text}" is ${t.h}px tall (${t.sel})`);
  for (const c of [...new Map(result.ctlHeights.map(c => [c.sel + c.h, c])).values()].slice(0, 6)) add(where, width, 'control-height-differs', `"${c.text}" is ${c.h}px tall, every control is ${c.want}px (${c.sel})`);
  for (const t of [...new Map(result.rawTimestamps.map(t => [t.text, t])).values()].slice(0, 4)) add(where, width, 'raw-timestamp-on-screen', `"${t.text}" (${t.sel})`);
  for (const u of [...new Map(result.unreachable.map(u => [u.sel, u])).values()].slice(0, 4)) add(where, width, 'content-below-the-fold-unreachable', `.${u.sel} ends ${u.below}px past the window and nothing scrolls — "${u.text}"`);
  for (const h of [...new Map(result.hiddenButShown.map(h => [h.sel, h])).values()].slice(0, 5)) add(where, width, 'hidden-element-still-visible', `.${h.sel} is marked hidden but still drawn — "${h.text}"`);
  for (const c of [...new Map(result.blockTextCut.map(c => [c.sel + c.why, c])).values()].slice(0, 5)) add(where, width, 'appointment-details-cut-off', `"${c.text}" ${c.why} by ${c.over}px (${c.sel})`);
  for (const u of result.rowUneven.slice(0, 4)) add(where, width, 'side-by-side-heights-differ', `${u.spread}px apart — ${u.boxes.join(', ')}`);
  for (const r of result.rowFill.slice(0, 4)) add(where, width, 'form-row-leaves-dead-space', `${r.unused}px unused of ${r.rowWidth}px across ${r.fields} fields`);
  for (const k of result.kpi.slice(0, 4)) add(where, width, 'kpi-strip', `${k.issue} ${JSON.stringify(k.widths || k.heights || k.unused)}`);
  for (const g of result.gaps) add(where, width, 'inconsistent-vertical-rhythm', `gaps ${g.distinctGaps.join(', ')}px between page sections`);
  for (const l of result.labelStyles) add(where, width, 'label-styles-differ', l.variants.join('  vs  '));
}

if (!findings.length) { console.log('Layout audit: no findings.'); process.exit(0); }
const byRule = findings.reduce((m, f) => { (m[f.rule] ||= []).push(f); return m; }, {});
console.log(`Layout audit: ${findings.length} finding(s)\n`);
for (const [rule, items] of Object.entries(byRule).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${rule}  (${items.length})`);
  const seen = new Set();
  for (const f of items) {
    const key = `${f.where}|${f.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`   ${f.where.padEnd(34)} @${f.width}  ${f.detail}`);
  }
  console.log('');
}
process.exit(process.env.AUDIT_STRICT ? 1 : 0);
