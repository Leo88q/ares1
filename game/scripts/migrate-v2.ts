/** Review-only by default. Execute ONLY after a tested program upgrade.
 * RPC_URL and PROGRAM_ID are explicit; no implicit deploy wallet or cluster.
 * --execute additionally requires ADMIN_KEYPAIR_PATH and EXPECTED_GENESIS_HASH.
 * Rent is paid to each migrated account by the instruction, never to the program.
 */
import fs from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { anchorDiscriminator, decodeGameConfig } from '../apps/backend/src/anchorRaw';
import { safeError } from '../apps/backend/src/security';
import { migrationInstruction, migrationLayouts, validateMigrationAccount, type MigrationKind } from './migrationClient';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing explicit ${name}`);
  return value;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--execute')) throw new Error('Usage: yarn migrate-v2 [--execute]');
  const execute = args.includes('--execute');
  const connection = new Connection(required('RPC_URL'), 'confirmed');
  const programId = new PublicKey(required('PROGRAM_ID'));
  // Require execution intent/credentials before any network operations, but do not print them.
  const expectedGenesis = execute ? required('EXPECTED_GENESIS_HASH') : undefined;
  const keyPath = execute ? required('ADMIN_KEYPAIR_PATH').replace(/^~/, process.env.HOME || '') : undefined;
  const genesis = await connection.getGenesisHash();
  if (execute && genesis !== expectedGenesis) throw new Error('Cluster genesis mismatch; refusing migration');
  console.log('Mode:', execute ? 'EXECUTE' : 'READ-ONLY PLAN', 'Program:', programId.toBase58(), 'Genesis:', genesis);
  const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
  const info = await connection.getAccountInfo(configPda);
  if (!info) throw new Error('Config not found');
  validateMigrationAccount('config', info, programId);
  const config = decodeGameConfig(info.data);
  const admin = keyPath ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8')))) : undefined;
  if (admin && !admin.publicKey.equals(config.authority)) throw new Error('Signer is not the current game authority');
  const plan: { kind: MigrationKind; key: PublicKey }[] = [];
  if (info.data.length !== migrationLayouts.config.current) plan.push({ kind: 'config', key: configPda });
  for (const kind of ['epoch', 'field'] as const) {
    const layout = migrationLayouts[kind];
    for (const size of layout.legacy) {
      const accounts = await connection.getProgramAccounts(programId, { filters: [{ dataSize: size }] });
      for (const { pubkey, account } of accounts) {
        if (!account.data.subarray(0, 8).equals(anchorDiscriminator('account', layout.name))) continue;
        validateMigrationAccount(kind, account, programId);
        plan.push({ kind, key: pubkey });
      }
    }
  }
  for (const { kind, key } of plan) {
    const before = await connection.getAccountInfo(key);
    if (!before) throw new Error('Planned account disappeared');
    validateMigrationAccount(kind, before, programId);
    const targetSize = migrationLayouts[kind].current;
    const rent = await connection.getMinimumBalanceForRentExemption(targetSize);
    console.log(kind, key.toBase58(), `${before.data.length} -> ${targetSize} bytes`, 'rent shortfall:', Math.max(0, rent - before.lamports));
    if (admin && before.data.length !== targetSize) {
      const tx = new Transaction().add(migrationInstruction(kind, programId, key, admin.publicKey));
      const signature = await sendAndConfirmTransaction(connection, tx, [admin]);
      const after = await connection.getAccountInfo(key);
      if (!after || after.data.length !== targetSize || after.lamports < rent) throw new Error('Post-migration verification failed');
      validateMigrationAccount(kind, after, programId);
      console.log('Confirmed:', signature);
    }
  }
  console.log(execute ? 'Planned migrations verified; rerun read-only to inspect remaining legacy accounts.' : 'No transactions sent. Review the plan and deployed program before using --execute.');
}
main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
