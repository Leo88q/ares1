/**
 * Рельса стартового набора и дейлика: лимиты, nonce и поведение эндпоинтов.
 *
 * Тест не ходит в сеть: подписант подменён функцией, эндпоинты поднимаются на
 * 127.0.0.1 со случайным портом (как /health), а константы сверяются с
 * исходником программы, чтобы зеркала не разъехались молча.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import {
  BASE_FIELD_PRICE_MICRO,
  DAILY_BONUS_MICRO,
  GRANT_AMOUNTS_MICRO,
  MAX_REWARD_MICRO,
  STARTER_DAILY_BUDGET_MICRO,
  STARTER_GRANT_MICRO,
  budgetFitsGrantQuota,
  chargeBudget,
  grantExpiry,
  refundBudget,
  grantNonce,
  isWalletAddress,
  utcDay,
} from '../src/rewards/rail.js';
import { rewardsRouter } from '../src/rewards/router.js';
import { assertRewardInstructionsAllowed, assertDedicatedRewardSigner } from '../src/rewards/policy.js';
import { anchorDiscriminator } from '../src/anchorRaw.js';

const libRs = readFileSync(new URL('../../../programs/solana_potato/src/lib.rs', import.meta.url), 'utf8');

function rustConst(name: string): bigint {
  const match = libRs.match(new RegExp(`pub const ${name}: u64 = ([\\d_]+);`));
  assert.ok(match, `Rust const ${name} must exist`);
  return BigInt(match[1]!.replaceAll('_', ''));
}

const WALLET = 'DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf';
const WALLET_B = 'Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o';

test('суммы грантов не выходят за ончейн-потолок и стартер равен цене поля', () => {
  assert.equal(MAX_REWARD_MICRO, rustConst('MAX_REWARD_MICRO'));
  assert.equal(BASE_FIELD_PRICE_MICRO, rustConst('BASE_FIELD_PRICE_MICRO'));
  assert.equal(STARTER_GRANT_MICRO, BASE_FIELD_PRICE_MICRO);
  assert.ok(STARTER_GRANT_MICRO <= MAX_REWARD_MICRO);
  assert.ok(DAILY_BONUS_MICRO < STARTER_GRANT_MICRO, 'дейлик не должен быть щедрее входа');
  // Стартовый набор = ровно одно поле типа 1, без POTATO сверху.
  assert.equal(STARTER_GRANT_MICRO, 250_000_000n);
  assert.equal(DAILY_BONUS_MICRO, 7_000_000n);
});

test('nonce детерминирован, уникален для кошелька и меняется по суткам', () => {
  const now = 1_760_000_000n;
  const a1 = grantNonce('starter', WALLET, now);
  const a2 = grantNonce('starter', WALLET, now + 5_000n);
  assert.equal(a1, a2, 'стартер не должен зависеть от времени: повтор упадёт на PDA');

  const b = grantNonce('starter', WALLET_B, now);
  assert.notEqual(a1, b, 'разные кошельки — разные PDA');

  const day1 = grantNonce('daily', WALLET, now);
  const day2 = grantNonce('daily', WALLET, now + 86_400n);
  assert.notEqual(day1, day2, 'новые UTC-сутки — новый nonce');
  assert.notEqual(day1, grantNonce('daily', WALLET_B, now));

  // Домены разделены: стартер и дейлик не делят один PDA.
  assert.notEqual(grantNonce('starter', WALLET, now), day1);
  for (const nonce of [a1, b, day1, day2]) assert.ok(nonce > 0n && nonce < 2n ** 64n);
});

test('utcDay меняется ровно на границе суток', () => {
  assert.equal(utcDay(0n), 0n);
  assert.equal(utcDay(86_399n), 0n);
  assert.equal(utcDay(86_400n), 1n);
});

test('дедлайн подписи короче ончейн-окна клейма', () => {
  const now = 1_760_000_000n;
  assert.ok(grantExpiry(now) > now);
  assert.ok(grantExpiry(now) - now <= 900n);
});

test('кошелёк валидируется как base58 до любого RPC', () => {
  assert.equal(isWalletAddress(WALLET), true);
  assert.equal(isWalletAddress(''), false);
  assert.equal(isWalletAddress('not-a-wallet'), false);
  assert.equal(isWalletAddress('0OIl' + 'a'.repeat(40)), false);
});

test('мягкий бюджет: копится за сутки, сбрасывается на новых и не превышается', () => {
  let state = { day: -1n, spentMicro: 0n };
  const now = 1_760_000_000n;
  let grants = 0;
  while (true) {
    const result = chargeBudget(state, 'starter', now);
    if (!result.ok) break;
    state = result.state;
    grants += 1;
  }
  assert.equal(grants, Number(STARTER_DAILY_BUDGET_MICRO / STARTER_GRANT_MICRO));
  assert.equal(state.spentMicro, STARTER_DAILY_BUDGET_MICRO);

  const nextDay = chargeBudget(state, 'starter', now + 86_400n);
  assert.equal(nextDay.ok, true);
  assert.equal(nextDay.state.spentMicro, STARTER_GRANT_MICRO);
});

test('суммарный бюджет рельсы укладывается в ончейн-квоту грантов', () => {
  // lib.rs:66 — кап эпохи; lib.rs:78 — доля ручных грантов.
  const cap = rustConst('MAX_DAILY_CAP_MICRO');
  const share = rustConst('GRANT_QUOTA_SHARE_BPS');
  assert.equal(share, 2_500n);
  assert.equal(budgetFitsGrantQuota(cap, share), true);
  assert.equal(budgetFitsGrantQuota(1_000_000n, share), false);
});

test('политика ключа: только grant_reward_once и идемпотентная ATA', () => {
  const game = PublicKey.unique();
  const grantIx = new TransactionInstruction({
    programId: game,
    keys: [],
    data: Buffer.concat([anchorDiscriminator('global', 'grant_reward_once'), Buffer.alloc(24)]),
  });
  // P1-1: легаси-`grant_reward` удалён из программы 2026-11-03; политика
  // обязана отклонить её дискриминатор, даже если кто-то соберёт его вручную
  // из старого клиента — allowlist состоит ровно из одной инструкции.
  const legacyGrantIx = new TransactionInstruction({
    programId: game,
    keys: [],
    data: Buffer.concat([anchorDiscriminator('global', 'grant_reward'), Buffer.alloc(8)]),
  });
  const rollIx = new TransactionInstruction({
    programId: game,
    keys: [],
    data: anchorDiscriminator('global', 'roll_epoch'),
  });
  const ataProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  const ataOk = new TransactionInstruction({ programId: ataProgram, keys: [], data: Buffer.from([1]) });
  const ataCreate = new TransactionInstruction({ programId: ataProgram, keys: [], data: Buffer.from([0]) });
  const transfer = new TransactionInstruction({
    programId: SystemProgram.programId,
    keys: [],
    data: Buffer.from([2, 0, 0, 0]),
  });

  assert.doesNotThrow(() => assertRewardInstructionsAllowed([ataOk, grantIx], game));
  assert.throws(() => assertRewardInstructionsAllowed([legacyGrantIx], game), /REWARD_POLICY/);
  assert.throws(() => assertRewardInstructionsAllowed([rollIx], game), /REWARD_POLICY/);
  assert.throws(() => assertRewardInstructionsAllowed([ataCreate], game), /REWARD_POLICY/);
  assert.throws(() => assertRewardInstructionsAllowed([transfer], game), /REWARD_POLICY/);
  assert.throws(() => assertRewardInstructionsAllowed([], game), /REWARD_POLICY/);
});

test('ключ рельсы обязан быть отдельным reward_signer', () => {
  const authority = PublicKey.unique();
  const payer = PublicKey.unique();
  const signer = PublicKey.unique();
  const config = { authority, rewardSigner: signer };
  assert.doesNotThrow(() => assertDedicatedRewardSigner(signer, config, payer));
  assert.throws(() => assertDedicatedRewardSigner(authority, config, payer), /authority/);
  assert.throws(() => assertDedicatedRewardSigner(payer, { authority, rewardSigner: payer }, payer), /dedicated/);
  assert.throws(() => assertDedicatedRewardSigner(PublicKey.unique(), config, payer), /on-chain reward_signer/);
});

interface Harness {
  sent: Array<{ wallet: string; amountMicro: bigint; nonce: bigint; expiresAt: bigint }>;
}

async function serve(
  options: { enabled: boolean; now?: () => bigint; fail?: Error },
  handler: (base: string, harness: Harness) => Promise<void>,
): Promise<void> {
  const sent: Harness['sent'] = [];
  const app = express();
  app.use(express.json());
  app.use('/api/rewards', rewardsRouter({
    enabled: options.enabled,
    disabledReason: 'test gate',
    rewardSigner: null,
    now: options.now ?? (() => 1_760_000_000n),
    sendGrant: async (input) => {
      if (options.fail) throw options.fail;
      sent.push(input);
      return 'sig-test';
    },
  }));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await handler(`http://127.0.0.1:${port}`, { sent });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const post = (base: string, path: string, body: unknown): Promise<Response> =>
  fetch(`${base}/api/rewards${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('/status объясняет состояние рельсы и не отдаёт секретов', async () => {
  await serve({ enabled: false }, async (base) => {
    const body = (await (await fetch(`${base}/api/rewards/status`)).json()) as Record<string, any>;
    assert.equal(body.enabled, false);
    assert.equal(body.reason, 'test gate');
    assert.equal(body.rewardSigner, null);
    assert.equal(body.starter.amountMicro, String(STARTER_GRANT_MICRO));
    assert.equal(body.daily.amountMicro, String(DAILY_BONUS_MICRO));
    assert.equal(JSON.stringify(body).includes('secret'), false);
  });
});

test('выключенная рельса отвечает 503 и ничего не отправляет', async () => {
  await serve({ enabled: false }, async (base, harness) => {
    const response = await post(base, '/starter', { wallet: WALLET });
    assert.equal(response.status, 503);
    assert.equal(harness.sent.length, 0);
  });
});

test('невалидный кошелёк отклоняется до подписи', async () => {
  await serve({ enabled: true }, async (base, harness) => {
    const response = await post(base, '/starter', { wallet: 'nope' });
    assert.equal(response.status, 400);
    assert.equal(harness.sent.length, 0);
  });
});

test('стартовый набор уходит одним грантом с детерминированным nonce', async () => {
  await serve({ enabled: true }, async (base, harness) => {
    const response = await post(base, '/starter', { wallet: WALLET });
    assert.equal(response.status, 201);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.kind, 'starter');
    assert.equal(body.signature, 'sig-test');
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0]!.amountMicro, STARTER_GRANT_MICRO);
    assert.equal(harness.sent[0]!.nonce, grantNonce('starter', WALLET, 1_760_000_000n));
    assert.ok(harness.sent[0]!.expiresAt > 1_760_000_000n);
  });
});

test('повторный запрос от того же кошелька попадает под кулдаун', async () => {
  await serve({ enabled: true }, async (base) => {
    assert.equal((await post(base, '/daily', { wallet: WALLET })).status, 201);
    assert.equal((await post(base, '/daily', { wallet: WALLET })).status, 429);
  });
});

test('ошибка подписанта не превращается в 200', async () => {
  await serve({ enabled: true, fail: new Error('simulation failed') }, async (base) => {
    const response = await post(base, '/daily', { wallet: WALLET });
    assert.equal(response.status, 502);
  });
});

test('уже выданный грант отдаётся как 409, а не как сбой', async () => {
  await serve({ enabled: true, fail: new Error('Allocate: account Address already in use') }, async (base) => {
    const response = await post(base, '/starter', { wallet: WALLET });
    assert.equal(response.status, 409);
  });
});

test('суточный бюджет рельсы ограничивает выдачу', async () => {
  const now = 1_760_000_000n;
  await serve({ enabled: true, now: () => now }, async (base) => {
    let granted = 0;
    let lastStatus = 0;
    // Кошельки разные, поэтому кулдаун не мешает; сутки не меняются, поэтому
    // бюджет не сбрасывается.
    for (let i = 0; i < 200; i += 1) {
      lastStatus = (await post(base, '/starter', { wallet: KeypairWallet(i) })).status;
      if (lastStatus !== 201) break;
      granted += 1;
    }
    assert.equal(granted, Number(STARTER_DAILY_BUDGET_MICRO / STARTER_GRANT_MICRO));
    assert.equal(lastStatus, 503, 'после выбранного бюджета рельса обязана закрыться');
  });
});

/** Валидный base58-адрес нужной формы без обращения к web3.js Keypair. */
function KeypairWallet(index: number): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = index;
  const tail = Array.from({ length: 6 }, () => {
    const char = alphabet[value % alphabet.length]!;
    value = Math.floor(value / alphabet.length);
    return char;
  }).join('');
  return `11111111111111111111111111111111${tail}`.slice(-44);
}

test('GRANT_AMOUNTS_MICRO совпадает с суммами эндпоинтов', () => {
  assert.deepEqual(GRANT_AMOUNTS_MICRO, { starter: STARTER_GRANT_MICRO, daily: DAILY_BONUS_MICRO });
});

test('дедлайн подписи не выходит за ончейн-окно клейма', () => {
  const now = 1_800_000_000n;
  const expiry = grantExpiry(now);
  assert.equal(expiry, now + 300n);
  // Даже если окно поднимут выше 900 с, подпись обязана остаться внутри лимита
  // программы (grant_reward_once отвергает более дальний expires_at).
  assert.ok(grantExpiry(now) - now <= 900n);
});

test('списание бюджета откатывается при неудачной отправке, но не после смены суток', () => {
  const now = 1_800_000_000n;
  const charged = chargeBudget({ day: -1n, spentMicro: 0n }, 'starter', now);
  assert.equal(charged.ok, true);
  const refunded = refundBudget(charged.state, 'starter', now);
  assert.equal(refunded.spentMicro, 0n);
  // Следующие сутки — возвращать нечего: счётчик уже новый.
  const nextDay = refundBudget(charged.state, 'starter', now + 86_400n);
  assert.equal(nextDay.spentMicro, charged.state.spentMicro);
  // Ниже нуля не уходим даже при двойном возврате.
  assert.equal(refundBudget(refunded, 'starter', now).spentMicro, 0n);
});

test('неудачная выдача не съедает суточный бюджет рельсы', async () => {
  // Подписант падает всегда: 80 запросов не должны исчерпать бюджет, иначе
  // честные игроки получат 503 при живом бюджете.
  const app = express();
  app.use('/api/rewards', rewardsRouter({
    enabled: true,
    rewardSigner: null,
    now: () => 1_800_000_000n,
    sendGrant: async () => { throw new Error('REWARD_RAIL: signer is not configured'); },
  }));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  try {
    const port = (server.address() as AddressInfo).port;
    let last: Response | null = null;
    for (let i = 0; i < 90; i += 1) {
      const wallet = `W${String(i).padStart(43, '1')}`.slice(0, 44);
      last = await fetch(`http://127.0.0.1:${port}/api/rewards/starter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet }),
      });
    }
    assert.equal(last?.status, 502, 'должны упираться в отказ отправки, а не в BUDGET_EXHAUSTED');
    const status = await fetch(`http://127.0.0.1:${port}/api/rewards/status`);
    assert.equal(status.status, 200);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('поток новых адресов не сбрасывает живой кулдаун: карта чистится только от истёкших', async () => {
  // P2-10: раньше при переполнении карты удалялся самый старый вставленный
  // ключ — поток запросов с новыми адресами обнулял чужой 15-секундный кулдаун.
  // base58 без 0/O/I/l: isWalletAddress пропускает только валидный base58.
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const walletAt = (i: number): string =>
    'W' + ALPHABET[i % 58] + ALPHABET[Math.floor(i / 58) % 58] + '1'.repeat(41);
  let now = 1_900_000_000n;
  const app = express();
  app.use('/api/rewards', rewardsRouter({
    enabled: true,
    rewardSigner: null,
    now: () => now,
    maxTrackedWallets: 2,
    sendGrant: async () => 'sig-test',
  }));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/rewards`;
  const ask = (wallet: string): Promise<Response> =>
    fetch(`${base}/starter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
  try {
    assert.equal((await ask(walletAt(0))).status, 201);
    assert.equal((await ask(walletAt(0))).status, 429, 'второй запрос того же кошелька — кулдаун');

    assert.equal((await ask(walletAt(1))).status, 201, 'второй адрес влезает');
    // Третий адрес переполняет карту: живые кулдауны вытеснять нельзя.
    const full = await ask(walletAt(2));
    assert.equal(full.status, 503);
    assert.equal(((await full.json()) as Record<string, unknown>).error, 'WALLET_LEDGER_FULL');
    // Главное: кулдаун первого кошелька не сброшен вытеснением.
    assert.equal((await ask(walletAt(0))).status, 429);

    // Через 15 с записи истекают и освобождаются, новый адрес снова влезает.
    now += 15n;
    assert.equal((await ask(walletAt(0))).status, 201, 'истёкший кулдаун отпускает кошелёк');
    assert.equal((await ask(walletAt(2))).status, 201, 'истёкшие записи освободили место');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
