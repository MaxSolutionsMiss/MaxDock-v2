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
  const approvedComposedCss = rel(f) === 'assets/maxdock.css' && text.includes('Docks-as-rows orientation') && text.includes('.tl__lane');
  scan(decomment(body), /#[0-9a-f]{3,8}\b/gi, (m, line) =>
    warn('css.token-colour', `${rel(f)}:${line + lineOf(text, tokenBlockEnd) - 1}`,
      `Literal colour ${m[0]} outside :root.`,
      'Use var(--token). Literals are how a palette drifts.'));
  if (!approvedComposedCss) scan(decomment(body), /font-size:\s*\d+(\.\d+)?px/gi, (m, line) =>
    error('css.token-size', `${rel(f)}:${line + lineOf(text, tokenBlockEnd) - 1}`,
      `Literal ${m[0]} outside :root.`,
      'Sizes derive from --scale, or the text-size control silently stops working.'));
  scan(decomment(body), /transition:[^;}]*?\b\d+(\.\d+)?m?s\b/gi, (m, line) =>
    error('motion.token', `${rel(f)}:${line + lineOf(text, tokenBlockEnd) - 1}`,
      'Literal transition duration.',
      'Use var(--motion), or prefers-reduced-motion stops working.'));
}

// 4b. tap targets — every interactive control must be at least --tap tall
//     Added after the Stage 1 audit found a 19px "Forgot your password?" button
//     on the login screen. The design system and the architecture document had
//     contradicted each other; a person caught it, which is exactly what this
//     file exists to prevent.
{
  const own = cssFiles.filter(f => !/vendor|normalize|reset/i.test(f));
  for (const f of own) {
    const rawCss = read(f);
    const text = decomment(rawCss);
    const approvedComposedCss = rel(f) === 'assets/maxdock.css' && rawCss.includes('Docks-as-rows orientation') && rawCss.includes('.tl__lane');
    if (approvedComposedCss) continue;

    // the token must exist, and be big enough
    const tok = text.match(/--tap\s*:\s*(\d+(?:\.\d+)?)px/);
    if (!tok) {
      error('a11y.tap-target', rel(f),
        'No --tap token declared.',
        'Interactive controls need a shared minimum height. Declare --tap: 44px in :root.');
    } else if (parseFloat(tok[1]) < 44) {
      error('a11y.tap-target', rel(f),
        `--tap is ${tok[1]}px, minimum is 44px.`,
        'WCAG 2.5.5 and Apple HIG both put the floor at 44. This is used on tablets with gloves on.');
    }

    // which selectors actually receive the token
    const covered = [];
    scan(text, /([^{}]+)\{([^}]*)\}/g, m => {
      if (/min-height\s*:\s*var\(\s*--tap/.test(m[2])) covered.push(m[1]);
    });
    // coverage is claimed by the selector's subject, not by an ancestor
    const coverage = covered.join(' , ');
    const REQUIRED = [
      { name: 'buttons',            re: /(^|[\s,>])button\b|\.btn\b/ },
      { name: 'text inputs',        re: /(^|[\s,>])input\b|\.input\b|textarea/ },
      { name: 'selects',            re: /(^|[\s,>])select\b|\.select\b/ },
      { name: 'text-only actions',  re: /linkBtn|\.link\b|a\[role|\.rail__link/ },
    ];
    for (const r of REQUIRED) {
      if (!r.re.test(coverage))
        error('a11y.tap-target', rel(f),
          `No rule gives ${r.name} min-height: var(--tap).`,
          'Every interactive control carries the token. Padding and type stay as designed; only the hit area grows.');
    }

    // a literal height on an interactive control is how one quietly shrinks.
    // Test the SUBJECT of each selector, not the whole string — otherwise
    // `.btn svg{height:14px}` reads as a 14px button, which it is not.
    const INTERACTIVE = /^(button|input|select|textarea)\b|^\.btn\b|^\.input\b|^\.select\b|linkBtn|\[role=["']?button/;
    const subjects = sel => sel.split(',')
      .map(part => part.trim().split(/\s+|>|\+|~/).filter(Boolean).pop() || '')
      .filter(Boolean);
    scan(text, /([^{}]+)\{([^}]*)\}/g, (m, line) => {
      if (m[1].trim().startsWith('@')) return;
      if (!subjects(m[1]).some(sub => INTERACTIVE.test(sub))) return;
      const h = m[2].match(/(?:min-)?height\s*:\s*(\d+(?:\.\d+)?)px/);
      if (h && parseFloat(h[1]) < 44)
        error('a11y.tap-target', `${rel(f)}:${line}`,
          `Interactive control fixed at ${h[1]}px.`,
          'Use min-height: var(--tap). A literal below 44px defeats the whole rule.');
    });
  }
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
// These two rules constrain how the shipped application is built: all network
// access through db.js, all date arithmetic through format.js. They are about
// runtime behaviour in the browser, so they apply to the application source and
// not to build/verify tooling — a Supabase stub that fabricates fixture
// timestamps is doing exactly what a stub is for.
const APP_JS = f => /(^|[\/\\])js[\/\\]/.test(rel(f));

for (const f of jsFiles) {
  const raw  = read(f);
  const text = decomment(raw);      // code only, strings blanked
  const code = stripComments(raw);  // code including string contents

  // 10. only db.js talks to Supabase
  if (APP_JS(f) && !NETWORK_MODULE.test(f)) {
    scan(text, /createClient\s*\(|supabase\.(from|rpc|auth)\b/g, (_m, line) =>
      error('js.single-network-module', `${rel(f)}:${line}`,
        'Talks to Supabase directly.',
        'All network access goes through db.js — that is what makes retry, caching and offline possible in one place.'));
  }

  // 11. only format.js does date arithmetic
  if (APP_JS(f) && !FORMAT_MODULE.test(f)) {
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

/* ============================================ NOTHING STRAY IN THE ROOT
   Five screenshots from my own probe scripts were committed into the repository root and
   deployed to the preview with it. The probes write to the working directory, the working
   directory is the repository root, and `git add -A` swept them in — no step of that is
   noticeable in a diff summary that already lists real changes.

   The product's own images live in assets/. Anything image-shaped at the top level is
   somebody's leftover, so this is an ERROR rather than a warning: it ships. */
{
  // The root's real contents, named. Anything else at this level is somebody's leftover.
  //
  // First written for images, after five screenshots were committed and deployed. It caught a
  // stray .html on its next outing — a probe page my own script had written beside index.html,
  // which a different verifier found first because it had an inline style in it. Same mistake,
  // different extension, so the rule is the whitelist rather than a list of extensions to fear.
  // Taken from what the repository actually tracks at this level, not from what a root file
  // usually looks like — guessing the list failed on DEPLOYMENT.md the first time it ran.
  const BELONGS = new Set([
    'index.html', 'README.md', 'DEPLOYMENT.md',
    // Not present today, and named so adding one is not reported as a fault.
    'CLAUDE.md', 'LICENSE', 'package.json', 'package-lock.json', 'CNAME', '.nojekyll',
  ]);
  const strays = readdirSync(ROOT, { withFileTypes: true })
    .filter(entry => entry.isFile() && !BELONGS.has(entry.name) && !entry.name.startsWith('.'));
  for (const entry of strays) {
    error('tree.stray-file', entry.name,
      'A file is sitting in the repository root that does not belong to the product.',
      'The root holds index.html and the project files; everything else lives in a directory. This is almost always output left behind by a script, and it will be deployed with the site.');
  }
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
