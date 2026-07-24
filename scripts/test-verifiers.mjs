#!/usr/bin/env node
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const cases = [
  { name: 'good', expected: 0 },
  { name: 'bad', expected: 1 },
];
const checkers = ['verify-maxdock.mjs', 'verify-maxdock-implementation.mjs'];
let failed = false;

for (const testCase of cases) {
  const fixturePath = join(ROOT, 'scripts', 'tests', 'fixtures', `${testCase.name}.json`);
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const work = mkdtempSync(join(tmpdir(), `maxdock-${testCase.name}-`));
  try {
    for (const [path, content] of Object.entries(fixture)) {
      const destination = join(work, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content);
    }
    mkdirSync(join(work, 'scripts'), { recursive: true });
    for (const checker of checkers) {
      cpSync(resolve(ROOT, 'scripts', checker), join(work, 'scripts', checker));
      const result = spawnSync(process.execPath, [join(work, 'scripts', checker)], {
        cwd: work,
        encoding: 'utf8',
      });
      const actual = result.status === 0 ? 0 : 1;
      if (actual !== testCase.expected) {
        failed = true;
        console.error(`FAIL ${testCase.name} · ${checker} · expected ${testCase.expected}, received ${actual}`);
        console.error(result.stdout);
        console.error(result.stderr);
      } else {
        console.log(`PASS ${testCase.name} · ${checker}`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
