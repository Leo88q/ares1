import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { anchorDiscriminator, decodeField } from '../src/anchorRaw.js';

function fieldData(owner: PublicKey, active = true, durability = 7): Buffer {
  const data = Buffer.alloc(70);
  anchorDiscriminator('account', 'Field').copy(data, 0);
  owner.toBuffer().copy(data, 8);
  data.writeUInt8(2, 40); // level
  data.writeUInt8(durability, 41);
  data.writeBigInt64LE(1_700_000_000n, 42);
  data.writeBigInt64LE(1_800_000_000n, 50);
  data.writeBigInt64LE(1_750_000_000n, 58);
  data.writeUInt8(active ? 1 : 0, 66);
  data.writeUInt8(1, 67); // field type
  data.writeUInt8(254, 68); // bump
  data.writeUInt8(2, 69); // silicon mutation
  return data;
}

test('backend decodes the deployed Field layout and verifies its discriminator and exact size', () => {
  const owner = new PublicKey(new Uint8Array(32).fill(7));
  const field = decodeField(fieldData(owner));
  assert.equal(field.owner.toBase58(), owner.toBase58());
  assert.equal(field.level, 2);
  assert.equal(field.durability, 7);
  assert.equal(field.isActive, true);
  assert.equal(field.mutationType, 2);
  assert.throws(() => decodeField(Buffer.alloc(70)), /Invalid Field account layout/);
  assert.throws(() => decodeField(Buffer.concat([fieldData(owner), Buffer.alloc(1)])), /Invalid Field account layout/);
});

export { fieldData };
