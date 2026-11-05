import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

  // Холодный старт: buy_field_sol — единственный путь к первому полю без
  // POTATO, поэтому сборщик инструкции и вызов из контекста существуют.
  // Но путь ОБЯЗАН быть под флагом: без него кнопка «купить за SOL» вела бы в
  // транзакцию, которая падает на закрытом тираже.
  assert.ok(row(solFieldIx).hits['web-builder'] > 0);
  assert.ok(row(solFieldIx).hits['web-ui'] > 0);
  assert.ok(row(solFieldIx).hits.tests > 0);
  const builder = readFileSync(path.join(gameRoot, 'apps/web/src/utils/anchorClient.ts'), 'utf8');
  const context = readFileSync(path.join(gameRoot, 'apps/web/src/contexts/GameContext.tsx'), 'utf8');
  assert.match(builder, /PRESALE_SOL_CLIENT_ENABLED/);
  assert.match(context, /PRESALE_SOL_CLIENT_ENABLED/);
  // Флаг читается только из env и по умолчанию закрыт: `=== 'true'`, не истинность.
  assert.match(builder, /VITE_PRESALE_SOL_ENABLED[\s\S]{0,80}=== 'true'/);

  // P1-1: grant_reward удалён из программы и IDL — отчёт не должен его
  // содержать (иначе появилась бы «покрытая» инструкция, которой нет на цепи).
  assert.equal(row(legacyGrant), undefined);
  assert.ok(!result.rows.some((item) => item.name === legacyGrant));

  // SKR treasury withdrawal is deliberately absent from the player-facing web
  // flow. It does have an offline authority CLI builder and ABI tests, so it is
  // referenced by scripts/tests rather than appearing unreferenced.
  assert.equal(row(skrWithdraw).hits['web-ui'], 0);
  assert.equal(row(skrWithdraw).hits['web-builder'], 0);
  assert.ok(row(skrWithdraw).hits.scripts > 0);
  assert.ok(row(skrWithdraw).hits.tests > 0);
  assert.ok(!result.unreferenced.includes(skrWithdraw));
});
