// Диагноз ATA: 1) ground truth с devnet, 2) порядок сидов, 3) живой simulate
// обоих вариантов слотов CreateIdempotent для УЖЕ СУЩЕСТВУЮЩЕЙ ATA (идемпотентно).
// Запуск: RPC_URL="..." tsx scripts/ata-diag.ts
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config", "solana", "id.json"), "utf-8"))));
const quest = new PublicKey("9bGsUX3u2imMyLgu7ottPSxzXs1rSUGJfX9J9r3WJ5s2");

function fpa(seeds: PublicKey[], program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds.map((p) => p.toBuffer()), program)[0];
}

async function main() {
  console.log("ata-diag v2 (robust) — запущен");
  const res = await conn.getParsedTokenAccountsByOwner(admin.publicKey, { program: "spl-token" });
  console.log("Token-аккаунтов владельца:", res.value.length);
  let ta: any;
  for (const acc of res.value) {
    const info = (acc.account.data as any).parsed?.info;
    if (info?.mint && info?.owner && info?.tokenAmount) {
      ta = acc;
      break;
    }
  }
  if (!ta) {
    console.error("Подходящий аккаунт не найден. Первый аккаунт (сыро):");
    console.error(JSON.stringify(res.value[0]?.account.data, null, 2)?.slice(0, 800));
    throw new Error("нет parse-able token-аккаунта");
  }
  const info = (ta.account.data as any).parsed.info;
  const mint = new PublicKey(info.mint);
  const owner = new PublicKey(info.owner);
  const realAta = ta.pubkey;

  console.log("GROUND TRUTH (с devnet):");
  console.log("  mint        ", mint.toBase58());
  console.log("  owner       ", owner.toBase58());
  console.log("  реальная ATA", realAta.toBase58());
  console.log("");

  const sdk = getAssociatedTokenAddressSync(mint, owner, true);
  const pOwnerFirst = fpa([owner, mint, TOKEN_PROGRAM_ID], ASSOCIATED_TOKEN_PROGRAM_ID);
  const pMintFirst = fpa([mint, owner, TOKEN_PROGRAM_ID], ASSOCIATED_TOKEN_PROGRAM_ID);
  console.log("Деривации:");
  console.log("  SDK                    ", sdk.toBase58(), realAta.equals(sdk) ? "← МАРШИТ РЕАЛЬНОСТИ" : "");
  console.log("  [owner,mint,tp]        ", pOwnerFirst.toBase58(), realAta.equals(pOwnerFirst) ? "← МАРШИТ РЕАЛЬНОСТИ" : "");
  console.log("  [mint,owner,tp]        ", pMintFirst.toBase58(), realAta.equals(pMintFirst) ? "← МАРШИТ РЕАЛЬНОСТИ" : "");
  console.log("");

  // Живой тест слотов: CreateIdempotent для УЖЕ СУЩЕСТВУЮЩЕЙ ATA (идемпотент → успех = порядок верен)
  const sim = async (label: string, mintSlot: PublicKey, ownerSlot: PublicKey) => {
    const ix = new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: realAta, isSigner: false, isWritable: true },
        { pubkey: mintSlot, isSigner: false, isWritable: false },
        { pubkey: ownerSlot, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // CreateIdempotent
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(admin);
    try {
      const out = await conn.simulateTransaction(tx);
      const ok = out.value.err === null;
      console.log(`  слоты [2]=${mintSlot.equals(mint) ? "mint" : "owner"}, [3]=${ownerSlot.equals(mint) ? "mint" : "owner"}: ${ok ? "✅ УСПЕХ" : "❌ " + JSON.stringify(out.value.err)}`);
      return ok;
    } catch (e: any) {
      console.log(`  слоты [2]=${mintSlot.equals(mint) ? "mint" : "owner"}, [3]=${ownerSlot.equals(mint) ? "mint" : "owner"}: ❌ ${e.message?.split("\n")[0]}`);
      return false;
    }
  };

  console.log("Simulate CreateIdempotent для существующей ATA (оба варианта слотов):");
  const okA = await sim("A", mint, owner);
  const okB = await sim("B", owner, mint);
  console.log("");
  if (okA) console.log("ВЫВОД: порядок слотов [payer, ata, MINT, OWNER, system, token] — как в текущем скрипте");
  else if (okB) console.log("ВЫВОД: порядок слотов [payer, ata, OWNER, MINT, system, token] — слоты 2/3 ПОМЕНЯНЫ");
  else console.log("ВЫВОД: оба варианта не прошли — проблема глубже (см. выше)");
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
