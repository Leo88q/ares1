import { anchorDiscriminator } from '../../apps/backend/src/anchorRaw';

/** Shared GameConfig byte fixture for decoder-parity tests (web/backend/landing). */
export function configFixture(size: 156 | 164 | 228 | 260): Buffer {
  const b = Buffer.alloc(size);
  anchorDiscriminator('account', 'GameConfig').copy(b);
  const modern = size === 228 || size === 260;
  for (let i = 0; i < (modern ? 5 : 3); i++) b.fill(i + 1, 8 + 32 * i, 40 + 32 * i);
  let o = modern ? 168 : 104;
  const u64 = (n: bigint) => { b.writeBigUInt64LE(n, o); o += 8; };
  u64(1_000_000_000_000_000n); u64(250_000_000_000n); u64(6_000_000n);
  b.writeUInt16LE(10_000, o); o += 2;
  u64(7n); u64(8n); u64(9n);
  if (size !== 156) u64(10n);
  b[o++] = 1; b[o] = 254;
  if (size === 260) b.fill(6, o + 1, o + 1 + 32); // guardian after bump
  return b;
}
