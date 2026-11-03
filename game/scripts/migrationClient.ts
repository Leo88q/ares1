import { PublicKey, SystemProgram, TransactionInstruction, type AccountInfo } from '@solana/web3.js';
import { anchorDiscriminator, u64LE } from '../apps/backend/src/anchorRaw';

export const migrationLayouts = {
  config: { name: 'GameConfig', legacy: [156, 164, 228], current: 260 },
  field: { name: 'Field', legacy: [69, 70], current: 78 },
  epoch: { name: 'Epoch', legacy: [41], current: 49 },
  admin_state: { name: 'AdminState', legacy: [97], current: 145 },
} as const;
export type MigrationKind = keyof typeof migrationLayouts;

export function validateMigrationAccount(kind: MigrationKind, info: Pick<AccountInfo<Buffer>, 'owner' | 'data'>, programId: PublicKey): void {
  const layout = migrationLayouts[kind];
  const sizes: readonly number[] = [...layout.legacy, layout.current];
  if (!info.owner.equals(programId) ||
      !sizes.includes(info.data.length) ||
      !info.data.subarray(0, 8).equals(anchorDiscriminator('account', layout.name))) {
    throw new Error(`Unsupported ${layout.name} owner, layout or discriminator`);
  }
}

/** Canonical `[b"field", field_id]` PDA — the address the program accepts. */
export function fieldPda(programId: PublicKey, fieldId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('field'), u64LE(fieldId)], programId)[0];
}

/**
 * P7: `migrate_field` carries `field_id` in its data and the program refuses
 * any address but the canonical `[b"field", field_id]` PDA. The script mirrors
 * that rule locally, so the operator cannot sign a transaction the chain would
 * reject (or, worse, migrate an account whose id they guessed).
 */
export function migrationInstruction(
  kind: MigrationKind,
  programId: PublicKey,
  target: PublicKey,
  authority: PublicKey,
  fieldId?: bigint,
): TransactionInstruction {
  const config = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
  if (kind === 'config' && !target.equals(config)) throw new Error('Config must be the canonical PDA');
  let data = anchorDiscriminator('global', `migrate_${kind}`);
  if (kind === 'field') {
    if (fieldId === undefined) throw new Error('Field migration requires the field id (field_id argument)');
    if (!target.equals(fieldPda(programId, fieldId))) throw new Error('Field must be the canonical [field, field_id] PDA');
    data = Buffer.concat([data, u64LE(fieldId)]);
  }
  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: target, isSigner: false, isWritable: true },
      ...(kind === 'config' ? [] : [{ pubkey: config, isSigner: false, isWritable: false }]),
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}
