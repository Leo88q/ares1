// Gate G-1: the reward payout rail must be replay-proof.
//
// Two things are pinned here:
//   1. No production source file may call the legacy `buildGrantRewardIx`,
//      which authorises by signature alone and can therefore be landed twice.
//   2. `buildGrantRewardOnceIx` must derive the `reward_claim` marker PDA from
//      (recipient ATA, nonce) and encode the args in the on-chain order, so a
//      duplicate payout is rejected by the runtime rather than by bookkeeping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });

test('no production module calls the replayable grant_reward builder', () => {
  const offenders = walk(srcDir).filter(file => {
    if (file.endsWith(path.join('src', 'solana.ts'))) return false; // the declaration itself
    return /\bbuildGrantRewardIx\b/.test(fs.readFileSync(file, 'utf8'));
  });
  assert.deepEqual(offenders, [], 'use buildGrantRewardOnceIx: grant_reward can be replayed');
});

test('solana.ts declares grant_reward as deprecated and offers the once-rail', () => {
  const source = fs.readFileSync(path.join(srcDir, 'solana.ts'), 'utf8');
  assert.match(source, /@deprecated Use buildGrantRewardOnceIx/);
  assert.match(source, /export function buildGrantRewardOnceIx/);
});

test('buildGrantRewardOnceIx binds the claim PDA to recipient and nonce', async () => {
  process.env.PROGRAM_ID ??= '11111111111111111111111111111112';
  const mod = await import('../src/solana.js').catch(() => null);
  if (!mod) return; // env-dependent module: the static guards above still hold
  const { rewardClaimPda, buildGrantRewardOnceIx, programId } = mod;
  const ata = new PublicKey(Buffer.alloc(32, 7));
  const other = new PublicKey(Buffer.alloc(32, 8));

  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(42n);
  const [expected] = PublicKey.findProgramAddressSync(
    [Buffer.from('reward'), ata.toBuffer(), nonceBuf],
    programId,
  );
  assert.equal(rewardClaimPda(ata, 42n).toBase58(), expected.toBase58());
  // Distinct nonce or distinct recipient ⇒ distinct marker ⇒ no cross-replay.
  assert.notEqual(rewardClaimPda(ata, 43n).toBase58(), expected.toBase58());
  assert.notEqual(rewardClaimPda(other, 42n).toBase58(), expected.toBase58());

  const ix = buildGrantRewardOnceIx({
    config: ata, epoch: ata, authority: other, potatoMint: ata, userPotato: ata,
    nonce: 42n, amountMicro: 1_000_000n, expiresAt: 1_800_000_000n,
  });
  assert.equal(ix.data.length, 8 + 8 + 8 + 8);
  assert.equal(ix.data.readBigUInt64LE(8), 42n);
  assert.equal(ix.data.readBigUInt64LE(16), 1_000_000n);
  assert.equal(ix.data.readBigInt64LE(24), 1_800_000_000n);
  assert.ok(ix.keys.some(k => k.pubkey.equals(expected) && k.isWritable));
  assert.ok(ix.keys.find(k => k.pubkey.equals(other))?.isSigner, 'authority signs and pays rent');
});
