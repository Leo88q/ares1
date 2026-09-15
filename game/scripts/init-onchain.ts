/**
 * One-time on-chain bootstrap after `anchor deploy` («тёплый старт»):
 *   1. creates the $POTATO mint (6 decimals, no freeze authority)
 *   2. hands mint authority to the config PDA
 *   3. calls `initialize` and `init_epoch`
 *   4. initializes the presale (cap=500, SOL price=0.25 SOL; SKR price = 1053 SKR, program const)
 *   5. materializes the treasury_sol PDA vault (destination of buy_field_sol)
 *   6. materializes the quest_treasury PDA + ATA and funds the 550 🥔 achievement pool
 *   7. creates SKR ATAs (80 % treasury / 20 % buyback) for the SKR presale
 *   8. verifies the SKR mint exists on this cluster (SKR features need it)
 *
 * Idempotent: every step is guarded by an account-existence check, safe to re-run.
 *
 *   ADMIN_KEYPAIR_PATH=~/.config/solana/id.json RPC_URL=https://api.devnet.solana.com \
 *   PROGRAM_ID=DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf npm run init-onchain
 */
import fs from "node:fs";
import crypto from "node:crypto";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAccount, setAuthority, AuthorityType,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf");
const SKR_MINT = new PublicKey("Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o");
const ADMIN_KEYPAIR_PATH = (process.env.ADMIN_KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`).replace(/^~/, process.env.HOME || "");

// Mirror of QUEST_REWARD_MICRO in lib.rs (50+50+100+100+200+50 = 550 🥔, one-time pool).
const QUEST_POOL_MICRO = 550_000_000n;
const MICRO = 1_000_000n;

const connection = new Connection(RPC_URL, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf-8"))));

const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const configPda = pda(Buffer.from("config"));
const epochPdaOf = (id: bigint) => pda(Buffer.from("epoch"), u64LE(id));
const presalePda = pda(Buffer.from("presale"));
const treasurySolPda = pda(Buffer.from("treasury_sol"));
const questTreasuryPda = pda(Buffer.from("quest_treasury"));

const disc = (name: string) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64LE = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const u32LE = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };

async function send(...ixs: TransactionInstruction[]): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [admin]);
}

async function accountExists(pk: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(pk)) !== null;
}

/**
 * Materializes a PDA as a system-owned 0-data vault by sending it rent.
 * A plain transfer makes the account appear in the tx, so it lands on-chain
 * after confirmation (owner = System, space = 0) — any program can then
 * transfer SOL/tokens to it.
 */
async function ensurePdaVault(pk: PublicKey, label: string): Promise<void> {
  if (await accountExists(pk)) {
    console.log(`${label.padEnd(12)} ${pk.toBase58()} (exists)`);
    return;
  }
  const rent = await connection.getMinimumBalanceForRentExemption(0);
  console.log(`Creating ${label} PDA vault (${(rent / LAMPORTS_PER_SOL).toFixed(6)} SOL rent)...`);
  const sig = await send(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: pk, lamports: rent }));
  console.log(`${label} vault created, tx:`, sig);
}

/**
 * ATA address for ANY owner (incl. PDAs). Uses the SDK derivation —
 * guaranteed bit-identical to the ATA program's own derivation.
 * (allowOwnerOffCurve=true → PDA owners are fine, no exception.)
 */
function ataOf(mintPk: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mintPk, owner, true);
}

/** Creates the ATA if missing (idempotent raw ATA-program instruction). */
async function ensureAta(mintPk: PublicKey, owner: PublicKey): Promise<PublicKey> {
  const ata = ataOf(mintPk, owner);
  if (await accountExists(ata)) return ata;
  // CreateIdempotent (idx 1): payer(w,s) | ata(w) | OWNER | MINT | system | token
  // (порядок owner/mint подтверждён живой симуляцией, scripts/ata-diag.ts)
  const ix = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mintPk, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });
  const sig = await send(ix);
  console.log(`ATA created ${ata.toBase58()} (owner ${owner.toBase58()}), tx:`, sig);
  return ata;
}

async function main() {
  console.log("Admin:      ", admin.publicKey.toBase58());
  console.log("Program:    ", PROGRAM_ID.toBase58());
  console.log("RPC:        ", RPC_URL);
  console.log("Config PDA: ", configPda.toBase58());

  const skrMintInfo = await connection.getAccountInfo(SKR_MINT);
  if (!skrMintInfo) {
    console.warn("\n⚠ SKR mint NOT found on this cluster — SKR presale / export license will be unavailable until SKR exists here.");
  } else {
    console.log("\nSKR mint:   ", SKR_MINT.toBase58(), "(found)");
  }

  let mint: PublicKey;
  let epochId: bigint;

  const existing = await connection.getAccountInfo(configPda);
  if (existing) {
    // GameConfig layout (borsh, no padding): disc(8) authority(32) pending(32) mint(32)
    // maxSupply(8) dailyCap(8) baseYield(8) globalMult(u16) fieldCount(8) epochId(8) ...
    // epoch_id = 8 + 96 + 24 + 2 + 8 = 138 (offset 130 — это field_count!)
    mint = new PublicKey(existing.data.subarray(8 + 64, 8 + 96));
    epochId = existing.data.readBigUInt64LE(8 + 96 + 24 + 2 + 8);
    console.log(`\nGameConfig already exists (epochId=${epochId}) — skipping mint/config/epoch steps.`);
  } else {
    const balance = await connection.getBalance(admin.publicKey);
    if (balance < 0.1e9) throw new Error(`Admin balance too low (${(balance / 1e9).toFixed(4)} SOL). Need ≥0.1 SOL for rent + fees. (devnet airdrop: solana airdrop ${admin.publicKey.toBase58()})`);

    console.log("\nCreating POTATO mint (6 decimals, no freeze authority)...");
    mint = await createMint(connection, admin, admin.publicKey, null, 6);
    console.log("Mint:     ", mint.toBase58());

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
    const epochIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: epochPdaOf(0n), isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc("init_epoch"),
    });
    const sig = await send(initIx, epochIx);
    console.log("tx:        ", sig);
    epochId = 0n;
  }

  // ── Миграции аккаунтов: старый билд (156/41 B) → новый лейаут (164/49 B) — идемпотентно ──
  // 32-ix билд добавил last_total_burned_micro (config) и burned_micro (epoch).
  // Старые аккаунты меньше на 8 B → borsh-декодинг в новой программе падает,
  // web-клиент читает вне буфера ("offset out of range"). migrate_config /
  // migrate_epoch делают realloc (новые байты = 0). Anchor realloc берёт ренту
  // из аккаунта программы → при необходимости доливаем программе 0.001 SOL.
  const NEW_CONFIG_SIZE = 164; // disc(8) + GameConfig (7×u64, u16, bool, u8)
  const NEW_EPOCH_SIZE = 49;   // disc(8) + Epoch (5×u64, u8, burned u64)

  async function migrateIfNeeded(
    account: PublicKey,
    wantSize: number,
    ixDisc: string,
    extraKeys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
  ): Promise<void> {
    const info = await connection.getAccountInfo(account);
    if (!info) { console.log(`migrate: ${account.toBase58()} не найден — пропускаю`); return; }
    if (info.data.length >= wantSize) {
      console.log(`migrate: ${account.toBase58()} уже ${info.data.length}B ≥ ${wantSize}B — ок`);
      return;
    }
    const tx = new Transaction();
    const progLamports = (await connection.getAccountInfo(PROGRAM_ID))?.lamports ?? 0;
    if (progLamports < 0.0015e9) {
      tx.add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: PROGRAM_ID, lamports: 0.001e9 }));
      console.log(`Баланс программы ${progLamports} lamports — доливаю 0.001 SOL под ренту realloc`);
    }
    tx.add(new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: account, isSigner: false, isWritable: true },
        ...extraKeys,
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc(ixDisc),
    }));
    const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
    console.log(`${ixDisc} ${account.toBase58()}: ${info.data.length}B → ${wantSize}B, tx:`, sig);
  }

  await migrateIfNeeded(configPda, NEW_CONFIG_SIZE, "migrate_config", []);
  await migrateIfNeeded(
    epochPdaOf(epochId),
    NEW_EPOCH_SIZE,
    "migrate_epoch",
    [{ pubkey: configPda, isSigner: false, isWritable: false }],
  );

  // ── Presale (idempotent): cap 500, SOL price 0.25 SOL ──
  if (await accountExists(presalePda)) {
    console.log(`\n${"Presale".padEnd(12)} ${presalePda.toBase58()} (exists)`);
  } else {
    console.log("\nInitializing presale (cap=500, SOL price=0.25 SOL; SKR price fixed at 1053 SKR in the program)...");
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: presalePda, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc("init_presale"), u32LE(500), u64LE(250_000_000n)]),
    });
    const sig = await send(ix);
    console.log("Presale initialized, tx:", sig);
  }

  // ── PDA vaults ──
  await ensurePdaVault(treasurySolPda, "treasury_sol");
  await ensurePdaVault(questTreasuryPda, "quest_treasury");

  // ── Quest pool: ATA (owner = quest_treasury PDA) + grant_reward up to 550 🥔 ──
  const questAta = await ensureAta(mint, questTreasuryPda);
  const questBal = (await getAccount(connection, questAta, "confirmed")).amount;
  if (questBal < QUEST_POOL_MICRO) {
    const grant = QUEST_POOL_MICRO - questBal;
    console.log(`\nFunding quest treasury: granting ${grant / MICRO} 🥔 (one-time achievement pool)...`);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: epochPdaOf(epochId), isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: questAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc("grant_reward"), u64LE(grant)]),
    });
    const sig = await send(ix);
    console.log("Quest pool funded, tx:", sig);
  } else {
    console.log(`\nQuest treasury already funded (${questBal / MICRO} 🥔).`);
  }

  // ── SKR ATAs for the presale split (80 % treasury / 20 % buyback) ──
  if (skrMintInfo) {
    const treasurySkrAta = await ensureAta(SKR_MINT, treasurySolPda);
    const buybackSkrAta = await ensureAta(SKR_MINT, admin.publicKey);
    console.log("\nSKR ATAs ready:");
    console.log("  treasury:  ", treasurySkrAta.toBase58());
    console.log("  buyback:   ", buybackSkrAta.toBase58());
  }

  const cfg = await connection.getAccountInfo(configPda);
  const authority = new PublicKey(cfg!.data.subarray(8, 8 + 32)).toBase58();
  console.log("\n=== Warm start complete — save these values ===");
  console.log("PROGRAM_ID:     ", PROGRAM_ID.toBase58());
  console.log("POTATO_MINT:    ", mint.toBase58());
  console.log("AUTHORITY:      ", authority);
  console.log("CONFIG_PDA:     ", configPda.toBase58());
  console.log("TREASURY_SOL:   ", treasurySolPda.toBase58());
  console.log("QUEST_TREASURY: ", questTreasuryPda.toBase58());
  console.log(`\nBackend:      PAYER_KEYPAIR_JSON=<выделенный low-privilege кошелёк с ~0.1 SOL; НЕ ${ADMIN_KEYPAIR_PATH} — AUDIT B4>`);
  console.log(`Frontend:     VITE_PROGRAM_ID=${PROGRAM_ID.toBase58()}  VITE_RPC_URL=${RPC_URL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
