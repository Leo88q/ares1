import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { chainConfig } from "../content";
import { pdas, treasurySolPda, decodeConfig } from "../utils/anchorClient";

/** Read-only devnet telemetry for the live game contract; no presale state. */
export interface LiveChainStats {
  online: boolean;
  updatedAt: number;
  /** GameConfig.field_count */
  fieldCount: number;
  /** GameConfig.total_burned_micro (POTATO, 6 decimals) */
  burnedMicro: bigint;
  /** POTATO mint supply (base units), or null if unavailable */
  supplyMicro: bigint | null;
  /** unique field owners, or null when the RPC query is unavailable */
  players: number | null;
  /** lamports in the program's SOL treasury PDA, or null if unavailable */
  treasuryLamports: bigint | null;
  /** GameConfig.paused — reported as contract state, never controlled here */
  paused: boolean;
}

const DEFAULT_STATS: LiveChainStats = {
  online: false,
  updatedAt: 0,
  fieldCount: 0,
  burnedMicro: 0n,
  supplyMicro: null,
  players: null,
  treasuryLamports: null,
  paused: false,
};

const PROGRAM_ID = new PublicKey(chainConfig.programId);

interface RpcResult<T> {
  result?: T;
  error?: { message?: string };
}

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(chainConfig.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = (await res.json()) as RpcResult<T>;
    if (json.error) return null;
    return json.result ?? null;
  } catch {
    return null;
  }
}

interface Base64Account {
  value?: { data?: [string, string] } | null;
}

interface ParsedMintAccount {
  value?: { data?: { parsed?: { info?: { supply?: string } } } } | null;
}

interface ProgramAccount {
  pubkey: string;
  account: { data: [string, string] };
}

async function loadOnce(): Promise<LiveChainStats> {
  const { config: configPda } = pdas(PROGRAM_ID);
  const [cfgRes, supplyRes, fieldsRes, treasuryRes] = await Promise.all([
    rpc<Base64Account>("getAccountInfo", [configPda().toBase58(), { encoding: "base64" }]),
    rpc<ParsedMintAccount>("getAccountInfo", [chainConfig.potatoMint, { encoding: "jsonParsed" }]),
    rpc<ProgramAccount[]>("getProgramAccounts", [
      PROGRAM_ID.toBase58(),
      {
        encoding: "base64",
        // Owner is the first 32-byte field immediately after the discriminator.
        dataSlice: { offset: 8, length: 32 },
        filters: [{ dataSize: 70 }],
      },
    ]),
    rpc<Base64Account>("getAccountInfo", [treasurySolPda(PROGRAM_ID).toBase58(), { encoding: "base64" }]),
  ]);

  const next: LiveChainStats = { ...DEFAULT_STATS, updatedAt: Date.now() };

  if (cfgRes?.value?.data) {
    const cfg = decodeConfig(Buffer.from(cfgRes.value.data[0], "base64"));
    next.fieldCount = Number(cfg.fieldCount);
    next.burnedMicro = cfg.totalBurnedMicro;
    next.paused = cfg.paused;
    next.online = true;
  }

  const mintSupply = supplyRes?.value?.data?.parsed?.info?.supply;
  if (mintSupply !== undefined) next.supplyMicro = BigInt(mintSupply);

  if (Array.isArray(fieldsRes)) {
    const owners = new Set<string>();
    for (const item of fieldsRes) owners.add(item.account.data[0]);
    next.players = owners.size;
    if (owners.size > 0) next.online = true;
  }

  if (treasuryRes?.value?.data) {
    const data = Buffer.from(treasuryRes.value.data[0], "base64");
    if (data.length >= 8) next.treasuryLamports = data.readBigUInt64LE(0);
  }

  return next;
}

let cache: LiveChainStats | null = null;
let timer: number | null = null;
const listeners = new Set<(stats: LiveChainStats) => void>();

function refresh(): void {
  void loadOnce().then((stats) => {
    cache = stats;
    for (const listener of listeners) listener(stats);
  });
}

export function useLiveChain(): LiveChainStats {
  const [stats, setStats] = useState<LiveChainStats>(cache ?? DEFAULT_STATS);

  useEffect(() => {
    const update = (next: LiveChainStats): void => {
      cache = next;
      setStats(next);
    };

    listeners.add(update);
    if (timer === null) {
      refresh();
      timer = window.setInterval(refresh, 60_000);
    }

    return () => {
      listeners.delete(update);
      if (listeners.size === 0 && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
  }, []);

  return stats;
}
