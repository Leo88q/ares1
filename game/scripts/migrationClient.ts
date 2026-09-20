import { PublicKey, SystemProgram, TransactionInstruction, type AccountInfo } from '@solana/web3.js';
import { anchorDiscriminator } from '../apps/backend/src/anchorRaw';

export const migrationLayouts = {
  config: { name: 'GameConfig', legacy: [156, 164], current: 228 },
  field: { name: 'Field', legacy: [69], current: 70 },
  epoch: { name: 'Epoch', legacy: [41], current: 49 },
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

export function migrationInstruction(kind: MigrationKind, programId: PublicKey, target: PublicKey, authority: PublicKey): TransactionInstruction {
  const config = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
  if (kind === 'config' && !target.equals(config)) throw new Error('Config must be the canonical PDA');
  return new TransactionInstruction({
    programId,
    data: anchorDiscriminator('global', `migrate_${kind}`),
    keys: [
      { pubkey: target, isSigner: false, isWritable: true },
      ...(kind === 'config' ? [] : [{ pubkey: config, isSigner: false, isWritable: false }]),
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}
