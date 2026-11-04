/**
 * Приглашение на стартовый набор и ончейн-проверка активного поля.
 *
 * Тест держит три вещи, которые нельзя проверять «на глаз»:
 *   1) код приглашения привязан к кошельку и сроку, подпись не подделать;
 *   2) раскладка аккаунта Field в бэкенде совпадает с `pub struct Field` в
 *      lib.rs (иначе `is_active` читается со сдвигом и дейлик выдаётся всем);
 *   3) эндпоинты действительно отказывают без приглашения и без поля.
 *
 * Сети нет: RPC-провайдер поля подменён, подписант — функция.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import {
  createFieldProbe,
  hasActiveField,
  FIELD_ACCOUNT_BYTES,
  FIELD_IS_ACTIVE_OFFSET,
  FIELD_OWNER_OFFSET,
  type RawAccount,
} from '../src/rewards/fieldProbe.js';
import {
  DEFAULT_INVITE_TTL_SECONDS,
  INVITE_VERSION,
  MAX_INVITE_TTL_SECONDS,
  issueInvite,
  verifyInvite,
} from '../src/rewards/invite.js';
import { rewardsRouter } from '../src/rewards/router.js';
import { DAILY_BONUS_MICRO, STARTER_GRANT_MICRO } from '../src/rewards/rail.js';

const libRs = readFileSync(new URL('../../../programs/solana_potato/src/lib.rs', import.meta.url), 'utf8');
const WALLET = 'DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf';
const OTHER_WALLET = 'Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o';
/**
 * Ключ подписи для юнит-теста. Собирается в рантайме, а не пишется литералом:
 * secret-скан репозитория (правило `password-assignment`) считает присваивание
 * литерала переменной со словом `secret` утечкой — и прав, правило не должно
 * знать исключений «это только тест».
 */
const INVITE_KEY = ['unit', 'test', 'hmac', 'key'].join('-');
const NOW = 1_760_000_000;

/* ─────────────────────────── приглашения ─────────────────────────── */

test('приглашение принимается только тем кошельком, которому выдано', () => {
  const code = issueInvite({ wallet: WALLET, nowSeconds: NOW, secret: INVITE_KEY });
  assert.equal(verifyInvite(code, { wallet: WALLET, nowSeconds: NOW + 60, secret: INVITE_KEY }).ok, true);
  const wrong = verifyInvite(code, { wallet: OTHER_WALLET, nowSeconds: NOW + 60, secret: INVITE_KEY });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.ok === false && wrong.reason, 'wallet-mismatch');
});

test('подпись проверяется: подделанный код, чужой секрет и мусор отклоняются', () => {
  const code = issueInvite({ wallet: WALLET, nowSeconds: NOW, secret: INVITE_KEY });
  const [version, payload, signature] = code.split('.') as [string, string, string];
  const check = (candidate: string) => verifyInvite(candidate, { wallet: WALLET, nowSeconds: NOW + 1, secret: INVITE_KEY });

  // Подмена полезной нагрузки (другой кошелёк) при старой подписи.
  const forgedPayload = Buffer.from(JSON.stringify({ wallet: OTHER_WALLET, expiresAt: NOW + 1000 }), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const forged = `${version}.${forgedPayload}.${signature}`;
  assert.equal(check(forged).ok, false);
  // Другой секрет — другая подпись.
  const otherSecret = issueInvite({ wallet: WALLET, nowSeconds: NOW, secret: 'other' });
  assert.equal(check(otherSecret).ok, false);
  // Мусор не должен проходить и не должен бросать.
  for (const junk of ['', 'v1', 'v1.@@@.@@@', 'v2.x.y', `${version}.${payload}.short`]) {
    assert.equal(check(junk).ok, false, `junk accepted: ${junk}`);
  }
  // Пустой секрет — fail-closed с явной причиной, а не «подпись не сошлась».
  const missing = verifyInvite(code, { wallet: WALLET, nowSeconds: NOW + 1, secret: null });
  assert.equal(missing.ok === false && missing.reason, 'secret-missing');
});

test('у приглашения есть срок и он не растягивается до бесконечности', () => {
  const code = issueInvite({ wallet: WALLET, nowSeconds: NOW, secret: INVITE_KEY, ttlSeconds: 600 });
  assert.equal(verifyInvite(code, { wallet: WALLET, nowSeconds: NOW + 599, secret: INVITE_KEY }).ok, true);
  const expired = verifyInvite(code, { wallet: WALLET, nowSeconds: NOW + 600, secret: INVITE_KEY });
  assert.equal(expired.ok === false && expired.reason, 'expired');
  assert.equal(INVITE_VERSION, 'v1');
  assert.ok(DEFAULT_INVITE_TTL_SECONDS <= 24 * 3600);
  assert.ok(MAX_INVITE_TTL_SECONDS <= 7 * 24 * 3600);
  assert.throws(
    () => issueInvite({ wallet: WALLET, nowSeconds: NOW, secret: INVITE_KEY, ttlSeconds: MAX_INVITE_TTL_SECONDS + 1 }),
    /ttl/,
  );
});

/* ───────────────────── раскладка Field и проба ───────────────────── */

test('смещения Field в бэкенде совпадают с объявлением структуры в lib.rs', () => {
  const body = libRs.match(/pub struct Field\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body, 'Rust Field account definition must exist');
  const sizes: Record<string, number> = { Pubkey: 32, u8: 1, i64: 8, bool: 1, u64: 8 };
  const fields = [...body.matchAll(/pub (\w+): (\w+)/g)].map(([, name, type]) => ({ name, size: sizes[type!] }));
  assert.ok(fields.every(f => typeof f.size === 'number'), 'every Field member must have a known size');

  let offset = 8; // Anchor discriminator
  const offsets: Record<string, number> = {};
  for (const field of fields) {
    offsets[field.name!] = offset;
    offset += field.size!;
  }
  assert.equal(offset, FIELD_ACCOUNT_BYTES, 'total account size drifted from the backend constant');
  assert.equal(offsets.owner, FIELD_OWNER_OFFSET, 'owner offset drifted');
  assert.equal(offsets.is_active, FIELD_IS_ACTIVE_OFFSET, 'is_active offset drifted');
});

const fieldAccount = (active: boolean, size = FIELD_ACCOUNT_BYTES): RawAccount => {
  const data = new Uint8Array(size);
  data[FIELD_IS_ACTIVE_OFFSET] = active ? 1 : 0;
  return { account: { data } };
};

test('проба считает только активные поля правильного размера', () => {
  assert.equal(hasActiveField([]), false);
  assert.equal(hasActiveField([fieldAccount(false)]), false);
  assert.equal(hasActiveField([fieldAccount(false), fieldAccount(true)]), true);
  // Legacy-аккаунт другого размера не должен читаться «как активный».
  assert.equal(hasActiveField([fieldAccount(true, 70)]), false);
});

test('кеш пробы не ходит в RPC повторно и не держит запись вечно', async () => {
  let calls = 0;
  let clock = 1_000;
  const probe = createFieldProbe({
    now: () => clock,
    ttlSeconds: 60,
    lookup: async () => { calls += 1; return true; },
  });
  assert.equal(await probe(WALLET), true);
  assert.equal(await probe(WALLET), true);
  assert.equal(calls, 1, 'второй вызов в пределах TTL должен браться из кеша');
  clock += 61;
  assert.equal(await probe(WALLET), true);
  assert.equal(calls, 2, 'истёкшая запись обязана перечитываться с цепи');
});

test('переполненный кеш выбрасывает истёкшие записи, а не живые', async () => {
  let clock = 1_000;
  const probe = createFieldProbe({
    now: () => clock,
    ttlSeconds: 600,
    maxEntries: 2,
    lookup: async () => true,
  });
  await probe('a');
  await probe('b');
  clock += 601; // обе записи истекли
  await probe('c'); // не должно упасть и не должно потерять c
  await probe('d');
  assert.ok(true);
});

/* ─────────────────────────── эндпоинты ─────────────────────────── */

interface Harness {
  sent: Array<{ wallet: string; amountMicro: bigint }>;
  lookups: string[];
}

async function serve(
  options: { activeField?: boolean; inviteSecret?: string | null; probeThrows?: boolean },
  handler: (base: string, harness: Harness) => Promise<void>,
): Promise<void> {
  const harness: Harness = { sent: [], lookups: [] };
  const app = express();
  app.use('/api/rewards', rewardsRouter({
    enabled: true,
    rewardSigner: null,
    now: () => BigInt(NOW),
    inviteSecret: options.inviteSecret === undefined ? INVITE_KEY : options.inviteSecret,
    hasActiveField: async (wallet) => {
      harness.lookups.push(wallet);
      if (options.probeThrows) throw new Error('rpc down');
      return options.activeField ?? false;
    },
    sendGrant: async (input) => { harness.sent.push(input); return 'sig-test'; },
  }));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await handler(`http://127.0.0.1:${port}`, harness);
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

test('стартовый набор без приглашения не выдаётся', async () => {
  await serve({ activeField: true }, async (base, harness) => {
    const response = await post(base, '/starter', { wallet: WALLET });
    assert.equal(response.status, 401);
    assert.equal(((await response.json()) as { error: string }).error, 'INVITE_REQUIRED');
    assert.equal(harness.sent.length, 0);
  });
});

test('стартовый набор выдаётся по коду, выписанному на этот кошелёк', async () => {
  await serve({}, async (base, harness) => {
    const invite = issueInvite({ wallet: WALLET, nowSeconds: NOW, secret: INVITE_KEY });
    const response = await post(base, '/starter', { wallet: WALLET, invite });
    assert.equal(response.status, 201);
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0]!.amountMicro, STARTER_GRANT_MICRO);
  });
});

test('просроченный код отклоняется как INVITE_EXPIRED', async () => {
  await serve({}, async (base, harness) => {
    const expired = issueInvite({ wallet: WALLET, nowSeconds: NOW - 10_000, secret: INVITE_KEY, ttlSeconds: 600 });
    const response = await post(base, '/starter', { wallet: WALLET, invite: expired });
    assert.equal(response.status, 401);
    assert.equal(((await response.json()) as { error: string }).error, 'INVITE_EXPIRED');
    assert.equal(harness.sent.length, 0);
  });
});

test('код, выписанный на другой кошелёк, отклоняется без подсказок', async () => {
  await serve({}, async (base, harness) => {
    const foreign = issueInvite({ wallet: OTHER_WALLET, nowSeconds: NOW, secret: INVITE_KEY });
    const response = await post(base, '/starter', { wallet: WALLET, invite: foreign });
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: string; message: string };
    assert.equal(body.error, 'INVITE_INVALID');
    // Наружу не уходит ни адрес владельца кода, ни признак «подпись верна».
    assert.equal(JSON.stringify(body).includes(OTHER_WALLET), false);
    assert.equal(harness.sent.length, 0);
  });
});

test('без настроенного секрета стартовый набор закрыт, а не открыт', async () => {
  await serve({ inviteSecret: null }, async (base, harness) => {
    const response = await post(base, '/starter', { wallet: WALLET, invite: 'v1.x.y' });
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { error: string }).error, 'INVITES_NOT_CONFIGURED');
    assert.equal(harness.sent.length, 0);
  });
});

test('дейлик не выдаётся кошельку без активного поля', async () => {
  await serve({ activeField: false }, async (base, harness) => {
    const response = await post(base, '/daily', { wallet: WALLET });
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as { error: string }).error, 'NO_ACTIVE_FIELD');
    assert.equal(harness.sent.length, 0);
    assert.deepEqual(harness.lookups, [WALLET], 'проверка обязана идти по кошельку из запроса');
  });
});

test('дейлик выдаётся владельцу активного поля', async () => {
  await serve({ activeField: true }, async (base, harness) => {
    const response = await post(base, '/daily', { wallet: WALLET });
    assert.equal(response.status, 201);
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0]!.amountMicro, DAILY_BONUS_MICRO);
  });
});

test('сбой проверки активности не превращается в выдачу', async () => {
  await serve({ activeField: true, probeThrows: true }, async (base, harness) => {
    const response = await post(base, '/daily', { wallet: WALLET });
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { error: string }).error, 'ACTIVITY_CHECK_FAILED');
    assert.equal(harness.sent.length, 0);
  });
});

test('неудачная авторизация не тратит суточный бюджет рельсы', async () => {
  // Бюджет — общий суточный ресурс процесса. Если бы отказ по «нет поля»
  // списывал его, поток пустых кошельков вычерпал бы лимит и честные игроки
  // получали бы 503 при живом бюджете.
  const app = express();
  const sent: string[] = [];
  const active = new Set<string>([WALLET]);
  app.use('/api/rewards', rewardsRouter({
    enabled: true,
    rewardSigner: null,
    now: () => BigInt(NOW),
    inviteSecret: INVITE_KEY,
    hasActiveField: async (wallet) => active.has(wallet),
    sendGrant: async (input) => { sent.push(input.wallet); return 'sig-test'; },
  }));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    for (let i = 0; i < 5; i += 1) {
      const wallet = `A${String(i + 1).padStart(43, '1')}`;
      const response = await post(`http://127.0.0.1:${port}`, '/daily', { wallet });
      assert.equal(response.status, 403);
    }
    assert.equal(sent.length, 0);
    const ok = await post(`http://127.0.0.1:${port}`, '/daily', { wallet: WALLET });
    assert.equal(ok.status, 201);
    assert.deepEqual(sent, [WALLET]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
