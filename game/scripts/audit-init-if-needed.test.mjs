import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from './audit-init-if-needed.mjs';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
test('committed SW016 evidence matches current Rust source', () => {
  const report = JSON.parse(read('../../reports/ares1-audit.json'));
  assert.equal(report.files_scanned, 1);
  assert.deepEqual(report.findings, inspect(read('../programs/solana_potato/src/lib.rs')));
});

test('SW016 inventory catches newly introduced init_if_needed with exact location', () => {
  assert.deepEqual(inspect('#[account(init, payer = user)]'), []);
  const findings = inspect('pub struct Foo {}\n  #[account(init_if_needed, payer = user)]', 'test.rs');
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].location, { path: 'test.rs', line: 2, column: 13 });
  assert.equal(findings[0].rule_id, 'SW016-source-inventory');
});
