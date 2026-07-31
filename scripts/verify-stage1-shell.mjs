#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const failures = [];
const fail = (file, message) => failures.push({ file, message });
const read = path => readFileSync(join(ROOT, path), 'utf8');

const required = [
  'index.html',
  'app/board.html',
  'app/my-appointments.html',
  'assets/maxdock.css',
  'assets/logo-knockout.png',
  'assets/logo-color.png',
  'js/db.js',
  'js/session.js',
  'js/router.js',
  'js/format.js',
  'js/poll.js',
  'js/ui/empty.js',
  'js/ui/toast.js',
  'js/pages/login.js',
  'js/pages/board.js',
  'js/pages/my-appointments.js',
];
for (const path of required) if (!existsSync(join(ROOT, path))) fail(path, 'Required Stage 1 shell file is missing.');

for (const path of ['src', 'package.json', 'vite.config.ts', 'tsconfig.json', 'eslint.config.js']) {
  if (existsSync(join(ROOT, path))) fail(path, 'Legacy React/Vite material remains in Stage 1.');
}

const status = read('docs/STATUS.md');
const stageMatch = status.match(/## Stage\s+\n?\s*(\d+)\s+of\s+8/i);
if (!stageMatch || Number(stageMatch[1]) < 1) fail('docs/STATUS.md', 'Status must declare Stage 1 or later.');

function walk(dir, out = []) {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return out;
  for (const name of readdirSync(absolute)) {
    const path = join(absolute, name);
    if (statSync(path).isDirectory()) walk(relative(ROOT, path), out);
    else out.push(path);
  }
  return out;
}

const htmlFiles = [join(ROOT, 'index.html'), ...walk('app').filter(path => extname(path) === '.html')];
for (const absolute of htmlFiles) {
  const file = relative(ROOT, absolute).replaceAll('\\', '/');
  const text = readFileSync(absolute, 'utf8');
  const localRefs = [...text.matchAll(/(?:href|src)=["']([^"']+)["']/gi)]
    .map(match => match[1])
    .filter(value => !/^(?:https?:|#|mailto:|data:)/i.test(value));
  for (const ref of localRefs) {
    const clean = ref.split(/[?#]/)[0];
    const target = normalize(resolve(dirname(absolute), clean));
    if (!target.startsWith(ROOT) || !existsSync(target)) fail(file, `Local reference does not resolve: ${ref}`);
  }

  const scripts = [...text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(match => match[1]);
  if (file.startsWith('app/')) {
    const last = scripts.at(-1) || '';
    if (!/\.\.\/js\/pages\/.+\.js$/.test(last)) fail(file, 'The page module is not the final declared script.');
  }

  const colourLogoUses = (text.match(/logo-color\.png/gi) || []).length;
  if (file === 'index.html' && colourLogoUses !== 1) fail(file, `Expected one full-colour logo use; found ${colourLogoUses}.`);
  if (file !== 'index.html' && colourLogoUses) fail(file, 'Full-colour logo appears outside the login page.');
}

const pageModules = walk('js/pages').filter(path => extname(path) === '.js');
for (const absolute of pageModules) {
  const file = relative(ROOT, absolute).replaceAll('\\', '/');
  const text = readFileSync(absolute, 'utf8');
  if (file !== 'js/pages/login.js' && !/export const \{ mount, refresh, destroy \}/.test(text)) {
    fail(file, 'Page module does not export mount, refresh and destroy.');
  }
}

for (const absolute of walk('js').filter(path => extname(path) === '.js')) {
  const result = spawnSync(process.execPath, ['--check', absolute], { encoding: 'utf8' });
  if (result.status !== 0) fail(relative(ROOT, absolute), result.stderr.trim() || 'JavaScript syntax check failed.');
}

const cssBytes = statSync(join(ROOT, 'assets/maxdock.css')).size;
const stageOneJsFiles = [
  'js/db.js',
  'js/session.js',
  'js/router.js',
  'js/format.js',
  'js/poll.js',
  'js/ui/empty.js',
  'js/ui/toast.js',
  'js/pages/login.js',
  'js/pages/board.js',
];
const jsBytes = stageOneJsFiles.reduce((sum, path) => sum + statSync(join(ROOT, path)).size, 0);
const cssRuleBytes = Buffer.byteLength(readFileSync(join(ROOT, 'assets/maxdock.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
// Two budgets, and only one of them is about the site being fast. The rules are what
// a browser parses and what CSS sprawl shows up in. The file limit counts the comments
// too, and comments are the reasoning this stylesheet is maintained by — over the wire
// the whole thing is about 22 KB gzipped against half a megabyte of JavaScript, so
// trading a paragraph of "why" for three rules was never a trade worth making.
//
// The rules figure is the gate, and it has been raised twice, both times on 2026-07-30 and
// both times written down here rather than nudged.
//
//   60 → 66 KB. Sixty was set when the product was a shell, a board and a settings screen,
//   and it had come to carry eight report views with their own chart system, role access,
//   two importers, a combine dialog, a multi-site picker and a truck.
//
//   66 → 70 KB. The owner's release pass added the paperwork panel, the four-quarter
//   appointment window with its rules and its metric-sized reference, readings drawn as
//   filling shapes as well as dials, and marks down the side of the day brief. Every one of
//   those is a thing on screen he asked for by name.
//
//   70 → 74 KB. P0 and the VR1 refinement pass, 2.4 KB of it, and every rule is a thing the
//   owner asked for: hit areas that reach 44px without the compact strip growing, one focus
//   ring instead of the browser's on everything including a rail where its own was invisible,
//   the current-time line on the board, the refresh stamp beside the date, a named group in
//   the settings card, and the board's loading shape so the page arrives at its height once
//   rather than twice. The dead-rule scan was run again before raising and returned nothing:
//   the pass that cleared .spark, .qrblock and the parallel .fillfig namespace had already
//   taken everything there was. The skeleton was rewritten twice to reuse the ruler and lane
//   dimensions rather than restate them, which saved 560 bytes; the raise is what is left
//   after that, not instead of it.
//
// Both raises were made only after reclaiming everything genuinely dead: the .spark chart,
// .ctrl-field--grow, .cell-fine, .pickgroup--wide, .qrblock, .status--changed, a parallel
// .fillfig namespace that the trailer's own classes already covered, the duplicate
// -webkit-mask copies, -webkit-overflow-scrolling (default on iOS since 13) and
// -webkit-font-smoothing. A scan for rules whose every class is absent from js/ and app/
// now returns only dynamically composed names, so there is nothing left to take.
//
// The point of the number is not the number. It is that growth in what a browser parses
// stays a decision somebody has to make on purpose and justify in writing, instead of
// arriving one convenience rule at a time.
if (cssRuleBytes > 74 * 1024) fail('assets/maxdock.css', `CSS rule budget exceeded: ${Math.round(cssRuleBytes / 1024)} KB of declarations.`);
// The file figure is a sanity bound, not a second gate, and it took two raises in one day to
// see that it had been the wrong shape all along. Sitting 2 KB above the rules content, it
// bound on *comments* — so the thing it actually rationed was the reasoning three paragraphs
// above insist on keeping, and clearing it meant deleting explanation to satisfy a number
// whose job the rules gate already does. Twice the ceiling was raised for prose alone.
// So it is now set well clear: it catches a pasted library or a duplicated stylesheet, and
// nothing else. If this one ever fails, look for something that is not CSS.
if (cssBytes > 160 * 1024) fail('assets/maxdock.css', `CSS file budget exceeded: ${Math.round(cssBytes / 1024)} KB including comments.`);
if (jsBytes > 120 * 1024) fail('js/', `Stage 1 JavaScript budget exceeded: ${Math.round(jsBytes / 1024)} KB.`);

// One stylesheet means one place a spacing decision is made. An inline style is a
// second place, and the same visual role written inline on six pages is how six
// pages end up with six different offsets — which is what the owner keeps seeing
// as things not lining up.
//
// Two inline styles are legitimate and stay allowed: a CSS custom property
// carrying data into the stylesheet (--c, --kpi-cols, --rows), and a value
// computed at render time from a template expression (a timeline block's left
// and width, a bar's height). Anything else is a declaration that belongs in
// assets/maxdock.css under a name.
const styleAttribute = /style="([^"]*)"/g;
for (const file of readdirSync(join(ROOT, 'js/pages')).map(name => `js/pages/${name}`)
  .concat(readdirSync(join(ROOT, 'js/ui')).map(name => `js/ui/${name}`))) {
  const source = readFileSync(join(ROOT, file), 'utf8');
  for (const [, value] of source.matchAll(styleAttribute)) {
    const computed = value.includes('${');
    const customPropertyOnly = value.split(';').filter(Boolean).every(part => part.trim().startsWith('--'));
    if (computed || customPropertyOnly) continue;
    fail(file, `inline style "${value}" — give it a class in assets/maxdock.css instead.`);
  }
}

console.log('\nMaxDock Stage 1 shell verification');
console.log('─'.repeat(58));
if (failures.length) {
  for (const item of failures) console.log(`  ✗ ${item.file} · ${item.message}`);
  console.log('─'.repeat(58));
  console.log(`  ${failures.length} failure(s).`);
  process.exit(1);
}
console.log(`  ${htmlFiles.length} HTML · ${Math.round(cssBytes / 1024)} KB CSS · ${Math.round(jsBytes / 1024)} KB JS`);
console.log('  Stage 1 static shell structure is valid.\n');
