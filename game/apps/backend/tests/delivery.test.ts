/**
 * planDelivery — чистая функция выдачи. Тест исполняет реальный код delivery.ts
 * (без БД и RPC), поэтому проверяет именно тот путь, по которому заказ
 * превращается в payload grant_reward_once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import { PACKS, findPack, packPotatoMicro, MAX_REWARD_MICRO } from '../src/presale/catalog.js';
import { planDelivery } from '../src/presale/delivery.js';

// Любые валидные base58-ключи: минт POTATO и кошелёк покупателя.
const MINT = 'Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o';
const WALLET = '11111111111111111111111111111111';

test('planDelivery: ATA = getAssociatedTokenAddressSync(mint, wallet)', () => {
  const pack = PACKS[0];
  const plan = planDelivery({ orderId: 7n, payerWallet: WALLET, packId: pack.id, potatoMint: MINT });
  const expected = getAssociatedTokenAddressSync(new PublicKey(MINT), new PublicKey(WALLET)).toBase58();
  assert.equal(plan.recipientAta, expected);
});

test('planDelivery: сумма = packPotatoMicro и в пределах одной выдачи', () => {
  for (const pack of PACKS) {
    const plan = planDelivery({ orderId: 1n, payerWallet: WALLET, packId: pack.id, potatoMint: MINT });
    assert.equal(plan.amountMicro, packPotatoMicro(findPack(pack.id)!));
    assert.ok(plan.amountMicro > 0n && plan.amountMicro <= MAX_REWARD_MICRO, `${pack.id} вне диапазона`);
    assert.equal(plan.grants, 1, 'пак всегда = ровно один grant');
  }
});

test('planDelivery: nonce = id заказа (гейт повторной выдачи)', () => {
  const plan = planDelivery({ orderId: 4242n, payerWallet: WALLET, packId: PACKS[0].id, potatoMint: MINT });
  assert.equal(plan.nonce, 4242n);
  assert.match(plan.reason, /order:4242$/);
});

test('planDelivery: неизвестный пак и битый адрес отклоняются', () => {
  assert.throws(() => planDelivery({ orderId: 1n, payerWallet: WALLET, packId: 'nope', potatoMint: MINT }), /Неизвестный пак/);
  assert.throws(() => planDelivery({ orderId: 1n, payerWallet: 'не-base58', packId: PACKS[0].id, potatoMint: MINT }), /base58/);
});
