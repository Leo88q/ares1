import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { migrationInstruction, validateMigrationAccount, migrationLayouts } from '../../scripts/migrationClient';
import { anchorDiscriminator } from '../../apps/backend/src/anchorRaw';
import { ixMigrateConfig, ixMigrateField, ixMigrateEpoch } from '../../apps/web/src/utils/anchorClient';
const programId = new PublicKey('DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf');
const authority = new PublicKey(Buffer.alloc(32, 3));
const config = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
const target = new PublicKey(Buffer.alloc(32, 4));
for (const kind of ['config', 'field', 'epoch'] as const) {
  test(`${kind} migration builder matches web, with only authority as writable signer`, async () => {
    const key = kind === 'config' ? config : target;
    const ix = migrationInstruction(kind, programId, key, authority);
    const web = kind === 'config' ? await ixMigrateConfig(programId, { config, authority }) :
      kind === 'field' ? await ixMigrateField(programId, { field: target, config, authority }) :
      await ixMigrateEpoch(programId, { epoch: target, config, authority });
    assert.deepEqual(ix, web);
    assert.deepEqual(ix.keys.filter(k => k.isSigner), [{ pubkey: authority, isSigner: true, isWritable: true }]);
    assert.deepEqual(ix.keys.at(-1), { pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
  });
  test(`${kind} planner validates supported sizes, discriminator and owner`, () => {
    const spec = migrationLayouts[kind];
    for (const size of [...spec.legacy, spec.current]) {
      const data = Buffer.alloc(size);
      anchorDiscriminator('account', spec.name).copy(data);
      assert.doesNotThrow(() => validateMigrationAccount(kind, { data, owner: programId }, programId));
      assert.throws(() => validateMigrationAccount(kind, { data, owner: SystemProgram.programId }, programId));
      assert.throws(() => validateMigrationAccount(kind, { data: Buffer.concat([data, Buffer.alloc(spec.current + 1 - data.length)]), owner: programId }, programId));
      data[0] ^= 1;
      assert.throws(() => validateMigrationAccount(kind, { data, owner: programId }, programId));
    }
  });
}
test('config builder refuses a noncanonical PDA', () => {
  assert.throws(() => migrationInstruction('config', programId, target, authority));
});
