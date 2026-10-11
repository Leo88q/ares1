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

test('coverage ignores comments and recognizes the guarded treasury CLI builder', () => {
  const result = report();
  const row = (name) => result.rows.find((item) => item.name === name);
  const migration = ['migrate', 'admin', 'state'].join('_');
  const solFieldIx = ['buy', 'field', 'sol'].join('_');
  const legacyGrant = ['grant', 'reward'].join('_');
  const skrWithdraw = ['withdraw', 'skr', 'treasury'].join('_');

  // migrate_admin_state has a real discriminator in anchorClient.ts and its
  // ix-prefixed wrapper is imported/called from a test; both must be detected.
  assert.ok(row(migration).hits['web-builder'] > 0);
  assert.ok(row(migration).hits.tests > 0);
  assert.ok(!result.unreferenced.includes(migration));

  // The SOL-field builder is referenced from tests, but not the UI layer.
  assert.equal(row(solFieldIx).hits['web-ui'], 0);
  assert.ok(row(solFieldIx).hits['web-builder'] > 0);
  assert.ok(row(solFieldIx).hits.tests > 0);

  // grant_reward occurs only in a comment in anchorClient.ts; backend/tests are
  // real references, but the comment must not create a web-builder reference.
  assert.equal(row(legacyGrant).hits['web-builder'], 0);
  assert.ok(row(legacyGrant).hits.backend > 0);

  // SKR treasury withdrawal is deliberately absent from the player-facing web
  // flow. It does have an offline authority CLI builder and ABI tests, so it is
  // referenced by scripts/tests rather than appearing unreferenced.
  assert.equal(row(skrWithdraw).hits['web-ui'], 0);
  assert.equal(row(skrWithdraw).hits['web-builder'], 0);
  assert.ok(row(skrWithdraw).hits.scripts > 0);
  assert.ok(row(skrWithdraw).hits.tests > 0);
  assert.ok(!result.unreferenced.includes(skrWithdraw));
});
