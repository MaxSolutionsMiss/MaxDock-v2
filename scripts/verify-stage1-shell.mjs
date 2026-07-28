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
if (cssRuleBytes > 60 * 1024) fail('assets/maxdock.css', `CSS rule budget exceeded: ${Math.round(cssRuleBytes / 1024)} KB of declarations.`);
if (cssBytes > 80 * 1024) fail('assets/maxdock.css', `CSS file budget exceeded: ${Math.round(cssBytes / 1024)} KB including comments.`);
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
