/**
 * Mirror of the on-chain constants in programs/solana_potato/src/lib.rs.
 * Keep the two files in sync — the unit test in tests/constants.test.ts
 * cross-checks a few reference values against the program's IDL build.
 */
import { t } from '../i18n'

export const MICRO = 1_000_000
export const BPS = 10_000
export const SECONDS_PER_DAY = 86_400
export const MAX_ACCRUAL_SECONDS = 48 * 3600
export const MIN_HARVEST_INTERVAL = 60
export const MAX_FIELD_LEVEL = 50
export const MAX_DURABILITY = 100
export const TAX_PERIOD_DAYS = 7
export const MAX_TAX_PREPAY_DAYS = 28
export const FERTILIZER_HOURS = 24
export const MAX_FERTILIZER_PREPAY_DAYS = 7
export const ORDER_TTL_HOURS = 24
export const CANCEL_COOLDOWN_HOURS = 3
export const MIN_ORDER_AMOUNT_POTATO = 0.1
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
export const taxCostMicro = (fieldType: number) => scaledCostMicro(BASE_COST_MICRO.tax, fieldType)
export const repairCostMicro = (fieldType: number) => scaledCostMicro(BASE_COST_MICRO.repair, fieldType)
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
/** Лунный цикл: 28 эпох, множитель yield в bps (8500–11500) */
export const LUNAR_TABLE = [
 9_500, 9_200, 8_800, 8_500, 8_700, 9_000, 9_300,
 9_600, 9_900, 10_200, 10_500, 10_800, 11_100, 11_400,
 11_500, 11_300, 11_000, 10_700, 10_400, 10_100, 9_800,
 9_500, 9_200, 8_900, 8_700, 8_600, 8_800, 9_100,
] as const;

export function dailyYieldMicro(f: YieldInputs, cfg: YieldConfig, nowSec: number): number {
 // Golden Sprout (mutationType = 1): +25% yield
 const mut_bps = f.mutationType === 1 ? 12_500 : BPS
 // Лунный цикл: детерминированный множитель по epoch_id (28 эпох)
 const lunar_bps = typeof f.epochId === 'number' && LUNAR_TABLE
  ? LUNAR_TABLE[f.epochId % 28]
  : BPS
 const mults = [
  levelMultBps(f.level),
  durabilityMultBps(f.durability),
  cfg.globalMultiplierBps,
  fieldTypeInfo(f.fieldType).yieldBps,
  nowSec < f.fertilizerUntil ? FERTILIZER_YIELD_BPS : BPS,
  nowSec > f.taxPaidUntil ? UNPAID_TAX_YIELD_BPS : BPS,
  mut_bps,
  lunar_bps,
 ]
 return mults.reduce((v, m) => (v * m) / BPS, cfg.baseYieldMicroPerDay)
}

/** Accrued but unharvested yield, in micro POTATO (same formula as the program). */
export function accumulatedMicro(
 f: YieldInputs & { lastHarvest: number },
 cfg: YieldConfig,
 nowSec: number,
): number {
 const elapsed = Math.min(Math.max(nowSec - f.lastHarvest, 0), MAX_ACCRUAL_SECONDS)
 return Math.floor((dailyYieldMicro(f, cfg, nowSec) * elapsed) / SECONDS_PER_DAY)
}

export const fmtPotato = (micro: number | bigint, decimals = 2) => (Number(micro) / MICRO).toFixed(decimals)
export const fmtSol = (lamports: number | bigint, decimals = 3) => (Number(lamports) / 1e9).toFixed(decimals)

export const fmtSkr = (atoms: number | bigint, decimals = 2) => (Number(atoms) / 1e6).toFixed(decimals)

export interface PresaleDropInfo { type: number; label: string; chance: number; color: string }
/** Шансы дропа модуля в пресейле: цена одна — тир случайный */
export const PRESALE_DROP: PresaleDropInfo[] = [
 { type: 0, label: 'COMMON', chance: 70, color: '#9AA0AC' },
 { type: 1, label: 'RARE', chance: 25, color: '#B85CFF' },
 { type: 2, label: 'EPIC', chance: 5, color: '#FFC94A' },
]
