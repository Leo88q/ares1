import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { chainConfig, presale } from "../content";
import {
  pdas,
  presaleStatePda,
  treasurySolPda,
  decodeConfig,
} from "../utils/anchorClient";

/**
 * Живая телеметрия devnet-цепи: продажные модули, поля, игроки,
 * сожжённый POTATO, supply, казна. Один общий poller на 60 секунд
 * на всех подписчиков (Hero + секция телеметрии).
 */
export interface LiveChainStats {
  online: boolean;
  updatedAt: number;
  /** PresaleState.sold */
  sold: number;
  /** PresaleState.cap */
  cap: number;
  /** PresaleState.price_lamports (SOL-рейл) */
  priceLamports: bigint;
  /** GameConfig.field_count */
  fieldCount: number;
  /** GameConfig.total_burned_micro (POTATO, 6 decimals) */
  burnedMicro: bigint;
  /** supply $POTATO (base units) или null, если mint недоступен */
  supplyMicro: bigint | null;
  /** уникальные владельцы полей (getProgramAccounts) или null */
  players: number | null;
  /** lamports в казне (treasury SOL PDA) или null */
  treasuryLamports: bigint | null;
  /** GameConfig.paused */
  paused: boolean;
}

const DEFAULT_STATS: LiveChainStats = {
  online: false,
  updatedAt: 0,
  sold: presale.sold,
  cap: presale.supply,
  priceLamports: chainConfig.presalePriceSolLamports,
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

  const [cfgRes, presaleRes, supplyRes, fieldsRes, treasuryRes] =
    await Promise.all([
      rpc<Base64Account>("getAccountInfo", [
        configPda().toBase58(),
        { encoding: "base64" },
      ]),
      rpc<Base64Account>("getAccountInfo", [
        presaleStatePda(PROGRAM_ID).toBase58(),
        { encoding: "base64" },
      ]),
      rpc<ParsedMintAccount>("getAccountInfo", [
        chainConfig.potatoMint,
        { encoding: "jsonParsed" },
      ]),
      rpc<ProgramAccount[]>("getProgramAccounts", [
        PROGRAM_ID.toBase58(),
        {
          encoding: "base64",
          // owner лежит сразу после 8-байтного discriminator
          dataSlice: { offset: 8, length: 32 },
          filters: [{ dataSize: 70 }],
        },
      ]),
      rpc<Base64Account>("getAccountInfo", [
        treasurySolPda(PROGRAM_ID).toBase58(),
        { encoding: "base64" },
      ]),
    ]);

  const next: LiveChainStats = {
    ...DEFAULT_STATS,
    online: false,
    updatedAt: Date.now(),
  };

  // PresaleState: disc(8) + authority(32) | sold u32 @40, cap u32 @44, price_lamports u64 @48
  if (presaleRes?.value?.data) {
    const data = Buffer.from(presaleRes.value.data[0], "base64");
    if (data.length >= 56) {
      next.sold = data.readUInt32LE(40);
      next.cap = data.readUInt32LE(44);
      next.priceLamports = data.readBigUInt64LE(48);
      next.online = true;
    }
  }

  // GameConfig: authority @8, ..., field_count u64 @130, total_burned_micro @146
  if (cfgRes?.value?.data) {
    const data = Buffer.from(cfgRes.value.data[0], "base64");
    const cfg = decodeConfig(data);
    next.fieldCount = Number(cfg.fieldCount);
    next.burnedMicro = cfg.totalBurnedMicro;
    next.paused = cfg.paused;
    next.online = true;
  }

  if (supplyRes?.value?.data?.parsed?.info?.supply !== undefined) {
    next.supplyMicro = BigInt(supplyRes.value.data.parsed.info.supply);
  }

  if (Array.isArray(fieldsRes)) {
    // dataSlice = owner (32 байта): уникальный строковый ключ = уникальный владелец
    const owners = new Set<string>();
    for (const item of fieldsRes) {
      owners.add(item.account.data[0]);
    }
    next.players = owners.size;
    if (owners.size > 0) next.online = true;
  }

  if (treasuryRes?.value?.data) {
    // SystemAccount: lamports u64 @0
    const data = Buffer.from(treasuryRes.value.data[0], "base64");
    if (data.length >= 8) {
      next.treasuryLamports = data.readBigUInt64LE(0);
    }
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
