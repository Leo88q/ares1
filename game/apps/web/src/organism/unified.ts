/**
 * ARES «Единый организм», P1 (docs/ORGANISM_INTEGRATION.md §32.4).
 *
 * One ledger for the whole base. A kilogram goes:
 *   growth → harvest → storage → processing → crew food | export | craft
 * Off-chain accounting only. Nothing here mints POTATO. Crafting stays disabled
 * until PotatoPerKg is calibrated (§13.2, marked H), so `potatoPerKg === null` means "not calibrated".
 *
 * Conservation (checked by tests and by `unifiedBalance`):
 *   startKg + harvestedKg = rawKg + processedKg + eatenKg + exportedKg + craftedKg + processingLossKg (+ sortedKg + spoiledKg + seedReturnedKg)
 *
 * Глубокая симуляция колонии (colony/deep) — НЕ вторая экономика еды: она
 * считает, СКОЛЬКО развития получает грядка и какую долю урожая потеряла,
 * а масса по-прежнему проходит через этот реестр. Расширения backward compatible:
 *  - `GrowthInput` может быть функцией (plotId, bedIndex) → прирост в днях;
 *  - `UnifiedPlot.planted` — физическая посадка (семенной картофель ограничен);
 *  - `advanceDay(b, growth, { yieldFactor, autoReplant })` — доля урожая при уборке
 *    и запрет автоматического пересева (решает слой симуляции).
 */
import { BEDS, LAB, PARAMETERS } from './parameters'
import { bedCycleKg, harvestFactor } from './beds'

/** Tier yield multipliers. Taken from LAB (1 / 1.35 / 1.7) until the on-chain tiers are reconciled (§13.4 G7). */
export const UNIFIED_TIER_MULT: readonly [number, number, number] = [1, 1.35, 1.7]

/** One cycle of growth for every bed, in days (colony value, §13.4 G8 resolved to this). */
export const UNIFIED_CYCLE_DAYS: number = PARAMETERS.cropCycleDays

/** kg of one full field cycle for a tier. */
export function fieldCycleKg(tier: 0 | 1 | 2): number {
  return PARAMETERS.cropAreaM2 * PARAMETERS.cropKgM2Day * UNIFIED_CYCLE_DAYS * UNIFIED_TIER_MULT[tier]
}

/** kg of one bed at full cycle for a tier. */
export function bedFullKg(tier: 0 | 1 | 2): number {
  return bedCycleKg(fieldCycleKg(tier), BEDS.perField)
}

export interface UnifiedPlot {
  id: string
  tier: 0 | 1 | 2
  /** Days of growth per bed. Negative = not planted yet. Harvest resets a bed to 0. */
  beds: number[]
  /**
   * Физически засажена ли грядка. `undefined` (старые сохранения) = засажена.
   * Снимается уборкой; ставится `plantBed`, когда есть семенной картофель и труд.
   */
  planted?: boolean[]
  /** Cumulative kg harvested from this plot (both manual and automatic). */
  harvestedKg: number
}

/** Грядка засажена (старые состояния без `planted` считаются засаженными). */
export function isPlanted(b: UnifiedBase, plotId: string, index: number): boolean {
  const plot = b.plots.find(p => p.id === plotId)
  if (!plot || !Number.isInteger(index) || index < 0) return false
  return plot.planted?.[index] ?? true
}

export interface UnifiedBase {
  day: number
  plots: UnifiedPlot[]
  crew: number
  /** Storage limit for raw + processed kg. Harvest that does not fit is refused, never silently lost. */
  storageCapKg: number
  rawKg: number
  processedKg: number
  /** Accounting base: kg that were in the base at the start. */
  startKg: number
  harvestedKg: number
  eatenKg: number
  exportedKg: number
  craftedKg: number
  processingLossKg: number
  foodShortfallKg: number
  /** Учётные счётчики глубокого слоя. По умолчанию 0: старые балансы не меняются. */
  sortedKg?: number
  spoiledKg?: number
  /**
   * Килограммы урожая, отправленные в семенной фонд. Это такой же выход, как
   * еда или потери: масса покидает продовольственный контур и больше в нём не
   * участвует. По умолчанию 0 — старые балансы не меняются.
   */
  seedReturnedKg?: number
  /** POTATO earned from crafting, off-chain ledger only. Never minted by this module. */
  potatoLedger: number
  /** POTATO per crafted kg. `null` = not calibrated, crafting refused. */
  potatoPerKg: number | null
}

export interface UnifiedInit {
  plots: Array<Omit<UnifiedPlot, 'harvestedKg'> & { harvestedKg?: number }>
  crew: number
  storageCapKg: number
  startKg: number
  potatoPerKg?: number | null
}

/** Дополнительные учётные счётчики глубокого слоя (по умолчанию 0 → совместимость). */
export interface UnifiedDeepCounters {
  /** Кг немытого картофеля, ушедшего на сортировку (товарная/семена/некондиция/остатки). */
  sortedKg?: number
  /** Кг, потерянные при хранении (порча). */
  spoiledKg?: number
}

export function initialUnifiedBase(init: UnifiedInit): UnifiedBase {
  if (!(init.storageCapKg >= 0) || !(init.startKg >= 0) || !(init.crew >= 0)) throw new RangeError('invalid base parameters')
  return {
    day: 0,
    plots: init.plots.map(p => ({ ...p, beds: [...p.beds], harvestedKg: p.harvestedKg ?? 0 })),
    crew: init.crew,
    storageCapKg: init.storageCapKg,
    rawKg: 0,
    processedKg: init.startKg,
    startKg: init.startKg,
    harvestedKg: 0,
    eatenKg: 0,
    exportedKg: 0,
    craftedKg: 0,
    processingLossKg: 0,
    foodShortfallKg: 0,
    sortedKg: 0, spoiledKg: 0, seedReturnedKg: 0,
    potatoLedger: 0,
    potatoPerKg: init.potatoPerKg ?? null,
  }
}

/** Kilograms in storage (raw + processed). */
export const storedKg = (b: UnifiedBase): number => b.rawKg + b.processedKg
const freeKg = (b: UnifiedBase): number => Math.max(0, b.storageCapKg - storedKg(b))

/** Kilograms that leave the base or are used; together with stock they must equal the inflow. */
export function unifiedBalance(b: UnifiedBase): { inflow: number; stock: number; outflow: number; residual: number } {
  const inflow = b.startKg + b.harvestedKg
  const stock = b.rawKg + b.processedKg
  const outflow = b.eatenKg + b.exportedKg + b.craftedKg + b.processingLossKg
    + (b.sortedKg ?? 0) + (b.spoiledKg ?? 0) + (b.seedReturnedKg ?? 0)
  return { inflow, stock, outflow, residual: inflow - stock - outflow }
}

function findPlot(b: UnifiedBase, plotId: string): number {
  return b.plots.findIndex(p => p.id === plotId)
}

/** A bed can be harvested by hand when the harvest factor (T2 + window, §31.2) is above zero and the bed is planted. */
export function canHarvestBed(b: UnifiedBase, plotId: string, index: number): boolean {
  const pi = findPlot(b, plotId)
  if (pi < 0 || !Number.isInteger(index) || index < 0 || index >= BEDS.perField) return false
  const plot = b.plots[pi]
  const v = plot.beds[index]
  if (v === undefined || v < 0) return false
  if (!isPlanted(b, plotId, index)) return false
  const kg = bedFullKg(plot.tier) * harvestFactor(v / UNIFIED_CYCLE_DAYS)
  return kg > 0 && kg <= freeKg(b) + 1e-9
}

/**
 * Manual harvest. Refused (same object returned) when the factor is zero or storage is full.
 * `opts.autoReplant === false` помечает грядку пустой: пересев решает слой
 * симуляции (нужны семенной картофель и труд), а не «бесконечная кнопка».
 */
export function harvestBed(b: UnifiedBase, plotId: string, index: number, opts: AdvanceOptions = {}): UnifiedBase {
  if (!canHarvestBed(b, plotId, index)) return b
  const pi = findPlot(b, plotId)
  const plot = b.plots[pi]
  const kg = bedFullKg(plot.tier) * harvestFactor(plot.beds[index] / UNIFIED_CYCLE_DAYS)
  const beds = [...plot.beds]
  beds[index] = 0
  const planted = plot.planted ? [...plot.planted] : beds.map(() => true)
  if (opts.autoReplant === false) planted[index] = false
  const plots = b.plots.map((p, i) => (i === pi ? { ...p, beds, planted, harvestedKg: p.harvestedKg + kg } : p))
  return { ...b, plots, rawKg: b.rawKg + kg, harvestedKg: b.harvestedKg + kg }
}

/** Посадить грядку заново. Семенной материал списывает вызывающий слой (colony/deep). */
export function plantBed(b: UnifiedBase, plotId: string, index: number): UnifiedBase {
  const pi = findPlot(b, plotId)
  if (pi < 0 || !Number.isInteger(index) || index < 0 || index >= BEDS.perField) return b
  const plot = b.plots[pi]
  const planted = [...(plot.planted ?? plot.beds.map(() => true))]
  while (planted.length < plot.beds.length) planted.push(true)
  if (planted[index]) return b
  planted[index] = true
  const beds = [...plot.beds]
  beds[index] = 0
  const plots = b.plots.map((p, i) => (i === pi ? { ...p, beds, planted } : p))
  return { ...b, plots }
}

/** Снять урожайный выход в долях: стресс и плотность посадки (слой colony/deep). */
export interface AdvanceOptions {
  /** Доля от полного выхода грядки на момент уборки (0…1). */
  yieldFactor?: (plotId: string, bedIndex: number) => number
  /** false — после уборки грядка пуста и требует посадки (по умолчанию true). */
  autoReplant?: boolean
  /**
   * Разрешение на уборку конкретной грядки. Если передано, созревшая грядка
   * ждёт, пока работа не будет выполнена, — точно так же, как она уже ждёт
   * места на складе. Не передано (базовая колония) — уборка идёт как раньше.
   */
  harvestAllow?: (plotId: string, bedIndex: number) => boolean
  /**
   * true — реестр не перерабатывает сырьё сам: разделкой управляет глубокий
   * слой, который возвращает семена и выделяет товарную долю. По умолчанию
   * false, то есть прежнее поведение.
   */
  skipProcessing?: boolean
}

/** Growth input per plot: a number for every plot, or a function of the plot id (energy and water limits). */
/**
 * Прирост развития: одно число на все грядки, либо функция (plotId, bedIndex) → дни.
 * Функция от одного аргумента остаётся корректной (второй игнорируется).
 */
export type GrowthInput = number | ((plotId: string, bedIndex: number) => number)

/** Grow every planted bed by its plot's growth. A bed at full cycle is harvested automatically if storage has room; otherwise it waits (no loss). */
function growBeds(b: UnifiedBase, growth: GrowthInput, opts: AdvanceOptions = {}): UnifiedBase {
  const growOf = (id: string, index: number): number => (typeof growth === 'number' ? growth : growth(id, index))
  const yieldOf = opts.yieldFactor ?? ((): number => 1)
  let cur = b
  cur = { ...cur, plots: cur.plots.map(p => {
    return { ...p, beds: p.beds.map((v, bi) => {
      if (p.planted && p.planted[bi] === false) return v
      const g = growOf(p.id, bi)
      if (!(g >= 0)) throw new RangeError('growth must be ≥ 0')
      return v < 0 ? (v + g >= 0 ? 0 : v + g) : v + g
    }) }
  }) }
  // automatic harvest of ripe beds (value ≥ cycle), one bed at a time, while storage allows
  for (let pi = 0; pi < cur.plots.length; pi++) {
    for (let bi = 0; bi < BEDS.perField; bi++) {
      const plot = cur.plots[pi]
      const v = plot.beds[bi]
      if (v < UNIFIED_CYCLE_DAYS - 1e-9) continue
      if (plot.planted && plot.planted[bi] === false) continue
      const kg = bedFullKg(plot.tier) * Math.max(0, Math.min(1, yieldOf(plot.id, bi)))
      if (kg > freeKg(cur) + 1e-9) continue // waits at full cycle; retried next day
      // Люди ограничивают уборку так же, как её уже ограничивает место на
      // складе: созревшая грядка стоит и ждёт, копя стресс запущенности, а не
      // собирается сама. Предикат необязателен — базовая колония его не
      // передаёт и убирает как прежде.
      if (opts.harvestAllow && !opts.harvestAllow(plot.id, bi)) continue
      const beds = [...plot.beds]
      beds[bi] = v - UNIFIED_CYCLE_DAYS
      const planted = [...(plot.planted ?? plot.beds.map(() => true))]
      if (opts.autoReplant === false) { planted[bi] = false; beds[bi] = 0 }
      cur = {
        ...cur,
        plots: cur.plots.map((p, i) => (i === pi ? { ...p, beds, planted, harvestedKg: p.harvestedKg + kg } : p)),
        rawKg: cur.rawKg + kg,
        harvestedKg: cur.harvestedKg + kg,
      }
    }
  }
  return cur
}

/** Raw → processed, at the LAB line rate (0.7 kg/h × 24 h) with its 85 % yield. */
function processDay(b: UnifiedBase): UnifiedBase {
  const x = Math.min(b.rawKg, LAB.processorRateKgph * 24)
  if (x <= 0) return b
  return {
    ...b,
    rawKg: b.rawKg - x,
    processedKg: b.processedKg + x * LAB.processingYield,
    processingLossKg: b.processingLossKg + x * (1 - LAB.processingYield),
  }
}

/** Crew eats processed food first; any deficit is recorded, not hidden. */
function feedCrew(b: UnifiedBase): UnifiedBase {
  const demand = b.crew * PARAMETERS.freshFoodKgCrewDay
  const eaten = Math.min(b.processedKg, demand)
  return { ...b, processedKg: b.processedKg - eaten, eatenKg: b.eatenKg + eaten, foodShortfallKg: b.foodShortfallKg + (demand - eaten) }
}

/**
 * One day. `growth` is growth in days added to each planted bed (1 = a full day of growth).
 * `opts.yieldFactor` — доля полного выхода при уборке (стресс/плотность из colony/deep);
 * `opts.autoReplant === false` — грядка после уборки пуста и требует посадки.
 */
export function advanceDay(b: UnifiedBase, growth: GrowthInput, opts: AdvanceOptions = {}): UnifiedBase {
  let cur = growBeds({ ...b, day: b.day + 1 }, growth, opts)
  // Глубокий слой делит сырьё сам (семена / товарная / некондиция), поэтому
  // реестр здесь сырьё не трогает — иначе две цепочки съедят одну массу.
  if (!opts.skipProcessing) cur = processDay(cur)
  cur = feedCrew(cur)
  return cur
}

/** Add a new plot (e.g. a newly built greenhouse). Its beds start as given; no kg are created. */
export function addPlot(b: UnifiedBase, plot: UnifiedPlot): UnifiedBase {
  if (b.plots.some(p => p.id === plot.id)) throw new RangeError(`duplicate plot ${plot.id}`)
  return { ...b, plots: [...b.plots, { ...plot, beds: [...plot.beds], harvestedKg: plot.harvestedKg }] }
}

/** Export processed kg to a buyer. Only processed food leaves the base. */
export function exportKg(b: UnifiedBase, kg: number): UnifiedBase {
  const x = Math.min(b.processedKg, Math.max(0, kg))
  if (x <= 0) return b
  return { ...b, processedKg: b.processedKg - x, exportedKg: b.exportedKg + x }
}

/** Craft processed kg into POTATO (off-chain ledger). Refused until PotatoPerKg is calibrated. */
export function craftPotato(b: UnifiedBase, kg: number): UnifiedBase {
  if (b.potatoPerKg === null) return b
  const x = Math.min(b.processedKg, Math.max(0, kg))
  if (x <= 0) return b
  return {
    ...b,
    processedKg: b.processedKg - x,
    craftedKg: b.craftedKg + x,
    potatoLedger: b.potatoLedger + x * b.potatoPerKg,
  }
}
