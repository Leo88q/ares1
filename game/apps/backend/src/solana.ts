import fs from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { env } from "./env.js";
import { anchorDiscriminator, u64LE, decodeGameConfig, decodeEpoch, GameConfig, EpochAccount } from "./anchorRaw.js";

export const programId = new PublicKey(env.programId);
export const connection = new Connection(env.rpcUrl, "confirmed");

export const authorityKeypair = (() => {
  const raw = JSON.parse(fs.readFileSync(env.authorityKeypairJson, "utf-8"));
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

export async function sendAdminTx(instructions: TransactionInstruction[]): Promise<string> {
  const tx = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(connection, tx, [authorityKeypair], { commitment: "confirmed" });
}

export { SYSVAR_RENT_PUBKEY, ASSOCIATED_TOKEN_PROGRAM_ID };
