import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { anchorDiscriminator } from '../src/anchorRaw.js';
import { FieldOwnershipError, verifyFieldOwnership } from '../src/colonies/fieldOwnership.js';
import type { Connection } from '@solana/web3.js';

function makeField(owner: PublicKey, active = true): Buffer {
  const data = Buffer.alloc(70);
  anchorDiscriminator('account', 'Field').copy(data);
  owner.toBuffer().copy(data, 8);
  data.writeUInt8(1, 40); data.writeUInt8(9, 41);
  data.writeBigInt64LE(0n, 42); data.writeBigInt64LE(0n, 50); data.writeBigInt64LE(0n, 58);
  data.writeUInt8(active ? 1 : 0, 66); data.writeUInt8(0, 67); data.writeUInt8(255, 68); data.writeUInt8(0, 69);
  return data;
}

function rpc(data: Buffer | null, accountOwner: PublicKey) {
  return {
    async getAccountInfoAndContext() {
      return { context: { slot: 123 }, value: data ? { data, owner: accountOwner } : null };
    },
  } as unknown as Connection;
}

const wallet = new PublicKey(new Uint8Array(32).fill(1));
const field = new PublicKey(new Uint8Array(32).fill(2));
const programId = new PublicKey(new Uint8Array(32).fill(3));
const args = { cluster: 'mainnet-beta' as const, programId, wallet: wallet.toBase58(), fieldAddress: field.toBase58() };

test('Field eligibility requires a finalized program-owned active Field matching the signed wallet', async () => {
  const result = await verifyFieldOwnership({ ...args, primary: rpc(makeField(wallet), programId) });
  assert.equal(result.wallet, wallet.toBase58());
  assert.equal(result.fieldAddress, field.toBase58());
  assert.equal(result.commitment, 'finalized');
  assert.equal(result.observedSlot, 123);
  assert.equal(result.durability, 9);
});

test('Field eligibility fails closed for absent, foreign, inactive, or wrongly owned accounts', async () => {
  await assert.rejects(verifyFieldOwnership({ ...args, primary: rpc(null, programId) }), (error: unknown) => error instanceof FieldOwnershipError && error.code === 'NOT_FOUND');
  await assert.rejects(verifyFieldOwnership({ ...args, primary: rpc(makeField(wallet), wallet) }), (error: unknown) => error instanceof FieldOwnershipError && error.code === 'WRONG_PROGRAM');
  await assert.rejects(verifyFieldOwnership({ ...args, primary: rpc(makeField(new PublicKey(new Uint8Array(32).fill(4))), programId) }), (error: unknown) => error instanceof FieldOwnershipError && error.code === 'NOT_OWNER');
  await assert.rejects(verifyFieldOwnership({ ...args, primary: rpc(makeField(wallet, false), programId) }), (error: unknown) => error instanceof FieldOwnershipError && error.code === 'INACTIVE');
});

test('Field ownership requires the configured independent RPC and rejects disagreement', async () => {
  const primary = rpc(makeField(wallet), programId);
  await assert.rejects(verifyFieldOwnership({ ...args, primary, requireSecondary: true }), (error: unknown) => error instanceof FieldOwnershipError && error.code === 'SECONDARY_REQUIRED');
  await assert.rejects(verifyFieldOwnership({ ...args, primary, secondary: rpc(makeField(wallet, false), programId), requireSecondary: true }), (error: unknown) => error instanceof FieldOwnershipError && error.code === 'RPC_DISAGREEMENT');
});
