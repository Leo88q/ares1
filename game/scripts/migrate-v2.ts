/**
 * One-shot devnet v1 → v2 migration (run AFTER an in-place program upgrade).
 *
 * v1 → v2 account layout changes (append-only, realloc via program instructions):
 *   GameConfig  156 → 164 bytes  (+last_total_burned_micro)
 *   Epoch       41  → 49  bytes  (+burned_micro)
 *   Field       69  → 70  bytes  (+mutation_type)
 *
 * The script finds v1-sized accounts and calls migrate_config / migrate_epoch /
 * migrate_field (authority = GameConfig.authority = your deployer key) for each.
 * Idempotent: v2-sized accounts are skipped, so re-running is safe.
 *
 *   ADMIN_KEYPAIR_PATH=~/.config/solana/id.json RPC_URL=https://api.devnet.solana.com \
 *   PROGRAM_ID=<id> npm run migrate-v2
 */
import fs from "node:fs";
import crypto from "node:crypto";
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction,
} from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "48D2uN5dwrpQuCJcb8Bge1hRkJVCRcS4J1JicAoAvMha");
const ADMIN_KEYPAIR_PATH = (process.env.ADMIN_KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`).replace(/^~/, process.env.HOME || "");

const CONFIG_V1 = 156, CONFIG_V2 = 164;
const EPOCH_V1 = 41, EPOCH_V2 = 49;
const FIELD_V1 = 69, FIELD_V2 = 70;

const connection = new Connection(RPC_URL, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf-8"))));

const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const configPda = pda(Buffer.from("config"));
const disc = (name: string) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

async function send(...ixs: TransactionInstruction[]): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [admin]);
}

function migrateIx(name: string, accounts: PublicKey[]): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: accounts.map((pk, i) => ({ pubkey: pk, isSigner: i === accounts.length - 1, isWritable: i === 0 })),
    data: disc(name),
  });
}

async function main() {
  console.log("Program:", PROGRAM_ID.toBase58());
  console.log("Admin:  ", admin.publicKey.toBase58());

  // ── GameConfig ──
  const cfgInfo = await connection.getAccountInfo(configPda);
  if (!cfgInfo) {
    console.log("GameConfig not found — nothing to migrate (fresh deploy?).");
    return;
  }
  if (cfgInfo.data.length === CONFIG_V1) {
    console.log("Migrating GameConfig 156 → 164 ...");
    const sig = await send(
      migrateIx("migrate_config", [configPda, admin.publicKey, SystemProgram.programId]),
    );
    console.log("  tx:", sig);
  } else if (cfgInfo.data.length === CONFIG_V2) {
    console.log("GameConfig already v2 (164).");
  } else {
    throw new Error(`Unexpected GameConfig size: ${cfgInfo.data.length}`);
  }

  // ── Epochs (seeds ["epoch", id] — enumerate all program accounts of v1 size) ──
  const epochs = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: EPOCH_V1 }],
  });
  console.log(`Epochs v1: ${epochs.length}`);
  for (let i = 0; i < epochs.length; i += 5) {
    const chunk = epochs.slice(i, i + 5);
    // migrate_epoch keys = [epoch, config, authority, system];
    // PDA не меняется между версиями (те же seeds и bump).
    const ixs = chunk.map(({ pubkey }) =>
      migrateIx("migrate_epoch", [pubkey, configPda, admin.publicKey, SystemProgram.programId]),
    );
    const sig = await send(...ixs);
    console.log(`  epoch chunk ${i / 5 + 1}: tx ${sig}`);
  }

  // ── Fields (seeds ["field", id] — enumerate all v1-sized field accounts) ──
  const fields = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: FIELD_V1 }],
  });
  console.log(`Fields v1: ${fields.length}`);
  for (let i = 0; i < fields.length; i += 5) {
    const chunk = fields.slice(i, i + 5);
    const ixs = chunk.map(({ pubkey }) =>
      migrateIx("migrate_field", [pubkey, configPda, admin.publicKey, SystemProgram.programId]),
    );
    const sig = await send(...ixs);
    console.log(`  field chunk ${i / 5 + 1} (${chunk.length} accts): tx ${sig}`);
  }

  // ── verify ──
  const leftover = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { dataSize: CONFIG_V1 },
    ],
  });
  const leftoverFields = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: FIELD_V1 }],
  });
  const leftoverEpochs = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: EPOCH_V1 }],
  });
  if (leftover.length || leftoverFields.length || leftoverEpochs.length) {
    console.warn(`⚠ Leftover v1 accounts: config=${leftover.length} fields=${leftoverFields.length} epochs=${leftoverEpochs.length}`);
    process.exitCode = 1;
  } else {
    console.log("✓ Migration complete: no v1-sized accounts left.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
