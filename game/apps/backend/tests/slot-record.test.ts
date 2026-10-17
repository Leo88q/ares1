import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  canonicalJson,
  loadSigningKey,
  publicKeyOf,
  signingMessage,
  signSlotRecord,
  validateSlotRecord,
  verifySlotRecord,
  type SlotRecord,
} from '../src/slots/record.js';

const NOW = 1_800_000_000;
const WALLET = 'Rg5vQ7kPzN2sXm8TdLw4BcYe9HnFaUjWtRa3Ez6Cy1Mb';
const SIG = '5'.repeat(88);
const NONCE = '123e4567-e89b-42d3-a456-426614174000';

const { privateKey: oldPriv, publicKey: oldPub } = generateKeyPairSync('ed25519');
const { privateKey: newPriv, publicKey: newPub } = generateKeyPairSync('ed25519');

const keyring = new Map([
  ['k-old', publicKeyOf(oldPriv)],
  ['k-new', publicKeyOf(newPriv)],
]);

const base = (over: Partial<SlotRecord> = {}): SlotRecord => ({
  v: 1,
  field_id: 'F1',
  slot: 1,
  wallet: WALLET,
  nonce: NONCE,
  issued_at: NOW,
  expires_at: NOW + 1800,
  payment_signature: null,
  key_id: 'k-new',
  ...over,
});
const paid = (over: Partial<SlotRecord> = {}): SlotRecord =>
  base({ slot: 7, payment_signature: SIG, ...over });

test('slot record: canonical JSON ignores key order and undefined fields', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 0 }] } }), canonicalJson({ a: { c: [3, { y: 0, z: 1 }], d: 2 }, b: 1 }));
  assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
});

test('slot record: sign and verify round-trip with the current key', () => {
  const r = base();
  const sig = signSlotRecord(r, newPriv);
  assert.deepEqual(verifySlotRecord(r, sig, keyring, NOW + 10), { ok: true });
});

test('slot record: signing is deterministic for the same record (no nonce in the signature input besides the record)', () => {
  const r = base();
  assert.equal(signSlotRecord(r, newPriv), signSlotRecord(r, newPriv));
});

test('slot record: any changed field breaks the signature', () => {
  const r = base();
  const sig = signSlotRecord(r, newPriv);
  const changes: Array<Partial<SlotRecord>> = [
    { field_id: 'F2' },
    { slot: 2 },
    { wallet: 'Pk4sVq8ZmT3xRa6NcW2bYd7HfJ9gLu5EtQ1yMs8KhXoP' },
    { nonce: '123e4567-e89b-42d3-a456-426614174001' },
    { issued_at: NOW - 1 },
    { expires_at: NOW + 1799 },
  ];
  for (const change of changes) {
    assert.deepEqual(verifySlotRecord({ ...r, ...change }, sig, keyring, NOW + 10), { ok: false, code: 'BAD_SIGNATURE' }, JSON.stringify(change));
  }
});

test('slot record: a signature over the bare JSON (no domain prefix) is not accepted', () => {
  const r = base();
  const bare = sign(null, Buffer.from(canonicalJson(r), 'utf8'), newPriv).toString('base64');
  assert.deepEqual(verifySlotRecord(r, bare, keyring, NOW + 10), { ok: false, code: 'BAD_SIGNATURE' });
  assert.notEqual(signingMessage(r).toString('utf8'), canonicalJson(r));
});

test('slot record: key rotation — old key still verifies its records, unknown key_id is refused', () => {
  const r = base({ key_id: 'k-old' });
  const sig = signSlotRecord(r, oldPriv);
  assert.deepEqual(verifySlotRecord(r, sig, keyring, NOW + 10), { ok: true });
  // Ключ, которого нет в списке принимаемых, не принимается, даже с валидной подписью.
  const stranger = generateKeyPairSync('ed25519').privateKey;
  const r2 = base({ key_id: 'k-gone' });
  assert.deepEqual(verifySlotRecord(r2, signSlotRecord(r2, stranger), keyring, NOW + 10), { ok: false, code: 'UNKNOWN_KEY' });
});

test('slot record: key_id names a key, a signature from another key under that id is refused', () => {
  const r = base({ key_id: 'k-new' });
  const sigFromOld = signSlotRecord({ ...r, key_id: 'k-old' }, oldPriv);
  assert.deepEqual(verifySlotRecord(r, sigFromOld, keyring, NOW + 10), { ok: false, code: 'BAD_SIGNATURE' });
});

test('slot record: expired at expires_at (not accepted at the exact boundary)', () => {
  const r = base();
  const sig = signSlotRecord(r, newPriv);
  assert.deepEqual(verifySlotRecord(r, sig, keyring, NOW + 1799), { ok: true });
  assert.deepEqual(verifySlotRecord(r, sig, keyring, NOW + 1800), { ok: false, code: 'EXPIRED' });
});

test('slot record: TTL above one hour is refused at sign time and verify time', () => {
  const r = base({ expires_at: NOW + 3601 });
  assert.equal(validateSlotRecord(r), 'TTL_TOO_LONG');
  assert.throws(() => signSlotRecord(r, newPriv), RangeError);
  assert.equal(validateSlotRecord(base({ expires_at: NOW + 3600 })), null);
  assert.equal(validateSlotRecord(base({ expires_at: NOW })), 'BAD_TIME');
});

test('slot record: free slots 1..6 carry no payment; paid slots 7..12 must carry one', () => {
  assert.equal(validateSlotRecord(base({ slot: 6 })), null);
  assert.equal(validateSlotRecord(base({ slot: 2, payment_signature: SIG })), 'PAYMENT_MISMATCH');
  assert.equal(validateSlotRecord(paid({ slot: 7 })), null);
  assert.equal(validateSlotRecord(paid({ payment_signature: null })), 'PAYMENT_MISMATCH');
  assert.equal(validateSlotRecord(paid({ payment_signature: 'short' })), 'PAYMENT_MISMATCH');
  assert.equal(validateSlotRecord(base({ slot: 13 })), 'BAD_SLOT');
  assert.equal(validateSlotRecord(base({ slot: 0 })), 'BAD_SLOT');
  assert.equal(validateSlotRecord(base({ slot: 1.5 })), 'BAD_SLOT');
});

test('slot record: malformed identifiers are refused before signing', () => {
  assert.equal(validateSlotRecord(base({ nonce: 'not-a-uuid' })), 'BAD_NONCE');
  assert.equal(validateSlotRecord(base({ nonce: '123e4567-e89b-12d3-a456-426614174000' })), 'BAD_NONCE'); // не версия 4
  assert.equal(validateSlotRecord(base({ wallet: 'short' })), 'BAD_WALLET');
  assert.equal(validateSlotRecord(base({ wallet: 'O'.repeat(44) })), 'BAD_WALLET'); // 'O' не входит в base58
  assert.equal(validateSlotRecord(base({ field_id: '' })), 'BAD_FIELD');
  assert.equal(validateSlotRecord(base({ key_id: 'K 1' })), 'BAD_KEY_ID');
  assert.equal(validateSlotRecord(base({ v: 2 })), 'BAD_VERSION');
});

test('slot record: loadSigningKey accepts ed25519 only', () => {
  const pem = oldPriv.export({ type: 'pkcs8', format: 'pem' }).toString();
  assert.equal(loadSigningKey(pem).asymmetricKeyType, 'ed25519');
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  assert.throws(() => loadSigningKey(ec), /ed25519/);
});
