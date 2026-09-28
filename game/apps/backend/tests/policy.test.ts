// Checklist items 102/103/108/114/127 (audit 2026-09-28): the signing bot's
// independent policy layer. Pure functions — no network access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  PAYER_ALLOWED_GAME_INSTRUCTIONS,
  assertPayerInstructionsAllowed,
  compareSnapshots,
  DataSourceMismatchError,
  payerAllowedDiscriminators,
  verifySnapshotConsistency,
} from '../src/policy.js';
import { anchorDiscriminator, decodeEpoch, decodeGameConfig } from '../src/anchorRaw.js';

const programId = new PublicKey('DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf');
const pk = (b: number) => new PublicKey(Buffer.alloc(32, b));

const rollIx = (): TransactionInstruction =>
  new TransactionInstruction({
    programId,
    keys: [
      { pubkey: pk(1), isSigner: false, isWritable: true },
      { pubkey: pk(2), isSigner: false, isWritable: false },
      { pubkey: pk(3), isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator('global', 'roll_epoch'),
  });

const computeIx = () => ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });

function snapshot(overrides: Partial<{
  epochId: bigint; epochKey: bigint; startTime: bigint; minted: bigint; cap: bigint;
}>) {
  const o = {
    epochId: 7n,
    epochKey: 7n,
    startTime: 1000n,
    minted: 123n,
    cap: 1000n,
    ...overrides,
  };
  // Build minimal decodable account buffers (Epoch layout, 49-byte v2 form).
  const epochBuf = Buffer.alloc(49);
  epochBuf.set(anchorDiscriminator('account', 'Epoch'), 0);
  epochBuf.writeBigUInt64LE(o.epochKey, 8);
  epochBuf.writeBigUInt64LE(o.cap, 16);
  epochBuf.writeBigUInt64LE(o.minted, 24);
  epochBuf.writeBigInt64LE(o.startTime, 32);
  epochBuf.writeUInt8(255, 40); // bump
  epochBuf.writeBigUInt64LE(0n, 41); // granted_micro
  return {
    config: decodeGameConfig(makeConfigBuf(o.epochId)),
    epoch: decodeEpoch(epochBuf),
    slot: 100,
  };
}

function makeConfigBuf(epochId: bigint): Buffer {
  const buf = Buffer.alloc(260);
  buf.set(anchorDiscriminator('account', 'GameConfig'), 0);
  let o = 8;
  for (const key of [pk(1), pk(2), pk(3), pk(4), pk(5)]) {
    key.toBuffer().copy(buf, o);
    o += 32;
  }
  buf.writeBigUInt64LE(1_000_000n, o); o += 8; // max supply
  buf.writeBigUInt64LE(1_000n, o); o += 8; // daily cap
  buf.writeBigUInt64LE(1n, o); o += 8; // base yield
  buf.writeUInt16LE(10_000, o); o += 2; // multiplier bps
  buf.writeBigUInt64LE(0n, o); o += 8; // field count
  buf.writeBigUInt64LE(epochId, o); o += 8; // epoch id
  buf.writeBigUInt64LE(0n, o); o += 8; // total burned
  buf.writeBigUInt64LE(0n, o); o += 8; // last total burned
  buf.writeUInt8(0, o); o += 1; // paused
  buf.writeUInt8(255, o); o += 1; // bump
  PublicKey.default.toBuffer().copy(buf, o); // guardian
  return buf;
}

test('payer allowlist: roll_epoch and compute budget pass', () => {
  assert.doesNotThrow(() => assertPayerInstructionsAllowed([computeIx(), rollIx()], programId));
});

test('payer allowlist: discriminator set is exactly roll_epoch + init_epoch', () => {
  const discs = [...payerAllowedDiscriminators()].sort();
  const expected = [
    anchorDiscriminator('global', 'init_epoch').toString('hex'),
    anchorDiscriminator('global', 'roll_epoch').toString('hex'),
  ].sort();
  assert.deepEqual(discs, expected);
  assert.equal(PAYER_ALLOWED_GAME_INSTRUCTIONS.length, 2);
});

test('item 108/114: a drainer instruction to a foreign program is refused', () => {
  const drainer = new TransactionInstruction({
    programId: pk(9),
    keys: [{ pubkey: pk(1), isSigner: true, isWritable: true }],
    data: Buffer.from([2, 0, 0, 0]),
  });
  assert.throws(
    () => assertPayerInstructionsAllowed([computeIx(), drainer], programId),
    /non-allowlisted program/,
  );
});

test('item 114: unknown game instruction discriminator is refused', () => {
  const grant = new TransactionInstruction({
    programId,
    keys: [{ pubkey: pk(1), isSigner: false, isWritable: true }],
    data: anchorDiscriminator('global', 'grant_reward'),
  });
  assert.throws(
    () => assertPayerInstructionsAllowed([rollIx(), grant], programId),
    /not in the payer allowlist/,
  );
});

test('item 82/127: durable nonce is refused for the server signer', () => {
  const nonceAccount = Keypair.generate().publicKey;
  const advance = SystemProgram.nonceAdvance({
    noncePubkey: nonceAccount,
    authorizedPubkey: pk(1),
  });
  assert.throws(
    () => assertPayerInstructionsAllowed([rollIx(), advance], programId),
    /system instruction type/,
  );
});

test('item 103: snapshot comparison detects poisoned data sources', () => {
  const primary = snapshot({});
  assert.deepEqual(compareSnapshots(primary, snapshot({})), []);
  assert.deepEqual(compareSnapshots(primary, snapshot({ epochId: 8n, epochKey: 8n })).length, 2); // config.epochId + epoch.id
  assert.deepEqual(compareSnapshots(primary, snapshot({ startTime: 2000n })), [
    `epoch.startTime ${primary.epoch.startTime} != 2000`,
  ]);
  assert.equal(compareSnapshots(primary, snapshot({ minted: 999n })).length, 1);
});

test('item 103: missing secondary source fails closed when required', () => {
  const primary = snapshot({});
  assert.throws(
    () => verifySnapshotConsistency(primary, null, true),
    /RPC_URL_SECONDARY is required/,
  );
  assert.doesNotThrow(() => verifySnapshotConsistency(primary, null, false));
  assert.doesNotThrow(() => verifySnapshotConsistency(primary, snapshot({}), true));
  try {
    verifySnapshotConsistency(primary, snapshot({ cap: 5n }), true);
    assert.fail('mismatch must throw');
  } catch (err) {
    assert.ok(err instanceof DataSourceMismatchError);
    assert.match(err.message, /mintCapMicro/);
    assert.equal((err as DataSourceMismatchError).mismatches.length, 1);
  }
});
