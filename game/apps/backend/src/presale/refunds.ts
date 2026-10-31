/**
 * Возврат по заказу пресейла: решение (state = refunded) и исполнение
 * (refund_tx_signature) — разные факты, и второй обязан быть доказан цепью.
 *
 * Почему это отдельный модуль: проверка «покупатель реально получил деньги»
 * должна быть чистой (без RPC) — иначе её нельзя покрыть тестами, а именно она
 * решает, закрывать денежный пункт или нет. Ровно тот же принцип, что в
 * `verify.ts`, только направление перевода обратное: там деньги приходили в
 * казну, здесь — уходят покупателю.
 */
import { GameOpsError } from '../gameops/errors.js';
import type { Pool } from '../gameops/pool.js';
import { withTransaction } from '../gameops/pool.js';
import type { ChainTokenTransferView, ChainTransferView } from './verify.js';

/**
 * Сколько токена реально ДОБАВИЛОСЬ владельцу в этой транзакции.
 *
 * `tokenInflow` из verify.ts берёт первую запись владельца; для казны это
 * корректно (у неё один ATA на минт), а у покупателя их может быть несколько —
 * тогда часть возврата «потерялась» бы из проверки, и оператор увидел бы
 * «недоплату» там, где деньги дошли. Поэтому здесь суммируются ВСЕ записи
 * владельца в этом минте, а сопоставление pre/post идёт по accountIndex,
 * единственному полю, связывающему два снимка.
 */
function tokenCredit(
  view: ChainTokenTransferView,
  owner: string,
  mint: string,
): { received: bigint; accounts: number } | null {
  const posts = view.postTokenBalances.filter(b => b.owner === owner && b.mint === mint);
  if (posts.length === 0) return null;
  let received = 0n;
  for (const post of posts) {
    const pre = view.preTokenBalances.find(
      b => b.accountIndex === post.accountIndex && b.mint === mint,
    );
    received += post.amount - (pre?.amount ?? 0n);
  }
  return { received, accounts: posts.length };
}

export type PayoutErrorCode =
  | 'NOT_FINALIZED'
  | 'TX_FAILED'
  | 'WALLET_NOT_INVOLVED'
  | 'AMOUNT_MISMATCH'
  | 'TOO_EARLY';

export interface PayoutCheck {
  ok: boolean;
  code?: PayoutErrorCode;
  received: bigint;
  detail: string;
}

/**
 * Общий предикат «покупатель получил ровно столько» для обоих видов платежа.
 * Возврат меньше причитающегося — не возврат; больше — повод разобраться, а не
 * «округляем, значит закрыто».
 */
function decide(received: bigint, expected: bigint, walletInvolved: boolean): PayoutCheck {
  if (!walletInvolved) {
    return {
      ok: false, code: 'WALLET_NOT_INVOLVED', received: 0n,
      detail: 'кошелёк покупателя не участвует в транзакции',
    };
  }
  if (received !== expected) {
    return {
      ok: false, code: 'AMOUNT_MISMATCH', received,
      detail: `покупатель получил ${received}, ожидалось ровно ${expected}`,
    };
  }
  return { ok: true, received, detail: 'возврат подтверждён цепью' };
}

/** SOL: приток лампортов на кошелёк покупателя (комиссию платит отправитель). */
export function verifySolRefund(
  view: ChainTransferView,
  expect: { wallet: string; amount: bigint; notBefore?: bigint | null },
): PayoutCheck {
  if (view.confirmation !== 'finalized') {
    return { ok: false, code: 'NOT_FINALIZED', received: 0n, detail: `статус ${view.confirmation}, нужен finalized` };
  }
  if (view.err !== null && view.err !== undefined) {
    return { ok: false, code: 'TX_FAILED', received: 0n, detail: `транзакция завершилась ошибкой: ${JSON.stringify(view.err)}` };
  }
  if (expect.notBefore != null) {
    // Доказательством возврата не может быть перевод, сделанный до самого
    // решения о возврате (иначе подойдёт любой старый перевод той же суммы).
    if (view.blockTime === null || view.blockTime < expect.notBefore) {
      return { ok: false, code: 'TOO_EARLY', received: 0n, detail: 'транзакция старше решения о возврате' };
    }
  }
  const index = view.accountKeys.findIndex(key => key === expect.wallet);
  if (index < 0) {
    return { ok: false, code: 'WALLET_NOT_INVOLVED', received: 0n, detail: 'кошелёк покупателя не участвует в транзакции' };
  }
  const pre = view.preBalances[index];
  const post = view.postBalances[index];
  if (pre === undefined || post === undefined) {
    return { ok: false, code: 'WALLET_NOT_INVOLVED', received: 0n, detail: 'нет балансов кошелька покупателя' };
  }
  return decide(post - pre, expect.amount, true);
}

/** SKR: приток токена на кошелёк покупателя в нужном минте. */
export function verifyTokenRefund(
  view: ChainTokenTransferView,
  expect: { wallet: string; mint: string; amount: bigint },
): PayoutCheck {
  if (view.confirmation !== 'finalized') {
    return { ok: false, code: 'NOT_FINALIZED', received: 0n, detail: `статус ${view.confirmation}, нужен finalized` };
  }
  if (view.err !== null && view.err !== undefined) {
    return { ok: false, code: 'TX_FAILED', received: 0n, detail: `транзакция завершилась ошибкой: ${JSON.stringify(view.err)}` };
  }
  const inflow = tokenCredit(view, expect.wallet, expect.mint);
  if (!inflow) {
    return {
      ok: false, code: 'WALLET_NOT_INVOLVED', received: 0n,
      detail: `у кошелька ${expect.wallet} нет баланса в минте ${expect.mint} в этой транзакции`,
    };
  }
  return decide(inflow.received, expect.amount, true);
}

export interface RefundSettlementInput {
  id: string;
  /** Подпись транзакции, в которой покупатель получил возврат. */
  signature: string;
  actor: string;
}

/**
 * Зафиксировать исполнение возврата. Идемпотентно: повтор с той же подписью
 * возвращает уже записанную строку (двойной клик оператора не ломает учёт),
 * другая подпись после закрытия — конфликт.
 */
export async function settleRefund(
  pool: Pool,
  input: RefundSettlementInput,
): Promise<{ order: Record<string, unknown>; alreadySettled: boolean }> {
  return withTransaction(pool, input.actor, async client => {
    const updated = await client.query<Record<string, unknown>>(
      `UPDATE game_ops.presale_orders
          SET refund_tx_signature = $2
        WHERE id = $1 AND state = 'refunded' AND refund_tx_signature IS NULL
        RETURNING *`,
      [input.id, input.signature],
    );
    if (updated.rows[0]) return { order: updated.rows[0], alreadySettled: false };

    const current = await client.query<{ state: string; refund_tx_signature: string | null }>(
      'SELECT state, refund_tx_signature FROM game_ops.presale_orders WHERE id = $1',
      [input.id],
    );
    const row = current.rows[0];
    if (!row) throw new GameOpsError('ORDER_NOT_FOUND', `Заказ ${input.id} не найден`, undefined, 404);
    if (row.state !== 'refunded') {
      throw new GameOpsError('INVALID_TRANSITION',
        `Заказ ${input.id} в состоянии ${row.state}: исполнение возврата фиксируется только у refunded`, undefined, 409);
    }
    if (row.refund_tx_signature === input.signature) {
      const same = await client.query<Record<string, unknown>>(
        'SELECT * FROM game_ops.presale_orders WHERE id = $1', [input.id],
      );
      return { order: same.rows[0]!, alreadySettled: true };
    }
    throw new GameOpsError('INVALID_TRANSITION',
      `Возврат по заказу ${input.id} уже подтверждён другой транзакцией`, undefined, 409);
  });
}
