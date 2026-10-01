// Тест CU-профиля (Этап 2): парсер обязан считать CU только своей программы,
// привязывать их к последней инструкции Anchor и честно сообщать `measured:
// false`, когда строк нет. Фикстура — синтетический лог: реальный формат
// печатает runtime (`Program <id> consumed N of M compute units`), CPI в
// SPL Token добавляет свои строки — они не должны попадать в профиль.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/cu-profile.py');
const PROGRAM = 'DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const LOG = [
  `[INFO solana_runtime::message_processor] Program ${PROGRAM} invoke [1]`,
  '[INFO solana_runtime::message_processor] Program log: Instruction: Harvest',
  `[INFO solana_runtime::message_processor] Program ${TOKEN} invoke [2]`,
  `[INFO solana_runtime::message_processor] Program ${TOKEN} consumed 3000 of 190000 compute units`,
  `[INFO solana_runtime::message_processor] Program ${PROGRAM} consumed 41234 of 200000 compute units`,
  '[INFO solana_runtime::message_processor] Program log: Instruction: Harvest',
  `[INFO solana_runtime::message_processor] Program ${PROGRAM} consumed 39876 of 200000 compute units`,
  '[INFO solana_runtime::message_processor] Program log: Instruction: FillOrder',
  `[INFO solana_runtime::message_processor] Program ${PROGRAM} consumed 121000 of 200000 compute units`,
  '\u001b[0m[INFO solana_runtime::message_processor] Program log: Instruction: PayTax',
].join('\n');

function run(args) {
  return execFileSync('python3', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('CU считаются по инструкциям и по нашей программе (CPI отсекается)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cu-profile-'));
  const log = path.join(dir, 'anchor-test.log');
  writeFileSync(log, LOG);
  const payload = JSON.parse(run(['--log', log, '--program-id', PROGRAM, '--json']));
  assert.equal(payload.measured, true);
  assert.equal(payload.foreignConsumedLines, 1, 'CU SPL Token не должны попадать в профиль');
  const harvest = payload.instructions.find((r) => r.instruction === 'Harvest');
  assert.deepEqual([harvest.calls, harvest.cuMin, harvest.cuMax], [2, 39876, 41234]);
  const fill = payload.instructions.find((r) => r.instruction === 'FillOrder');
  assert.equal(fill.cuMedian, 121000);
  assert.equal(payload.top[0].instruction, 'FillOrder', 'топ сортируется по медиане CU');
});

test('без строк «consumed» профиль честно не измерен', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cu-profile-'));
  const log = path.join(dir, 'empty.log');
  writeFileSync(log, '[INFO] Program log: Instruction: Harvest\n');
  const payload = JSON.parse(run(['--log', log, '--program-id', PROGRAM, '--json']));
  assert.equal(payload.measured, false);
  assert.match(payload.reason, /consumed/);
});
