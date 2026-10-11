import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFixedPointUnits } from '../../apps/web/src/utils/marketUnits'
import {
  calculateSettlementFee,
  feeBpsAtDailySellerVolume,
  grossQuoteAtomsForFill,
  MIN_SETTLEMENT_GROSS_QUOTE_ATOMS,
  POTATO_MICRO,
  SELLER_VOLUME_THRESHOLDS_MICRO,
} from '../../apps/web/src/utils/marketFeePolicy'

test('progressive marginal tiers use cumulative daily seller POTATO volume', () => {
  assert.equal(feeBpsAtDailySellerVolume(0n), 900n)
  assert.equal(feeBpsAtDailySellerVolume(SELLER_VOLUME_THRESHOLDS_MICRO[0] - 1n), 900n)
  assert.equal(feeBpsAtDailySellerVolume(SELLER_VOLUME_THRESHOLDS_MICRO[0]), 1_000n)
  assert.equal(feeBpsAtDailySellerVolume(SELLER_VOLUME_THRESHOLDS_MICRO[1]), 1_100n)
  assert.equal(feeBpsAtDailySellerVolume(SELLER_VOLUME_THRESHOLDS_MICRO[2]), 1_200n)
})

test('crossing a tier inside a fill splits gross exactly and pays each marginal rate', () => {
  const result = calculateSettlementFee({
    amountMicro: 100n * POTATO_MICRO,
    priceQuoteAtomsPerPotato: 10_000_000n,
    sellerVolumeBeforeMicro: 999n * POTATO_MICRO + 500_000n,
  })

  assert.deepEqual(result.segments.map((segment) => segment.feeBps), [900n, 1_000n])
  assert.deepEqual(result.segments.map((segment) => segment.potatoMicro), [500_000n, 99_500_000n])
  assert.equal(result.segments.reduce((sum, segment) => sum + segment.grossQuoteAtoms, 0n), result.grossQuoteAtoms)
  assert.equal(result.grossQuoteAtoms, result.feeQuoteAtoms + result.sellerNetQuoteAtoms)
  assert.equal(result.sellerVolumeAfterMicro, 1_099n * POTATO_MICRO + 500_000n)
})

test('a large fill crosses all tiers and keeps seller net plus fee equal to gross', () => {
  const result = calculateSettlementFee({
    amountMicro: 120_000n * POTATO_MICRO,
    priceQuoteAtomsPerPotato: 1_000_000n,
    sellerVolumeBeforeMicro: 0n,
  })
  assert.deepEqual(result.segments.map((segment) => segment.feeBps), [900n, 1_000n, 1_100n, 1_200n])
  assert.deepEqual(result.segments.map((segment) => segment.potatoMicro), [1_000n * POTATO_MICRO, 9_000n * POTATO_MICRO, 90_000n * POTATO_MICRO, 20_000n * POTATO_MICRO])
  assert.equal(result.grossQuoteAtoms, 120_000n * 1_000_000n)
  assert.equal(result.grossQuoteAtoms, result.feeQuoteAtoms + result.sellerNetQuoteAtoms)
})

test('splitting a sale into orders cannot reduce the marginal fee and does not reset the daily tier', () => {
  const amount = 1_250n * POTATO_MICRO
  const price = 10_000_003n
  const whole = calculateSettlementFee({
    amountMicro: amount,
    priceQuoteAtomsPerPotato: price,
    sellerVolumeBeforeMicro: 0n,
  })

  let volume = 0n
  let splitFee = 0n
  let splitGross = 0n
  for (let i = 0; i < 25; i++) {
    const fill = calculateSettlementFee({
      amountMicro: 50n * POTATO_MICRO,
      priceQuoteAtomsPerPotato: price,
      sellerVolumeBeforeMicro: volume,
    })
    volume = fill.sellerVolumeAfterMicro
    splitFee += fill.feeQuoteAtoms
    splitGross += fill.grossQuoteAtoms
  }

  assert.equal(volume, amount)
  assert.ok(splitGross >= whole.grossQuoteAtoms)
  assert.ok(splitFee >= whole.feeQuoteAtoms)
})

test('gross rounding is upward and zero/tiny settlements are rejected', () => {
  assert.equal(grossQuoteAtomsForFill(POTATO_MICRO, 1_000_001n), 1_000_001n)
  assert.throws(() => calculateSettlementFee({
    amountMicro: 10n * POTATO_MICRO,
    priceQuoteAtomsPerPotato: 1n,
    sellerVolumeBeforeMicro: 0n,
  }), /below the minimum/)
  assert.throws(() => calculateSettlementFee({
    amountMicro: 0n,
    priceQuoteAtomsPerPotato: 1_000_000n,
    sellerVolumeBeforeMicro: 0n,
  }), /invalid fill amount/)
  assert.equal(MIN_SETTLEMENT_GROSS_QUOTE_ATOMS, 1_000_000n)
})

test('V2 quote input parsing is exact for SOL and six-decimal SKR without floats', () => {
  assert.equal(parseFixedPointUnits('0.000000001', 9), 1n)
  assert.equal(parseFixedPointUnits('12.340000000', 9), 12_340_000_000n)
  assert.equal(parseFixedPointUnits('12.340000', 6), 12_340_000n)
  assert.throws(() => parseFixedPointUnits('1e-3', 9), /decimal amount/)
  assert.throws(() => parseFixedPointUnits('-1', 6), /decimal amount/)
  assert.throws(() => parseFixedPointUnits('0.0000001', 6), /decimal places/)
})

test('deterministic split-fill property: 1,000 varied partitions never lower gross or fee', () => {
  let seed = 123_456_789
  const random = (maxExclusive: number): number => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
    return seed % maxExclusive
  }

  for (let sample = 0; sample < 1_000; sample++) {
    const totalPotato = 20 + random(2_000)
    const totalMicro = BigInt(totalPotato) * POTATO_MICRO
    const price = 1_000_000n + BigInt(random(1_000_000_000))
    const volumeBefore = BigInt(random(100_000)) * POTATO_MICRO
    const whole = calculateSettlementFee({
      amountMicro: totalMicro,
      priceQuoteAtomsPerPotato: price,
      sellerVolumeBeforeMicro: volumeBefore,
    })

    let remainingPotato = totalPotato
    let volume = volumeBefore
    let splitFee = 0n
    let splitGross = 0n
    while (remainingPotato > 0) {
      const maxPart = Math.min(50, remainingPotato - 10)
      const part = remainingPotato <= 50 ? remainingPotato : 10 + random(maxPart - 9)
      const fill = calculateSettlementFee({
        amountMicro: BigInt(part) * POTATO_MICRO,
        priceQuoteAtomsPerPotato: price,
        sellerVolumeBeforeMicro: volume,
      })
      splitFee += fill.feeQuoteAtoms
      splitGross += fill.grossQuoteAtoms
      volume = fill.sellerVolumeAfterMicro
      remainingPotato -= part
    }

    assert.ok(splitGross >= whole.grossQuoteAtoms, `gross reduced in sample ${sample}`)
    assert.ok(splitFee >= whole.feeQuoteAtoms, `fee reduced in sample ${sample}`)
  }
})
