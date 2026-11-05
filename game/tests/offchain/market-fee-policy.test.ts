import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFixedPointUnits } from '../../apps/web/src/utils/marketUnits'
import {
  calculateSettlementFee,
  feeBpsAtPricedVolume,
  grossQuoteAtomsForFill,
  MIN_SETTLEMENT_GROSS_QUOTE_ATOMS,
  POTATO_MICRO,
  TRADE_VOLUME_THRESHOLDS_MICRO,
} from '../../apps/web/src/utils/marketFeePolicy'

test('marginal tiers are a function of the trade volume only', () => {
  assert.equal(feeBpsAtPricedVolume(0n), 500n)
  assert.equal(feeBpsAtPricedVolume(TRADE_VOLUME_THRESHOLDS_MICRO[0] - 1n), 500n)
  assert.equal(feeBpsAtPricedVolume(TRADE_VOLUME_THRESHOLDS_MICRO[0]), 600n)
  assert.equal(feeBpsAtPricedVolume(TRADE_VOLUME_THRESHOLDS_MICRO[1]), 700n)
  assert.equal(feeBpsAtPricedVolume(TRADE_VOLUME_THRESHOLDS_MICRO[2]), 800n)
})

test('crossing a tier inside one fill splits gross exactly and pays each marginal rate', () => {
  // P0-5: филл на 1 100 POTATO стартует с нуля сделки — 1 000 по 5 %, 100 по 6 %.
  const result = calculateSettlementFee({
    amountMicro: 1_100n * POTATO_MICRO,
    priceQuoteAtomsPerPotato: 10_000_000n,
    sellerVolumeBeforeMicro: 0n,
  })

  assert.deepEqual(result.segments.map((segment) => segment.feeBps), [500n, 600n])
  assert.deepEqual(result.segments.map((segment) => segment.potatoMicro), [1_000n * POTATO_MICRO, 100n * POTATO_MICRO])
  assert.equal(result.segments.reduce((sum, segment) => sum + segment.grossQuoteAtoms, 0n), result.grossQuoteAtoms)
  assert.equal(result.grossQuoteAtoms, result.feeQuoteAtoms + result.sellerNetQuoteAtoms)
  // Дневной объём продавца остаётся учётом, но не ценой: та же сделка у
  // «ветерана» с 500k POTATO стоит столько же.
  const veteran = calculateSettlementFee({
    amountMicro: 1_100n * POTATO_MICRO,
    priceQuoteAtomsPerPotato: 10_000_000n,
    sellerVolumeBeforeMicro: 500_000n * POTATO_MICRO,
  })
  assert.equal(veteran.feeQuoteAtoms, result.feeQuoteAtoms)
  assert.equal(veteran.sellerVolumeBeforeMicro, 500_000n * POTATO_MICRO)
  assert.equal(veteran.sellerVolumeAfterMicro, 501_100n * POTATO_MICRO)
})

test('a large fill crosses all tiers and keeps seller net plus fee equal to gross', () => {
  const result = calculateSettlementFee({
    amountMicro: 120_000n * POTATO_MICRO,
    priceQuoteAtomsPerPotato: 1_000_000n,
    sellerVolumeBeforeMicro: 0n,
  })
  assert.deepEqual(result.segments.map((segment) => segment.feeBps), [500n, 600n, 700n, 800n])
  assert.deepEqual(result.segments.map((segment) => segment.potatoMicro), [1_000n * POTATO_MICRO, 9_000n * POTATO_MICRO, 90_000n * POTATO_MICRO, 20_000n * POTATO_MICRO])
  assert.equal(result.grossQuoteAtoms, 120_000n * 1_000_000n)
  assert.equal(result.grossQuoteAtoms, result.feeQuoteAtoms + result.sellerNetQuoteAtoms)
})

test('the fee no longer depends on who sells: switching wallets buys nothing', () => {
  // P0-5: раньше tier брался из дневного объёма продавца, поэтому «свежий
  // кошелёк на каждую сделку» давал 5 % вместо 8 % бесплатно. Теперь цена
  // одинакова для нового адреса и для адреса с 500k POTATO за сутки.
  const amount = 10n * POTATO_MICRO
  const price = 1_000_000n
  const fresh = calculateSettlementFee({ amountMicro: amount, priceQuoteAtomsPerPotato: price, sellerVolumeBeforeMicro: 0n })
  const veteran = calculateSettlementFee({
    amountMicro: amount,
    priceQuoteAtomsPerPotato: price,
    sellerVolumeBeforeMicro: 500_000n * POTATO_MICRO,
  })
  assert.equal(feeBpsAtPricedVolume(0n), 500n)
  assert.equal(fresh.feeQuoteAtoms, veteran.feeQuoteAtoms)
  assert.equal(fresh.segments.map(s => s.feeBps).join(), veteran.segments.map(s => s.feeBps).join())

  // Дробление одной крупной сделки на мелкие по-прежнему дешевле — это
  // свойство нелинейной шкалы, и оно платится реальными транзакциями и
  // отдельным контрагентом на каждый филл (self-trade запрещён), а не
  // генерацией ключей. Фиксируем факт, чтобы он не считался защитой.
  const whole = calculateSettlementFee({ amountMicro: 1_250n * POTATO_MICRO, priceQuoteAtomsPerPotato: 10_000_003n, sellerVolumeBeforeMicro: 0n })
  let splitFee = 0n
  for (let i = 0; i < 25; i++) {
    const fill = calculateSettlementFee({ amountMicro: 50n * POTATO_MICRO, priceQuoteAtomsPerPotato: 10_000_003n, sellerVolumeBeforeMicro: 0n })
    splitFee += fill.feeQuoteAtoms
  }
  assert.ok(splitFee < whole.feeQuoteAtoms, 'granularity of the ladder is a known, priced limitation')
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

test('deterministic property: 1,000 varied trades split gross exactly and never mix seller history into price', () => {
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
    // История продавца не участвует в цене: тот же филл с нулевой историей
    // стоит ровно столько же.
    const noHistory = calculateSettlementFee({
      amountMicro: totalMicro,
      priceQuoteAtomsPerPotato: price,
      sellerVolumeBeforeMicro: 0n,
    })
    assert.equal(whole.feeQuoteAtoms, noHistory.feeQuoteAtoms, `seller history changed the fee in sample ${sample}`)

    // Каждый сегмент положителен, сумма сегментов равна gross, net + fee = gross.
    assert.equal(whole.grossQuoteAtoms, whole.feeQuoteAtoms + whole.sellerNetQuoteAtoms)
    assert.equal(whole.segments.reduce((sum, segment) => sum + segment.grossQuoteAtoms, 0n), whole.grossQuoteAtoms)
    assert.ok(whole.segments.every(segment => segment.potatoMicro > 0n))

    let remainingPotato = totalPotato
    let splitGross = 0n
    while (remainingPotato > 0) {
      const maxPart = Math.min(50, remainingPotato - 10)
      const part = remainingPotato <= 50 ? remainingPotato : 10 + random(maxPart - 9)
      const fill = calculateSettlementFee({
        amountMicro: BigInt(part) * POTATO_MICRO,
        priceQuoteAtomsPerPotato: price,
        sellerVolumeBeforeMicro: 0n,
      })
      splitGross += fill.grossQuoteAtoms
      remainingPotato -= part
    }

    // Gross одной сделки не может быть меньше суммы gross её частей: округление
    // каждого филла вверх, поэтому дробление никогда не «экономит» атомы.
    assert.ok(splitGross >= whole.grossQuoteAtoms, `gross reduced in sample ${sample}`)
  }
})
