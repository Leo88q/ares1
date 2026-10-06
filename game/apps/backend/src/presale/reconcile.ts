/**
 * Сверка: цепь против БД. Чистая функция над двумя списками.
 *
 * Это реализация правила DATABASE_DESIGN.md §1 для Phase 1. Требование не
 * «сверить, если удобно», а структурное: **список плательщиков обязан
 * восстанавливаться из одной только истории кошелька-казначейства**, без БД.
 * Поэтому вход `chainTransfers` — полный и самодостаточный: из него можно
 * построить список плательщиков, вообще не глядя на заказы.
 *
 * Два расхождения критичны по-разному:
 *   chainOnly — деньги пришли, заказа нет. Покупатель заплатил и ничего не
 *               получит. Это инцидент, а не «шум сверки».
 *   dbOnly    — заказ помечен оплаченным, а перевода в цепи нет. Мы выдадим
 *               пак без денег. Это хуже первого: теряем мы.
 */

export interface ChainTransfer {
  signature: string;
  /** От кого пришли деньги — из истории кошелька. */
  fromWallet: string;
  units: bigint;
  slot: bigint;
  blockTime: bigint | null;
}

export interface DbOrderRecord {
  order_no: number;
  tx_signature: string | null;
  received_units: bigint | null;
  state: string;
  payer_wallet: string;
}

export interface ReconciliationReport {
  matchedCount: number;
  /** Деньги в цепи есть, заказа нет. */
  chainOnly: ChainTransfer[];
  /** Заказ считает себя оплаченным, перевода в цепи нет. */
  dbOnly: DbOrderRecord[];
  /** Подпись совпала, сумма — нет. */
  amountMismatch: Array<{
    signature: string;
    order_no: number;
    chainUnits: bigint;
    dbUnits: bigint;
  }>;
  /** Заказ привязан к подписи, но плательщик в заказе — другой кошелёк. */
  walletMismatch: Array<{ signature: string; order_no: number; chainWallet: string; dbWallet: string }>;
  /** Одна и та же подпись закрыла несколько заказов (unique не сработал). */
  duplicateSignature: Array<{ signature: string; orderNos: number[] }>;
  ok: boolean;
}

const SETTLED = new Set(['paid', 'delivered']);

export function reconcile(
  chainTransfers: readonly ChainTransfer[],
  dbOrders: readonly DbOrderRecord[],
): ReconciliationReport {
  const bySignature = new Map<string, ChainTransfer>();
  for (const transfer of chainTransfers) {
    // Дубль подписи в самой цепи невозможен, но вход приходит извне:
    // молча перезаписать — значит потерять перевод.
    if (bySignature.has(transfer.signature)) {
      throw new Error(`В истории кошелька повтор подписи ${transfer.signature} — вход недостоверен`);
    }
    bySignature.set(transfer.signature, transfer);
  }

  const seenSignatures = new Map<string, number[]>();
  const chainOnly: ChainTransfer[] = [];
  const dbOnly: DbOrderRecord[] = [];
  const amountMismatch: ReconciliationReport['amountMismatch'] = [];
  const walletMismatch: ReconciliationReport['walletMismatch'] = [];
  let matchedCount = 0;

  for (const order of dbOrders) {
    if (!order.tx_signature) {
      // Заказ без подписи оплаченным быть не может (это гарантирует и схема).
      if (SETTLED.has(order.state)) dbOnly.push(order);
      continue;
    }
    const list = seenSignatures.get(order.tx_signature) ?? [];
    list.push(order.order_no);
    seenSignatures.set(order.tx_signature, list);

    const transfer = bySignature.get(order.tx_signature);
    if (!transfer) {
      if (SETTLED.has(order.state)) dbOnly.push(order);
      continue;
    }
    matchedCount += 1;
    if (order.received_units !== null && order.received_units !== transfer.units) {
      amountMismatch.push({
        signature: order.tx_signature,
        order_no: order.order_no,
        chainUnits: transfer.units,
        dbUnits: order.received_units,
      });
    }
    if (order.payer_wallet && order.payer_wallet !== transfer.fromWallet) {
      walletMismatch.push({
        signature: order.tx_signature,
        order_no: order.order_no,
        chainWallet: transfer.fromWallet,
        dbWallet: order.payer_wallet,
      });
    }
  }

  const attributed = new Set(
    dbOrders.map(o => o.tx_signature).filter((s): s is string => s !== null),
  );
  for (const transfer of chainTransfers) {
    if (!attributed.has(transfer.signature)) chainOnly.push(transfer);
  }

  const duplicateSignature = [...seenSignatures.entries()]
    .filter(([, orderNos]) => orderNos.length > 1)
    .map(([signature, orderNos]) => ({ signature, orderNos: [...orderNos].sort((a, b) => a - b) }));

  return {
    matchedCount,
    chainOnly,
    dbOnly,
    amountMismatch,
    walletMismatch,
    duplicateSignature,
    ok:
      chainOnly.length === 0 &&
      dbOnly.length === 0 &&
      amountMismatch.length === 0 &&
      walletMismatch.length === 0 &&
      duplicateSignature.length === 0,
  };
}

/**
 * Список плательщиков, построенный ТОЛЬКО из истории кошелька.
 * Именно этот список — источник правды; БД лишь объясняет, к какому заказу
 * относится каждый перевод. Если БД потерять, выдачу можно провести отсюда.
 */
export interface PayerRecord {
  fromWallet: string;
  signatures: string[];
  totalUnits: bigint;
  transfers: number;
}

export function payersFromChain(chainTransfers: readonly ChainTransfer[]): PayerRecord[] {
  const byWallet = new Map<string, PayerRecord>();
  for (const transfer of chainTransfers) {
    const existing = byWallet.get(transfer.fromWallet);
    if (existing) {
      existing.signatures.push(transfer.signature);
      existing.totalUnits += transfer.units;
      existing.transfers += 1;
    } else {
      byWallet.set(transfer.fromWallet, {
        fromWallet: transfer.fromWallet,
        signatures: [transfer.signature],
        totalUnits: transfer.units,
        transfers: 1,
      });
    }
  }
  // Сортировка по убыванию суммы: при ручной раздаче первыми видны крупные.
  return [...byWallet.values()].sort((a, b) =>
    b.totalUnits > a.totalUnits ? 1 : b.totalUnits < a.totalUnits ? -1 : 0,
  );
}
