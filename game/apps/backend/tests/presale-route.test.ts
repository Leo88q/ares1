/**
 * Маршрут верификации платежа пресейла — склейка, а не только чистые функции.
 *
 * Регресс, который эти тесты фиксируют: покупателю при резерве обещано
 * `payUnits = база + order_no` (пыль = номер заказа), а маршрут сравнивал платёж
 * с `order.price_units` (база без пыли). Итог — КАЖДЫЙ корректный платёж получал
 * AMOUNT_OVERPAID и уходил в ручной разбор. Чистые тесты `verify.ts` этого не
 * видели, потому что подавали «правильную» сумму напрямую.
 *
 * Поэтому здесь проверяется именно HTTP-путь: поддельный пул отдаёт реальную
 * строку заказа из БД, поддельное чтение цепи — снимок транзакции, а тест
 * смотрит на вердикт и на факт подтверждения в БД.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { presaleRouter } from '../src/routes/presale.js';
import type { PresaleChainViews, PresaleDeps } from '../src/routes/presale.js';
import type { GameOpsConfig } from '../src/gameops/env.js';
import type { Pool } from '../src/gameops/pool.js';
import type { ChainTransferView } from '../src/presale/verify.js';
import {
  buildPaymentExpectation,
  PRESALE_PAYMENT_MAX_AGE_SECONDS,
  PaymentExpectationError,
} from '../src/presale/paymentExpectation.js';

const token = 'token-'.padEnd(40, 'x');
const PAYER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const TREASURY = 'DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf';
const SIGNATURE = '5'.repeat(88);
const NOW = 1_700_000_000;

const config: GameOpsConfig = {
  databaseUrl: 'postgres://localhost/unused',
  role: 'game_ops_writer',
  poolMax: 1,
  statementTimeoutMs: 1_000,
  adminToken: token,
  reconciliationMaxAgeMinutes: 20,
  chainId: 'reward',
  expectedSchemaVersion: 15,
};

/** База цены тиража (без пыли). Покупатель платит base + order_no. */
const BASE_PRICE = 500_000_000n;

const ORDER = {
  id: '42',
  // Заказ создан 20 минут назад: платёж после этого времени — оплата этого заказа.
  created_at: new Date((NOW - 1200) * 1000).toISOString(),
  run_id: 'wave1',
  order_no: 7,
  pack_id: 'meadow-4',
  price_units: BASE_PRICE.toString(),
  payer_wallet: PAYER,
  state: 'payment_seen',
  tx_signature: SIGNATURE,
  received_units: null,
};

const RUN = {
  run_id: 'wave1',
  currency: 'sol' as const,
  treasury: TREASURY,
  price_units: BASE_PRICE.toString(),
  started_slot: '100',
};

function fakePresalePool() {
  const statements: string[] = [];
  let confirmed = false;
  const client = {
    query: async (text: string) => {
      statements.push(text);
      if (text.includes("SET state = 'paid'")) {
        confirmed = true;
        return { rows: [{ ...ORDER, state: 'paid' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      statements.push(text);
      if (text.includes('FROM game_ops.presale_orders WHERE id = $1')) {
        return { rows: params?.[0] === ORDER.id ? [ORDER] : [] };
      }
      if (text.includes('FROM game_ops.presale_runs WHERE run_id = $1')) {
        return { rows: params?.[0] === RUN.run_id ? [RUN] : [] };
      }
      return { rows: [] };
    },
    connect: async () => client,
    on: () => pool,
    end: async () => undefined,
  };
  return { pool: pool as unknown as Pool, statements, wasConfirmed: () => confirmed };
}

/** Снимок финализированной транзакции: покупатель заплатил ровно `received`. */
function paymentView(received: bigint, blockTime = BigInt(NOW)): ChainTransferView {
  return {
    signature: SIGNATURE,
    slot: 100n,
    blockTime,
    err: null,
    accountKeys: [PAYER, TREASURY],
    preBalances: [10_000_000_000n, 0n],
    postBalances: [10_000_000_000n - received - 5_000n, received],
    confirmation: 'finalized',
  };
}

function deps(viewResult: ChainTransferView | null): PresaleDeps {
  const views: PresaleChainViews = {
    // Заглушка вместо RPC: любой каст к типу Connection не должен понадобиться —
    // маршрут не трогает соединение, если чтения инжектированы.
    fetchPaymentView: async () => viewResult,
    fetchTokenPaymentView: async () => null,
  };
  return {
    connection: {} as unknown as PresaleDeps['connection'],
    cluster: 'devnet',
    paymentsEnabled: true,
    potatoMint: TREASURY,
    views,
    now: () => NOW,
  };
}

async function withServer(pool: Pool, injected: PresaleDeps, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/presale', presaleRouter(pool, config, injected));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function verify(baseUrl: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/presale/admin/orders/${ORDER.id}/verify`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

// ── Чистая арифметика ожидания ───────────────────────────────────────────────
test('ожидание = база тиража + номер заказа (то же, что обещано при резерве)', () => {
  const expectation = buildPaymentExpectation({ order: ORDER, run: RUN, nowSeconds: NOW });
  assert.equal(expectation.expected, BASE_PRICE + 7n);
  assert.equal(expectation.expected, 500_000_007n);
  assert.equal(expectation.base, BASE_PRICE);
});

test('порог возраста привязан к времени заказа, а не к моменту проверки', () => {
  const expectation = buildPaymentExpectation({ order: ORDER, run: RUN, nowSeconds: NOW });
  assert.equal(expectation.minBlockTimeSource, 'order_created_at');
  assert.equal(expectation.minBlockTime, BigInt(NOW - 1200 - 300));
  // Проверка, запущенная позже, не превращает корректный платёж в TOO_OLD.
  const later = buildPaymentExpectation({ order: ORDER, run: RUN, nowSeconds: NOW + 86_400 });
  assert.equal(later.minBlockTime, expectation.minBlockTime);
});

test('без created_at действует запасной порог (окно в час)', () => {
  const expectation = buildPaymentExpectation({
    order: { price_units: ORDER.price_units, order_no: ORDER.order_no }, run: RUN, nowSeconds: NOW,
  });
  assert.equal(expectation.minBlockTimeSource, 'max_age');
  assert.equal(expectation.minBlockTime, BigInt(NOW - PRESALE_PAYMENT_MAX_AGE_SECONDS));
});

test('база заказа, разошедшаяся с базой тиража, — отказ, а не тихое округление', () => {
  assert.throws(
    () => buildPaymentExpectation({
      order: { ...ORDER, price_units: '400000000' }, run: RUN, nowSeconds: NOW,
    }),
    (error: unknown) => error instanceof PaymentExpectationError && error.code === 'ORDER_RUN_PRICE_MISMATCH',
  );
});

// ── HTTP-путь ────────────────────────────────────────────────────────────────
test('корректный платёж (база + пыль) засчитывается: вердикт OK и переход в paid', async () => {
  const { pool, wasConfirmed } = fakePresalePool();
  await withServer(pool, deps(paymentView(500_000_007n)), async baseUrl => {
    const { status, body } = await verify(baseUrl);
    assert.equal(status, 200);
    assert.equal(body.expected, '500000007');
    const verdict = body.verdict as { code: string; ok: boolean; needsManualReview: boolean; receivedUnits: bigint };
    assert.equal(verdict.code, 'OK');
    assert.equal(verdict.ok, true);
    assert.equal(verdict.needsManualReview, false);
  });
  assert.equal(wasConfirmed(), true, 'успешная верификация обязана зафиксировать оплату');
});

test('оплата базы без пыли не засчитывается как этот заказ', async () => {
  const { pool, wasConfirmed } = fakePresalePool();
  await withServer(pool, deps(paymentView(BASE_PRICE)), async baseUrl => {
    const { status, body } = await verify(baseUrl);
    assert.equal(status, 200);
    const verdict = body.verdict as { code: string; ok: boolean; needsManualReview: boolean };
    assert.equal(verdict.code, 'AMOUNT_SHORT');
    assert.equal(verdict.ok, false);
    assert.equal(verdict.needsManualReview, true);
  });
  assert.equal(wasConfirmed(), false);
});

test('переплата (чужая пыль) остаётся ручным разбором, а не зачётом', async () => {
  const { pool, wasConfirmed } = fakePresalePool();
  await withServer(pool, deps(paymentView(500_000_017n)), async baseUrl => {
    const { body } = await verify(baseUrl);
    const verdict = body.verdict as { code: string; needsManualReview: boolean };
    assert.equal(verdict.code, 'AMOUNT_OVERPAID');
    assert.equal(verdict.needsManualReview, true);
  });
  assert.equal(wasConfirmed(), false);
});

test('старая транзакция не принимается: порог возраста больше не мёртвый код', async () => {
  const { pool, wasConfirmed } = fakePresalePool();
  // Платёж сделан за час ДО создания заказа: это не оплата этого заказа.
  const ancient = BigInt(NOW - 1200 - 3600);
  await withServer(pool, deps(paymentView(500_000_007n, ancient)), async baseUrl => {
    const { body } = await verify(baseUrl);
    const verdict = body.verdict as { code: string; ok: boolean; needsManualReview: boolean };
    assert.equal(verdict.code, 'TOO_OLD');
    assert.equal(verdict.ok, false);
    assert.equal(verdict.needsManualReview, true);
  });
  assert.equal(wasConfirmed(), false);
});

test('транзакция без blockTime не засчитывается: возраст проверить нельзя', async () => {
  const { pool } = fakePresalePool();
  const view = paymentView(500_000_007n);
  await withServer(pool, deps({ ...view, blockTime: null }), async baseUrl => {
    const { body } = await verify(baseUrl);
    assert.equal((body.verdict as { code: string }).code, 'TOO_OLD');
  });
});

test('заказ без подписи платежа — 400 до обращения к цепи', async () => {
  const { pool } = fakePresalePool();
  const unsigned = deps(paymentView(500_000_007n));
  const original = ORDER.tx_signature;
  ORDER.tx_signature = null as unknown as string;
  try {
    await withServer(pool, unsigned, async baseUrl => {
      const { status, body } = await verify(baseUrl);
      assert.equal(status, 400);
      assert.equal(body.error, 'VALIDATION');
    });
  } finally {
    ORDER.tx_signature = original;
  }
});

// ── Лимит бесплатных броней на кошелёк ───────────────────────────────────────
function fakeReservePool(recentCount: number) {
  const statements: string[] = [];
  let insertCount = 0;
  const run = {
    run_id: 'wave1', pack_id: 'meadow-4', currency: 'sol',
    price_units: BASE_PRICE.toString(), cap: 500, reserved_count: 0,
    treasury: TREASURY, is_open: true, reserve_minutes: 30, started_slot: '100',
  };
  const client = {
    query: async (text: string) => {
      statements.push(text);
      if (text.includes('FOR UPDATE')) return { rows: [run], rowCount: 1 };
      if (text.includes('count(*)::int')) return { rows: [{ n: recentCount }], rowCount: 1 };
      if (text.includes('max(order_no)')) return { rows: [{ next_no: recentCount + 1 }], rowCount: 1 };
      if (text.includes('INSERT INTO game_ops.presale_orders')) {
        insertCount += 1;
        return {
          rows: [{
            id: '1', run_id: 'wave1', order_no: recentCount + 1, pack_id: 'meadow-4',
            price_units: run.price_units, payer_wallet: PAYER, state: 'reserved',
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  const pool = {
    query: async () => ({ rows: [] }),
    connect: async () => client,
    on: () => pool,
    end: async () => undefined,
  };
  return {
    pool: pool as unknown as Pool,
    statements,
    inserts: () => insertCount,
  };
}

async function reserve(baseUrl: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/presale/runs/wave1/reserve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: PAYER }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test('резерв обещает ровно базу + номер заказа (то, что потом проверяет verify)', async () => {
  const { pool } = fakeReservePool(4);
  await withServer(pool, deps(paymentView(500_000_007n)), async baseUrl => {
    const { status, body } = await reserve(baseUrl);
    assert.equal(status, 201);
    // orderNo = MAX(order_no)+1 = 5, значит платить 500000005.
    assert.equal(body.orderNo, 5);
    assert.equal(body.payUnits, '500000005');
  });
});

test('лимит броней: после пяти за час шестая — 429 и без вставки строки', async () => {
  const { pool, inserts, statements } = fakeReservePool(5);
  await withServer(pool, deps(paymentView(500_000_007n)), async baseUrl => {
    const { status, body } = await reserve(baseUrl);
    assert.equal(status, 429);
    assert.equal(body.error, 'RESERVE_LIMIT');
  });
  assert.equal(inserts(), 0, 'заказ не должен создаваться при достигнутом лимите');
  assert.equal(
    statements.some(text => text.includes('INSERT INTO game_ops.presale_orders')),
    false,
  );
});
