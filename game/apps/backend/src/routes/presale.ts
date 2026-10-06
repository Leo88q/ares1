/**
 * Публичное и админ-API пресейла Phase 1.
 *
 * Разделение прав — как в gameops.ts:
 *   - публичные эндпоинты (статус тиража, резерв, привязка платежа, публичный
 *     статус заказа) — без токена, но под rate-limit и без раскрытия чужих
 *     данных (email и кошелёк наружу не уходят);
 *   - админские (открыть/закрыть тираж, подтверждение платежа, выдача, возврат,
 *     сверка) — только с Bearer-токеном, отказ попадает в аудит.
 *
 * Ничего изменяющего не происходит без записи в game_ops: резерв, переходы,
 * выдача и возврат идут через триггерную схему, а не «в обход».
 */
import { Router, type Request, type Response } from 'express';
import type { Connection } from '@solana/web3.js';
import { GameOpsError } from '../gameops/errors.js';
import type { GameOpsConfig } from '../gameops/env.js';
import type { Pool } from '../gameops/pool.js';
import { requireAdmin } from './gameops.js';
import { jsonSafe, send } from './shared.js';
import { PACKS, packPotatoMicro } from '../presale/catalog.js';
import {
  openRun, reserveOrder, attachPayment, confirmPayment, markDelivered,
  refundOrder, expireStaleReservations, getRunStatus, getOrderPublic,
  listPendingDelivery, listNeedsAttention,
} from '../presale/orders.js';
import { verifyPayment, verifyTokenPayment } from '../presale/verify.js';
import { fetchPaymentView, fetchTokenPaymentView, fetchTreasuryTransfers } from '../presale/chain.js';
import { reconcile, payersFromChain } from '../presale/reconcile.js';
import { planDelivery } from '../presale/delivery.js';
import { createIntent, getIntent } from '../gameops/intents.js';

export interface PresaleDeps {
  connection: Connection;
  /** Минт POTATO — для расчёта ATA получателя при выдаче. */
  potatoMint: string;
}

const runIdParam = (req: Request): string => String(req.params.runId ?? '');
const orderNoParam = (req: Request): number => Number.parseInt(String(req.params.orderNo ?? ''), 10);

export function presaleRouter(pool: Pool, config: GameOpsConfig, deps: PresaleDeps): Router {
  const router = Router();
  const admin = requireAdmin(pool, config);

  const handle = (res: Response, status: number, fn: () => unknown): void => {
    try {
      send(res, status, fn());
    } catch (error) {
      if (error instanceof GameOpsError) {
        send(res, error.status, { error: error.code, message: error.message, detail: error.detail ?? null });
        return;
      }
      send(res, 500, { error: 'UNEXPECTED', message: 'Внутренняя ошибка' });
    }
  };

  const handleAsync = (res: Response, status: number, fn: () => Promise<unknown>): Promise<void> => {
    return fn()
      .then(payload => send(res, status, payload))
      .catch(error => {
        if (error instanceof GameOpsError) {
          send(res, error.status, { error: error.code, message: error.message, detail: error.detail ?? null });
          return;
        }
        send(res, 500, { error: 'UNEXPECTED', message: 'Внутренняя ошибка' });
      });
  };

  // ── Публичные ──────────────────────────────────────────────────────────────

  router.get('/packs', (_req, res) => {
    handle(res, 200, () => ({
      packs: PACKS.map(pack => ({
        id: pack.id,
        titleRu: pack.titleRu,
        titleEn: pack.titleEn,
        fields: pack.fields,
        potatoMicro: packPotatoMicro(pack).toString(),
      })),
    }));
  });

  router.get('/runs/:runId', (req, res) => {
    handleAsync(res, 200, async () => {
      const status = await getRunStatus(pool, runIdParam(req));
      if (!status) throw new GameOpsError('RUN_NOT_FOUND', `Тираж ${runIdParam(req)} не найден`, undefined, 404);
      return { run: status };
    });
  });

  router.post('/runs/:runId/reserve', (req, res) => {
    const wallet = typeof req.body?.wallet === 'string' ? req.body.wallet : '';
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    return handleAsync(res, 201, async () => {
      const result = await reserveOrder(pool, {
        runId: runIdParam(req),
        payerWallet: wallet,
        payerEmail: email,
        actor: `buyer:${wallet.slice(0, 8) || 'unknown'}`,
      });
      return {
        orderNo: result.order.order_no,
        state: result.order.state,
        currency: result.currency,
        payUnits: result.payUnits.toString(),
        treasury: result.treasury,
        reserveSecondsLeft: result.reserveSecondsLeft,
        remaining: result.remainingAfterReserve,
        // Покупатель обязан перевести ТОЧНО payUnits на treasury. Пыль — номер заказа.
        instruction: `Переведите ровно ${result.payUnits} базовых единиц на ${result.treasury} и пришлите подпись транзакции.`,
      };
    });
  });

  router.post('/runs/:runId/orders/:orderNo/payment', (req, res) => {
    const signature = typeof req.body?.signature === 'string' ? req.body.signature : '';
    return handleAsync(res, 200, async () => {
      const order = await attachPayment(pool, {
        runId: runIdParam(req), orderNo: orderNoParam(req), signature,
        actor: `buyer:${String(req.body?.wallet ?? '').slice(0, 8) || 'order'}`,
      });
      // Привязали подпись; верификация асинхронно или оператором. Отвечаем сразу,
      // чтобы покупатель не ждал RPC.
      return { state: order.state, needsManualReview: false, message: 'Подпись получена, проверяем перевод.' };
    });
  });

  router.get('/runs/:runId/orders/:orderNo', (req, res) => {
    handleAsync(res, 200, async () => {
      const pub = await getOrderPublic(pool, runIdParam(req), orderNoParam(req));
      if (!pub) throw new GameOpsError('ORDER_NOT_FOUND', `Заказ №${orderNoParam(req)} не найден`, undefined, 404);
      return { order: pub };
    });
  });

  // ── Админские ──────────────────────────────────────────────────────────────

  router.post('/admin/runs', admin, (req, res) => {
    const body = req.body ?? {};
    return handleAsync(res, 201, async () => openRun(pool, {
      runId: String(body.runId ?? ''),
      packId: String(body.packId ?? ''),
      currency: body.currency === 'skr' ? 'skr' : 'sol',
      priceUnits: BigInt(String(body.priceUnits ?? '0')),
      cap: Number(body.cap ?? 0),
      treasury: String(body.treasury ?? ''),
      reserveMinutes: body.reserveMinutes != null ? Number(body.reserveMinutes) : undefined,
      actor: 'presale.admin',
    }));
  });

  router.post('/admin/runs/:runId/close', admin, (req, res) => {
    return handleAsync(res, 200, async () => {
      const closed = await closeRun(pool, runIdParam(req), 'presale.admin');
      return { run: closed };
    });
  });

  router.post('/admin/expire', admin, (req, res) => {
    return handleAsync(res, 200, () => expireStaleReservations(pool, 'presale.admin'));
  });

  router.post('/admin/orders/:id/verify', admin, (req, res) => {
    return handleAsync(res, 200, async () => verifyOrderPayment(pool, deps, String(req.params.id)));
  });

  router.post('/admin/orders/:id/deliver', admin, (req, res) => {
    return handleAsync(res, 200, async () => {
      const order = await getOrderRow(pool, String(req.params.id));
      if (!order) throw new GameOpsError('ORDER_NOT_FOUND', 'Заказ не найден', undefined, 404);
      const plan = planDelivery({
        orderId: BigInt(order.id),
        payerWallet: order.payer_wallet,
        packId: order.pack_id,
        potatoMint: deps.potatoMint,
      });
      const intent = await createIntent(pool, {
        recipientAta: plan.recipientAta,
        amountMicro: plan.amountMicro,
        nonce: plan.nonce,
        reason: plan.reason,
        actor: 'presale.admin',
      });
      return { intentId: intent.id, reused: intent.reused, plan: jsonSafe(plan) };
    });
  });

  router.post('/admin/orders/:id/delivered', admin, (req, res) => {
    const intentId = BigInt(String(req.body?.intentId ?? '0'));
    return handleAsync(res, 200, async () => {
      const intent = await getIntent(pool, String(intentId));
      if (!intent) throw new GameOpsError('INTENT_NOT_FOUND', 'Интент не найден', undefined, 404);
      if (intent.state !== 'confirmed') {
        throw new GameOpsError('INVALID_TRANSITION',
          `Интент ${intent.id} ещё не подтверждён на цепи (состояние ${intent.state}): выдача фиксируется только после ончейн-подтверждения`, undefined, 409);
      }
      return markDelivered(pool, { id: String(req.params.id), intentId, actor: 'presale.admin' });
    });
  });

  router.post('/admin/orders/:id/refund', admin, (req, res) => {
    return handleAsync(res, 200, async () => refundOrder(pool, {
      id: String(req.params.id),
      reason: String(req.body?.reason ?? 'возврат пресейла'),
      actor: 'presale.admin',
    }));
  });

  router.get('/admin/pending', admin, (_req, res) => {
    handleAsync(res, 200, () => listPendingDelivery(pool));
  });

  router.get('/admin/attention', admin, (_req, res) => {
    handleAsync(res, 200, () => listNeedsAttention(pool));
  });

  router.get('/admin/reconcile', admin, (req, res) => {
    const runId = runIdParam({ params: { runId: req.query.runId } } as unknown as Request);
    return handleAsync(res, 200, async () => reconcileRun(pool, deps, runId));
  });

  return router;
}

async function getOrderRow(pool: Pool, id: string) {
  const { query } = await import('../gameops/pool.js');
  const rows = await query<Record<string, unknown>>(pool, 'SELECT * FROM game_ops.presale_orders WHERE id = $1', [id]);
  return (rows[0] as {
    id: string; payer_wallet: string; pack_id: string; state: string;
    price_units: string; run_id: string; order_no: number;
    tx_signature: string | null; received_units: string | null;
  }) ?? null;
}

async function closeRun(pool: Pool, runId: string, actor: string) {
  const { withTransaction } = await import('../gameops/pool.js');
  return withTransaction(pool, actor, async client => {
    const updated = await client.query(
      `UPDATE game_ops.presale_runs SET is_open = false, closed_at = now()
        WHERE run_id = $1 AND is_open = true RETURNING *`,
      [runId],
    );
    if (!updated.rows[0]) throw new GameOpsError('RUN_NOT_FOUND', `Тираж ${runId} не найден или уже закрыт`, undefined, 404);
    return updated.rows[0];
  });
}

async function verifyOrderPayment(pool: Pool, deps: PresaleDeps, orderId: string) {
  const order = await getOrderRow(pool, orderId);
  if (!order) throw new GameOpsError('ORDER_NOT_FOUND', 'Заказ не найден', undefined, 404);
  if (!order.tx_signature) {
    throw new GameOpsError('VALIDATION', 'У заказа нет подписи платежа', undefined, 400);
  }
  const run = await runOf(pool, order.run_id);
  const expected = BigInt(order.price_units);
  const base = expected - BigInt(order.order_no);

  let verdict;
  if (run.currency === 'skr') {
    const view = await fetchTokenPaymentView(deps.connection, order.tx_signature);
    if (!view) throw new GameOpsError('VALIDATION', 'Транзакция не найдена в цепи', undefined, 404);
    verdict = verifyTokenPayment(view, {
      treasuryAta: run.treasury, mint: skrMintOf(run), expectedUnits: expected,
      payerWallet: order.payer_wallet,
    });
  } else {
    const view = await fetchPaymentView(deps.connection, order.tx_signature);
    if (!view) throw new GameOpsError('VALIDATION', 'Транзакция не найдена в цепи', undefined, 404);
    verdict = verifyPayment(view, {
      treasury: run.treasury, expectedLamports: expected, payerWallet: order.payer_wallet,
    });
  }

  if (verdict.ok) {
    await confirmPayment(pool, { id: orderId, receivedUnits: verdict.receivedUnits, slot: verdict.slot, actor: 'presale.verify' });
  }
  void base;
  return { verdict };
}

function skrMintOf(_run: { currency: string }): string {
  // Минт SKR — константа программы (lib.rs:159). Хранить его в тираже значило бы
  // допустить «другой SKR», а это ровно ошибка «деньги в бесполезный токен».
  return 'Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o';
}

async function runOf(pool: Pool, runId: string) {
  const { query } = await import('../gameops/pool.js');
  const rows = await query<{ run_id: string; currency: 'sol' | 'skr'; treasury: string; price_units: string }>(
    pool, 'SELECT * FROM game_ops.presale_runs WHERE run_id = $1', [runId],
  );
  const run = rows[0];
  if (!run) throw new GameOpsError('RUN_NOT_FOUND', `Тираж ${runId} не найден`, undefined, 404);
  return run;
}

async function reconcileRun(pool: Pool, deps: PresaleDeps, runId: string) {
  const run = await runOf(pool, runId);
  if (run.currency !== 'sol') {
    throw new GameOpsError('VALIDATION', 'Автоматическая сверка пока реализована для SOL-тиражей', undefined, 400);
  }
  const chainTransfers = await fetchTreasuryTransfers(deps.connection, run.treasury);
  const { query } = await import('../gameops/pool.js');
  const rows = await query<{
    order_no: number; tx_signature: string | null; received_units: string | null;
    state: string; payer_wallet: string;
  }>(pool, 'SELECT order_no, tx_signature, received_units, state, payer_wallet FROM game_ops.presale_orders WHERE run_id = $1', [runId]);
  const dbOrders = rows.map(row => ({
    order_no: row.order_no,
    tx_signature: row.tx_signature,
    received_units: row.received_units !== null ? BigInt(row.received_units) : null,
    state: row.state,
    payer_wallet: row.payer_wallet,
  }));
  const report = reconcile(chainTransfers, dbOrders);
  return { report, payers: payersFromChain(chainTransfers) };
}

export { jsonSafe };
