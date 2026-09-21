import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { anchorDiscriminator, decodeGameConfig, decodeEpoch } from '../../apps/backend/src/anchorRaw';
import { decodeConfig, decodeEpoch as decodeWebEpoch } from '../../apps/web/src/utils/anchorClient';

function configFixture(size: 156 | 164 | 228) {
  const b = Buffer.alloc(size);
  anchorDiscriminator('account', 'GameConfig').copy(b);
  for (let i = 0; i < (size === 228 ? 5 : 3); i++) b.fill(i + 1, 8 + 32 * i, 40 + 32 * i);
  let o = size === 228 ? 168 : 104;
  const u64 = (n: bigint) => { b.writeBigUInt64LE(n, o); o += 8; };
  u64(1_000_000_000_000_000n); u64(250_000_000_000n); u64(6_000_000n);
  b.writeUInt16LE(10_000, o); o += 2;
  u64(7n); u64(8n); u64(9n);
  if (size !== 156) u64(10n);
  b[o++] = 1; b[o] = 254;
  return b;
}
for (const size of [156, 164, 228] as const) {
  test(`backend/web agree on GameConfig ${size}-byte layout`, () => {
    const b = configFixture(size);
    const server = decodeGameConfig(b);
    const web = decodeConfig(b);
    for (const [name, value] of Object.entries(web)) {
      const expected = server[name as keyof typeof server];
      if (value instanceof PublicKey) assert.equal(value.toBase58(), (expected as PublicKey).toBase58());
      else assert.equal(value, expected, name);
    }
    assert.equal(server.epochId, 8n);
    assert.equal(server.lastTotalBurnedMicro, size === 156 ? 0n : 10n);
    assert.equal(server.paused, true);
    assert.equal(server.bump, 254);
    assert.equal(server.rewardSigner.toBase58(), new PublicKey(Buffer.alloc(32, size === 228 ? 5 : 1)).toBase58());
  });
}
for (const size of [41, 49]) {
  test(`legacy/current Epoch ${size}-byte layout`, () => {
    const b = Buffer.alloc(size);
    anchorDiscriminator('account', 'Epoch').copy(b);
    b.writeBigUInt64LE(42n, 8);
    b.writeBigUInt64LE(250_000_000_000n, 16);
    b.writeBigInt64LE(123n, 32);
    b[40] = 253;
    if (size === 49) b.writeBigUInt64LE(17n, 41);
    assert.deepEqual(decodeWebEpoch(b), decodeEpoch(b));
    assert.equal(decodeEpoch(b).grantedMicro, size === 49 ? 17n : 0n);
  });
}
test('backend rejects truncated accounts and wrong discriminators', () => {
  assert.throws(() => decodeGameConfig(Buffer.alloc(228)));
  assert.throws(() => decodeGameConfig(configFixture(228).subarray(0, 227)));
  assert.throws(() => decodeEpoch(Buffer.alloc(49)));
  assert.throws(() => decodeConfig(Buffer.alloc(227)));
});

test('raw client uses the SDK Token-2022 constant (import must not throw)', async () => {
  const client = await import('../../apps/web/src/utils/anchorClient');
  const spl = await import('@solana/spl-token');
  assert.equal(client.TOKEN_2022_PROGRAM_ID.toBase58(), spl.TOKEN_2022_PROGRAM_ID.toBase58());
});
