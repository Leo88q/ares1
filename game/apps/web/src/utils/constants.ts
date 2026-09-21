/**
 * Mirror of the on-chain constants in programs/solana_potato/src/lib.rs.
 * Keep the two files in sync — tests/offchain/upkeepCosts.test.ts checks
 * upkeep prices against the Rust source constants and integer formulas.
 */
import { t } from '../i18n'

export const MICRO = 1_000_000
export const BPS = 10_000
export const SECONDS_PER_DAY = 86_400
/** Mirror of Rust MAX_ACCRUAL_SECONDS: 7 days. */
export const MAX_ACCRUAL_SECONDS = 7 * SECONDS_PER_DAY
export const MIN_HARVEST_INTERVAL = 60
export const MAX_FIELD_LEVEL = 50
export const MAX_DURABILITY = 100
export const TAX_PERIOD_DAYS = 7
export const MAX_TAX_PREPAY_DAYS = 28
export const FERTILIZER_HOURS = 24
export const MAX_FERTILIZER_PREPAY_DAYS = 7
export const ORDER_TTL_HOURS = 24
export const CANCEL_COOLDOWN_HOURS = 3
export const MIN_ORDER_AMOUNT_POTATO = 10
export const FEE_BURN_PERCENT = 60
export const EXPORT_LICENSE_PRICE_SKR_ATOMS = 500_000_000n // 500 SKR (6 decimals)
export const UNPAID_TAX_YIELD_BPS = 5_000
export const FERTILIZER_YIELD_BPS = 15_000
/** Harvest button becomes active above this amount (0.1 POTATO). */
export const HARVEST_THRESHOLD_MICRO = 100_000

export interface FieldTypeInfo {
 id: 0 | 1 | 2
 name: string
 emoji: string
 yieldBps: number
 costBps: number
}

export const FIELD_TYPES: readonly FieldTypeInfo[] = [
 { id: 0, name: 'Common', emoji: '', yieldBps: 3_500, costBps: 4_000 },
 { id: 1, name: 'Rare', emoji: 'POTATO', yieldBps: 10_000, costBps: 10_000 },
 { id: 2, name: 'Epic', emoji: '', yieldBps: 21_000, costBps: 20_000 },
]

export function fieldTypeInfo(fieldType: number): FieldTypeInfo {
 return FIELD_TYPES[Math.min(Math.max(fieldType, 0), 2)]
}

export interface MutationInfo {
 id: number
 name: string
 code: string
 effect: string
 color: string
}

const MUTATIONS: MutationInfo[] = [
 { id: 0, name: 'Стандарт', code: 'STD', effect: 'Базовая генетика', color: '#64748b' },
 { id: 1, name: 'Золотой росток', code: 'GOLD', effect: '+25% к урожаю', color: 'var(--pf-gold)' },
 { id: 2, name: 'Кремниевая оболочка', code: 'SILI', effect: 'Износ x0.5', color: '#94a3b8' },
]

export function mutationInfo(type: number): MutationInfo {
 const m = MUTATIONS[Math.min(Math.max(type, 0), MUTATIONS.length - 1)]
 return { ...m, name: t(m.name), effect: t(m.effect) }
}

/** Reference prices for field type 1 (“Луг”), in micro POTATO. */
const BASE_COST_MICRO = {
 field: 250 * MICRO,
 tax: 6 * MICRO,
 repair: 15 * MICRO,
 fertilizer: 10 * MICRO,
 upgrade: 100 * MICRO,
} as const

export function scaledCostMicro(baseMicro: number, fieldType: number): number {
 return Math.floor((baseMicro * fieldTypeInfo(fieldType).costBps) / BPS)
}

export const fieldPriceMicro = (fieldType: number) => scaledCostMicro(BASE_COST_MICRO.field, fieldType)
/** Rust uses integer division: L1–2 → 1×, L3–4 → 2×, L49–50 → 25×. */
export const taxCostMicro = (level: number, fieldType: number) =>
 scaledCostMicro(BASE_COST_MICRO.tax, fieldType) * Math.floor((level + 1) / 2)

/** Rust floors level / 3, then clamps to 1: L1–5 → 1×, L6–8 → 2×. */
export const repairCostMicro = (level: number, fieldType: number) =>
 scaledCostMicro(BASE_COST_MICRO.repair, fieldType) * Math.max(Math.floor(level / 3), 1)
export const fertilizerCostMicro = (fieldType: number) => scaledCostMicro(BASE_COST_MICRO.fertilizer, fieldType)

/** Cost of upgrading from `level` to `level + 1`. */
export function upgradeCostMicro(level: number, fieldType: number): number {
 return scaledCostMicro(BASE_COST_MICRO.upgrade * level, fieldType)
}

/** Level multiplier in bps — same table as `get_level_mult` on-chain. */
export function levelMultBps(level: number): number {
 const table: Record<number, number> = { 0: 10_000, 1: 10_000, 2: 15_700, 3: 20_400, 4: 24_600, 5: 28_600 }
 if (level <= 5) return table[level]
 return 28_600 + (level - 5) * 4_000
}

export function durabilityMultBps(durability: number): number {
 return 2_000 + Math.min(durability, MAX_DURABILITY) * 80
}

/** Marketplace fee tier in bps for an order of `amountMicro`. */
export function feeBps(amountMicro: number): number {
 // Прогрессивная комиссия 9% – 12%
 if (amountMicro < 1_000 * MICRO) return 900    // < 1k:   9%
 if (amountMicro < 10_000 * MICRO) return 1_000 // < 10k:  10%
 if (amountMicro < 100_000 * MICRO) return 1_100 // < 100k: 11%
 return 1_200                                    // >= 100k: 12%
}

export interface YieldInputs {
 level: number
 durability: number
 fieldType: number
 taxPaidUntil: number
 fertilizerUntil: number
 mutationType?: number
 epochId?: number
}

export interface YieldConfig {
 baseYieldMicroPerDay: number
 globalMultiplierBps: number
}

/** Yield per day at the current state of the field, in micro POTATO. */
/** Лунный цикл: 28 эпох, множитель yield в bps (8500–11500) — MUST match LUNAR_TABLE in programs/solana_potato/src/lib.rs */
export const LUNAR_TABLE = [
 10_000, 10_334, 10_651, 10_935, 11_173, 11_352, 11_462, 11_500, // дни 0-7 (пик 1.15×)
 11_462, 11_352, 11_173, 10_935, 10_651, 10_334, 10_000, 9_666,  // дни 8-15
 9_349,  9_065,  8_827,  8_648,  8_538,  8_500,  8_538,  8_648,  // дни 16-23 (дно 0.85×)
 8_827,  9_065,  9_349,  9_666,                                   // дни 24-27
] as const;

/** Daily yield WITHOUT the lunar factor (lunar is applied per accrual window). */
function dailyYieldMicroNoLunar(f: YieldInputs, cfg: YieldConfig, nowSec: number): number {
 // Golden Sprout (mutationType = 1): +25% yield
 const mut_bps = f.mutationType === 1 ? 12_500 : BPS
 const mults = [
  levelMultBps(f.level),
  durabilityMultBps(f.durability),
  cfg.globalMultiplierBps,
  fieldTypeInfo(f.fieldType).yieldBps,
  nowSec < f.fertilizerUntil ? FERTILIZER_YIELD_BPS : BPS,
  nowSec > f.taxPaidUntil ? UNPAID_TAX_YIELD_BPS : BPS,
  mut_bps,
 ]
 return mults.reduce((v, m) => (v * m) / BPS, cfg.baseYieldMicroPerDay)
}

export function dailyYieldMicro(f: YieldInputs, cfg: YieldConfig, nowSec: number): number {
 // Лунный цикл: детерминированный множитель по epoch_id (28 эпох)
 const lunar_bps = typeof f.epochId === 'number' && LUNAR_TABLE
  ? LUNAR_TABLE[f.epochId % 28]
  : BPS
 return Math.floor((dailyYieldMicroNoLunar(f, cfg, nowSec) * lunar_bps) / BPS)
}

/**
 * Mirror of the on-chain `lunar_weighted_bps`: each trailing 86400s segment of
 * the accrual window is weighted by the lunar bps of its own epoch, so a
 * multi-day accrual spanning roll_epoch cannot be farmed at the peak rate.
 */
export function lunarWeightedBps(elapsedSec: number, epochId: number): number {
 const current = LUNAR_TABLE[((epochId % 28) + 28) % 28]
 if (elapsedSec <= 0) return current
 let weighted = 0
 let remaining = elapsedSec
 let ageDays = 0
 while (remaining > 0) {
  const chunk = Math.min(remaining, SECONDS_PER_DAY)
  const idx = ((((epochId - ageDays) % 28) + 28) % 28)
  weighted += LUNAR_TABLE[idx] * chunk
  remaining -= chunk
  ageDays += 1
 }
 return Math.floor(weighted / elapsedSec)
}

/** Accrued but unharvested yield, in micro POTATO (same formula as the program). */
export function accumulatedMicro(
 f: YieldInputs & { lastHarvest: number },
 cfg: YieldConfig,
 nowSec: number,
): number {
 const elapsed = Math.min(Math.max(nowSec - f.lastHarvest, 0), MAX_ACCRUAL_SECONDS)
 const lunar = typeof f.epochId === 'number' ? lunarWeightedBps(elapsed, f.epochId) : BPS
 const perDay = dailyYieldMicroNoLunar(f, cfg, nowSec)
 return Math.floor((perDay * lunar * elapsed) / (BPS * SECONDS_PER_DAY))
}

export const fmtPotato = (micro: number | bigint, decimals = 2) => (Number(micro) / MICRO).toFixed(decimals)
/** Exact token amount for prices/balance warnings; never round away a micro POTATO. */
export function fmtPotatoExact(micro: number | bigint): string {
 const amount = BigInt(micro)
 const sign = amount < 0n ? '-' : ''
 const abs = amount < 0n ? -amount : amount
 const unit = BigInt(MICRO)
 const fraction = (abs % unit).toString().padStart(6, '0').replace(/0+$/, '')
 return `${sign}${abs / unit}${fraction ? `.${fraction}` : ''}`
}

export const fmtSol = (lamports: number | bigint, decimals = 3) => (Number(lamports) / 1e9).toFixed(decimals)

export const fmtSkr = (atoms: number | bigint, decimals = 2) => (Number(atoms) / 1e6).toFixed(decimals)

export interface PresaleDropInfo { type: number; label: string; chance: number; color: string }
/** Шансы дропа модуля в пресейле: цена одна — тир случайный */
export const PRESALE_DROP: PresaleDropInfo[] = [
 { type: 0, label: 'COMMON', chance: 70, color: '#9AA0AC' },
 { type: 1, label: 'RARE', chance: 25, color: '#B85CFF' },
 { type: 2, label: 'EPIC', chance: 5, color: '#FFC94A' },
]
