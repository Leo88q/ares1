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

/** Parse decimal input exactly (dot or one decimal comma); reject exponent notation and excess decimals. */
export function parseFixedPointUnits(text: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new RangeError('invalid decimals')
  const trimmed = text.trim()
  const normalized = trimmed.includes(',') && !trimmed.includes('.') && (trimmed.match(/,/g)?.length ?? 0) === 1
    ? trimmed.replace(',', '.')
    : trimmed
  const match = /^(\d+)(?:\.(\d*))?$/.exec(normalized)
  if (!match) throw new Error('Enter a non-negative decimal amount')
  const fraction = match[2] ?? ''
  if (fraction.length > decimals) throw new Error(`At most ${decimals} decimal places are allowed`)
  const scale = 10n ** BigInt(decimals)
  const whole = BigInt(match[1]) * scale
  const fractional = fraction.length ? BigInt(fraction.padEnd(decimals, '0')) : 0n
  return whole + fractional
}

/** Format integer token units without converting through IEEE-754 numbers. */
export function formatFixedPointUnits(value: bigint, decimals: number, displayDecimals = decimals): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new RangeError('invalid decimals')
  if (!Number.isInteger(displayDecimals) || displayDecimals < 0 || displayDecimals > decimals) {
    throw new RangeError('invalid display decimals')
  }
  const negative = value < 0n
  const absolute = negative ? -value : value
  const divisor = 10n ** BigInt(decimals - displayDecimals)
  const rounded = (absolute + divisor / 2n) / divisor
  const displayScale = 10n ** BigInt(displayDecimals)
  const whole = rounded / displayScale
  if (displayDecimals === 0) return `${negative ? '-' : ''}${whole}`
  const fraction = (rounded % displayScale).toString().padStart(displayDecimals, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

/** Exact units-to-decimal display with insignificant fractional zeroes removed. */
export function formatFixedPointUnitsExact(value: bigint, decimals: number): string {
  const fixed = formatFixedPointUnits(value, decimals, decimals)
  if (!fixed.includes('.')) return fixed
  return fixed.replace(/0+$/, '').replace(/\.$/, '')
}

export function marketTotalLamports(amountMicro: bigint, priceLamports: bigint): number {
  const total = amountMicro * priceLamports / 1_000_000n;
  if (amountMicro < 0n || priceLamports < 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Order amount exceeds the supported display range');
  }
  return Number(total);
}
