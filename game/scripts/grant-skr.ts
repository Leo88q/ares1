/**
 * Devnet-утилита: начислить тестовый SKR кошелькам.
 *
 * Сначала смотрит, кто mint authority у SKR-минта:
 *   - authority = кошелёк admin (deployer) → ментит напрямую (ATA идемпотентно);
 *   - authority = config PDA программы → нужно on-chain instruction grant_skr
 *     (ответьте, что увидели — добавим в программу и задеплоим);
 *   - любой другой authority → мент невозможен, скрипт покажет адрес.
 *
 *   ADMIN_KEYPAIR_PATH=~/.config/solana/id.json RPC_URL=https://api.devnet.solana.com \
 *     npm run grant-skr -- HPMr5r9sS5ApWsPNJytZRLbm2jz1veFxTn1wepjAhtho 10000
 *
 * Формат аргументов: <wallet> <amount> [<wallet> <amount> ...] — amount в SKR
 * (6 decimals), например 10000 = 10 000 SKR.
 */
import fs from "node:fs";
import {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  mintTo,
} from "@solana/spl-token";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf");
const SKR_MINT = new PublicKey("Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o");
const ADMIN_KEYPAIR_PATH = (process.env.ADMIN_KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`).replace(/^~/, process.env.HOME || "");
const MICRO = 1_000_000n;

const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2 !== 0) {
  console.error("Использование: npm run grant-skr -- <wallet> <amount> [<wallet> <amount> ...]");
  process.exit(1);
}
const grants: Array<{ wallet: PublicKey; amountMicro: bigint }> = [];
for (let i = 0; i < args.length; i += 2) {
  grants.push({
    wallet: new PublicKey(args[i]),
    amountMicro: BigInt(Math.round(Number(args[i + 1]))) * MICRO,
  });
}

const connection = new Connection(RPC_URL, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf-8"))));
const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];

async function main() {
  const mintInfo = await getMint(connection, SKR_MINT, "confirmed");
  console.log("SKR mint:      ", SKR_MINT.toBase58());
  console.log("supply:        ", Number(mintInfo.supply) / 1e6, "SKR");
  console.log("mint authority:", mintInfo.mintAuthority?.toBase58() ?? "(none)");
  console.log("freeze auth:   ", mintInfo.freezeAuthority?.toBase58() ?? "(none)");
  console.log("admin wallet:  ", admin.publicKey.toBase58());

  if (!mintInfo.mintAuthority) {
    console.error("\n✖ Mint authority отозвана — SKR эмиссия невозможна вовсе.");
    process.exit(2);
  }

  if (!mintInfo.mintAuthority.equals(admin.publicKey)) {
    if (mintInfo.mintAuthority.equals(configPda)) {
      console.error(`\n✖ Mint authority = config PDA (${configPda.toBase58()}) — напрямую кошельком ментить нельзя.`);
      console.error("  Нужно on-chain instruction grant_skr (аналог grant_reward). Напишите — добавим и задеплоим.");
    } else {
      console.error(`\n✖ Mint authority = ${mintInfo.mintAuthority.toBase58()} — ни наш кошелёк, ни config PDA.`);
      console.error("  Варианты: отозвать/сменить authority или ментить из старого деплоя. Напишите адрес — решим.");
    }
    process.exit(2);
  }

  // authority = наш кошелёк → прямой мент
  for (const g of grants) {
    const ata = getAssociatedTokenAddressSync(SKR_MINT, g.wallet, false);
    const existing = await connection.getAccountInfo(ata);
    const tx = new Transaction();
    if (!existing) {
      // ATA принадлежит получателю, ренту платит admin (получатель может не иметь SOL).
      tx.add(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, g.wallet, SKR_MINT));
    }
    tx.add(mintTo(SKR_MINT, ata, admin, g.amountMicro));
    const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
    console.log(`✔ ${g.wallet.toBase58()}: +${g.amountMicro / MICRO} SKR → ${ata.toBase58()}\n  sig: ${sig}`);
  }
  console.log("\nГотово. Обновите страницу игры — баланс в шапке должен измениться.");
}

main().catch((err) => {
  console.error("Ошибка:", err?.message ?? err);
  process.exit(1);
});
