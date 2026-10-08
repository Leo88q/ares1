// PAYER_KEYPAIR_JSON: обе формы значения (путь к файлу и inline-JSON) —
// требование хостингов без файловых секретов (Flux/Railway/Render и т.п.).
// Без сети: Keypair.fromSecretKey — чистая криптография.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import {
  isInlineKeypairJson,
  loadPayerSecretKey,
  parsePayerSecretKey,
  PAYER_SECRET_KEY_BYTES,
} from '../src/payerKey.js';

const neverRead = () => {
  throw new Error('readFile must not be called for inline JSON');
};

test('inline JSON array is accepted and yields the same keypair', () => {
  const kp = Keypair.generate();
  const spec = JSON.stringify(Array.from(kp.secretKey));
  const bytes = loadPayerSecretKey(spec, neverRead);
  assert.equal(bytes.length, PAYER_SECRET_KEY_BYTES);
  assert.equal(Keypair.fromSecretKey(bytes).publicKey.toBase58(), kp.publicKey.toBase58());
});

test('inline JSON survives surrounding whitespace/newlines (env files)', () => {
  const kp = Keypair.generate();
  const spec = `\n  ${JSON.stringify(Array.from(kp.secretKey))}\n`;
  const bytes = loadPayerSecretKey(spec, neverRead);
  assert.equal(Keypair.fromSecretKey(bytes).publicKey.toBase58(), kp.publicKey.toBase58());
});

test('a file path is read through the injected reader', () => {
  const kp = Keypair.generate();
  const path = './keys/epoch-payer.json';
  let seen: string | null = null;
  const bytes = loadPayerSecretKey(path, (p) => {
    seen = p;
    return JSON.stringify(Array.from(kp.secretKey));
  });
  assert.equal(seen, path);
  assert.equal(Keypair.fromSecretKey(bytes).publicKey.toBase58(), kp.publicKey.toBase58());
});

test('inline detection: brackets mean inline, everything else is a path', () => {
  assert.equal(isInlineKeypairJson('[1,2,3]'), true);
  assert.equal(isInlineKeypairJson('  [1,2,3]'), true);
  assert.equal(isInlineKeypairJson('./keys/epoch-payer.json'), false);
  assert.equal(isInlineKeypairJson('/app/keys/epoch-payer.json'), false);
});

test('wrong length is rejected with an actionable message, without echoing values', () => {
  assert.throws(
    () => parsePayerSecretKey('[1,2,3]'),
    (err: Error) => err.message.includes('64') && !err.message.includes('1,2,3'),
  );
  assert.throws(() => parsePayerSecretKey('[]'), /64/);
});

test('non-byte entries are rejected by index', () => {
  const good = Array.from({ length: PAYER_SECRET_KEY_BYTES }, () => 0);
  for (const bad of [256, -1, 1.5]) {
    const arr = [...good];
    arr[7] = bad;
    assert.throws(() => parsePayerSecretKey(JSON.stringify(arr)), /элемент \[7\]/);
  }
  const withString = [...good];
  (withString as unknown[])[0] = '1';
  assert.throws(() => parsePayerSecretKey(JSON.stringify(withString)), /элемент \[0\]/);
});

test('non-JSON content is rejected without echoing it', () => {
  assert.throws(
    () => parsePayerSecretKey('not-a-json-value'),
    (err: Error) => err.message.includes('JSON') && !err.message.includes('not-a-json-value'),
  );
});

test('an unreadable file fails with a hint and does not echo the spec', () => {
  const spec = './keys/missing.json';
  assert.throws(
    () => loadPayerSecretKey(spec, () => {
      throw new Error('ENOENT');
    }),
    (err: Error) => err.message.includes('inline-JSON') && !err.message.includes(spec),
  );
});

test('a keypair-shaped JSON object is rejected (only the 64-number array is accepted)', () => {
  assert.throws(() => parsePayerSecretKey('{"secretKey":[1,2,3]}'), /64/);
});
