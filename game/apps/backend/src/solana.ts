import fs from "node:fs";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { env } from "./env.js";
import { anchorDiscriminator, u64LE, decodeGameConfig, decodeEpoch, GameConfig, EpochAccount } from "./anchorRaw.js";

export const programId = new PublicKey(env.programId);
export const connection = new Connection(env.rpcUrl, "confirmed");

/** Low-privilege payer key for roll_epoch (AUDIT B4: НЕ authority-ключ). */
export const payerKeypair = (() => {
  const raw = JSON.parse(fs.readFileSync(env.payerKeypairJson, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
})();

export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

export function epochPda(epochId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("epoch"), u64LE(epochId)], programId)[0];
}

export function treasuryAuthority(): PublicKey {
  return configPda();
}

export async function fetchConfig(): Promise<GameConfig> {
  const info = await connection.getAccountInfo(configPda());
  if (!info) throw new Error("Config account not found — run initialize first");
  return decodeGameConfig(info.data);
}

export async function fetchEpoch(epochId: bigint): Promise<EpochAccount> {
  const info = await connection.getAccountInfo(epochPda(epochId));
  if (!info) throw new Error(`Epoch ${epochId} account not found`);
  return decodeEpoch(info.data);
}

export function buildGrantRewardIx(params: {
  config: PublicKey;
  epoch: PublicKey;
  authority: PublicKey;
  potatoMint: PublicKey;
  userPotato: PublicKey;
  amountMicro: bigint;
}): TransactionInstruction {
  const data = Buffer.concat([anchorDiscriminator("global", "grant_reward"), u64LE(params.amountMicro)]);
  const keys = [
    { pubkey: params.config, isSigner: false, isWritable: true },
    { pubkey: params.epoch, isSigner: false, isWritable: true },
    { pubkey: params.authority, isSigner: true, isWritable: false },
    { pubkey: params.potatoMint, isSigner: false, isWritable: true },
    { pubkey: params.userPotato, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}

export function buildUpdateSkrMintIx(params: { config: PublicKey; authority: PublicKey; newSkrMint: PublicKey }): TransactionInstruction {
  const data = Buffer.concat([anchorDiscriminator("global", "update_skr_mint"), params.newSkrMint.toBuffer()]);
  return new TransactionInstruction({ programId, data, keys: [
    { pubkey: params.config, isSigner: false, isWritable: true },
    { pubkey: params.authority, isSigner: true, isWritable: false },
  ]});
}
export function buildUpdateRewardSignerIx(params: { config: PublicKey; authority: PublicKey; newSigner: PublicKey }): TransactionInstruction {
  const data = Buffer.concat([anchorDiscriminator("global", "update_reward_signer"), params.newSigner.toBuffer()]);
  return new TransactionInstruction({ programId, data, keys: [
    { pubkey: params.config, isSigner: false, isWritable: true },
    { pubkey: params.authority, isSigner: true, isWritable: false },
  ]});
}

export function buildRollEpochIx(params: {
  config: PublicKey;
  currentEpoch: PublicKey;
  nextEpoch: PublicKey;
  payer: PublicKey;
}): TransactionInstruction {
  const data = anchorDiscriminator("global", "roll_epoch");
  const keys = [
    { pubkey: params.config, isSigner: false, isWritable: true },
    { pubkey: params.currentEpoch, isSigner: false, isWritable: false },
    { pubkey: params.nextEpoch, isSigner: false, isWritable: true },
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}

export function buildInitEpochIx(params: {
  config: PublicKey;
  epoch: PublicKey;
  authority: PublicKey;
}): TransactionInstruction {
  const data = anchorDiscriminator("global", "init_epoch");
  const keys = [
    { pubkey: params.config, isSigner: false, isWritable: false },
    { pubkey: params.epoch, isSigner: false, isWritable: true },
    { pubkey: params.authority, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}

export function userPotatoAta(owner: PublicKey, potatoMint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(potatoMint, owner, false);
}

/**
 * Отправка через VersionedTransaction V0 + ComputeBudget + LUT (если передан).
 * Фолбэк на legacy Transaction для совместимости.
 * Для backend-крона это даёт ~30% экономии CU и защиту от 1232-байт лимита.
 */
export async function sendVersionedTx(
  instructions: TransactionInstruction[],
  opts?: { lookupTables?: AddressLookupTableAccount[]; extraSigners?: Keypair[] },
): Promise<string> {
  const priorityIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    ...instructions,
  ];
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const messageV0 = new TransactionMessage({
    payerKey: payerKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions: priorityIxs,
  }).compileToV0Message(opts?.lookupTables ?? []);
  const vtx = new VersionedTransaction(messageV0);
  vtx.sign([payerKeypair, ...(opts?.extraSigners ?? [])]);
  // simulate для раннего отлова EpochNotOver/EpochCapExceeded
  const sim = await connection.simulateTransaction(vtx, { sigVerify: false });
  if (sim.value.err) {
    const logs = (sim.value.logs ?? []).join("\n");
    if (/EpochNotOver|EpochCapExceeded|custom program error/i.test(logs)) throw new Error(logs.slice(0, 500));
  }
  const sig = await connection.sendTransaction(vtx, { skipPreflight: false, maxRetries: 3 });
  const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

export async function sendPayerTx(instructions: TransactionInstruction[]): Promise<string> {
  // Пытаемся Versioned, фолбэк на legacy если RPC не поддерживает
  try {
    return await sendVersionedTx(instructions);
  } catch {
    const tx = new Transaction().add(...instructions);
    return sendAndConfirmTransaction(connection, tx, [payerKeypair], { commitment: "confirmed" });
  }
}

export { SYSVAR_RENT_PUBKEY, ASSOCIATED_TOKEN_PROGRAM_ID };
