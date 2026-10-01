import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./instruction-coverage.mjs', import.meta.url));
const gameRoot = path.resolve(path.dirname(script), '..');

function report() {
  return JSON.parse(execFileSync(process.execPath, [script, '--json'], { cwd: gameRoot, encoding: 'utf8' }));
}

test('coverage ignores comments and counts builder-only mentions before calling an instruction unreferenced', () => {
  const result = report();
  const row = (name) => result.rows.find((item) => item.name === name);
  const migration = ['migrate', 'admin', 'state'].join('_');
  const buyFieldSol = ['buy', 'field', 'sol'].join('_');
  const legacyGrant = ['grant', 'reward'].join('_');
  const skrWithdraw = ['withdraw', 'skr', 'treasury'].join('_');

  // migrate_admin_state has a real discriminator in anchorClient.ts and its
  // ix-prefixed wrapper is imported/called from a test; both must be detected.
  assert.ok(row(migration).hits['web-builder'] > 0);
  assert.ok(row(migration).hits.tests > 0);
  assert.ok(!result.unreferenced.includes(migration));

  // The SOL-field builder is referenced from tests, but not the UI layer.
  assert.equal(row(buyFieldSol).hits['web-ui'], 0);
  assert.ok(row(buyFieldSol).hits['web-builder'] > 0);
  assert.ok(row(buyFieldSol).hits.tests > 0);

  // grant_reward occurs only in a comment in anchorClient.ts; backend/tests are
  // real references, but the comment must not create a web-builder reference.
  assert.equal(row(legacyGrant).hits['web-builder'], 0);
  assert.ok(row(legacyGrant).hits.backend > 0);

  // This instruction has no in-scope code reference (the test mentions it only
  // in a comment); keep it visible as a review candidate, not an auto-removal.
  assert.deepEqual(result.unreferenced, [skrWithdraw]);
});
