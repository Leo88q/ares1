// Тестовые векторы V1–V5 и инварианты §5.6 для deploy-budget.mjs.
// Комиссии = 0, rent(n) = (128 + n) × rate — проверяется чистая арифметика
// модели, а не RPC. Запуск: node --test scripts/deploy-budget.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONSTANTS,
  budget,
  ceilDiv,
  checkReserveFloor,
  computeFees,
  deriveRate,
  planNew,
  planUpgrade,
  solToLamports,
} from './deploy-budget.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rentFn = (rate) => (n) => (CONSTANTS.RENT_OVERHEAD + n) * BigInt(rate);
const NO_FEES = 0n;

// ── V1: первый деплой, so_len = max_len = 450 000 ───────────────────────────
test('V1: первый деплой, так же как эталон §5.6', () => {
  const cases = [
    { rate: 6960, lock: 3134345520n, rent0: 890880n, need: 3135236400n },
    { rate: 5080, lock: 2287711960n, rent0: 650240n, need: 2288362200n },
    { rate: 2575, lock: 1159617775n, rent0: 329600n, need: 1159947375n },
    { rate: 696, lock: 313434552n, rent0: 89088n, need: 313523640n },
  ];
  for (const { rate, lock, rent0, need } of cases) {
    const rent = rentFn(rate);
    assert.deepEqual(rent(0n), rent0, `rent(0) при ставке ${rate}`);
    const step = planNew({ soLen: 450000n, rent, fees: NO_FEES });
    assert.equal(step.lock, lock, `LOCK при ставке ${rate}`);
    assert.equal(step.net, lock, `NET = LOCK при ставке ${rate}`);
    assert.equal(step.peak, lock, `PEAK = LOCK при ставке ${rate}`);
    const plan = budget({ step, rent, fees: NO_FEES });
    assert.equal(plan.needBeforeReserve, need, `NEED_BEFORE_RESERVE при ставке ${rate}`);
    assert.equal(plan.needBeforeReserve, plan.peak + rent(0n));
  }
});

// ── V2: апгрейд без роста, ставка упала 6960 → 5080 ─────────────────────────
test('V2: апгрейд без роста возвращает излишек залога', () => {
  const rent = rentFn(5080);
  const step = planUpgrade({
    soLen: 450000n,
    rent,
    fees: NO_FEES,
    curCap: 450000n,
    curProgramDataLamports: 3133204080n,
    simd0433Active: false,
  });
  assert.equal(step.net, -846325240n);
  assert.equal(step.ext, 0n);
  assert.equal(step.peak, 2286878840n);
  const plan = budget({ step, rent, fees: NO_FEES });
  assert.equal(plan.needBeforeReserve, 2287529080n);
});

// ── V3: апгрейд с ростом больше MIN_EXTEND ──────────────────────────────────
test('V3: апгрейд с ростом 450 000 → 480 000 (extend по SIMD-0431)', () => {
  const rent = rentFn(5080);
  const step = planUpgrade({
    soLen: 480000n,
    rent,
    fees: NO_FEES,
    curCap: 450000n,
    curProgramDataLamports: 2286878840n,
    simd0433Active: false,
  });
  assert.equal(step.cap, 480000n);
  assert.equal(step.net, 152400000n);
  assert.equal(step.ext, 152400000n);
  assert.equal(step.peak, 2591678840n);
  const plan = budget({ step, rent, fees: NO_FEES });
  assert.equal(plan.needBeforeReserve, 2592329080n);
});

// ── V4: усадка при активном SIMD-0433 ───────────────────────────────────────
test('V4: усадка 450 000 → 400 000 при SIMD-0433', () => {
  const rent = rentFn(5080);
  const step = planUpgrade({
    soLen: 400000n,
    rent,
    fees: NO_FEES,
    curCap: 450000n,
    curProgramDataLamports: 2286878840n,
    simd0433Active: true,
  });
  assert.equal(step.cap, 400000n);
  assert.equal(step.net, -254000000n);
  assert.equal(step.ext, 0n);
  assert.equal(step.peak, 2032878840n);
  const plan = budget({ step, rent, fees: NO_FEES });
  assert.equal(plan.needBeforeReserve, 2033529080n);
});

// ── V5: малый рост — extend кратен минимуму 10 КиБ ──────────────────────────
test('V5: рост 450 000 → 455 000 даёт cap = 460 240 (MIN_EXTEND)', () => {
  const rent = rentFn(5080);
  const step = planUpgrade({
    soLen: 455000n,
    rent,
    fees: NO_FEES,
    curCap: 450000n,
    curProgramDataLamports: 2286878840n,
    simd0433Active: false,
  });
  assert.equal(step.cap, 460240n);
  assert.equal(step.net, 52019200n);
  assert.equal(step.ext, 52019200n);
  assert.equal(step.peak, 2364298040n);
  const plan = budget({ step, rent, fees: NO_FEES });
  assert.equal(plan.needBeforeReserve, 2364948280n);
});

// ── Инварианты §5.6 ─────────────────────────────────────────────────────────
test('инвариант (i): NEED не убывает при росте so_len', () => {
  const rent = rentFn(5080);
  let previous = 0n;
  for (const len of [100000n, 250000n, 450000n, 600000n, 971392n]) {
    const step = planNew({ soLen: len, rent, fees: NO_FEES });
    const plan = budget({ step, rent, fees: NO_FEES });
    assert.ok(plan.needBeforeReserve > previous, `рост при ${len}`);
    previous = plan.needBeforeReserve;
  }
});

test('инвариант (i): NEED не убывает при росте ставки', () => {
  for (const len of [250000n, 971392n]) {
    let previous = 0n;
    for (const rate of [696, 1322, 2575, 5080, 6333, 6960, 10000]) {
      const rent = rentFn(rate);
      const plan = budget({ step: planNew({ soLen: len, rent, fees: NO_FEES }), rent, fees: NO_FEES });
      assert.ok(plan.needBeforeReserve > previous, `рост при ставке ${rate}/${len}`);
      previous = plan.needBeforeReserve;
    }
  }
});

test('инвариант (ii): rate из rent(0) совпадает с rent(1) − rent(0)', () => {
  const rent5080 = rentFn(5080);
  assert.equal(deriveRate(rent5080(0n), rent5080(1n)), 5080n);
  assert.equal(deriveRate(650240n, 655320n), 5080n);
  assert.throws(() => deriveRate(650241n, 655321n), /не делится/);
  assert.throws(() => deriveRate(650240n, 999999n), /нелинейна/);
});

test('инвариант (iii): для первого деплоя PEAK = NET', () => {
  const rent = rentFn(5080);
  const step = planNew({ soLen: 971392n, rent, fees: computeFees(971392n) });
  assert.equal(step.peak, step.net);
});

test('инвариант (iv): для апгрейда PEAK ≥ rent(45 + so_len)', () => {
  const rent = rentFn(5080);
  for (const [soLen, curCap] of [[400000n, 450000n], [450000n, 450000n], [480000n, 450000n], [460000n, 450000n]]) {
    const step = planUpgrade({ soLen, rent, fees: 12345n, curCap, curProgramDataLamports: 2286878840n });
    assert.ok(step.peak >= rent(CONSTANTS.PROGRAMDATA_META + soLen), `PEAK при ${soLen}/${curCap}`);
  }
});

test('инвариант (v): без роста и без SIMD-0433 EXT = 0', () => {
  const rent = rentFn(5080);
  const step = planUpgrade({ soLen: 400000n, rent, fees: 0n, curCap: 450000n, curProgramDataLamports: 2286878840n });
  assert.equal(step.ext, 0n);
});

// ── R3: никакого хардкода ставки и размеров в расчёте ───────────────────────
test('R3: deploy-budget.mjs не содержит литералов ставки rent', () => {
  const source = readFileSync(path.join(here, 'deploy-budget.mjs'), 'utf8');
  for (const literal of ['6960', '5080', '3480', '6333', '2575']) {
    assert.ok(!source.includes(literal), `в deploy-budget.mjs найден литерал ${literal} (R3)`);
  }
});

// ── Гигиена денег и пола резерва ────────────────────────────────────────────
test('R4: десятичные строки SOL разбираются без float', () => {
  assert.equal(solToLamports('0.30'), 300000000n);
  assert.equal(solToLamports('0,25'), 250000000n);
  assert.equal(solToLamports('4'), 4000000000n);
  assert.equal(solToLamports('0.000000001'), 1n);
  assert.throws(() => solToLamports('0.1234567891'), /9 знаков/);
  assert.throws(() => solToLamports('1e9'), /десятичная строка/);
});

test('пол резерва: ≥ 0.25 SOL и ≥ 2 × SETUP_ONCHAIN', () => {
  assert.equal(checkReserveFloor(300000000n, 0n), 250000000n);
  assert.equal(checkReserveFloor(300000000n, 10652760n), 250000000n);
  assert.equal(checkReserveFloor(400000000n, 200000000n), 400000000n);
  assert.throws(() => checkReserveFloor(200000000n, 0n), /ниже пола/);
  assert.throws(() => checkReserveFloor(300000000n, 200000000n), /ниже пола/);
});

test('ceilDiv: только целые лампорты', () => {
  assert.equal(ceilDiv(10n, 3n), 4n);
  assert.equal(ceilDiv(0n, 800n), 0n);
  assert.throws(() => ceilDiv(10, 3), TypeError);
  assert.throws(() => ceilDiv(10n, 0n), RangeError);
});

// ── V6: онлайн-режим (ставка и залог из RPC) ────────────────────────────────
// Регрессия: planning-функции синхронные, поэтому rent обязан быть предзагружен;
// иначе «Promise × BigInt» падал в рантайме, а шаг арес-setup в CI — вместе с ним.
test('V6: онлайн-расчёт через RPC повторяет модель §5.1 и §5.2', () => {
  const RATE = 5080; // ставка живёт только в заглушке RPC (R3: в расчёте её нет)
  const pda = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
  const program36 = Buffer.concat([Buffer.from([2, 0, 0, 0]), pda]);
  const programData45 = Buffer.concat([
    Buffer.from([3, 0, 0, 0]),
    Buffer.alloc(8),
    Buffer.from([1]),
    Buffer.alloc(32, 7),
  ]);
  const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const { method, params } = JSON.parse(raw);
      const ok = (result) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      };
      if (method === 'getMinimumBalanceForRentExemption') return ok((128 + params[0]) * RATE);
      if (method === 'getGenesisHash') return ok('stub-genesis');
      if (method === 'getSlot') return ok(1);
      if (method === 'getBalance') return ok(10000000000);
      if (method === 'getProgramAccounts') return ok([]);
      if (method === 'getAccountInfo') {
        const length = params[1]?.dataSlice?.length;
        if (length === 36) {
          return ok({ context: { slot: 1 }, value: { lamports: 1, data: [program36.toString('base64'), 'base64'], owner: LOADER, executable: true, space: 36 } });
        }
        if (length === 45) {
          return ok({ context: { slot: 1 }, value: { lamports: 3633119480, data: [programData45.toString('base64'), 'base64'], owner: LOADER, executable: false, space: 715053 } });
        }
        return ok({ context: { slot: 1 }, value: null });
      }
      return ok(null);
    });
  });
  server.listen(0, '127.0.0.1');
  // spawnSync заблокировал бы event loop — заглушка RPC не смогла бы ответить.
  return new Promise((resolve, reject) => {
    server.on('listening', async () => {
      try {
        const url = `http://127.0.0.1:${server.address().port}`;
        const run = await promisify(execFile)(process.execPath, [
          path.join(here, 'deploy-budget.mjs'), '--so-len', '971392', '--rpc', url,
          '--mode', 'upgrade', '--cur-cap', '715008', '--programdata-lamports', '3633119480', '--json',
        ]);
        const out = JSON.parse(run.stdout);
        assert.equal(out.offline, false);
        assert.equal(out.mode, 'upgrade');
        assert.equal(out.rate, '5080');
        assert.equal(out.ext, '1302430720'); // rent(45 + 971392) − 3 633 119 480
        assert.equal(out.fees, '8043200');
        assert.equal(out.peak, '6246024120');
        assert.equal(out.upgradeNet, '1310473920');
        assert.equal(out.minRemaining, '650240');
        assert.equal(out.setupOnchain, '7665720'); // без SKR-минта: 7 665 720
        assert.equal(out.needBeforeReserve, '6254340080');
        assert.equal(out.needTotal, '6554340080'); // + RESERVE 0.30 SOL
        assert.equal(out.balance, '10000000000');
        assert.equal(out.shortfall, '0'); // кода выхода 3 не будет
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
});
