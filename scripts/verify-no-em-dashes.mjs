#!/usr/bin/env node
// No em dashes in anything the site renders.
//
// The owner reads them as a tell that a machine wrote the sentence, and he is not wrong
// about where they come from: nobody typing into a shipping application reaches for an
// em dash. Every one of them has a better replacement that is also shorter — a comma
// where the clause continues, a colon where a list follows, a semicolon where two
// sentences are being held together, a full stop where they are not, and the middle dot
// this product already uses to join a label to a value.
//
// The lone dash meaning "no value" in a table cell is a different thing: a convention,
// not prose. Those are en dashes, which is one of the substitutions he offered.
//
// Comments are exempt. They are not the website, and the point of the rule is what a
// person reads on screen.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const walk = dir => readdirSync(join(ROOT, dir), { withFileTypes: true })
  .flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

const files = [...walk('js'), ...walk('app'), 'index.html'].filter(file => ['.js', '.html'].includes(extname(file)));

const findings = [];
for (const file of files) {
  if (!statSync(join(ROOT, file)).isFile()) continue;
  readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, index) => {
    if (!line.includes('—')) return;
    // A whole-line comment, in either style. Inline trailing comments are rare enough
    // that catching one is a fair price for not writing a JavaScript parser here.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    findings.push(`${file}:${index + 1}  ${line.trim().slice(0, 120)}`);
  });
}

if (findings.length) {
  console.error('Em dash check failed: the site renders em dashes');
  for (const finding of findings) console.error(`- ${finding}`);
  console.error('\nUse a comma, a colon, a semicolon, a full stop, a middle dot for label · value,');
  console.error('or an en dash for a "no value" placeholder.');
  process.exit(1);
}

console.log(`Em dash check passed: ${files.length} rendered files carry none`);
