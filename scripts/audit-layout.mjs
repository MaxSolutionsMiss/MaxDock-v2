// Renders every MaxDock page in a real browser against a stubbed Supabase and
// checks it against the layout rules the owner signed off across DB64–DB66:
// labels beside their fields, one spacing rhythm, KPI cards filling their row,
// consistent action placement, nothing clipped, nothing overflowing.
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
const WIDTHS = [1440, 1280, 1024];
const PAGES = ['board', 'queue', 'my-appointments', 'settings', 'reports', 'users', 'data'];

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
const add = (page, width, rule, detail) => findings.push({ page, width, rule, detail });

const browser = await chromium.launch();
for (const name of PAGES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(STUB);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/app/${name}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    for (const e of errors) add(name, width, 'page-error', e.slice(0, 160));

    const result = await page.evaluate(() => {
      const out = { clipped: [], smallTargets: [], rowFill: [], kpi: [], gaps: [], overflowX: 0, labelStyles: [] };
      const vis = el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';

      out.overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;

      // Content wider than its box — the "fields are cut off" defect.
      document.querySelectorAll('.input,.select,td,th,.field__label,.setrow__d,.kpi__label,.rail__link,.btn').forEach(el => {
        if (!vis(el)) return;
        if (el.scrollWidth > el.clientWidth + 1) {
          out.clipped.push({ text: (el.textContent || el.value || '').trim().slice(0, 44), over: el.scrollWidth - el.clientWidth, sel: el.className });
        }
      });

      // Interactive controls below a comfortable hit size. A small checkbox inside a
      // padded <label> is fine — the label is what the pointer actually hits — so
      // measure the effective target, not just the control box.
      document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea').forEach(el => {
        if (!vis(el)) return;
        const wrapper = el.closest('label');
        const target = wrapper && wrapper.contains(el) ? wrapper : el;
        const h = Math.round(Math.max(el.getBoundingClientRect().height, target.getBoundingClientRect().height));
        if (h > 0 && h < 32) out.smallTargets.push({ text: (el.textContent || el.getAttribute('aria-label') || el.type || '').trim().slice(0, 32), h, sel: el.className });
      });

      // A form row should use its width, not stop short and leave the rest empty.
      document.querySelectorAll('.frow').forEach(row => {
        if (!vis(row)) return;
        const rw = row.getBoundingClientRect().width;
        const kids = [...row.children].filter(vis);
        if (!kids.length || rw < 200) return;
        const right = Math.max(...kids.map(k => k.getBoundingClientRect().right));
        const unused = Math.round(row.getBoundingClientRect().right - right);
        if (unused > rw * 0.25) out.rowFill.push({ unused, rowWidth: Math.round(rw), fields: kids.length });
      });

      // KPI cards must fill their row evenly (DB65/DB66).
      document.querySelectorAll('.kpis').forEach(strip => {
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

      // One vertical rhythm between the major page bands.
      const bands = [...document.querySelectorAll('.page > *')].filter(vis);
      const seen = new Set();
      for (let i = 1; i < bands.length; i += 1) {
        const gap = Math.round(bands[i].getBoundingClientRect().top - bands[i - 1].getBoundingClientRect().bottom);
        if (gap >= 0 && gap < 80) seen.add(gap);
      }
      if (seen.size > 2) out.gaps.push({ distinctGaps: [...seen].sort((a, b) => a - b) });

      // Field labels must all be styled the same way.
      const styles = new Set();
      document.querySelectorAll('.field__label, .dock-checks > legend').forEach(el => {
        if (!vis(el)) return;
        const s = getComputedStyle(el);
        styles.add(`${s.fontSize}|${s.textTransform}|${s.fontWeight}`);
      });
      if (styles.size > 1) out.labelStyles.push({ variants: [...styles] });

      return out;
    });

    if (result.overflowX > 1) add(name, width, 'page-scrolls-sideways', `${result.overflowX}px`);
    for (const c of result.clipped.slice(0, 6)) add(name, width, 'content-clipped', `"${c.text}" overflows by ${c.over}px (${c.sel})`);
    for (const t of [...new Map(result.smallTargets.map(t => [t.sel + t.h, t])).values()].slice(0, 6)) add(name, width, 'hit-target-too-small', `"${t.text}" is ${t.h}px tall (${t.sel})`);
    for (const r of result.rowFill.slice(0, 4)) add(name, width, 'form-row-leaves-dead-space', `${r.unused}px unused of ${r.rowWidth}px across ${r.fields} fields`);
    for (const k of result.kpi.slice(0, 4)) add(name, width, 'kpi-strip', `${k.issue} ${JSON.stringify(k.widths || k.heights || k.unused)}`);
    for (const g of result.gaps) add(name, width, 'inconsistent-vertical-rhythm', `gaps ${g.distinctGaps.join(', ')}px between page sections`);
    for (const l of result.labelStyles) add(name, width, 'label-styles-differ', l.variants.join('  vs  '));

    await context.close();
  }
}
await browser.close();
server.close();

if (!findings.length) { console.log('Layout audit: no findings.'); process.exit(0); }
const byRule = findings.reduce((m, f) => { (m[f.rule] ||= []).push(f); return m; }, {});
console.log(`Layout audit: ${findings.length} finding(s)\n`);
for (const [rule, items] of Object.entries(byRule).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${rule}  (${items.length})`);
  const seen = new Set();
  for (const f of items) {
    const key = `${f.page}|${f.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`   ${f.page.padEnd(16)} @${f.width}  ${f.detail}`);
  }
  console.log('');
}
process.exit(process.env.AUDIT_STRICT ? 1 : 0);
