import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export function anchorDiscriminator(namespace: "global" | "account", name: string): Buffer {
  return crypto.createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);
}

export function u64LE(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}

export function readPubkey(data: Buffer, offset: number): { value: PublicKey; next: number } {
  return { value: new PublicKey(data.subarray(offset, offset + 32)), next: offset + 32 };
}

export function readU64(data: Buffer, offset: number): { value: bigint; next: number } {
  return { value: data.readBigUInt64LE(offset), next: offset + 8 };
}

export function readI64(data: Buffer, offset: number): { value: bigint; next: number } {
  return { value: data.readBigInt64LE(offset), next: offset + 8 };
}

export function readU16(data: Buffer, offset: number): { value: number; next: number } {
  return { value: data.readUInt16LE(offset), next: offset + 2 };
}

export function readU8(data: Buffer, offset: number): { value: number; next: number } {
  return { value: data.readUInt8(offset), next: offset + 1 };
}

export function readBool(data: Buffer, offset: number): { value: boolean; next: number } {
  return { value: data.readUInt8(offset) !== 0, next: offset + 1 };
}

export interface GameConfig {
  authority: PublicKey;
  pendingAuthority: PublicKey;
  potatoMint: PublicKey;
  skrMint: PublicKey;
  rewardSigner: PublicKey;
  maxSupplyMicro: bigint;
  dailyMintCapMicro: bigint;
  baseYieldMicroPerDay: bigint;
  globalMultiplierBps: number;
  fieldCount: bigint;
  epochId: bigint;
  totalBurnedMicro: bigint;
  /** v2: total_burned snapshot on the previous roll_epoch (elastic cap). */
  lastTotalBurnedMicro: bigint;
  paused: boolean;
  bump: number;
}

export function decodeGameConfig(data: Buffer): GameConfig {
  let o = 8; // skip account discriminator
  const authority = readPubkey(data, o); o = authority.next;
  const pendingAuthority = readPubkey(data, o); o = pendingAuthority.next;
  const potatoMint = readPubkey(data, o); o = potatoMint.next;
  let skrMint: PublicKey, rewardSigner: PublicKey
  if (data.length >= 8 + 32*5 + 8*4 + 2 + 8*3 + 1 + 1) {
    const skr = readPubkey(data, o); o = skr.next; skrMint = skr.value
    const rw = readPubkey(data, o); o = rw.next; rewardSigner = rw.value
  } else {
    skrMint = new PublicKey('Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o')
    rewardSigner = authority.value
  }
  const maxSupplyMicro = readU64(data, o); o = maxSupplyMicro.next;
  const dailyMintCapMicro = readU64(data, o); o = dailyMintCapMicro.next;
  const baseYieldMicroPerDay = readU64(data, o); o = baseYieldMicroPerDay.next;
  const globalMultiplierBps = readU16(data, o); o = globalMultiplierBps.next;
  const fieldCount = readU64(data, o); o = fieldCount.next;
  const epochId = readU64(data, o); o = epochId.next;
  const totalBurnedMicro = readU64(data, o); o = totalBurnedMicro.next;
  const lastTotalBurnedMicro = readU64(data, o); o = lastTotalBurnedMicro.next;
  const paused = readBool(data, o); o = paused.next;
  const bump = readU8(data, o);
  return {
    authority: authority.value,
    pendingAuthority: pendingAuthority.value,
    potatoMint: potatoMint.value,
    skrMint,
    rewardSigner,
    maxSupplyMicro: maxSupplyMicro.value,
    dailyMintCapMicro: dailyMintCapMicro.value,
    baseYieldMicroPerDay: baseYieldMicroPerDay.value,
    globalMultiplierBps: globalMultiplierBps.value,
    fieldCount: fieldCount.value,
    epochId: epochId.value,
    totalBurnedMicro: totalBurnedMicro.value,
    lastTotalBurnedMicro: lastTotalBurnedMicro.value,
    paused: paused.value,
    bump: bump.value,
  };
}

export interface EpochAccount {
  id: bigint;
  mintCapMicro: bigint;
  mintedMicro: bigint;
  startTime: bigint;
  bump: number;
  /** v2: burn accounted during this epoch (elastic cap axis). */
  burnedMicro: bigint;
}

export function decodeEpoch(data: Buffer): EpochAccount {
  let o = 8;
  const id = readU64(data, o); o = id.next;
  const mintCapMicro = readU64(data, o); o = mintCapMicro.next;
  const mintedMicro = readU64(data, o); o = mintedMicro.next;
  const startTime = readI64(data, o); o = startTime.next;
  const bump = readU8(data, o); o = bump.next;
  const burnedMicro = readU64(data, o);
  return {
    id: id.value,
    mintCapMicro: mintCapMicro.value,
    mintedMicro: mintedMicro.value,
    startTime: startTime.value,
    bump: bump.value,
    burnedMicro: burnedMicro.value,
  };
}
