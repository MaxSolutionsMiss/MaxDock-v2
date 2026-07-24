#!/usr/bin/env node
/**
 * verify-maxdock.mjs — conformance checker for the MaxDock rebuild
 *
 * Encodes the rules from MAXDOCK_ARCHITECTURE.md and maxdock-design-v2.html as
 * checks a machine can run. Every rule here exists because the previous build
 * broke it. Run it in CI on every pull request.
 *
 *   node scripts/verify-maxdock.mjs            # check the repo
 *   node scripts/verify-maxdock.mjs --json     # machine-readable output
 *
 * Exit 0 = conformant. Exit 1 = at least one ERROR. Warnings never fail a build.
 *
 * No dependencies. Node 18+.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes('--json');
const findings = [];
const add = (level, rule, file, message, hint) =>
  findings.push({ level, rule, file, message, hint });
const error = (...a) => add('ERROR', ...a);
const warn  = (...a) => add('WARN',  ...a);

/* ---------------------------------------------------------------- helpers */
const SKIP = new Set(['.git', 'node_modules', 'docs', 'vendor', '.github']);
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files    = walk(ROOT);
const rel      = f => relative(ROOT, f);
const read     = f => readFileSync(f, 'utf8');
const byExt    = e => files.filter(f => extname(f) === e);
const cssFiles = byExt('.css');
const jsFiles  = byExt('.js').concat(byExt('.mjs'));
const htmlFiles= byExt('.html');
const kb       = n => Math.round(n / 1024);

/* strip comments and string literals so matches are real code, not prose */
/* strip comments only — string literals are preserved, because some rules
   (URLs, service hostnames) live inside strings and must still be caught */
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
/* additionally blank string literals — for rules that must not match prose */
const decomment = s => stripComments(s)
  .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}
function scan(text, re, cb) {
  let m; const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(text)) !== null) cb(m, lineOf(text, m.index));
}

/* ============================================================ CSS RULES */

// 1. exactly one stylesheet
{
  const own = cssFiles.filter(f => !/vendor|normalize|reset/i.test(f));
  if (own.length === 0) warn('css.single', '-', 'No stylesheet found.');
  else if (own.length > 1)
    error('css.single', own.map(rel).join(', '),
      `${own.length} stylesheets. The system permits exactly one.`,
      'Fold them into maxdock.css. Layered stylesheets are what produced 36 files last time.');
}

// 2. no !important
for (const f of cssFiles) {
  scan(decomment(read(f)), /!\s*important/gi, (_m, line) =>
    error('css.important', `${rel(f)}:${line}`, 'Uses !important.',
      'If specificity is fighting you the markup is wrong. The old build had 3,874 of these.'));
}

// 3. release-numbered assets must never reappear
for (const f of files) {
  if (/(?:^|[\/\\])maxdock-db\d+[\w-]*\.(css|js)$/i.test(f))
    error('assets.no-release-layers', rel(f),
      'Release-numbered patch asset.',
      'A visual change edits a token in the one stylesheet. Never add maxdock-dbNN.*');
}

// 4. colours and sizes come from tokens, not literals
for (const f of cssFiles) {
  const text = read(f);
  const tokenBlockEnd = (() => {
    const i = text.indexOf(':root');
    if (i === -1) return 0;
    const j = text.indexOf('}', i);
    return j === -1 ? 0 : j;
  })();
  const body = text.slice(tokenBlockEnd);
  scan(decomment(body), /#[0-9a-f]{3,8}\b/gi, (m, line) =>
    warn('css.token-colour', `${rel(f)}:${line + lineOf(text, tokenBlockEnd) - 1}`,
      `Literal colour ${m[0]} outside :root.`,
      'Use var(--token). Literals are how a palette drifts.'));
  scan(decomment(body), /font-size:\s*\d+(\.\d+)?px/gi, (m, line) =>
    error('css.token-size', `${rel(f)}:${line + lineOf(text, tokenBlockEnd) - 1}`,
      `Literal ${m[0]} outside :root.`,
      'Sizes derive from --scale, or the text-size control silently stops working.'));
  scan(decomment(body), /transition:[^;}]*?\b\d+(\.\d+)?m?s\b/gi, (m, line) =>
    error('motion.token', `${rel(f)}:${line + lineOf(text, tokenBlockEnd) - 1}`,
      'Literal transition duration.',
      'Use var(--motion), or prefers-reduced-motion stops working.'));
}

// 5. invalid declarations (the #005party class of typo)
for (const f of cssFiles) {
  scan(decomment(read(f)), /:\s*#[0-9a-z]*[g-z][0-9a-z]*\s*;/gi, (m, line) =>
    error('css.invalid-value', `${rel(f)}:${line}`,
      `Invalid colour value "${m[0].trim()}".`,
      'Browsers discard this silently, so it will not show up in testing.'));
}

/* =========================================================== HTML RULES */

for (const f of htmlFiles) {
  const text = read(f);
  const name = basename(f);

  // 6. no runtime script or stylesheet injection
  scan(text, /document\.write|createElement\(\s*['"](?:script|link)['"]/gi, (_m, line) =>
    error('html.no-runtime-loading', `${rel(f)}:${line}`,
      'Injects a script or stylesheet at runtime.',
      'Declare it in the HTML. Hidden load order was the single biggest cause of failure last time.'));

  // 7. the design-system script must load last
  const srcs = [...text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
  if (srcs.length) {
    const last = basename(srcs[srcs.length - 1].split('?')[0]);
    if (/page|view|screen/i.test(srcs.join(' ')) && !/pages?\//.test(srcs[srcs.length - 1]))
      warn('html.page-last', rel(f),
        `Last script is ${last}.`,
        'The page module loads last so nothing runs after it.');
  }

  // 8. logo usage — colour lockup on the login page only
  if (/logo-color\.png/i.test(text) && !/^index\.html$/i.test(name))
    error('brand.logo-usage', rel(f),
      'Uses logo-color.png outside the login page.',
      'The colour lockup appears on index.html only. Everywhere else uses logo-knockout.png in the badge.');

  // 9. viewport meta, or the tablet layout silently breaks
  if (!/name=["']viewport["']/i.test(text))
    error('html.viewport', rel(f), 'Missing viewport meta tag.',
      'Without it the iPad layout renders at desktop width.');
}

/* ============================================================= JS RULES */

const NETWORK_MODULE = /(^|[\/\\])db\.js$/;
const FORMAT_MODULE  = /(^|[\/\\])format\.js$/;

for (const f of jsFiles) {
  const raw  = read(f);
  const text = decomment(raw);      // code only, strings blanked
  const code = stripComments(raw);  // code including string contents

  // 10. only db.js talks to Supabase
  if (!NETWORK_MODULE.test(f)) {
    scan(text, /createClient\s*\(|supabase\.(from|rpc|auth)\b/g, (_m, line) =>
      error('js.single-network-module', `${rel(f)}:${line}`,
        'Talks to Supabase directly.',
        'All network access goes through db.js — that is what makes retry, caching and offline possible in one place.'));
  }

  // 11. only format.js does date arithmetic
  if (!FORMAT_MODULE.test(f)) {
    scan(text, /new Date\(|\.getHours\(|\.setHours\(|\.getTimezoneOffset\(/g, (_m, line) =>
      error('js.time-in-format-only', `${rel(f)}:${line}`,
        'Date arithmetic outside format.js.',
        'Times render in the location timezone, not the browser. DST breaks naive hour maths twice a year.'));
  }

  // 12. no MutationObserver for layout
  scan(text, /new\s+MutationObserver/g, (_m, line) =>
    error('js.no-mutation-observers', `${rel(f)}:${line}`,
      'Creates a MutationObserver.',
      'The old build ran 21 at once. That is precisely what duplicated the gear controls.'));

  // 13. no third-party QR service  (scans `code`: the hostname lives in a string)
  scan(code, /qrserver\.com|api\.qrserver/gi, (_m, line) =>
    error('privacy.local-qr', `${rel(f)}:${line}`,
      'Generates the QR through a third party.',
      'This leaks appointment references off your infrastructure and Chrome blocks it. Generate locally.'));

  // 13b. no other third-party runtime dependency for core UI
  scan(code, /https?:\/\/(?!fonts\.(googleapis|gstatic)\.com)[a-z0-9.-]*\.(com|net|io|org)\/[^\s'"`]*\.(png|svg|jpe?g|gif)/gi,
    (m, line) => warn('privacy.third-party-asset', `${rel(f)}:${line}`,
      `Loads an image from ${m[0].split('/')[2]}.`,
      'Assets ship with the app. A third-party host can be blocked, can go down, and sees your traffic.'));

  // 14. no browser storage for app state (session excepted)
  scan(text, /localStorage\.(setItem|getItem)|sessionStorage\./g, (m, line) => {
    if (/supabase|session|auth/i.test(raw.slice(Math.max(0, m.index - 120), m.index + 120))) return;
    warn('js.no-local-state', `${rel(f)}:${line}`,
      'Stores application state in browser storage.',
      'Preferences belong in user_preferences so they follow a person between devices.');
  });

  // 15. the 5-second poll must be suspendable
  if (/(^|[\/\\])poll\.js$/.test(f)) {
    if (!/suspend/.test(text) || !/resume/.test(text))
      error('poll.suspendable', rel(f),
        'poll.js has no suspend/resume.',
        'Refresh must never re-render while a slot picker is open or a form is dirty.');
    if (!/visibilityState|visibilitychange/.test(text))
      warn('poll.visibility', rel(f),
        'Poll does not pause on a hidden tab.',
        'A tablet left on a bench should not poll all night.');
  }
}

/* ====================================================== PERFORMANCE BUDGET */
{
  const cssBytes = cssFiles.reduce((n, f) => n + statSync(f).size, 0);
  const appJs = jsFiles.filter(f => !/supabase|vendor/i.test(f));
  const jsBytes = appJs.reduce((n, f) => n + statSync(f).size, 0);
  if (cssBytes > 60 * 1024)
    warn('budget.css', '-', `CSS is ${kb(cssBytes)} KB, budget 60 KB.`,
      'The old build shipped 36 stylesheets per page.');
  if (jsBytes > 120 * 1024)
    warn('budget.js', '-', `Application JS is ${kb(jsBytes)} KB, budget 120 KB.`,
      'The old build shipped ~617 KB. If you need a 24th script the architecture has drifted.');
  if (jsFiles.length > 30)
    warn('budget.files', '-', `${jsFiles.length} JS files.`, 'Check against the module list in the architecture doc.');
}

/* ============================================ REQUIRED DOCUMENTS PRESENT */
for (const doc of ['docs/maxdock-design-v2.html',
                   'docs/MAXDOCK_FUNCTIONAL_SPEC.md',
                   'docs/MAXDOCK_ARCHITECTURE.md']) {
  if (!existsSync(join(ROOT, doc)))
    error('docs.contract', doc, 'Contract document missing.',
      'The three documents are the agreement between design and implementation. They live in /docs/ under these exact names.');
}

/* ======================================================= REPORT */
const errors = findings.filter(f => f.level === 'ERROR');
const warns  = findings.filter(f => f.level === 'WARN');

if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: errors.length === 0,
    counts: { errors: errors.length, warnings: warns.length },
    findings
  }, null, 2));
} else {
  const group = list => {
    const by = {};
    for (const f of list) (by[f.rule] ||= []).push(f);
    for (const [rule, items] of Object.entries(by)) {
      console.log(`\n  ${items[0].level === 'ERROR' ? '✗' : '!'} ${rule}  (${items.length})`);
      console.log(`    ${items[0].hint || ''}`);
      for (const i of items.slice(0, 8)) console.log(`      ${i.file}  ${i.message}`);
      if (items.length > 8) console.log(`      … and ${items.length - 8} more`);
    }
  };
  console.log('\nMaxDock conformance check');
  console.log('─'.repeat(58));
  console.log(`  ${htmlFiles.length} html · ${cssFiles.length} css · ${jsFiles.length} js`);
  if (errors.length) { console.log('\nERRORS — these fail the build'); group(errors); }
  if (warns.length)  { console.log('\nWARNINGS — review, do not fail'); group(warns); }
  console.log('\n' + '─'.repeat(58));
  console.log(errors.length
    ? `  ${errors.length} error${errors.length > 1 ? 's' : ''}, ${warns.length} warning${warns.length === 1 ? '' : 's'}`
    : `  Conformant. ${warns.length} warning${warns.length === 1 ? '' : 's'}.`);
  console.log();
}

process.exit(errors.length ? 1 : 0);
