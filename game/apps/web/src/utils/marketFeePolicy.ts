/**
 * Working V2 marketplace fee policy — зеркало `lib.rs`.
 *
 * Ставки 5/6/7/8 % считаются от объёма **сделки** (P0-5), а не от суточного
 * объёма продавца, поэтому имена говорят `TRADE_VOLUME`: прежнее
 * `SELLER_VOLUME_THRESHOLDS_MICRO` читалось как «объём продавца» и провоцировало
 * сверку с решением 2026-10-11 (9/10/11/12 %), которое относилось к другой базе.
 * Значения закреплены `tests/offchain/mirrorParity.test.ts` против Rust-источника.
 */
export const SETTLEMENT_FEE_BPS = [500n, 600n, 700n, 800n] as const
export const TRADE_VOLUME_THRESHOLDS_MICRO = [
  1_000n * 1_000_000n,
  10_000n * 1_000_000n,
  100_000n * 1_000_000n,
] as const
export const MIN_SETTLEMENT_GROSS_QUOTE_ATOMS = 1_000_000n
export const POTATO_MICRO = 1_000_000n
export const BPS_DENOMINATOR = 10_000n
export const U64_MAX = (1n << 64n) - 1n

export interface FeeSegment {
  readonly potatoMicro: bigint
  readonly grossQuoteAtoms: bigint
  readonly feeBps: bigint
  readonly feeQuoteAtoms: bigint
}

export interface SettlementBreakdown {
  readonly grossQuoteAtoms: bigint
  readonly feeQuoteAtoms: bigint
  readonly sellerNetQuoteAtoms: bigint
  readonly sellerVolumeBeforeMicro: bigint
  readonly sellerVolumeAfterMicro: bigint
  readonly segments: readonly FeeSegment[]
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive')
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator
}

/**
 * Fee tier for a position **inside one settlement's** marginal walk.
 *
 * The value passed in is the trade volume consumed so far (starting at 0), not
 * the seller's daily total — hence the neutral name. Client-side mirror of
 * `calculate_settlement_fee_v2` in lib.rs.
 */
export function feeBpsAtPricedVolume(volumeMicro: bigint): bigint {
  if (volumeMicro < 0n || volumeMicro > U64_MAX) throw new RangeError('invalid seller volume')
  if (volumeMicro < TRADE_VOLUME_THRESHOLDS_MICRO[0]) return SETTLEMENT_FEE_BPS[0]
  if (volumeMicro < TRADE_VOLUME_THRESHOLDS_MICRO[1]) return SETTLEMENT_FEE_BPS[1]
  if (volumeMicro < TRADE_VOLUME_THRESHOLDS_MICRO[2]) return SETTLEMENT_FEE_BPS[2]
  return SETTLEMENT_FEE_BPS[3]
}

/** Gross quote atoms for an amount priced in quote atoms per whole POTATO. */
export function grossQuoteAtomsForFill(amountMicro: bigint, priceQuoteAtomsPerPotato: bigint): bigint {
  if (amountMicro <= 0n || priceQuoteAtomsPerPotato <= 0n) throw new RangeError('amount and price must be positive')
  const gross = ceilDiv(amountMicro * priceQuoteAtomsPerPotato, POTATO_MICRO)
  if (gross > U64_MAX) throw new RangeError('gross quote amount exceeds u64')
  return gross
}

/**
 * Calculates the seller-paid V2 fee in the order's quote asset.
 *
 * P0-5: the ladder is priced on the **trade**, not on the seller. Every
 * settlement starts at the bottom tier, so a fresh wallet, a busy day and a
 * large history all cost the same: previously the tier came from the seller's
 * rolling UTC-day volume (`SellerVolumeV2`), which a seller could reset for
 * free by generating a new keypair — 5 % instead of 8 %, three percentage
 * points of treasury revenue given away with zero in-game effort, while
 * honest sellers paid more the more they sold.
 *
 * `sellerVolumeBeforeMicro` is still accepted and reported (events, stats,
 * `SellerVolumeV2` accounting) but does not affect the price.
 *
 * Quote-atom rounding uses cumulative ceil differences, so all segment gross
 * amounts sum exactly to the buyer's gross payment. The fee is rounded up per
 * segment, so fractional-atom rounding can only leave the fee equal or raise
 * it by a few atoms. This helper must stay byte-for-byte equivalent to
 * `calculate_settlement_fee_v2` in lib.rs.
 */
export function calculateSettlementFee(input: {
  readonly amountMicro: bigint
  readonly priceQuoteAtomsPerPotato: bigint
  readonly sellerVolumeBeforeMicro: bigint
}): SettlementBreakdown {
  const { amountMicro, priceQuoteAtomsPerPotato, sellerVolumeBeforeMicro } = input
  if (amountMicro <= 0n || amountMicro > U64_MAX) throw new RangeError('invalid fill amount')
  if (priceQuoteAtomsPerPotato <= 0n || priceQuoteAtomsPerPotato > U64_MAX) throw new RangeError('invalid quote price')
  if (sellerVolumeBeforeMicro < 0n || sellerVolumeBeforeMicro > U64_MAX) throw new RangeError('invalid seller volume')

  const sellerVolumeAfterMicro = sellerVolumeBeforeMicro + amountMicro
  if (sellerVolumeAfterMicro > U64_MAX) throw new RangeError('seller volume exceeds u64')
  const grossQuoteAtoms = grossQuoteAtomsForFill(amountMicro, priceQuoteAtomsPerPotato)
  if (grossQuoteAtoms < MIN_SETTLEMENT_GROSS_QUOTE_ATOMS) {
    throw new RangeError('gross quote amount is below the minimum market value')
  }

  const segments: FeeSegment[] = []
  let remainingMicro = amountMicro
  let consumedMicro = 0n
  // P0-5: ступень считается от объёма этой сделки, а не от дневного объёма
  // продавца. Ноль здесь — решение, а не забытый аргумент.
  let pricedVolumeMicro = 0n
  let quoteGrossAllocated = 0n
  let feeQuoteAtoms = 0n

  while (remainingMicro > 0n) {
    const bps = feeBpsAtPricedVolume(pricedVolumeMicro)
    const nextThreshold = TRADE_VOLUME_THRESHOLDS_MICRO.find((threshold) => pricedVolumeMicro < threshold)
    const tierCapacity = nextThreshold === undefined ? remainingMicro : nextThreshold - pricedVolumeMicro
    const segmentMicro = remainingMicro < tierCapacity ? remainingMicro : tierCapacity
    const nextConsumedMicro = consumedMicro + segmentMicro
    const quoteBefore = ceilDiv(consumedMicro * priceQuoteAtomsPerPotato, POTATO_MICRO)
    const quoteAfter = ceilDiv(nextConsumedMicro * priceQuoteAtomsPerPotato, POTATO_MICRO)
    const segmentGross = quoteAfter - quoteBefore
    const segmentFee = ceilDiv(segmentGross * bps, BPS_DENOMINATOR)

    segments.push({
      potatoMicro: segmentMicro,
      grossQuoteAtoms: segmentGross,
      feeBps: bps,
      feeQuoteAtoms: segmentFee,
    })
    quoteGrossAllocated += segmentGross
    feeQuoteAtoms += segmentFee
    remainingMicro -= segmentMicro
    consumedMicro = nextConsumedMicro
    pricedVolumeMicro += segmentMicro
  }

  if (quoteGrossAllocated !== grossQuoteAtoms) throw new Error('fee segment gross does not reconcile')
  if (feeQuoteAtoms >= grossQuoteAtoms) throw new RangeError('fee leaves no positive seller proceeds')

  return {
    grossQuoteAtoms,
    feeQuoteAtoms,
    sellerNetQuoteAtoms: grossQuoteAtoms - feeQuoteAtoms,
    sellerVolumeBeforeMicro,
    sellerVolumeAfterMicro,
    segments,
  }
}
