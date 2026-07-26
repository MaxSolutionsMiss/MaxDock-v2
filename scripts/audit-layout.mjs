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
const WIDTHS = [1440, 1280, 1024, 834, 768, 430, 390];
// Dialogs are audited at a subset — one desktop, one laptop, one tablet, one phone.
// They are opened inside the page load that is already running, so this costs
// interactions rather than navigations.
const MODAL_WIDTHS = new Set([1440, 1024, 768, 390]);
const PAGES = ['board', 'queue', 'my-appointments', 'settings', 'reports', 'users', 'data'];

// Dialogs reachable from each page, with the control that opens them. Every one of
// these is a place a field can clip or a row can fall out of alignment, and until
// now none of them were rendered by the audit at all — which is exactly where the
// owner found the original Add user defect.
const MODALS = {
  board: [
    { name: 'block-dock-time', trigger: '[data-block-time]' },
    { name: 'edit-appointment', trigger: '[data-edit-record]' },
    { name: 'book-appointment', trigger: '[data-open-booking]', walkSteps: 5 },
    { name: 'notifications', trigger: '.notif__btn' },
  ],
  queue: [
    { name: 'book-appointment', trigger: '[data-open-booking]', walkSteps: 5 },
    { name: 'customize', trigger: '[data-customize]' },
  ],
  'my-appointments': [{ name: 'cancel-appointment', trigger: '.btn--danger' }],
  // Add dock lives in the Docks & truck types section, so the section has to be
  // opened before the control exists.
  settings: [{ name: 'add-dock', prepare: '[data-section="docks"]', trigger: '[data-add-dock]' }],
  users: [
    { name: 'add-user', trigger: '[data-add-user]' },
    { name: 'edit-user', trigger: '[data-edit-user]' },
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
  const out = { clipped: [], smallTargets: [], rowFill: [], kpi: [], gaps: [], overflowX: 0, labelStyles: [], cutOff: [], rowUneven: [], modal: [], collapsed: [] };
  if (!root) return out;
  const vis = el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';

  if (!scope) out.overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;

  // Content wider than its box — the "fields are cut off" defect.
  root.querySelectorAll('.input,.select,td,th,.field__label,.setrow__d,.kpi__label,.rail__link,.btn,.step').forEach(el => {
    if (!vis(el)) return;
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

  // A form row should use its width, not stop short and leave the rest empty.
  root.querySelectorAll('.frow').forEach(row => {
    if (!vis(row)) return;
    const rw = row.getBoundingClientRect().width;
    const kids = [...row.children].filter(vis);
    if (!kids.length || rw < 200) return;
    const right = Math.max(...kids.map(k => k.getBoundingClientRect().right));
    const unused = Math.round(row.getBoundingClientRect().right - right);
    if (unused > rw * 0.25) out.rowFill.push({ unused, rowWidth: Math.round(rw), fields: kids.length });
  });

  // KPI cards must fill their row evenly (DB65/DB66).
  root.querySelectorAll('.kpis').forEach(strip => {
    if (!vis(strip)) return;
    const cards = [...strip.children].filter(vis);
    if (cards.length < 2) return;
    const widths = cards.map(c => Math.round(c.getBoundingClientRect().width));
    const heights = cards.map(c => Math.round(c.getBoundingClientRect().height));
    if (Math.max(...widths) - Math.min(...widths) > 2) out.kpi.push({ issue: 'cards not equal width', widths });
    if (Math.max(...heights) - Math.min(...heights) > 2) out.kpi.push({ issue: 'cards not equal height', heights });
    const right = Math.max(...cards.map(c => c.getBoundingClientRect().right));
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
    const foot = root.querySelector('.modal__foot, .form-actions');
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
    else el.value = 'AUDIT-0001';
    fire(el);
  });
  root.querySelector('[data-slot]')?.click();
}

const browser = await chromium.launch();
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
    await page.goto(`http://127.0.0.1:${PORT}/app/${name}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    for (const e of errors) add(name, width, 'page-error', e.slice(0, 160));

    // Every rule below is a "this must not be wrong" check, so a page that renders
    // nothing satisfies all of them. Assert the page actually drew before trusting
    // a clean result — a silent boot failure once made this whole job pass empty.
    const rendered = await page.evaluate(() => {
      const root = document.querySelector('.page');
      return { has: Boolean(root), controls: document.querySelectorAll('.page .btn,.page .input,.page .select,.page td').length };
    });
    if (!rendered.has || rendered.controls < 3) {
      add(name, width, 'page-did-not-render', rendered.has ? `.page holds ${rendered.controls} controls` : 'no .page element — the app never booted');
      await context.close();
      continue;
    }

    report(name, width, await page.evaluate(collect, null));

    if (MODAL_WIDTHS.has(width)) {
      for (const spec of MODALS[name] || []) {
        const where = `${name} › ${spec.name}`;
        if (spec.prepare) {
          await page.locator(spec.prepare).first().click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(400);
        }
        const trigger = page.locator(spec.trigger).first();
        if (!(await trigger.count())) { add(where, width, 'modal-trigger-missing', `no ${spec.trigger} on the page`); continue; }
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
          const label = steps > 1 ? `${where} (step ${step + 1})` : where;
          report(label, width, await page.evaluate(collect, '[data-audit-open]'));
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
await browser.close();
server.close();

function report(where, width, result) {
  if (result.overflowX > 1) add(where, width, 'page-scrolls-sideways', `${result.overflowX}px`);
  for (const m of result.modal) add(where, width, 'dialog-does-not-fit', m);
  for (const c of [...new Map(result.collapsed.map(c => [c.sel, c])).values()].slice(0, 4)) add(where, width, 'band-collapsed', `.${c.sel} is ${c.h}px tall but holds ${c.needs}px of content`);
  for (const c of [...new Map(result.cutOff.map(c => [c.text + c.over, c])).values()].slice(0, 5)) add(where, width, 'cut-off-by-hidden-overflow', `"${c.text}" is ${c.over}px outside .${c.by}`);
  for (const c of result.clipped.slice(0, 6)) add(where, width, 'content-clipped', `"${c.text}" overflows by ${c.over}px (${c.sel})`);
  for (const t of [...new Map(result.smallTargets.map(t => [t.sel + t.h, t])).values()].slice(0, 6)) add(where, width, 'hit-target-too-small', `"${t.text}" is ${t.h}px tall (${t.sel})`);
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
