/**
 * One-time on-chain bootstrap after `anchor deploy`:
 *   1. creates the $POTATO mint (6 decimals, no freeze authority)
 *   2. hands mint authority to the config PDA
 *   3. calls `initialize` and `init_epoch`
 *
 * Idempotent: if GameConfig already exists it prints the current state and exits.
 *
 *   ADMIN_KEYPAIR_PATH=~/.config/solana/id.json RPC_URL=https://api.devnet.solana.com \
 *   PROGRAM_ID=48D2uN5dwrpQuCJcb8Bge1hRkJVCRcS4J1JicAoAvMha npm run init-onchain
 */
import fs from "node:fs";
import crypto from "node:crypto";
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createMint, setAuthority, AuthorityType } from "@solana/spl-token";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "48D2uN5dwrpQuCJcb8Bge1hRkJVCRcS4J1JicAoAvMha");
const ADMIN_KEYPAIR_PATH = (process.env.ADMIN_KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`).replace(/^~/, process.env.HOME || "");

const disc = (name: string) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64LE = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
const u32LE = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
};


async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf-8"))));
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const [epoch0Pda] = PublicKey.findProgramAddressSync([Buffer.from("epoch"), u64LE(0n)], PROGRAM_ID);

  console.log("Admin:     ", admin.publicKey.toBase58());
  console.log("Program:   ", PROGRAM_ID.toBase58());
  console.log("RPC:       ", RPC_URL);
  console.log("Config PDA:", configPda.toBase58());

  const existing = await connection.getAccountInfo(configPda);
  if (existing) {
    const potatoMint = new PublicKey(existing.data.subarray(8 + 64, 8 + 96));
    const authority = new PublicKey(existing.data.subarray(8, 8 + 32));
    console.log("\nGameConfig already exists — nothing to do.");
    console.log("Authority:  ", authority.toBase58());
    console.log("POTATO_MINT:", potatoMint.toBase58());
    const epochInfo = await connection.getAccountInfo(epoch0Pda);
    if (!epochInfo) {
      console.log("Epoch 0 missing — creating it.");
      await sendAndConfirmTransaction(connection, new Transaction().add(initEpochIx(configPda, epoch0Pda, admin.publicKey)), [admin]);
    }

    // ─── Idempotent presale check ───
    const [presalePdaExisting] = PublicKey.findProgramAddressSync([Buffer.from("presale")], PROGRAM_ID);
    const presaleInfoExisting = await connection.getAccountInfo(presalePdaExisting);
    if (!presaleInfoExisting) {
      console.log("Presale PDA missing — initializing (cap=500, price=0.25 SOL)...");
      const initPresaleIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: presalePdaExisting, isSigner: false, isWritable: true },
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
          disc("init_presale"),
          u32LE(500),
          u64LE(250_000_000n),
        ]),
      });
      const presaleSig = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(initPresaleIx),
        [admin]
      );
      console.log("Presale initialized, tx:", presaleSig);
    } else {
      console.log("Presale PDA:", presalePdaExisting.toBase58());
    }

    return;
  }

  const balance = await connection.getBalance(admin.publicKey);
  if (balance < 0.05e9) throw new Error(`Admin balance too low (${balance / 1e9} SOL). Need ≈0.05 SOL for rent.`);

  console.log("\nCreating POTATO mint (6 decimals, no freeze authority)...");
  const mint = await createMint(connection, admin, admin.publicKey, null, 6);
  console.log("Mint:", mint.toBase58());

  console.log("Transferring mint authority to config PDA...");
  await setAuthority(connection, admin, mint, admin.publicKey, AuthorityType.MintTokens, configPda);

  console.log("Calling initialize + init_epoch...");
  const initIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: disc("initialize"),
  });
  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(initIx, initEpochIx(configPda, epoch0Pda, admin.publicKey)),
    [admin],
  );
  console.log("tx:", sig);


  // ─────────── Presale init (idempotent) ───────────
  const [presalePda] = PublicKey.findProgramAddressSync([Buffer.from("presale")], PROGRAM_ID);
  const presaleInfo = await connection.getAccountInfo(presalePda);
  if (!presaleInfo) {
    console.log("\nInitializing presale (cap=500, price=0.25 SOL)...");
    const initPresaleIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: presalePda, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        disc("init_presale"),
        u32LE(500),           // cap
        u64LE(250_000_000n),  // 0.25 SOL in lamports
      ]),
    });
    const presaleSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(initPresaleIx),
      [admin]
    );
    console.log("Presale initialized, tx:", presaleSig);
  } else {
    console.log("\nPresale PDA already exists:", presalePda.toBase58());
  }

  console.log("\nDone. Save these values:");
  console.log("PROGRAM_ID: ", PROGRAM_ID.toBase58());
  console.log("POTATO_MINT:", mint.toBase58());
  console.log("CONFIG_PDA: ", configPda.toBase58());
  console.log(`\nBackend: AUTHORITY_KEYPAIR_JSON must point at ${ADMIN_KEYPAIR_PATH} (or a copy in apps/backend/keys/).`);
}

function initEpochIx(configPda: PublicKey, epochPda: PublicKey, authority: PublicKey) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: epochPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: disc("init_epoch"),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
