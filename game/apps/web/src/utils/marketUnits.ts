import { LAMPORTS_PER_SOL } from '@solana/web3.js';

// fill_order uses System Program transfer, not the 6-decimal SKR token.
export const MARKET_MIN_TOTAL_LAMPORTS = 1_000_000;
export const lamportsToSol = (value: number | bigint): number => Number(value) / LAMPORTS_PER_SOL;

export function solToLamports(value: number): bigint {
  const lamports = Math.round(value * LAMPORTS_PER_SOL);
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(lamports) || lamports <= 0) {
    throw new Error('Enter a positive SOL price within the supported range');
  }
  return BigInt(lamports);
}

export function marketTotalLamports(amountMicro: bigint, priceLamports: bigint): number {
  const total = amountMicro * priceLamports / 1_000_000n;
  if (amountMicro < 0n || priceLamports < 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Order amount exceeds the supported display range');
  }
  return Number(total);
}
