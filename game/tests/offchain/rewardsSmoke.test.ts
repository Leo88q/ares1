/**
 * Гейт сквозного смоука рельсы наград (`yarn rewards:smoke`).
 *
 * Смоук нельзя прогнать в CI без devnet-бэкенда и живого `reward_signer`, но его
 * контракт можно закрепить текстом: скрипт обязан проверять все четыре стыка
 * (приглашение → HTTP → грант → сверка), не подписывать транзакции сам и не
 * печатать секреты. Иначе «смоук есть» превращается в файл, который однажды
 * перестанет проверять то, ради чего написан.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url); // game/
const script = readFileSync(new URL('scripts/rewards-smoke.ts', root), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { scripts: Record<string, string> };
const operations = readFileSync(new URL('docs/OPERATIONS.md', root), 'utf8');

test('смоук зарегистрирован командой и описан в runbook', () => {
  assert.equal(pkg.scripts['rewards:smoke'], 'tsx scripts/rewards-smoke.ts');
  assert.match(operations, /yarn rewards:smoke/);
  assert.match(operations, /REWARDS_RAIL_APPROVED=YES/);
});

test('смоук проходит весь путь: status → invite → starter → сверка', () => {
  assert.match(script, /\/api\/rewards\/status/);
  assert.match(script, /issueInvite\(/);
  assert.match(script, /\/api\/rewards\/starter/);
  assert.match(script, /grant PDA is absent/);
  assert.match(script, /ata did not receive the grant/);
  // Сверка обязана смотреть на цепь, а не на ответ HTTP: 200 не значит «токены пришли».
  assert.match(script, /getAccount\(connection, ata\)/);
  assert.match(script, /getAccountInfo\(claim/);
});

test('смоук не подписывает транзакции: ключ reward_signer остаётся у бэкенда', () => {
  for (const forbidden of ['sendTransaction', 'VersionedTransaction', 'Keypair.fromSecretKey', 'signTransaction']) {
    assert.equal(script.includes(forbidden), false, `smoke must not sign: ${forbidden}`);
  }
});

test('секреты не попадают в вывод, а mainnet требует явного разрешения', () => {
  assert.match(script, /REWARDS_SMOKE_ALLOW_MAINNET/);
  assert.match(script, /safeError\(/);
  // Код приглашения печатается частично: целиком он одноразовый и привязан к кошельку.
  assert.match(script, /invite\.split\('\.'\)\[0\]/);
  assert.doesNotMatch(script, /console\.log\([^)]*secret/i);
});
