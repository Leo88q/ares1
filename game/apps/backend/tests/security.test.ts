// F-15: unit coverage for the security helpers used by index.ts / epochRoller.
// No network access: pure functions only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { assertDedicatedPayer, safeError } from '../src/security.js';

const pk = (b: number) => new PublicKey(Buffer.alloc(32, b));

test('assertDedicatedPayer accepts a wallet with no admin roles', () => {
  const config = { authority: pk(1), pendingAuthority: pk(2), rewardSigner: pk(3) };
  assertDedicatedPayer(pk(9), config); // must not throw
});

test('assertDedicatedPayer rejects authority / pending / rewardSigner', () => {
  const config = { authority: pk(1), pendingAuthority: pk(2), rewardSigner: pk(3) };
  for (const bad of [config.authority, config.pendingAuthority, config.rewardSigner]) {
    assert.throws(() => assertDedicatedPayer(bad, config), /separate/);
  }
});

test('safeError redacts credential-bearing RPC URLs', () => {
  const out = safeError(new Error('failed: https://mainnet.helius-rpc.com/?api-key=SECRET123 while sending'));
  assert.ok(!out.includes('SECRET123'));
  assert.ok(!out.includes('helius-rpc.com'));
  assert.ok(out.includes('[REDACTED_URL]'));
});

test('safeError redacts keypair arrays and truncates long messages', () => {
  const bytes = Array.from({ length: 32 }, (_, i) => i).join(',');
  const out = safeError(`key [${bytes}] ${'x'.repeat(2000)}`);
  assert.ok(!out.includes('31,'), 'keypair material must be redacted');
  assert.ok(out.includes('[REDACTED_KEYPAIR]'));
  assert.ok(out.length <= 1000);
  assert.equal(safeError('plain string'), 'plain string');
});
