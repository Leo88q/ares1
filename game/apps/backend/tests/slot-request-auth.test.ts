import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { requestAuthMessage, verifyRequestAuth, type SlotRequestFields } from '../src/slots/requestAuth.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const WALLET = new PublicKey(raw).toBase58();
const OTHER = generateKeyPairSync('ed25519').privateKey;
const NOW = 1_800_000_000;

const fields = (over: Partial<SlotRequestFields> = {}): SlotRequestFields =>
  ({ field_id: 'F1', slot: 1, wallet: WALLET, payment_signature: null, ...over });

const signB64 = (f: SlotRequestFields, ts: number, key = privateKey) =>
  sign(null, requestAuthMessage(f, ts), key).toString('base64');

test('request auth: the wallet owner signs the exact request → ok', () => {
  const f = fields();
  assert.deepEqual(verifyRequestAuth(f, NOW, signB64(f, NOW), NOW), { ok: true });
});

test('request auth: signature changes if the slot or the payment is changed (no replay onto another request)', () => {
  const f = fields();
  const sig = signB64(f, NOW);
  assert.deepEqual(verifyRequestAuth(fields({ slot: 2 }), NOW, sig, NOW), { ok: false, code: 'AUTH_BAD_SIGNATURE' });
  assert.deepEqual(verifyRequestAuth(fields({ payment_signature: '4'.repeat(88) }), NOW, sig, NOW), { ok: false, code: 'AUTH_BAD_SIGNATURE' });
});

test('request auth: signed by another key → refused', () => {
  const f = fields();
  assert.deepEqual(verifyRequestAuth(f, NOW, signB64(f, NOW, OTHER), NOW), { ok: false, code: 'AUTH_BAD_SIGNATURE' });
});

test('request auth: outside the ±300 s window → stale', () => {
  const f = fields();
  assert.deepEqual(verifyRequestAuth(f, NOW - 301, signB64(f, NOW - 301), NOW), { ok: false, code: 'AUTH_STALE' });
  assert.deepEqual(verifyRequestAuth(f, NOW + 300, signB64(f, NOW + 300), NOW), { ok: true });
});

test('request auth: not a wallet address → refused', () => {
  const f = fields({ wallet: 'not-a-wallet' });
  assert.deepEqual(verifyRequestAuth(f, NOW, 'AAAA', NOW), { ok: false, code: 'AUTH_BAD_WALLET' });
});
