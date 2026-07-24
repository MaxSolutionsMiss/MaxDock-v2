#!/usr/bin/env node
/**
 * Implementation-owned repository gate for the MaxDock rebuild.
 *
 * Claude's scripts/verify-maxdock.mjs remains unchanged and design-owned.
 * This companion enforces the repository transition to the approved static,
 * no-build architecture without altering Claude's checker.
 *
 * Stage 0: the legacy React/Vite shell may remain temporarily, but is reported.
 * Stage 1+: React, Vite, TypeScript application code and build tooling fail CI.
 *
 * No dependencies. Node 20+.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes('--json');
const findings = [];
const add = (level, rule, file, message, hint = '') => findings.push({ level, rule, file, message, hint });
const error = (...args) => add('ERROR', ...args);
const warn = (...args) => add('WARN', ...args);

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor']);
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const files = walk(ROOT);
const rel = path => relative(ROOT, path).replaceAll('\\', '/');
const read = path => readFileSync(path, 'utf8');
const applicationFiles = files.filter(path => !rel(path).startsWith('docs/') && !rel(path).startsWith('.github/') && !rel(path).startsWith('scripts/'));

function parseStage() {
  const statusPath = join(ROOT, 'docs', 'STATUS.md');
  if (!existsSync(statusPath)) {
    error('transition.status', 'docs/STATUS.md', 'STATUS.md is missing.', 'The implementation owner updates this file at every stage.');
    return 0;
  }
  const text = read(statusPath);
  const match = text.match(/## Stage\s+\n?\s*(\d+)\s+of\s+8/i);
  if (!match) {
    error('transition.status', 'docs/STATUS.md', 'Could not parse the stage number.', 'Use the format “0 of 8 — …”.');
    return 0;
  }
  return Number(match[1]);
}

const stage = parseStage();
const strict = stage >= 1;

const requiredContracts = [
  'docs/maxdock-design-v2.html',
  'docs/MAXDOCK_FUNCTIONAL_SPEC.md',
  'docs/MAXDOCK_ARCHITECTURE.md',
  'docs/MAXDOCK_BRIDGE.md',
  'docs/STATUS.md',
  'assets/logo-knockout.png',
  'assets/logo-color.png',
  'scripts/verify-maxdock.mjs',
];
for (const path of requiredContracts) {
  if (!existsSync(join(ROOT, path))) {
    error('repository.required', path, 'Required bridge or contract file is missing.');
  }
}

const forbiddenLegacy = [
  ['src', 'React/Vite source directory'],
  ['package.json', 'npm package manifest'],
  ['package-lock.json', 'npm lockfile'],
  ['vite.config.ts', 'Vite configuration'],
  ['vite.config.js', 'Vite configuration'],
  ['tsconfig.json', 'TypeScript configuration'],
  ['tsconfig.app.json', 'TypeScript configuration'],
  ['tsconfig.node.json', 'TypeScript configuration'],
  ['eslint.config.js', 'React-era lint configuration'],
];
for (const [path, description] of forbiddenLegacy) {
  if (!existsSync(join(ROOT, path))) continue;
  if (strict) {
    error('architecture.no-build', path, `${description} remains after Stage 1 started.`, 'Remove the legacy build foundation instead of layering the static application over it.');
  } else {
    warn('transition.legacy-shell', path, `${description} is still present during Stage 0.`, 'This is allowed only until Stage 1 replaces the temporary React/Vite shell.');
  }
}

for (const path of applicationFiles) {
  const r = rel(path);
  const ext = extname(path).toLowerCase();
  if (['.ts', '.tsx', '.jsx'].includes(ext)) {
    if (strict) error('architecture.no-typescript', r, `${ext} application file is not allowed in the static architecture.`);
    else warn('transition.legacy-shell', r, `${ext} file remains during Stage 0.`);
  }
  if (/\b(import|require\s*\().*\b(react|react-dom|vite)\b/i.test(read(path)) && ['.js', '.mjs', '.ts', '.tsx', '.jsx'].includes(ext)) {
    if (strict) error('architecture.no-framework', r, 'React or Vite usage is not allowed.');
    else warn('transition.legacy-shell', r, 'React or Vite usage remains during Stage 0.');
  }
  if (/(^|\/)(?:override|overrides|patch|fix|hotfix|temp|temporary)[-_].*\.(?:css|js)$/i.test(r)) {
    error('assets.no-patch-files', r, 'Patch-style asset filename is not allowed.', 'Edit the canonical module or token instead.');
  }
}

if (strict) {
  const stageOneRequired = [
    'index.html',
    'app/board.html',
    'assets/maxdock.css',
    'js/db.js',
    'js/session.js',
    'js/router.js',
    'js/format.js',
    'js/poll.js',
  ];
  for (const path of stageOneRequired) {
    if (!existsSync(join(ROOT, path))) {
      error('stage1.required', path, 'Stage 1 static shell file is missing.');
    }
  }
}

const htmlFiles = applicationFiles.filter(path => extname(path).toLowerCase() === '.html');
for (const path of htmlFiles) {
  const text = read(path);
  const r = rel(path);
  if (/<style\b/i.test(text)) error('html.no-inline-style-block', r, 'Inline <style> block found.', 'All application CSS belongs in assets/maxdock.css.');
  if (/\sstyle\s*=\s*["']/i.test(text)) error('html.no-style-attributes', r, 'Inline style attribute found.', 'Use the one canonical stylesheet and semantic classes.');

  const ids = [...text.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  for (const id of duplicates) error('html.unique-ids', r, `Duplicate HTML id “${id}”.`);

  const externalStyles = [...text.matchAll(/<link[^>]+href=["'](https?:\/\/[^"']+)["']/gi)].map(match => match[1]);
  for (const url of externalStyles) {
    if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//i.test(url)) {
      error('html.external-styles', r, `External stylesheet is not approved: ${url}`);
    }
  }
  const externalScripts = [...text.matchAll(/<script[^>]+src=["'](https?:\/\/[^"']+)["']/gi)].map(match => match[1]);
  for (const url of externalScripts) {
    if (!/^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\/.*supabase/i.test(url)) {
      error('html.external-scripts', r, `External runtime script is not approved: ${url}`);
    }
  }

  const controls = [...text.matchAll(/<(input|select|textarea|button)\b([^>]*)>/gi)];
  for (const control of controls) {
    const tag = control[1].toLowerCase();
    const attrs = control[2];
    if (tag === 'input' && /type\s*=\s*["']hidden["']/i.test(attrs)) continue;
    if (/aria-label\s*=|aria-labelledby\s*=|id\s*=/i.test(attrs)) continue;
    warn('accessibility.control-name', r, `<${tag}> may not have an accessible name.`, 'Use a label, aria-label or aria-labelledby.');
  }
}

const textFiles = applicationFiles.filter(path => ['.js', '.mjs', '.html', '.css', '.json', '.env'].includes(extname(path).toLowerCase()) || basename(path).startsWith('.env'));
for (const path of textFiles) {
  const text = read(path);
  const r = rel(path);
  if (/SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]|sb_secret_/i.test(text)) {
    error('security.no-admin-secrets', r, 'Administrative Supabase credential pattern found in client repository.');
  }
}

const dbPath = join(ROOT, 'js', 'db.js');
if (existsSync(dbPath)) {
  const count = (read(dbPath).match(/createClient\s*\(/g) || []).length;
  if (count !== 1) error('js.single-client', 'js/db.js', `Expected exactly one createClient() call; found ${count}.`);
}

const errors = findings.filter(item => item.level === 'ERROR');
const warnings = findings.filter(item => item.level === 'WARN');
const report = { ok: errors.length === 0, stage, strict, counts: { errors: errors.length, warnings: warnings.length }, findings };

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('\nMaxDock implementation architecture gate');
  console.log('─'.repeat(58));
  console.log(`  Stage ${stage} · ${strict ? 'strict static mode' : 'contract-transition mode'}`);
  for (const item of findings) {
    console.log(`  ${item.level === 'ERROR' ? '✗' : '!'} ${item.rule} · ${item.file} · ${item.message}`);
    if (item.hint) console.log(`    ${item.hint}`);
  }
  console.log('─'.repeat(58));
  console.log(errors.length ? `  ${errors.length} error(s), ${warnings.length} warning(s)` : `  Conformant. ${warnings.length} warning(s).`);
  console.log();
}

process.exit(errors.length ? 1 : 0);
