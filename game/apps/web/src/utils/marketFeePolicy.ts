/**
 * Working V2 marketplace fee policy. The 1k/10k/100k POTATO breakpoints below
 * are draft defaults pending final owner approval before release. This helper
 * is not used by live legacy Anchor instructions; keep that separation explicit
 * until the versioned program and quote-pair accounts are deployed.
 */
export const SETTLEMENT_FEE_BPS = [900n, 1_000n, 1_100n, 1_200n] as const
export const SELLER_VOLUME_THRESHOLDS_MICRO = [
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

export function feeBpsAtDailySellerVolume(volumeMicro: bigint): bigint {
  if (volumeMicro < 0n || volumeMicro > U64_MAX) throw new RangeError('invalid seller volume')
  if (volumeMicro < SELLER_VOLUME_THRESHOLDS_MICRO[0]) return SETTLEMENT_FEE_BPS[0]
  if (volumeMicro < SELLER_VOLUME_THRESHOLDS_MICRO[1]) return SETTLEMENT_FEE_BPS[1]
  if (volumeMicro < SELLER_VOLUME_THRESHOLDS_MICRO[2]) return SETTLEMENT_FEE_BPS[2]
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
 * Seller volume is measured in POTATO micro-units over one UTC day and is
 * shared across quote pairs. Each fill is split at the marginal tier
 * boundaries. Quote-atom rounding uses cumulative ceil differences, so all
 * segment gross amounts sum exactly to the buyer's gross payment. The fee is
 * rounded up per segment: splitting a sale across more fills cannot lower the
 * fee through fractional-atom rounding (it can only leave it equal or raise it
 * by a few quote atoms).
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
  let sellerVolumeMicro = sellerVolumeBeforeMicro
  let quoteGrossAllocated = 0n
  let feeQuoteAtoms = 0n

  while (remainingMicro > 0n) {
    const bps = feeBpsAtDailySellerVolume(sellerVolumeMicro)
    const nextThreshold = SELLER_VOLUME_THRESHOLDS_MICRO.find((threshold) => sellerVolumeMicro < threshold)
    const tierCapacity = nextThreshold === undefined ? remainingMicro : nextThreshold - sellerVolumeMicro
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
    sellerVolumeMicro += segmentMicro
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
