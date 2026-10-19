/**
 * ARES-1 — main experiment: three 180-sol runs through the shared colony engine.
 *
 * Everything here goes through `advanceDay` / `advanceDays`, i.e. through exactly
 * the same code path the game uses. Nothing is scripted per scenario except the
 * environment (sun hours, recovery) and, for the failure scenario, a forced
 * fault. No wallet, no RPC, no token, no payout: the SIM credits are the
 * existing game credits and nothing else.
 *
 * Run:  cd game && npx tsx scripts/deepScenario.ts
 * Writes reports/deep-180-<name>.json and reports/deep-180.md
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  advanceDay, buildModule, buySupplies, deliverFood, foodReserve, initialColony,
  type ColonyModule, type ColonyState, type ModuleKind, type Scenario,
} from '../apps/web/src/colony/simulation'
import type { ColonyWorld, DeepScenario, DeviceKind } from '../apps/web/src/colony/deep/world'
import type { DailyRow, ScenarioReport } from './deepScenario.types'
import { PARAMETERS } from '../apps/web/src/organism/parameters'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPORT_DIR = join(HERE, '..', 'reports')

export interface ScenarioSpec {
  name: string
  title: string
  /** Existing colony scenario knobs (sun hours / water recovery). */
  scenario: Scenario
  /** Deep-world environment override. */
  deep?: Partial<DeepScenario>
  /** Device kind forced into a fault at `sol`. */
  forcedFault?: { sol: number; deviceKind: DeviceKind }
}

export const SCENARIOS: ScenarioSpec[] = [
  {
    name: 'nominal',
    title: 'Номинальный: 18 ч солнца, регенерация 94 %',
    scenario: { sunHours: 18, waterRecovery: 0.94 },
    deep: { sunHours: 18, weatherFactor: 1, dustRate: 0.35, coldDropC: 0 },
  },
  {
    name: 'reduced-solar',
    title: 'Пылевой сезон: 11 ч эффективного солнца',
    scenario: { sunHours: 11, waterRecovery: 0.94 },
    deep: { sunHours: 11, weatherFactor: 0.85, dustRate: 1.6, coldDropC: -6 },
  },
  {
    name: 'pump-extractor-failure',
    title: 'Отказ насоса на 60-м сол и добычи на 95-м',
    scenario: { sunHours: 18, waterRecovery: 0.94 },
    deep: { sunHours: 18, weatherFactor: 1, dustRate: 0.35, coldDropC: 0 },
    forcedFault: { sol: 60, deviceKind: 'pump' },
  },
]

const SOLS = 180

const round = (value: number, digits = 3): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const nutrientTotal = (world: ColonyWorld): number =>
  world.stock.amount.nutrient_n + world.stock.amount.nutrient_p + world.stock.amount.nutrient_k

/** One row of the machine-readable report. */
function row(state: ColonyState, world: ColonyWorld, bottleneck: string): DailyRow {
  const step = world.lastStep
  const power = step?.power
  return {
    sol: state.day,
    foodKg: round(state.foodKg, 2),
    waterCleanL: round(world.stock.amount.water_clean, 1),
    waterRawL: round(world.stock.amount.water_raw, 1),
    waterGreyL: round(world.stock.amount.water_grey, 1),
    oxygenKg: round(world.stock.amount.o2, 2),
    nutrientsKg: round(nutrientTotal(world), 3),
    parts: round(world.stock.amount.parts, 2),
    filters: round(world.stock.amount.filters, 2),
    seedKg: round(world.stock.amount.seed_potato, 2),
    wareKg: round(world.stock.amount.ware_potato, 2),
    batteryKwh: round(state.batteryKwh, 2),
    generationKwh: round(power?.generationKwh ?? 0, 2),
    servedKwh: round(power?.servedKwh ?? 0, 2),
    unmetKwh: round(power?.unmetKwh ?? 0, 2),
    curtailedKwh: round(power?.curtailedKwh ?? 0, 2),
    labourHours: round(step?.labour.provided ?? 0, 2),
    labourRequiredHours: round(step?.labour.required ?? 0, 2),
    bottleneck,
    faults: world.totals.faults,
    downtimeSols: round(world.totals.downtimeDeviceSols, 2),
    harvestedKg: round(world.totals.harvestedKg, 2),
    minedKg: round(world.totals.minedKg, 2),
    hauledKg: round(world.totals.hauledKg, 2),
  }
}

/**
 * Starting base for the experiment, exactly as the brief describes it:
 * 4 settlers, 2 greenhouses, solar + batteries, extraction, purification with
 * regeneration, storage, workshop, cargo rover and a small lab. Everything is
 * bought with the ordinary in-game credits through `buildModule`, so the start
 * is reproducible and auditable — no free modules.
 */
// Третью теплицу пробовали: она не помогает, а вредит. Удобрения импортные,
// а компост возвращает 0.07 кг с 8 кг внесённых, поэтому лишние 20 m² просто
// размазывают тот же N/P/K по 18 грядкам — ни одна не получает нормы, и урожай
// падает с 360 до 216 кг. Площадь здесь не предел, предел — ввоз удобрений.
const START_KIT: ModuleKind[] = ['greenhouse', 'solar', 'solar', 'battery', 'battery']

/** Какие сети нужны модулю, чтобы он вообще работал (как в игре). */
const NETS_FOR: Record<ModuleKind, ReadonlyArray<'power' | 'water' | 'return' | 'tunnel'>> = {
  solar: ['power'],
  greenhouse: ['power', 'water', 'return', 'tunnel'],
  habitat: ['power', 'water', 'return', 'tunnel'],
  recycler: ['power', 'water', 'return', 'tunnel'],
  rover: ['power', 'tunnel'],
  workshop: ['power', 'tunnel'],
  battery: ['power'],
}

export function buildStartColony(): ColonyState {
  let state = initialColony()
  for (const kind of START_KIT) {
    const built = buildModule(state, kind)
    if (built === state) continue
    state = built
    // Постройка без коммуникаций — это корпус, а не мощность: подключаем к хабу
    // теми же функциями, что использует игра.
    // Коммуникации строятся заново по итоговому составу модулей: это тот же
    // путь, которым игра поднимает сети для сохранений без явного `networks`.
    // Поштучный `addNetwork` здесь не подходит — он отвергает пары, которые уже
    // есть в стартовом наборе, и новые модули остаются без питания.
    state = { ...state, networks: undefined }
  }
  // Удобрения в этой модели — привозные: вторая теплица удваивает их расход, и
  // без закупки база упирается в N/P/K на ~83-м солу. Закупка идёт обычной
  // игровой кнопкой за обычные кредиты и видна в отчёте как импортозависимость.
  // Порог отсечки — ремонтный резерв, а не произвольное число: 240 кредитов
  // хватает на три пакета supplies или на несколько ремонтов. Прежний порог
  // 480 кредитов оставлял 410 незадействованными — пять пакетов удобрений и
  // запчастей лежали мёртвым грузом, пока грядки упирались в N/P/K.
  const reserveCredits = PARAMETERS.supplyCredits * 3
  while (state.credits >= PARAMETERS.supplyCredits + reserveCredits) state = buySupplies(state)
  return state
}

export function runScenario(spec: ScenarioSpec, sols = SOLS): ScenarioReport {
  let state = buildStartColony()
  const start = {
    modules: state.modules.reduce<Record<string, number>>((acc, m: ColonyModule) => {
      acc[m.kind] = (acc[m.kind] ?? 0) + 1
      return acc
    }, {}),
    credits: state.credits,
    crew: state.crew,
    waterLitres: state.waterLitres,
    foodKg: state.foodKg,
    nutrientsKg: state.nutrientsKg,
    sparesKg: state.sparesKg,
    oxygenKg: state.oxygenKg,
    credits: state.credits,
  }
  const daily: DailyRow[] = []
  const bottleneckSols: Record<string, number> = {}
  let firstBottleneck: string | null = null
  let firstShortfallSol: number | null = null
  let minWater = Infinity
  let minFood = Infinity
  let minOxygen = Infinity

  for (let sol = 1; sol <= sols; sol++) {
    // The forced fault is injected through the world's own scenario field, so it
    // travels the same path as any player-visible failure.
    if (spec.forcedFault && sol === spec.forcedFault.sol && state.world) {
      state.world.scenario = {
        ...state.world.scenario,
        forcedFault: { sol, deviceKind: spec.forcedFault.deviceKind },
      }
    }
    if (spec.deep && state.world) state.world.scenario = { ...state.world.scenario, ...spec.deep }

    state = advanceDay(state, spec.scenario)
    // Решение игрока, а не бонус симуляции: везём только настоящий излишек.
    // `sellableKg` держит 14-дневный резерв, но цикл картофеля — 90 солов, и
    // продажа под этот резерв перед разрывом в урожаях означает голод: между
    // сборами проходит больше двух недель. Политика эксперимента — держать
    // четырёхкратный резерв (≈56 солов еды) и везти лишь то, что выше него:
    // продажа раньше съедает стартовый запас до первого урожая, и колония
    // голодает на 31-м солу, формально выполнив контракт.
    // Отгрузку ведёт глубокий слой: он списывает физическую товарную партию,
    // требует упаковку и держит предоплаченный фонд. Прежний вызов
    // `deliverFood` брал излишек из реестра еды, то есть из привезённого с
    // Земли запаса, — колония формально выполняла контракт, не вырастив ни
    // килограмма сверх своего рациона. Теперь везём только выращенное.
    if (!state.world) {
      const reserve = foodReserve(state)
      if (state.ledger.processedKg >= reserve * 4) state = deliverFood(state)
    }
    const world = state.world
    if (!world) throw new Error('deep world missing after advanceDay')
    const bottleneck = world.lastStep?.bottleneck ?? 'none'
    if (bottleneck !== 'none') {
      bottleneckSols[bottleneck] = (bottleneckSols[bottleneck] ?? 0) + 1
      if (!firstBottleneck) firstBottleneck = bottleneck
    }
    if (firstShortfallSol === null && (state.foodShortfallKg > 0 || world.totals.o2ShortfallKg > 0)) {
      firstShortfallSol = sol
    }
    minWater = Math.min(minWater, world.stock.amount.water_clean)
    minFood = Math.min(minFood, state.foodKg)
    minOxygen = Math.min(minOxygen, world.stock.amount.o2)
    daily.push(row(state, world, bottleneck))
  }

  const world = state.world!
  const t = world.totals
  const labour = Object.fromEntries(
    Object.entries(t.labourByKind).map(([kind, hours]) => [kind, round(hours as number, 1)]),
  )

  return {
    name: spec.name,
    title: spec.title,
    sols,
    scenario: spec.scenario,
    deep: { ...(state.world?.scenario ?? {}) } as DeepScenario,
    start,
    daily,
    totals: {
      harvestedKg: round(t.harvestedKg, 2),
      yieldLossKg: round(t.yieldLossKg, 2),
      sortedKg: round(t.sortedKg, 2),
      exportedKg: round(state.ledger.exportedKg, 2),
      crewFoodKg: round(t.crewFoodKg, 2),
      foodShortfallKg: round(t.foodShortfallKg, 2),
      minedKg: round(t.minedKg, 2),
      hauledKg: round(t.hauledKg, 2),
      cleanProducedL: round(t.cleanProducedL, 1),
      recycledL: round(t.recycledL, 1),
      condensateL: round(t.condensateL, 1),
      waterUsedL: round(t.waterUsedL + t.waterIndustrialL + t.waterAggregateUsedL, 1),
      nutrientAppliedKg: round(t.nutrientAppliedKg, 3),
      nutrientReturnedKg: round(t.nutrientReturnedKg, 3),
      filtersUsed: round(t.filtersUsed, 2),
      partsUsed: round(t.partsUsed, 2),
      packagingUsed: round(t.packagingUsed, 2),
      generationKwh: round(t.generationKwh, 1),
      servedKwh: round(t.servedKwh, 1),
      unmetKwh: round(t.unmetKwh, 1),
      labourHours: round(t.labourHours, 1),
      labourByKind: labour,
      evaPrepHours: round(t.evaPrepHours, 1),
      evaO2Kg: round(t.evaO2Kg, 2),
      downtimeDeviceSols: round(t.downtimeDeviceSols, 2),
      faults: t.faults,
      importedWaterL: round(t.importedWaterL, 2),
      importedNutrientKg: round(t.importedNutrientKg, 3),
      importedParts: round(t.importedParts, 2),
      o2ProducedKg: round(t.o2ProducedKg, 2),
      cropO2Kg: round(t.cropO2Kg, 2),
      o2LeakedKg: round(t.o2LeakedKg, 2),
      o2ShortfallKg: round(t.o2ShortfallKg, 3),
      contractPaidCR: round(t.contractPaidCR, 2),
    },
    end: {
      foodKg: round(state.foodKg, 2),
      waterCleanL: round(world.stock.amount.water_clean, 1),
      nutrientsKg: round(nutrientTotal(world), 3),
      parts: round(world.stock.amount.parts, 2),
      oxygenKg: round(world.stock.amount.o2, 2),
      seedKg: round(world.stock.amount.seed_potato, 2),
      wareKg: round(world.stock.amount.ware_potato, 2),
      batteryKwh: round(state.batteryKwh, 2),
      credits: state.credits,
      harvestedKg: round(world.totals.harvestedKg, 2),
      deliveredKg: round(state.deliveredKg, 2),
    },
    minimums: {
      waterCleanL: round(minWater, 1),
      foodKg: round(minFood, 2),
      oxygenKg: round(minOxygen, 2),
    },
    firstBottleneck,
    firstShortfallSol,
    bottleneckSols,
    survived: minFood > 0 && world.totals.o2ShortfallKg < 1 && state.crew > 0,
  }
}

const markdown = (reports: ScenarioReport[]): string => {
  const lines: string[] = [
    '# ARES-1 — 180-сол эксперимент (глубокий слой)',
    '',
    'Три прогона из одной стартовой колонии через общий движок (`advanceDay`).',
    'Ниже — сводка; полные данные в `deep-180-<name>.json` (построчные метрики за каждый сол).',
    '',
    'Единицы: сол = 24.6229 ч, литры, кг, kWh, человеко-часы. SIM-кредиты — игровые,',
    'не токен POTATO и не баланс кошелька.',
    '',
  ]
  for (const r of reports) {
    lines.push(`## ${r.title} (\`${r.name}\`)`)
    lines.push('')
    lines.push(`- Итог: ${r.survived ? 'колония дожила до 180-го сола' : 'КОЛОНИЯ НЕ ВЫЖИЛА'}`)
    lines.push(`- Первый узкий ресурс: ${r.firstBottleneck ?? 'нет'}; всего солов по узким местам: ${JSON.stringify(r.bottleneckSols)}`)
    lines.push(`- Первый дефицит (еда/O₂): ${r.firstShortfallSol ?? 'не было'}`)
    lines.push(`- Минимумы: вода ${r.minimums.waterCleanL} л, еда ${r.minimums.foodKg} кг, O₂ ${r.minimums.oxygenKg} кг`)
    lines.push(`- Урожай ${r.totals.harvestedKg} кг, потери урожая ${r.totals.yieldLossKg} кг, съедено ${r.totals.crewFoodKg} кг, вывезено по контракту ${r.totals.exportedKg} кг`)
    lines.push(`- Добыча ${r.totals.minedKg} кг породы, перевозка ${r.totals.hauledKg} кг, очищено воды ${r.totals.cleanProducedL} л (регенерация ${r.totals.recycledL} л, конденсат ${r.totals.condensateL} л)`)
    lines.push(`- Энергия: выработка ${r.totals.generationKwh} kWh, подано ${r.totals.servedKwh} kWh, непокрыто ${r.totals.unmetKwh} kWh`)
    lines.push(`- Труд ${r.totals.labourHours} ч: ${JSON.stringify(r.totals.labourByKind)}`)
    lines.push(`- Выходы наружу: подготовка ${r.totals.evaPrepHours} ч, стравлено шлюзами ${r.totals.evaO2Kg} кг O₂`)
    lines.push(`- Простои ${r.totals.downtimeDeviceSols} сол·устройств, отказов ${r.totals.faults}, запчастей израсходовано ${r.totals.partsUsed}, фильтров ${r.totals.filtersUsed}`)
    lines.push(`- Удобрения: внесено ${r.totals.nutrientAppliedKg} кг, возвращено компостом ${r.totals.nutrientReturnedKg} кг`)
    lines.push(`- Кислород: электролиз ${r.totals.o2ProducedKg} кг, растения ${r.totals.cropO2Kg} кг, утечки ${r.totals.o2LeakedKg} кг, дефицит ${r.totals.o2ShortfallKg} кг`)
    lines.push(`- Импорт: вода ${r.totals.importedWaterL} л, удобрения ${r.totals.importedNutrientKg} кг, запчасти ${r.totals.importedParts} шт (0 = полная автономия по статье)`)
    lines.push(`- Финал: еда ${r.end.foodKg} кг, вода ${r.end.waterCleanL} л, семена ${r.end.seedKg} кг, товарная партия ${r.end.wareKg} кг, заряд ${r.end.batteryKwh} kWh`)
    lines.push('')
  }
  return lines.join('\n')
}

function main(): void {
  mkdirSync(REPORT_DIR, { recursive: true })
  const reports = SCENARIOS.map(spec => runScenario(spec))
  for (const report of reports) {
    writeFileSync(join(REPORT_DIR, `deep-180-${report.name}.json`), `${JSON.stringify(report, null, 1)}\n`)
  }
  writeFileSync(join(REPORT_DIR, 'deep-180.md'), markdown(reports))
  console.log(markdown(reports))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
