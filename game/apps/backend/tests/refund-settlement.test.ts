/**
 * Доказательство возврата: чистая проверка цепи + маршрут, который её применяет.
 *
 * Проблема, которую закрывают эти тесты: `state = 'refunded'` — это решение
 * вернуть деньги, а не факт возврата. Пока различия не было, заказ считался
 * закрытым сразу после решения, хотя перевод делает оператор отдельным шагом
 * (вывод из казны двухшаговый, с таймлоком). Итог: покупатель без денег, учёт
 * без расхождения, очередь «требует внимания» с вечно висящими заказами.
 *
 * Проверяются обе половины:
 *   1. чистая функция — «эта транзакция действительно вернула ровно столько
 *      этому кошельку» (с направлением перевода, обратным платежу);
 *   2. HTTP-маршрут — порядок «сначала цепь, потом запись», идемпотентность
 *      повторного вызова и отказ при чужой подписи.
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
import type { ChainTokenTransferView, ChainTransferView } from '../src/presale/verify.js';
import { verifySolRefund, verifyTokenRefund } from '../src/presale/refunds.js';

const token = 'token-'.padEnd(40, 'y');
const PAYER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const TREASURY = 'DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf';
const MINT = 'Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o';
const REFUND_TX = '5'.repeat(88);
const OTHER_TX = '6'.repeat(88);
const NOW = 1_700_000_000;
const BASE = 500_000_000n;
/** Счёт покупателя: база + пыль (номер заказа). */
const AMOUNT = BASE + 7n;

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

/** Снимок транзакции возврата: деньги уходят покупателю, казначейство платит. */
function solRefundView(received: bigint, overrides: Partial<ChainTransferView> = {}): ChainTransferView {
  return {
    signature: REFUND_TX,
    slot: 200n,
    blockTime: BigInt(NOW),
    err: null,
    accountKeys: [TREASURY, PAYER],
    preBalances: [0n, 1_000_000_000n],
    postBalances: [received + 5_000n, 1_000_000_000n + received],
    confirmation: 'finalized',
    ...overrides,
  };
}

function tokenView(after: bigint[], before: bigint[] = [0n, 0n]): ChainTokenTransferView {
  return {
    signature: REFUND_TX,
    slot: 200n,
    blockTime: BigInt(NOW),
    err: null,
    accountKeys: [TREASURY, PAYER, `${PAYER}-ata-2`],
    preTokenBalances: [
      { accountIndex: 1, mint: MINT, owner: PAYER, amount: before[0] ?? 0n },
      { accountIndex: 2, mint: MINT, owner: PAYER, amount: before[1] ?? 0n },
    ],
    postTokenBalances: [
      { accountIndex: 1, mint: MINT, owner: PAYER, amount: after[0] ?? 0n },
      { accountIndex: 2, mint: MINT, owner: PAYER, amount: after[1] ?? 0n },
    ],
    confirmation: 'finalized',
  };
}

// ── Чистая проверка: направление обратное платежу ────────────────────────────

test('SOL: возврат подтверждён, когда покупатель получил ровно причитающееся', () => {
  const check = verifySolRefund(solRefundView(AMOUNT), { wallet: PAYER, amount: AMOUNT });
  assert.equal(check.ok, true);
  assert.equal(check.received, AMOUNT);
});

test('SOL: недостаточно финализированная транзакция не считается возвратом', () => {
  for (const confirmation of ['processed', 'confirmed'] as const) {
    const check = verifySolRefund(solRefundView(AMOUNT, { confirmation }), { wallet: PAYER, amount: AMOUNT });
    assert.equal(check.ok, false);
    assert.equal(check.code, 'NOT_FINALIZED');
  }
});

test('SOL: упавшая транзакция не возврат, даже если балансы выглядят правильно', () => {
  const check = verifySolRefund(solRefundView(AMOUNT, { err: { InstructionError: [0, 'Custom'] } }), {
    wallet: PAYER, amount: AMOUNT,
  });
  assert.equal(check.ok, false);
  assert.equal(check.code, 'TX_FAILED');
});

test('SOL: кошелёк, которого нет в транзакции, ничего не получил', () => {
  const view = solRefundView(AMOUNT, { accountKeys: [TREASURY, 'SomeOtherWallet1111111111111111111111111'] });
  const check = verifySolRefund(view, { wallet: PAYER, amount: AMOUNT });
  assert.equal(check.ok, false);
  assert.equal(check.code, 'WALLET_NOT_INVOLVED');
});

test('SOL: недоплата и переплата — обе не «почти возврат»', () => {
  const short = verifySolRefund(solRefundView(AMOUNT - 1n), { wallet: PAYER, amount: AMOUNT });
  assert.equal(short.ok, false);
  assert.equal(short.code, 'AMOUNT_MISMATCH');
  assert.equal(short.received, AMOUNT - 1n);
  // Возврат больше причитающегося — тоже повод разобраться, а не автозакрытие.
  const over = verifySolRefund(solRefundView(AMOUNT + 1n), { wallet: PAYER, amount: AMOUNT });
  assert.equal(over.ok, false);
  assert.equal(over.code, 'AMOUNT_MISMATCH');
});

test('SOL: старый перевод той же суммы не подменяет решение о возврате', () => {
  // Иначе доказательством возврата стал бы любой прошлый перевод покупателю.
  const old = verifySolRefund(
    solRefundView(AMOUNT, { blockTime: BigInt(NOW - 86_400) }),
    { wallet: PAYER, amount: AMOUNT, notBefore: BigInt(NOW - 300) },
  );
  assert.equal(old.ok, false);
  assert.equal(old.code, 'TOO_EARLY');
  const unknownAge = verifySolRefund(solRefundView(AMOUNT, { blockTime: null }), {
    wallet: PAYER, amount: AMOUNT, notBefore: BigInt(NOW - 300),
  });
  assert.equal(unknownAge.code, 'TOO_EARLY', 'без blockTime возраст не доказан');
});

test('SKR: склейка нескольких токен-аккаунтов покупателя не теряет возврат', () => {
  // У покупателя может быть больше одного ATA на тот же минт. Если смотреть
  // только первую запись, часть возврата выпадет из проверки и оператор
  // увидит «недоплату» там, где деньги дошли полностью.
  const check = verifyTokenRefund(tokenView([300_000_000n, 200_000_007n]), {
    wallet: PAYER, mint: MINT, amount: AMOUNT,
  });
  assert.equal(check.ok, true);
  assert.equal(check.received, AMOUNT);
});

test('SKR: нет записи владельца в нужном минте — не возврат', () => {
  const view: ChainTokenTransferView = {
    ...tokenView([0n, 0n]),
    postTokenBalances: [
      { accountIndex: 1, mint: 'OtherMint1111111111111111111111111111111', owner: PAYER, amount: AMOUNT },
    ],
    preTokenBalances: [],
  };
  const check = verifyTokenRefund(view, { wallet: PAYER, mint: MINT, amount: AMOUNT });
  assert.equal(check.ok, false);
  assert.equal(check.code, 'WALLET_NOT_INVOLVED');
});

test('SKR: транзакция без притока покупателю — не возврат', () => {
  const check = verifyTokenRefund(tokenView([0n, 0n]), { wallet: PAYER, mint: MINT, amount: AMOUNT });
  assert.equal(check.ok, false);
  assert.equal(check.code, 'AMOUNT_MISMATCH');
  assert.equal(check.received, 0n);
});

// ── HTTP-маршрут ─────────────────────────────────────────────────────────────

interface FakeOrder {
  id: string;
  run_id: string;
  order_no: number;
  pack_id: string;
  price_units: string;
  payer_wallet: string;
  state: string;
  tx_signature: string | null;
  received_units: string | null;
  created_at: string;
  refunded_at: string | null;
  refund_tx_signature: string | null;
}

/**
 * Пул, который ведёт себя как настоящий в той части, которая нужна маршруту:
 * UPDATE ставит колонку только если заказ в `refunded` и подписи ещё нет —
 * ровно как в SQL маршрута (условие в WHERE, а не в коде).
 */
function fakePool(order: FakeOrder) {
  const writes: string[] = [];
  const client = {
    query: async (text: string, params?: unknown[]) => {
      writes.push(text);
      if (text.includes('SET refund_tx_signature = $2')) {
        if (order.state !== 'refunded' || order.refund_tx_signature !== null) return { rows: [], rowCount: 0 };
        order.refund_tx_signature = String(params?.[1]);
        return { rows: [order], rowCount: 1 };
      }
      if (text.includes('SELECT state, refund_tx_signature')) {
        return { rows: [{ state: order.state, refund_tx_signature: order.refund_tx_signature }], rowCount: 1 };
      }
      if (text.includes('SELECT * FROM game_ops.presale_orders WHERE id = $1')) {
        return { rows: [order], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      writes.push(text);
      if (text.includes('FROM game_ops.presale_orders WHERE id = $1')) {
        return { rows: params?.[0] === order.id ? [order] : [] };
      }
      if (text.includes('FROM game_ops.presale_runs WHERE run_id = $1')) {
        return {
          rows: [{
            run_id: order.run_id, currency: 'sol', treasury: TREASURY,
            price_units: order.price_units, started_slot: '100',
          }],
        };
      }
      return { rows: [] };
    },
    connect: async () => client,
    on: () => pool,
    end: async () => undefined,
  };
  return { pool: pool as unknown as Pool, order, writes };
}

function refundedOrder(overrides: Partial<FakeOrder> = {}): FakeOrder {
  return {
    id: '77',
    run_id: 'wave1',
    order_no: 7,
    pack_id: 'meadow-4',
    price_units: BASE.toString(),
    payer_wallet: PAYER,
    state: 'refunded',
    tx_signature: '7'.repeat(88),
    received_units: AMOUNT.toString(),
    created_at: new Date((NOW - 3600) * 1000).toISOString(),
    // Решение о возврате принято час назад; возвратный перевод — сейчас.
    refunded_at: new Date((NOW - 3600) * 1000).toISOString(),
    refund_tx_signature: null,
    ...overrides,
  };
}

function depsWith(view: ChainTransferView | null): PresaleDeps {
  const views: PresaleChainViews = {
    fetchPaymentView: async () => view,
    fetchTokenPaymentView: async () => null,
  };
  return {
    connection: {} as unknown as PresaleDeps['connection'],
    cluster: 'devnet',
    paymentsEnabled: false,
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

async function settle(
  baseUrl: string,
  body: Record<string, unknown> = { signature: REFUND_TX },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/presale/admin/orders/77/refund-settled`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test('маршрут: подпись не в формате base58 отвергается до обращения к цепи', async () => {
  const { pool, order } = fakePool(refundedOrder());
  await withServer(pool, depsWith(solRefundView(AMOUNT)), async baseUrl => {
    for (const signature of ['short', '0'.repeat(88), `${'5'.repeat(87)}l`]) {
      const { status, body } = await settle(baseUrl, { signature });
      assert.equal(status, 400, `подпись «${signature}» не должна приниматься`);
      assert.equal(body.error, 'VALIDATION');
    }
  });
  assert.equal(order.refund_tx_signature, null);
});

test('маршрут: исполнение возврата фиксируется только у возвращённого заказа', async () => {
  const { pool, order } = fakePool(refundedOrder({ state: 'paid', refunded_at: null }));
  await withServer(pool, depsWith(solRefundView(AMOUNT)), async baseUrl => {
    const { status, body } = await settle(baseUrl);
    assert.equal(status, 409);
    assert.equal(body.error, 'INVALID_TRANSITION');
  });
  assert.equal(order.refund_tx_signature, null, 'запись в БД не должна произойти');
});

test('маршрут: перевод, не подтверждающий сумму, не закрывает возврат', async () => {
  const { pool, order } = fakePool(refundedOrder());
  await withServer(pool, depsWith(solRefundView(AMOUNT - 10n)), async baseUrl => {
    const { status, body } = await settle(baseUrl);
    assert.equal(status, 400);
    assert.equal(body.error, 'VALIDATION');
    assert.equal(body.detail, 'AMOUNT_MISMATCH', 'стабильный код причины — для поддержки');
    assert.match(String(body.message), /Возврат не подтверждён цепью/);
  });
  assert.equal(order.refund_tx_signature, null, 'недоказанный возврат не записывается');
});

test('маршрут: старый перевод до решения о возврате не принимается', async () => {
  const { pool, order } = fakePool(refundedOrder());
  const old = solRefundView(AMOUNT, { blockTime: BigInt(NOW - 7200) });
  await withServer(pool, depsWith(old), async baseUrl => {
    const { status, body } = await settle(baseUrl);
    assert.equal(status, 400);
    assert.equal(body.detail, 'TOO_EARLY', 'старый перевод не может доказывать возврат');
  });
  assert.equal(order.refund_tx_signature, null);
});

test('маршрут: без записанной суммы возвращается ровно счёт (база + пыль)', async () => {
  // Заказ ушёл в возврат из payment_seen: сколько реально пришло, неизвестно.
  // Возврат базы цены оставил бы покупателю недоплату на номер заказа.
  const { pool, order } = fakePool(refundedOrder({ received_units: null }));
  await withServer(pool, depsWith(solRefundView(AMOUNT)), async baseUrl => {
    const { status } = await settle(baseUrl);
    assert.equal(status, 200, 'счёт заказа включает пыль, и возврат обязан её учитывать');
  });
  assert.equal(order.refund_tx_signature, REFUND_TX);
});

test('маршрут: доказанный возврат записывается, повтор идемпотентен, чужая подпись — конфликт', async () => {
  const { pool, order } = fakePool(refundedOrder());
  await withServer(pool, depsWith(solRefundView(AMOUNT)), async baseUrl => {
    const first = await settle(baseUrl);
    assert.equal(first.status, 200);
    assert.equal((first.body.verified as { received: string }).received, AMOUNT.toString());
    assert.equal(order.refund_tx_signature, REFUND_TX, 'подпись сохранена как доказательство');

    // Двойной клик оператора не должен превращаться в ошибку учёта.
    const again = await settle(baseUrl);
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadySettled, true);

    // А вот подмена доказательства — отказ: иначе закрытым окажется возврат,
    // которого покупатель не получал.
    const other = await settle(baseUrl, { signature: OTHER_TX });
    assert.equal(other.status, 409);
    assert.equal(order.refund_tx_signature, REFUND_TX);
  });
});
