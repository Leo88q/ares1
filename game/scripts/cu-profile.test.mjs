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
  const harvest = payload.instructions.find((r) => r.i === 'Harvest');
  assert.deepEqual([harvest.n, harvest.min, harvest.max], [2, 39876, 41234]);
  const fill = payload.instructions.find((r) => r.i === 'FillOrder');
  assert.equal(fill.med, 121000);
  assert.equal(payload.top[0].i, 'FillOrder', 'топ сортируется по медиане CU');
});

test('длинный профиль разбивается на аннотации и склеивается без потерь', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cu-profile-'));
  const log = path.join(dir, 'big.log');
  const lines = [];
  for (let i = 0; i < 60; i += 1) {
    lines.push(`Program log: Instruction: Ix${String(i).padStart(2, '0')}`);
    lines.push(`Program ${PROGRAM} consumed ${1000 + i} of 200000 compute units`);
  }
  writeFileSync(log, lines.join('\n'));
  const out = run(['--log', log, '--program-id', PROGRAM, '--annotate']);
  const parts = out
    .split('\n')
    .filter((line) => line.startsWith('::notice title=ares-cu'))
    .map((line) => JSON.parse(line.slice(line.indexOf('::', 2) + 2)));
  assert.ok(parts.length > 1, 'профиль обязан разбиться: аннотация GitHub обрезается на ~4 КБ');
  const merged = parts.flatMap((p) => p.instructions);
  assert.equal(merged.length, parts[0].itemsTotal);
  assert.equal(new Set(merged.map((r) => r.i)).size, 60);
  for (const line of out.split('\n').filter((l) => l.startsWith('::notice'))) {
    assert.ok(line.length < 4000, `аннотация длиннее лимита: ${line.length}`);
  }
});

test('без строк «consumed» профиль честно не измерен', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cu-profile-'));
  const log = path.join(dir, 'empty.log');
  writeFileSync(log, '[INFO] Program log: Instruction: Harvest\n');
  const payload = JSON.parse(run(['--log', log, '--program-id', PROGRAM, '--json']));
  assert.equal(payload.measured, false);
  assert.match(payload.reason, /consumed/);
});
