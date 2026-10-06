/**
 * План выдачи пресейл-пака: из заказа в payload для grant_reward_once.
 *
 * Чистая функция — ни БД, ни RPC, — поэтому её можно проверить без стенда и,
 * что важнее, она не может «в процессе» решить иначе, чем в тесте.
 *
 * Связка «заказ → выдача» держится на двух инвариантах:
 *   1. `nonce` = id заказа. Ончейн-PDA [b"reward", ata, nonce] делает повторную
 *      выдачу того же заказа невозможной на уровне программы (гейт G-1), а
 *      идемпотентность reward_intents — на уровне БД. Двойная защита.
 *   2. `amountMicro` = packPotatoMicro(pack), и пак заведомо ≤ MAX_REWARD_MICRO,
 *      поэтому план всегда = ровно одна транзакция grant_reward_once. Дробить
 *      нельзя не потому, что «окно 15 минут», а потому что одна выдача проще
 *      расследуется и не оставляет «полупакетов».
 */
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { findPack, packPotatoMicro, MAX_REWARD_MICRO } from './catalog.js';

export interface DeliveryPlan {
  /** POTATO ATA покупателя — именно туда минтит программа. */
  recipientAta: string;
  amountMicro: bigint;
  nonce: bigint;
  reason: string;
  grants: 1;
}

export function planDelivery(input: {
  orderId: bigint;
  payerWallet: string;
  packId: string;
  potatoMint: string;
}): DeliveryPlan {
  const pack = findPack(input.packId);
  if (!pack) throw new Error(`Неизвестный пак: ${input.packId}`);
  const amountMicro = packPotatoMicro(pack);
  if (amountMicro <= 0n || amountMicro > MAX_REWARD_MICRO) {
    throw new Error(
      `Пак ${input.packId} требует ${amountMicro} микро — вне диапазона одной выдачи (1..${MAX_REWARD_MICRO})`,
    );
  }

  let wallet: PublicKey;
  let mint: PublicKey;
  try {
    wallet = new PublicKey(input.payerWallet);
    mint = new PublicKey(input.potatoMint);
  } catch {
    throw new Error('Кошелёк покупателя или минт POTATO не являются base58-адресом');
  }

  const recipientAta = getAssociatedTokenAddressSync(mint, wallet);
  return {
    recipientAta: recipientAta.toBase58(),
    amountMicro,
    nonce: input.orderId,
    reason: `presale:${input.packId}:order:${input.orderId}`,
    grants: 1,
  };
}
