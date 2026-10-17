import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { grantSlot, type GrantInput, type SlotAudit, type SlotServiceDeps } from '../src/slots/service.js';
import { publicKeyOf, signSlotRecord, verifySlotRecord, type SlotRecord } from '../src/slots/record.js';
import type { SlotPaymentSnapshot, TokenBalanceView } from '../src/slots/payment.js';
import type { NewGrant, NewIssuance, SlotStore, StoredGrant } from '../src/slots/store.js';
import { GameOpsError } from '../src/gameops/errors.js';

// Адреса и подписи — base58 без 0, O, I, l (иначе валидатор отказывает).
const MINT = 'SKRmint1111111111111111111111111111111111';
const TREASURY = 'Treasury11111111111111111111111111111111111';
const W1 = '2'.repeat(44);
const W2 = '3'.repeat(44);
const SIG_A = '4'.repeat(87) + 'a';
const SIG_B = '4'.repeat(87) + 'b';
const SIG_C = '4'.repeat(87) + 'c';
const PRICE = 500_000_000n;
const NOW = 1_800_000_000;

const { privateKey: priv } = generateKeyPairSync('ed25519');
const KEYRING = new Map([['k1', publicKeyOf(priv)]]);

const bal = (accountIndex: number, mint: string, owner: string | null, amount: bigint): TokenBalanceView =>
  ({ accountIndex, mint, owner, amount });

/** Успешный платёж W1 → казначейство, finalized, свежий блок. */
function payment(payer: string, overrides: Partial<SlotPaymentSnapshot> = {}): SlotPaymentSnapshot {
  return {
    signature: 'sig',
    err: null,
    blockTime: BigInt(NOW - 60),
    confirmation: 'finalized',
    preTokenBalances: [bal(1, MINT, payer, 10n ** 12n), bal(2, MINT, TREASURY, 0n)],
    postTokenBalances: [bal(1, MINT, payer, 10n ** 12n - PRICE), bal(2, MINT, TREASURY, PRICE)],
    ...overrides,
  };
}

/** In-memory хранилище с откатом транзакции; поведение уникальных индексов как в БД. */
function memStore() {
  let grants: StoredGrant[] = [];
  let issuances: (NewIssuance & { id: number })[] = [];
  const amounts = new Map<number, bigint>();
  let seq = 0;
  const store: SlotStore = {
    async findGrantBySlot(fieldId, slot) {
      return grants.find(g => g.field_id === fieldId && g.slot === slot) ?? null;
    },
    async findGrantByPayment(signature) {
      return grants.find(g => g.payment_signature === signature) ?? null;
    },
    async insertGrant(g: NewGrant) {
      if (grants.some(x => x.field_id === g.field_id && x.slot === g.slot)) {
        throw new GameOpsError('SLOT_TAKEN', 'slot taken', undefined, 409);
      }
      if (g.payment_signature && grants.some(x => x.payment_signature === g.payment_signature)) {
        throw new GameOpsError('PAYMENT_ALREADY_USED', 'payment used', undefined, 409);
      }
      const row: StoredGrant = { id: ++seq, field_id: g.field_id, slot: g.slot, wallet: g.wallet, payment_signature: g.payment_signature };
      grants.push(row);
      amounts.set(row.id, g.amount_units);
      return row;
    },
    async insertIssuance(i) {
      if (issuances.some(x => x.nonce === i.nonce)) throw new Error('nonce duplicate');
      issuances.push({ ...i, id: ++seq });
    },
  };
  return {
    store,
    grants: () => grants,
    issuances: () => issuances,
    amounts,
    async run<T>(fn: (s: SlotStore) => Promise<T>): Promise<T> {
      const snapG = grants.map(g => ({ ...g }));
      const snapI = issuances.slice();
      try {
        return await fn(store);
      } catch (error) {
        grants = snapG;
        issuances = snapI;
        throw error;
      }
    },
  };
}

function setup(opts: { payments?: Record<string, SlotPaymentSnapshot | null>; now?: number } = {}) {
  const db = memStore();
  const audits: SlotAudit[] = [];
  const fetched: string[] = [];
  const payments = opts.payments ?? {};
  const deps: SlotServiceDeps = {
    runInTransaction: fn => db.run(fn),
    fetchPayment: async sig => {
      fetched.push(sig);
      return payments[sig] ?? null;
    },
    sign: r => signSlotRecord(r, priv),
    keyId: 'k1',
    skrMint: MINT,
    treasuryOwner: TREASURY,
    priceUnits: PRICE,
    now: () => opts.now ?? NOW,
    randomNonce: () => randomUUID(),
    audit: async e => { audits.push(e); },
  };
  return { db, audits, fetched, deps };
}

const free = (over: Partial<GrantInput> = {}): GrantInput => ({ field_id: 'F1', slot: 1, wallet: W1, payment_signature: null, ...over });
const paid = (over: Partial<GrantInput> = {}): GrantInput => ({ field_id: 'F1', slot: 7, wallet: W1, payment_signature: SIG_A, ...over });

test('free slot: first claim wins and gets a verifiable signed record', async () => {
  const s = setup();
  const out = await grantSlot(free(), s.deps);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.issued.reissued, false);
  assert.equal(out.issued.record.payment_signature, null);
  assert.equal(out.issued.record.expires_at - out.issued.record.issued_at, 3600);
  assert.deepEqual(verifySlotRecord(out.issued.record, out.issued.signature, KEYRING, NOW + 1), { ok: true });
  assert.equal(s.db.issuances().length, 1);
  assert.equal(s.fetched.length, 0, 'free slot never touches the chain');
});

test('free slot: another wallet is refused with SLOT_TAKEN', async () => {
  const s = setup();
  await grantSlot(free(), s.deps);
  const out = await grantSlot(free({ wallet: W2 }), s.deps);
  assert.deepEqual(out, { ok: false, status: 409, code: 'SLOT_TAKEN' });
});

test('free slot: same owner asks again → reissue with a fresh nonce, same grant row', async () => {
  const s = setup();
  const first = await grantSlot(free(), s.deps);
  const again = await grantSlot(free(), s.deps);
  assert.ok(first.ok && again.ok);
  if (!first.ok || !again.ok) return;
  assert.equal(again.issued.reissued, true);
  assert.notEqual(again.issued.record.nonce, first.issued.record.nonce);
  assert.equal(s.db.grants().length, 1);
  assert.equal(s.db.issuances().length, 2);
});

test('free slot with a payment signature is rejected before any work', async () => {
  const s = setup();
  const out = await grantSlot(free({ payment_signature: SIG_A }), s.deps);
  assert.deepEqual(out, { ok: false, status: 400, code: 'PAYMENT_NOT_ALLOWED' });
  assert.equal(s.fetched.length, 0);
});

test('paid slot without a payment signature is rejected', async () => {
  const s = setup();
  const out = await grantSlot(paid({ payment_signature: null }), s.deps);
  assert.deepEqual(out, { ok: false, status: 400, code: 'PAYMENT_REQUIRED' });
});

test('bad field, slot range and wallet are rejected before the chain is read', async () => {
  const s = setup();
  assert.equal((await grantSlot(free({ field_id: '../x' }), s.deps)).ok, false);
  assert.deepEqual(await grantSlot(free({ slot: 0 }), s.deps), { ok: false, status: 400, code: 'BAD_SLOT' });
  assert.deepEqual(await grantSlot(paid({ slot: 13 }), s.deps), { ok: false, status: 400, code: 'BAD_SLOT' });
  assert.deepEqual(await grantSlot(free({ wallet: 'Oops0' }), s.deps), { ok: false, status: 400, code: 'BAD_WALLET' });
  assert.equal(s.fetched.length, 0);
});

test('paid slot: transaction not on chain → 402, nothing issued', async () => {
  const s = setup({ payments: {} });
  const out = await grantSlot(paid(), s.deps);
  assert.deepEqual(out, { ok: false, status: 402, code: 'PAYMENT_NOT_FOUND' });
  assert.equal(s.db.grants().length, 0);
});

test('paid slot: wrong amount is not credited (402 with the verifier code)', async () => {
  const s = setup({ payments: { [SIG_A]: payment(W1, { postTokenBalances: [bal(1, MINT, W1, 10n ** 12n - PRICE - 1n), bal(2, MINT, TREASURY, PRICE + 1n)] }) } });
  const out = await grantSlot(paid(), s.deps);
  assert.deepEqual(out, { ok: false, status: 402, code: 'PAYMENT_AMOUNT_NOT_EXACT' });
  assert.equal(s.db.grants().length, 0);
});

test('paid slot: valid payment → record bound to the payment, amount stored, verifiable', async () => {
  const s = setup({ payments: { [SIG_A]: payment(W1) } });
  const out = await grantSlot(paid(), s.deps);
  assert.ok(out.ok);
  if (!out.ok) return;
  const rec: SlotRecord = out.issued.record;
  assert.equal(rec.payment_signature, SIG_A);
  assert.equal(rec.slot, 7);
  assert.equal(s.db.amounts.get(out.issued.grant_id), PRICE);
  assert.deepEqual(verifySlotRecord(rec, out.issued.signature, KEYRING, NOW + 1), { ok: true });
});

test('paid slot: a payment already used for another slot is refused without a chain read', async () => {
  const s = setup({ payments: { [SIG_A]: payment(W1) } });
  await grantSlot(paid(), s.deps);
  s.fetched.length = 0;
  const out = await grantSlot(paid({ slot: 8 }), s.deps);
  assert.deepEqual(out, { ok: false, status: 409, code: 'PAYMENT_ALREADY_USED' });
  assert.equal(s.fetched.length, 0);
});

test('paid slot: same payer and slot again → reissue of the same grant (S7 retry rule)', async () => {
  const s = setup({ payments: { [SIG_A]: payment(W1) } });
  const first = await grantSlot(paid(), s.deps);
  const again = await grantSlot(paid(), s.deps);
  assert.ok(first.ok && again.ok);
  if (!first.ok || !again.ok) return;
  assert.equal(again.issued.reissued, true);
  assert.equal(again.issued.grant_id, first.issued.grant_id);
  assert.equal(s.db.grants().length, 1);
});

test('paid slot: valid payment but slot already owned → 409, no record, review queued in audit', async () => {
  const s = setup({ payments: { [SIG_B]: payment(W2) } });
  // Владелец слота 7 уже есть (платёж SIG_A).
  s.db.grants().push({ id: 99, field_id: 'F1', slot: 7, wallet: W1, payment_signature: SIG_A });
  const out = await grantSlot(paid({ wallet: W2, payment_signature: SIG_B }), s.deps);
  assert.deepEqual(out, { ok: false, status: 409, code: 'SLOT_TAKEN' });
  assert.equal(s.db.issuances().length, 0);
  assert.ok(s.audits.some(a => a.action === 'slot.payment.review' && a.detail.reason === 'SLOT_TAKEN_AFTER_VALID_PAYMENT'));
});

test('paid slot: a race lost at insert (unique index) is reported as SLOT_TAKEN', async () => {
  const s = setup({ payments: { [SIG_C]: payment(W2) } });
  // Чтение внутри транзакции не видит занятости, а вставка — видит (гонка).
  const realRun = s.deps.runInTransaction;
  s.deps.runInTransaction = fn => realRun(async store => fn({
    ...store,
    findGrantBySlot: async () => null,
    insertGrant: async () => { throw new GameOpsError('SLOT_TAKEN', 'slot taken', undefined, 409); },
  }));
  const out = await grantSlot(paid({ wallet: W2, payment_signature: SIG_C }), s.deps);
  assert.deepEqual(out, { ok: false, status: 409, code: 'SLOT_TAKEN' });
});

test('stale payment (older than the one-hour window) is refused', async () => {
  const s = setup({ payments: { [SIG_A]: payment(W1, { blockTime: BigInt(NOW - 7200) }) } });
  const out = await grantSlot(paid(), s.deps);
  assert.deepEqual(out, { ok: false, status: 402, code: 'PAYMENT_BLOCK_TOO_OLD' });
});

test('unexpected storage failure → 500 INTERNAL, no partial grant left behind', async () => {
  const s = setup();
  s.deps.runInTransaction = async fn => {
    const snap = s.db.grants().length;
    try {
      return await fn({ ...s.db.store, insertIssuance: async () => { throw new Error('boom'); } });
    } catch (e) {
      s.db.grants().length = snap;
      throw e;
    }
  };
  const out = await grantSlot(free(), s.deps);
  assert.deepEqual(out, { ok: false, status: 500, code: 'INTERNAL' });
  assert.equal(s.db.grants().length, 0);
});
