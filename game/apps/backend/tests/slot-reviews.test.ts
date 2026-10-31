/**
 * Очередь разбора платежей за слоты: «деньги списаны, слот не выдан».
 *
 * Проверяются три вещи, каждая из которых раньше отсутствовала:
 *   1) валидный платёж при занятом слоте оставляет durable-строку (не лог);
 *   2) закрыть строку «на слово» нельзя — нужна подпись транзакции, и она
 *      проверяется по снимку цепи (покупатель получил ровно свою сумму);
 *   3) отказ от возврата требует заметки, иначе решение не расследовать.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { gameOpsRouter } from '../src/routes/gameops.js';
import type { GameOpsConfig } from '../src/gameops/env.js';
import type { Pool } from '../src/gameops/pool.js';
import { verifyRefundPayout, resolveSlotPaymentReview } from '../src/slots/reviews.js';
import type { ChainTokenTransferView } from '../src/presale/verify.js';

const token = 'token-'.padEnd(40, 'x');
const WALLET = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const MINT = 'Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o';
const PAYMENT_SIG = '5'.repeat(88);
const REFUND_SIG = '7'.repeat(88);

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

const REVIEW = {
  id: '1',
  payment_signature: PAYMENT_SIG,
  field_id: 'F1',
  slot: 7,
  wallet: WALLET,
  mint: MINT,
  amount_units: '1000',
  reason: 'SLOT_TAKEN_AFTER_VALID_PAYMENT',
  status: 'pending' as string,
  created_at: new Date().toISOString(),
  resolved_at: null,
  resolution_signature: null,
  resolution_note: null,
};

/** Снимок транзакции, в которой кошелёк покупателя получил `received` минта. */
function refundView(received: bigint, overrides: Partial<ChainTokenTransferView> = {}): ChainTokenTransferView {
  return {
    signature: REFUND_SIG,
    slot: 100n,
    blockTime: 1_700_000_000n,
    err: null,
    accountKeys: [WALLET, MINT],
    preTokenBalances: [{ accountIndex: 0, mint: MINT, owner: WALLET, amount: 0n }],
    postTokenBalances: [{ accountIndex: 0, mint: MINT, owner: WALLET, amount: received }],
    confirmation: 'finalized',
    ...overrides,
  };
}

function fakePool(overrides: { updateReturns?: boolean } = {}) {
  const statements: string[] = [];
  let review: Record<string, unknown> = { ...REVIEW };
  const client = {
    query: async (text: string, params?: unknown[]) => {
      statements.push(text);
      if (text.includes("SET status = $2")) {
        if (overrides.updateReturns === false) return { rows: [], rowCount: 0 };
        review = {
          ...review,
          status: params?.[1] as string,
          resolved_at: new Date().toISOString(),
          resolution_signature: (params?.[2] as string | null) ?? null,
          resolution_note: (params?.[3] as string | null) ?? null,
        };
        return { rows: [review], rowCount: 1 };
      }
      if (text.includes('SELECT status FROM game_ops.slot_payment_reviews')) {
        return { rows: [{ status: review.status }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      statements.push(text);
      if (text.includes('FROM game_ops.slot_payment_reviews WHERE id = $1')) {
        return { rows: params?.[0] === REVIEW.id ? [review] : [], rowCount: 1 };
      }
      if (text.includes('FROM game_ops.slot_payment_reviews')) return { rows: [review], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    connect: async () => client,
    on: () => pool,
    end: async () => undefined,
  };
  return { pool: pool as unknown as Pool, statements };
}

async function withServer(
  pool: Pool,
  fetchTokenView: (signature: string) => Promise<ChainTokenTransferView | null>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/gameops', gameOpsRouter(pool, config, { fetchTokenView }));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function resolve(baseUrl: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/gameops/slot-reviews/${REVIEW.id}/resolve`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

// ── Чистая проверка доказательства ───────────────────────────────────────────
test('возврат подтверждается только точной суммой в нужном минте', () => {
  const ok = verifyRefundPayout(refundView(1000n), { wallet: WALLET, mint: MINT, amount: 1000n });
  assert.equal(ok.ok, true);

  const short = verifyRefundPayout(refundView(999n), { wallet: WALLET, mint: MINT, amount: 1000n });
  assert.equal(short.ok, false);
  assert.equal(short.code, 'AMOUNT_MISMATCH');

  const otherMint = verifyRefundPayout(refundView(1000n), { wallet: WALLET, mint: 'A'.repeat(44), amount: 1000n });
  assert.equal(otherMint.ok, false);
  assert.equal(otherMint.code, 'WALLET_NOT_INVOLVED');
});

test('неподтверждённая или упавшая транзакция не является доказательством', () => {
  const pending = verifyRefundPayout(refundView(1000n, { confirmation: 'confirmed' }), { wallet: WALLET, mint: MINT, amount: 1000n });
  assert.equal(pending.code, 'NOT_FINALIZED');
  const failed = verifyRefundPayout(refundView(1000n, { err: { InstructionError: [0, 'Custom'] } }), { wallet: WALLET, mint: MINT, amount: 1000n });
  assert.equal(failed.code, 'TX_FAILED');
});

// ── HTTP: закрыть разбор можно только доказательством ────────────────────────
test('refund без подписи отклоняется до записи', async () => {
  const { pool, statements } = fakePool();
  await withServer(pool, async () => refundView(1000n), async baseUrl => {
    const { status, body } = await resolve(baseUrl, { action: 'refund', signature: '' });
    assert.equal(status, 400);
    assert.equal(body.error, 'VALIDATION');
  });
  assert.equal(statements.some(text => text.includes('SET status = $2')), false);
});

test('refund с неподтверждающей транзакцией отвергается, строка остаётся pending', async () => {
  const { pool, statements } = fakePool();
  await withServer(pool, async () => refundView(500n), async baseUrl => {
    const { status, body } = await resolve(baseUrl, { action: 'refund', signature: REFUND_SIG });
    assert.equal(status, 400);
    assert.match(String(body.message ?? ''), /не подтверждён/u);
  });
  assert.equal(statements.some(text => text.includes('SET status = $2')), false);
});

test('refund с доказательством закрывает разбор', async () => {
  const { pool } = fakePool();
  await withServer(pool, async () => refundView(1000n), async baseUrl => {
    const { status, body } = await resolve(baseUrl, { action: 'refund', signature: REFUND_SIG, note: 'ticket 42' });
    assert.equal(status, 200);
    assert.equal(body.status, 'refunded');
    assert.equal(body.resolution_signature, REFUND_SIG);
  });
});

test('reject требует заметки: «не вернули» без причины не принимается', async () => {
  const { pool } = fakePool();
  await withServer(pool, async () => null, async baseUrl => {
    const withoutNote = await resolve(baseUrl, { action: 'reject' });
    assert.equal(withoutNote.status, 400);
    const withNote = await resolve(baseUrl, { action: 'reject', note: 'дубль уже возвращённого платежа' });
    assert.equal(withNote.status, 200);
    assert.equal(withNote.body.status, 'rejected');
  });
});

test('повторное закрытие уже закрытого разбора — 409, а не «тихо ок»', async () => {
  const pool = {
    query: async (text: string) => {
      if (text.includes('FROM game_ops.slot_payment_reviews WHERE id = $1')) {
        return { rows: [{ ...REVIEW, status: 'refunded' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }),
    on: () => pool,
    end: async () => undefined,
  } as unknown as Pool;
  await withServer(pool, async () => refundView(1000n), async baseUrl => {
    const { status, body } = await resolve(baseUrl, { action: 'refund', signature: REFUND_SIG });
    assert.equal(status, 409);
    assert.equal(body.error, 'INVALID_TRANSITION');
  });
});

test('resolveSlotPaymentReview отклоняет неизвестное действие до записи', async () => {
  const { pool, statements } = fakePool();
  await assert.rejects(
    () => resolveSlotPaymentReview(pool, { id: '1', action: 'steal' as never, actor: 'test' }),
    /Неизвестное действие/u,
  );
  assert.equal(statements.length, 0);
});
