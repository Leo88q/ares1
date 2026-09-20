import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { assertDedicatedPayer, safeError } from '../../apps/backend/src/security';

const pk = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
const roles = { authority: pk(1), pendingAuthority: pk(2), rewardSigner: pk(3) };

test('epoch payer cannot be any privileged signer', () => {
  for (const key of Object.values(roles)) assert.throws(() => assertDedicatedPayer(key, roles));
  assert.doesNotThrow(() => assertDedicatedPayer(pk(4), roles));
});
test('RPC URLs, credentials and numeric keypairs are redacted from diagnostics', () => {
  const message = safeError(new Error('HTTP 429 https://rpc.example/v2/secret-value?api-key=secret-value token=secret-value'));
  assert.ok(!message.includes('secret-value'));
  assert.match(message, /429/);
  assert.equal(safeError(JSON.stringify(Array(64).fill(123))), '[REDACTED_KEYPAIR]');
});
