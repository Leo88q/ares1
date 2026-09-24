// F-15: landing had no tests. Lock the i18n dictionary set: every locale must
// carry exactly the same keys as the English baseline, no duplicates, and
// every static t("…") literal used by the app must exist in the baseline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stringsDir = join(root, 'i18n', 'strings');
const files = readdirSync(stringsDir).filter(f => f.endsWith('.ts')).sort();

function keysOf(file) {
  const src = readFileSync(join(stringsDir, file), 'utf8');
  const keys = [];
  const re = /^ {1,2}'((?:[^'\\]|\\.)*)':/gm;
  let m;
  while ((m = re.exec(src)) !== null) keys.push(m[1]);
  return keys;
}

test('locale files exist and share one key set', () => {
  assert.ok(files.length >= 6, `expected >=6 locale files, got ${files.length}`);
  const baseline = keysOf('en.ts');
  assert.ok(baseline.length >= 300, `suspiciously small en.ts: ${baseline.length} keys`);
  assert.equal(new Set(baseline).size, baseline.length, 'duplicate keys in en.ts');
  for (const f of files) {
    const keys = keysOf(f);
    assert.equal(new Set(keys).size, keys.length, `duplicate keys in ${f}`);
    const missing = baseline.filter(k => !keys.includes(k));
    const extra = keys.filter(k => !baseline.includes(k));
    assert.deepEqual({ f, missing, extra }, { f, missing: [], extra: [] },
      `${f} diverges from en.ts baseline`);
  }
});

test('static t() literals used by the app exist in en.ts', () => {
  const baseline = new Set(keysOf('en.ts'));
  const sources = ['App.tsx', 'content.ts'];
  const missing = [];
  for (const src of sources) {
    const code = readFileSync(join(root, src), 'utf8');
    const re = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      if (!baseline.has(m[1])) missing.push(`${src}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
