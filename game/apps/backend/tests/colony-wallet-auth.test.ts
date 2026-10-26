import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import {
  createWalletChallenge,
  hashWalletChallenge,
  issueWalletSession,
  verifyWalletChallenge,
  verifyWalletSession,
} from '../src/colonies/walletAuth.js';

const ORIGIN = 'https://game.example';
const SESSION_SIGNING_KEY_FOR_TESTS = 'test-only-colony-session-secret-32-bytes';

function testWallet() {
  const pair = generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  const wallet = new PublicKey(der.subarray(der.length - 32)).toBase58();
  return { wallet, privateKey: pair.privateKey };
}

test('wallet sign-in message binds origin, wallet and cluster; signature is verified', () => {
  const { wallet, privateKey } = testWallet();
  const challenge = createWalletChallenge({ wallet, origin: ORIGIN, cluster: 'mainnet-beta', now: new Date('2026-10-22T10:00:00Z') });
  const signatureBase64Url = sign(null, Buffer.from(challenge.message), privateKey).toString('base64url');
  assert.equal(verifyWalletChallenge({ wallet, origin: ORIGIN, message: challenge.message, signatureBase64Url }), true);
  assert.equal(verifyWalletChallenge({ wallet, origin: 'https://attacker.example', message: challenge.message, signatureBase64Url }), false);
  assert.equal(verifyWalletChallenge({ wallet, origin: ORIGIN, message: `${challenge.message}\nextra`, signatureBase64Url }), false);
  assert.match(challenge.message, /does not authorize a token transfer or transaction/);
});

test('durable challenge persistence stores hashes instead of reusable plaintext nonce/message', () => {
  const { wallet } = testWallet();
  const challenge = createWalletChallenge({ wallet, origin: ORIGIN, cluster: 'mainnet-beta' });
  const hashes = hashWalletChallenge(challenge.message);
  assert.match(hashes.messageHash, /^[0-9a-f]{64}$/);
  assert.match(hashes.nonceHash, /^[0-9a-f]{64}$/);
  assert.throws(() => hashWalletChallenge('not a challenge'), /message/);
});

test('challenge rejects non-HTTPS origins, invalid public keys and oversized TTL', () => {
  const { wallet } = testWallet();
  assert.throws(() => createWalletChallenge({ wallet, origin: 'http://game.example', cluster: 'devnet' }), /HTTPS/);
  assert.throws(() => createWalletChallenge({ wallet: 'not-a-wallet', origin: ORIGIN, cluster: 'devnet' }), /base58|public key/i);
  assert.throws(() => createWalletChallenge({ wallet, origin: ORIGIN, cluster: 'devnet', ttlMs: 600_000 }), /TTL/);
});

test('session is origin-bound, short-lived, signed and tamper evident', () => {
  const { wallet } = testWallet();
  const token = issueWalletSession({ wallet, origin: ORIGIN, secret: SESSION_SIGNING_KEY_FOR_TESTS, nowSeconds: 1000, ttlSeconds: 300 });
  assert.equal(verifyWalletSession({ token, origin: ORIGIN, secret: SESSION_SIGNING_KEY_FOR_TESTS, nowSeconds: 1100 })?.wallet, wallet);
  assert.equal(verifyWalletSession({ token, origin: 'https://other.example', secret: SESSION_SIGNING_KEY_FOR_TESTS, nowSeconds: 1100 }), null);
  assert.equal(verifyWalletSession({ token: `${token}x`, origin: ORIGIN, secret: SESSION_SIGNING_KEY_FOR_TESTS, nowSeconds: 1100 }), null);
  assert.equal(verifyWalletSession({ token, origin: ORIGIN, secret: SESSION_SIGNING_KEY_FOR_TESTS, nowSeconds: 1300 }), null);
  assert.throws(() => issueWalletSession({ wallet, origin: ORIGIN, secret: 'short' }), /32 UTF-8 bytes/);
});
