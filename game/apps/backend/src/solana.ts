import fs from "node:fs";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
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

/** AdminState singleton PDA: withdrawal rate limits + timelocked proposals. */
export function adminStatePda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("admin_state")], programId)[0];
}

export async function fetchConfig(): Promise<GameConfig> {
  const info = await connection.getAccountInfo(configPda());
  if (!info) throw new Error("Config account not found — run initialize first");
  if (!info.owner.equals(programId)) throw new Error("Config account has unexpected owner");
  return decodeGameConfig(info.data);
}

export async function fetchEpoch(epochId: bigint): Promise<EpochAccount> {
  const info = await connection.getAccountInfo(epochPda(epochId));
  if (!info) throw new Error(`Epoch ${epochId} account not found`);
  if (!info.owner.equals(programId)) throw new Error("Epoch account has unexpected owner");
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

/**
 * Step 1 of the timelocked SKR mint migration: stores a proposal in AdminState.
 * The config is NOT touched until buildApplyPendingSkrMintIx runs 24h later.
 */
export function buildUpdateSkrMintIx(params: { config: PublicKey; adminState: PublicKey; authority: PublicKey; newSkrMint: PublicKey }): TransactionInstruction {
  const data = Buffer.concat([anchorDiscriminator("global", "update_skr_mint"), params.newSkrMint.toBuffer()]);
  return new TransactionInstruction({ programId, data, keys: [
    { pubkey: params.config, isSigner: false, isWritable: false },
    { pubkey: params.adminState, isSigner: false, isWritable: true },
    { pubkey: params.authority, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]});
}

/** Step 2 of the SKR mint migration (after the admin timelock expires). */
export function buildApplyPendingSkrMintIx(params: { config: PublicKey; adminState: PublicKey; authority: PublicKey }): TransactionInstruction {
  const data = anchorDiscriminator("global", "apply_pending_skr_mint");
  return new TransactionInstruction({ programId, data, keys: [
    { pubkey: params.config, isSigner: false, isWritable: true },
    { pubkey: params.adminState, isSigner: false, isWritable: true },
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
  // Simulate is a hard gate: if the simulation fails, the real transaction
  // would fail too — sending it anyway burns fees and hides bugs (AUDIT H-5).
  const sim = await connection.simulateTransaction(vtx, { sigVerify: false });
  if (sim.value.err) {
    const logs = (sim.value.logs ?? []).join("\n");
    throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)} — ${logs.slice(0, 500)}`);
  }
  const sig = await connection.sendTransaction(vtx, { skipPreflight: false, maxRetries: 3 });
  const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

export async function sendPayerTx(instructions: TransactionInstruction[]): Promise<string> {
  // NO legacy fallback: sendVersionedTx may throw AFTER the transaction was
  // already sent (e.g. confirmation timeout). Re-sending as legacy would
  // execute the same state change twice (AUDIT H-5: double roll_epoch).
  // Versioned txs are supported by every modern RPC; if one is not, fail loudly.
  return sendVersionedTx(instructions);
}

export { SYSVAR_RENT_PUBKEY, ASSOCIATED_TOKEN_PROGRAM_ID };
