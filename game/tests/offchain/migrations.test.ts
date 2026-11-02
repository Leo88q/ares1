import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { fieldPda, migrationInstruction, validateMigrationAccount, migrationLayouts } from '../../scripts/migrationClient';
import { anchorDiscriminator } from '../../apps/backend/src/anchorRaw';
import { ixMigrateConfig, ixMigrateField, ixMigrateEpoch, ixMigrateAdminState } from '../../apps/web/src/utils/anchorClient';
const programId = new PublicKey('DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf');
const authority = new PublicKey(Buffer.alloc(32, 3));
const config = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
const adminState = PublicKey.findProgramAddressSync([Buffer.from('admin_state')], programId)[0];
const target = new PublicKey(Buffer.alloc(32, 4));
for (const kind of ['config', 'field', 'epoch', 'admin_state'] as const) {
  test(`${kind} migration builder matches web, with only authority as writable signer`, async () => {
    // P7: the only accepted field address is the canonical [field, field_id] PDA.
    const fieldId = 100n;
    const fieldKey = fieldPda(programId, fieldId);
    const key = kind === 'config' ? config : kind === 'admin_state' ? adminState : kind === 'field' ? fieldKey : target;
    const ix = migrationInstruction(kind, programId, key, authority, kind === 'field' ? fieldId : undefined);
    const web = kind === 'config' ? await ixMigrateConfig(programId, { config, authority }) :
      kind === 'field' ? await ixMigrateField(programId, { field: fieldKey, config, authority, fieldId }) :
      kind === 'epoch' ? await ixMigrateEpoch(programId, { epoch: target, config, authority }) :
      await ixMigrateAdminState(programId, { adminState, config, authority });
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

test('field builder refuses a missing id and a noncanonical PDA', () => {
  const fieldKey = fieldPda(programId, 7n);
  assert.throws(() => migrationInstruction('field', programId, fieldKey, authority), /requires the field id/);
  assert.throws(() => migrationInstruction('field', programId, target, authority, 7n), /canonical \[field, field_id\] PDA/);
  // Тот же аккаунт, но чужой id — тоже отказ: id входит в адрес.
  assert.throws(() => migrationInstruction('field', programId, fieldKey, authority, 8n), /canonical/);
});
