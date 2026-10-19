/**
 * Мост между существующей колонией (`colony/simulation`) и глубоким миром.
 *
 * Здесь зафиксировано, КТО ВЛАДЕЕТ КАЖДЫМ ПОТОКОМ. У каждого потока ровно
 * один писатель, поэтому масса и энергия не расходуются дважды:
 *
 * | Поток                                       | Владелец                        |
 * |---------------------------------------------|---------------------------------|
 * | Физические запасы: вода, O2, N/P/K, запчасти | глубокий мир                    |
 * | Масса картофеля и еды (кг)                   | реестр `organism/unified`       |
 * | Агрегатный спрос воды/питания на сол         | `dailyBudget` → прикладывает мир |
 * | Темп роста грядок (дни)                      | реестр, по приросту от мира     |
 * | Кредиты                                      | существующая игра (через `credits`) |
 *
 * `dailyBudget` остаётся **прогнозом**: ничего не списывает, отдаёт спрос и
 * потенциал роста. Глубокий мир прикладывает спрос к единому складу и добавляет
 * промышленный контур (добыча → возгонка → очистка → регенерация), последствия
 * дефицита и трудозатраты.
 */
import { PARAMETERS, type ColonyModule, type ColonyState, type DayBudget, type ModuleKind, type Scenario } from '../simulation'
import { modulePowerCapacityKw, networkServices } from '../networks'
import { fraction, clamp01, SOL_HOURS } from './units'
import { DEEP_P } from './params'
import { stockTake } from './resources'
import type { Device, DeviceKind } from './devices'
import { createDevice, isBattery } from './devices'
import { createVehicle, type VehicleClass } from './machines'
import { greenhouseRatedKw } from './world'
import { createBatch, type CropBatch } from './growth'
import type { ColonyWorld, WorldConfig } from './world'
import {
  applySort, createWorld, pushEvent, setSortableRawKg, splitNutrients, startCompost, stepSol,
  WORLD_VERSION, type SolStep, type Totals,
} from './world'
import { advanceDay as advanceUnified, plantBed, type UnifiedBase } from '../../organism/unified'
import { bedCycleKg } from '../../organism/beds'
import { BEDS } from '../../organism/parameters'

/** Дополнительные поля сводки дня, которые заполняет глубокий слой. */
export interface DeepDayExtras {
  /** Произведено очищенной воды за сол, л (добыча + регенерация). */
  waterProducedLitres: number
  /** Чистое изменение запаса воды: расход − производство, л. */
  waterNetLitres: number
  /** Сколько кг убрано за сол (физическая масса). */
  harvestedKg: number
  /** Сколько кг отправлено на сортировку. */
  sortedKg: number
  /** Кислород, выделенный растениями в атмосферу, кг. */
  cropO2Kg: number
  /** Кислород, потерянный через утечки атмосферы, кг. */
  leakO2Kg: number
  /** Физиологический спрос экипажа в кислороде, кг. */
  crewO2Kg: number
  nutrientProducedKg: number
  labourHours: number
  bottleneck: string
  unmetKwh: number
  shed: string[]
}

export interface DeepDayBudget extends DayBudget {
  deep?: DeepDayExtras
}

// --- Мир из существующей колонии ------------------------------------------

export const DEVICE_FOR_MODULE: Record<ModuleKind, DeviceKind[]> = {
  solar: ['solar'],
  battery: ['battery'],
  habitat: ['habitat'],
  greenhouse: ['greenhouse'],
  workshop: ['workshop'],
  recycler: ['o2_gen'],       // агрегатная модель объединяла регенерацию и электролиз
  rover: [],                  // ровер → машина, а не стационарное устройство
  // То, что раньше подразумевалось само собой, теперь ставится руками:
  // поставил — получил узел, не поставил или потерял — цепочка встала.
  extractor: ['extractor'],
  depot: ['depot'],
  purifier: ['purifier'],
  lab: ['lab'],
}

/**
 * Инфраструктура, которая раньше подразумевалась, но не моделировалась явно:
 * насос, очистка, регенерация стоков, скруббер, склад, добывающая установка и
 * лаборатория. Узлы не создают ресурсы — только дают мощности и цепочки.
 */
export const BASE_INFRASTRUCTURE: DeviceKind[] = ['pump', 'purifier', 'recycler', 'scrubber', 'depot', 'extractor', 'lab']

const CREW_PLAN: Array<{ id: string; name: string; specialty: 'agronomist' | 'engineer' | 'operator' | 'generalist' }> = [
  { id: 'crew-1', name: 'К. Иванова', specialty: 'agronomist' },
  { id: 'crew-2', name: 'М. Окафор', specialty: 'engineer' },
  { id: 'crew-3', name: 'А. Соколов', specialty: 'operator' },
  { id: 'crew-4', name: 'Л. Чен', specialty: 'generalist' },
]

/** Стартовые месторождения: конкретные участки, а не «лёд в любой клетке». */
export const COLONY_DEPOSITS = [
  { id: 'dep-ice-1', name: 'Северный ледовый откос', x: 8, z: 5, distanceKm: 4.2, actualKg: 26_000, iceFraction: DEEP_P.iceContentFraction, hardness: 1.1 },
  { id: 'dep-ice-2', name: 'Кратер Маруси', x: 40, z: 12, distanceKm: 9.5, actualKg: 41_000, iceFraction: 0.52, hardness: 1.45 },
  { id: 'dep-ice-3', name: 'Южная трещина', x: 24, z: 44, distanceKm: 14.8, actualKg: 18_000, iceFraction: 0.44, hardness: 1.8 },
]

/** Минимальный порог состояния модуля: сохранён из существующей модели. */
export const MIN_MODULE_CONDITION = 20

/** Функция ёмкости грядок: состояние модуля ограничивает темп роста. */
const capacityFactor = (m: ColonyModule): number => Math.max(0.2, m.condition / 100)

/**
 * Идентификаторы глубоких устройств берутся из модулей существующей колонии:
 * один модуль — один узел, id совпадает, поэтому вид и симуляция не расходятся.
 */
export function deviceIdsOf(state: ColonyState): Partial<Record<DeviceKind, string[]>> {
  const out: Partial<Record<DeviceKind, string[]>> = {}
  for (const module of state.modules) {
    for (const kind of DEVICE_FOR_MODULE[module.kind]) (out[kind] ??= []).push(module.id)
  }
  return out
}

/** Запас N/P/K в мире, собранный из одного числа состояния колонии. */
const nutrientStockOf = (kg: number) =>
  Object.fromEntries(splitNutrients(Math.max(0, kg))) as Record<'nutrient_n' | 'nutrient_p' | 'nutrient_k', number>

export function colonyWorldConfig(state: ColonyState, seed = 0x5eed_1a1a): WorldConfig {
  const o2Generators = Math.max(1, state.modules.filter(m => m.kind === 'recycler').length)
  // Электролиз закрывает дыхательный бюджет экипажа: растения его дополняют,
  // но не заменяют (база не должна становиться кислородно самодостаточной
  // только за счёт теплиц). Мощность делится между установками: второй
  // рекуператор даёт резервирование, а не удвоение выработки.
  // Маржинальность 1.5 — обычная практика для систем жизнеобеспечения: установка
  // должна закрывать дыхательный бюджет и при износе, иначе разовый отказ
  // сразу означает гипоксию, а не «надо починить».
  const breathO2KgPerSol = (state.crew * DEEP_P.crewO2KgPerSol * 1.5) / o2Generators
  const count = (kind: ModuleKind): number => state.modules.filter(m => m.kind === kind).length
  return {
    crew: CREW_PLAN.slice(0, Math.max(1, state.crew)),
    greenhouses: state.modules.filter(m => m.kind === 'greenhouse').length,
    greenhouseAreaM2: PARAMETERS.cropAreaM2,
    bedsPerGreenhouse: BEDS.perField,
    solarArrays: state.modules.filter(m => m.kind === 'solar').length,
    batteries: state.modules.filter(m => m.kind === 'battery').length,
    habitats: state.modules.filter(m => m.kind === 'habitat').length,
    workshops: state.modules.filter(m => m.kind === 'workshop').length,
    // Один узел каждого вида составляет «базовую» инфраструктуру, поэтому
    // существующая колония продолжает работать как раньше. Каждый поставленный
    // игроком модуль сверх того добавляет настоящую мощность: второй
    // ледодобытчик — это вторая добыча, а не ещё одна иконка.
    labs: 1 + count('lab'),
    pumps: 1,
    purifiers: 1 + count('purifier'),
    recyclers: 1,
    extractors: 1 + count('extractor'),
    depots: 1 + count('depot'),
    o2Generators,
    scrubbers: 1,
    vehicles: ['scout', 'excavator', 'hauler'],
    deviceIds: deviceIdsOf(state),
    deposits: COLONY_DEPOSITS,
    startingStock: {
      water_clean: state.waterLitres,
      ...nutrientStockOf(state.nutrientsKg),
      parts: state.sparesKg,
      o2: state.oxygenKg,
      seed_potato: 40,
      ware_potato: 0,
      cull_potato: 0,
      filters: 12,
      packaging: 60,
      reagents: 20,
      co2: 4,
    },
    contracts: [],
    seed,
    // Номинальная пылевая нагрузка: пыль ускоряет износ, но базовый сценарий — не буря.
    scenario: { sunHours: 18, weatherFactor: 1, dustRate: 0.35, coldDropC: 0, forcedFault: null },
    credits: state.credits,
    baseTankLitres: 900,
    tankLitresPerDepot: 1_400,
    autoTasks: true,
    autoSort: false,
    autoDeliver: false,
    criticalReserveFraction: 0.25,
    seedSplitShare: 0.12,
    cullShare: 0.08,
    condensateLitresPerSol: 30,
    // Электролиз закрывает дыхательный бюджет экипажа: растения его дополняют,
    // но не заменяют (иначе база была бы кислородно самодостаточной только за
    // счёт теплиц). Мощность установки делится между всеми рекуператорами:
    // второй модуль даёт резервирование, а не удвоение выработки.
    o2GenKgPerHour: breathO2KgPerSol / SOL_HOURS,
    scrubberKgPerHour: 0.35,
    purifierLitresPerHour: 40,
    recyclerLitresPerHour: 40,
    maxEvents: 60,
    maxHistory: 200,
    initialDevelopment: 0,
    // Ключ создаётся сразу: его наличие не должно меняться между ходами, иначе
    // сравнение состояний видит разницу формы там, где её нет.
    powerCapacityByDevice: Object.fromEntries(
      modulePowerCapacityKw(state, DEEP_P.powerLinkCapacityKw, DEEP_P.powerLinkDerateCells),
    ),
  }
}

/** Создать глубокий мир по текущей колонии. */
export function createWorldForColony(state: ColonyState, seed?: number): ColonyWorld {
  const world = createWorld(colonyWorldConfig(state, seed))
  // Связать устройства с модулями существующей колонии (состояние ↔ вид).
  for (const module of state.modules) {
    for (const kind of DEVICE_FOR_MODULE[module.kind]) {
      const device = world.devices.find(d => d.kind === kind && !d.legacyModuleId)
      if (device) device.legacyModuleId = module.id
    }
  }
  // Стартовая посадка: грядки существующей экспедиции уже растут.
  for (const module of state.modules) {
    if (module.kind !== 'greenhouse') continue
    const beds = module.beds ?? []
    for (const batch of world.batches) {
      if (batch.greenhouseId !== module.id) continue
      const value = beds[batch.bedIndex] ?? 0
      if (value <= 0) continue
      batch.plantedSol = 0
      batch.development = clamp01(value / PARAMETERS.cropCycleDays)
      batch.density = 1
      batch.health = 1
      batch.lastTendSol = 0
      updateSeedMass(batch)
    }
  }
  world.credits = state.credits
  setSortableRawKg(world, state.ledger.rawKg)
  // Заряд батарей берётся из существующего состояния, а не «из воздуха».
  const batteries = world.devices.filter(isBattery)
  if (batteries.length > 0) {
    const each = Math.min(state.batteryKwh / batteries.length, DEEP_P.batteryCapacityKwh)
    for (const battery of batteries) battery.storedKwh = Math.max(0, Math.min(battery.capacityKwh, each))
  }
  return world
}

const SEED_KG_PER_BED = DEEP_P.seedRateKgPerM2 * PARAMETERS.cropAreaM2 / BEDS.perField

/** Масса семян, занятая грядкой: физический ресурс, не абстракция. */
export function seedMassPerBed(): number {
  return SEED_KG_PER_BED
}
function updateSeedMass(batch: CropBatch): void {
  batch.seedKg = batch.plantedSol === null ? 0 : SEED_KG_PER_BED
}

// --- Синхронизация ---------------------------------------------------------

/**
 * Из существующего состояния в мир: кредиты, запчасти, состояние модулей и
 * подключение по сетям. Сети колонии — не украшение: отсоединённый агрегат
 * не потребляет, не выдаёт продукт и не заряжается.
 */
export function syncWorldFromState(world: ColonyWorld, state: ColonyState): void {
  world.credits = state.credits
  world.stock.amount.parts = Math.max(0, state.sparesKg)
  world.stock.amount.o2 = Math.max(0, state.oxygenKg)
  // Удобрения ведёт состояние колонии: игрок покупает их обычной кнопкой
  // «закупка», и мир обязан это видеть. Раньше они задавались только при
  // создании мира, поэтому любая закупка после его появления жила лишь в
  // `state`, а первый же `syncStateFromWorld` записывал обратно свой меньший
  // запас — купленные килограммы бесследно исчезали. Возврат компоста от этого
  // не теряется: он начисляется внутри шага, уже после синхронизации, и уходит
  // обратно в состояние в конце того же солa.
  Object.assign(world.stock.amount, nutrientStockOf(state.nutrientsKg))
  setSortableRawKg(world, state.ledger.rawKg)
  const services = state.networks ? networkServices(state) : null
  // Пропускная способность канала (§7): считается по тому же набору линий,
  // что и связность, — включая синтетический каркас, если игрок ещё ничего
  // не проложил. Базовая инфраструктура стоит на хабе и каналом не ограничена.
  // Карта кладётся в конфигурацию, а не на устройства: устройства входят в
  // состояние, которое игрок сравнивает между ходами, и новое поле на них
  // ломало бы проверку неизменяемости входа.
  const powerCapacity = modulePowerCapacityKw(
    state, DEEP_P.powerLinkCapacityKw, DEEP_P.powerLinkDerateCells,
  )
  const capacity: Record<string, number> = {}
  for (const [moduleId, kw] of powerCapacity) capacity[moduleId] = kw
  world.config.powerCapacityByDevice = capacity
  for (const device of world.devices) {
    if (!device.legacyModuleId) {
      // Базовая инфраструктура глубокого слоя всегда подключена.
      device.connected = true
      continue
    }
    const module = state.modules.find(m => m.id === device.legacyModuleId)
    if (!module) continue
    device.condition = clamp01(module.condition / 100)
    device.wear = clamp01(1 - device.condition)
    device.connected = services?.get(module.id)?.power ?? true
  }
}

/** Из мира в существующее состояние: все физические запасы. */
export function syncStateFromWorld(state: ColonyState, world: ColonyWorld): ColonyState {
  const batteryKwh = world.devices.filter(isBattery).reduce((sum, d) => sum + d.storedKwh, 0)
  const modules = state.modules.map(module => {
    const device = world.devices.find(d => d.legacyModuleId === module.id)
    if (!device) return module
    const condition = Math.min(100, Math.max(MIN_MODULE_CONDITION, device.condition * 100))
    return Math.abs(condition - module.condition) < 1e-9 ? module : { ...module, condition }
  })
  const nutrientKg = world.stock.amount.nutrient_n + world.stock.amount.nutrient_p + world.stock.amount.nutrient_k
  // Заряд раскладывается по модулям колонии: глубокий аккумулятор = модуль батареи.
  // Отсоединённая батарея сохраняет свой заряд и не получает чужой.
  const legacyBatteries = state.modules.filter(m => m.kind === 'battery')
  const mapped = world.devices.filter(d => isBattery(d) && d.legacyModuleId)
  let batteryCharge: Record<string, number>
  if (legacyBatteries.length > 0 && mapped.length === legacyBatteries.length) {
    batteryCharge = Object.fromEntries(mapped.map(d => [d.legacyModuleId!, d.storedKwh]))
  } else {
    batteryCharge = Object.fromEntries(legacyBatteries.map(m => [m.id, batteryKwh / legacyBatteries.length]))
  }
  return {
    ...state,
    modules,
    waterLitres: Math.max(0, world.stock.amount.water_clean),
    nutrientsKg: Math.max(0, nutrientKg),
    sparesKg: Math.max(0, world.stock.amount.parts),
    oxygenKg: Math.max(0, world.stock.amount.o2),
    batteryKwh: Math.max(0, batteryKwh),
    batteryCharge,
    credits: world.credits,
  }
}

/** Полное обслуживание базы: существующая кнопка «ремонт». */
export function overhaulWorld(world: ColonyWorld): void {
  for (const device of world.devices) {
    device.fault = null
    device.safeMode = false
    device.wear = 0
    device.condition = 1
    device.hoursSinceService = 0
  }
  for (const vehicle of world.vehicles) {
    vehicle.fault = null
    vehicle.wear = 0
    vehicle.condition = 1
    vehicle.hoursSinceService = 0
    vehicle.state = 'idle'
    vehicle.idleReason = null
  }
}

const GREENHOUSE_RATED_KW = greenhouseRatedKw(PARAMETERS.cropAreaM2)

/** Добавить устройства глубокого слоя при постройке модуля. */
export function addDeepModule(world: ColonyWorld, module: ColonyModule): (Device | { kind: 'vehicle' })[] {
  const added: (Device | { kind: 'vehicle' })[] = []
  for (const kind of DEVICE_FOR_MODULE[module.kind]) {
    const device = createDevice(kind, `${kind}-${module.id}`, {
      legacyModuleId: module.id,
      ...(kind === 'greenhouse' ? { ratedKw: GREENHOUSE_RATED_KW } : {}),
      // Мощность электролизёра следует за его производительностью: kWh/кг O2 —
      // documented parameter, поэтому рост выработки сразу виден в бюджете энергии.
      ...(kind === 'o2_gen'
        ? { ratedKw: world.config.o2GenKgPerHour * DEEP_P.electrolysisKwhKgO2 }
        : {}),
    })
    world.devices.push(device)
    added.push(device)
    if (kind === 'greenhouse') {
      // Теплица без грядок — это только корпус: партии создаются вместе с узлом.
      for (let bed = 0; bed < world.config.bedsPerGreenhouse; bed++) {
        world.batches.push(createBatch(`${module.id}-bed-${bed}`, module.id, bed,
          world.config.greenhouseAreaM2 / world.config.bedsPerGreenhouse, false))
      }
    }
  }
  if (module.kind === 'rover') {
    const vehicle = createVehicle(`VEH-${module.id}`, 'hauler', 'hauler')
    world.vehicles.push(vehicle)
    added.push(vehicle as unknown as { kind: 'vehicle' })
  }
  return added
}

/** Удалить устройства глубокого слоя при сносе модуля. */
export function removeDeepModule(world: ColonyWorld, id: string): void {
  world.devices = world.devices.filter(d => d.legacyModuleId !== id)
  world.vehicles = world.vehicles.filter(v => !v.id.endsWith(id))
  world.batches = world.batches.filter(b => b.greenhouseId !== id)
}

export type { VehicleClass }

// --- Шаг дня ---------------------------------------------------------------

export interface AdvanceResult {
  state: ColonyState
  world: ColonyWorld
  step: SolStep
  harvestedKg: number
  sortedKg: number
}

/**
 * Потенциал роста по каждой теплице: агрегатный потенциал × состояние модуля.
 * Агрегатная модель считает потенциал, глубокий мир превращает его в дни роста.
 */
export function growthPotentialOf(state: ColonyState, budget: DayBudget): Record<string, number> {
  const out: Record<string, number> = {}
  for (const module of state.modules) {
    if (module.kind !== 'greenhouse') continue
    const base = budget.growthByModule?.[module.id] ?? budget.growthFraction
    out[module.id] = base * capacityFactor(module)
  }
  return out
}

/** Ожидаемый выход одной грядки за цикл без стресса: база учёта потерь. */
export const BED_FULL_KG = bedCycleKg(PARAMETERS.cropAreaM2 * PARAMETERS.cropKgM2Day * PARAMETERS.cropCycleDays)

/**
 * Один сол колонии: агрегатный прогноз → шаг глубокого мира → реестр еды.
 * Порядок важен: мир шагает первым, поэтому посадка выполняется до роста.
 */
export function advanceColonyDay(state: ColonyState, scenario: Scenario, budget: DayBudget): AdvanceResult {
  const world = ensureWorld(state)
  syncWorldFromState(world, state)

  const foodDemandKg = state.crew * PARAMETERS.freshFoodKgCrewDay
  const foodFraction = fraction(state.ledger.processedKg, foodDemandKg)
  // Потенциал роста на грядку: агрегатный потенциал × состояние модуля.
  const growthPotential: Record<string, number> = {}
  for (const module of state.modules) {
    if (module.kind !== 'greenhouse') continue
    const base = budget.growthByModule?.[module.id] ?? budget.growthFraction
    growthPotential[module.id] = base * capacityFactor(module)
  }
  const stepped = stepSol(world, {
    foodFraction,
    // Вода: только то, чего глубокий слой сам не моделирует (экипаж + утечки).
    // Транспирацию теплицы и воду электролиза списывает глубокий мир, иначе
    // `budget.waterUsedLitres` (в котором они уже есть) списал бы их дважды.
    waterDemandL: budget.waterCrewMakeupL,
    // N/P/K считает глубокий слой по партиям (`growCrops`): агрегатная оценка
    // `budget.nutrientsUsedKg` — это тот же самый расход грядок, и передавать
    // его сюда значило бы списать удобрения дважды.
    growthPotential,
    sunHours: scenario.sunHours,
    weatherFactor: 1,
  })

  // 1. Реестр еды: посадка, рост, уборка, переработка, кормёжка. Единственный писатель массы еды.
  const beforePlots = new Map(state.ledger.plots.map(p => [p.id, { beds: [...p.beds], harvested: p.harvestedKg }]))
  let ledger: UnifiedBase = state.ledger
  for (const command of stepped.outbox.plant) ledger = plantBed(ledger, command.plotId, command.bedIndex)
  const growthByBed = (plotId: string, index: number): number => stepped.lastStep?.growthByBed[plotId]?.[index] ?? 0
  const yieldFactor = (plotId: string, index: number): number => stepped.lastStep?.yieldFactor[plotId]?.[index] ?? 1
  ledger = advanceUnified(ledger, growthByBed, { yieldFactor, autoReplant: false })

  // 2. Учёт уборки в глубоком мире: снять партию, записать выход и потери.
  let harvestedKg = 0
  for (const plot of ledger.plots) {
    const before = beforePlots.get(plot.id)
    if (!before) continue
    const delta = plot.harvestedKg - before.harvested
    if (delta <= 1e-9) continue
    harvestedKg += delta
    for (let index = 0; index < plot.beds.length; index++) {
      const was = before.beds[index] ?? 0
      const now = plot.beds[index] ?? 0
      // Собранную грядку выдаёт падение её накопленного роста: после уборки
      // реестр сбрасывает её в ноль (autoReplant = false). Прежний признак —
      // «значение на начало суток уже >= cropCycleDays» — почти никогда не
      // срабатывал: грядка доходила до 90 внутри суток, а `was` было 89.x.
      // Партия тогда не очищалась, оставалась «засаженной» навсегда, и грядка
      // выпадала из оборота после первого же цикла.
      if (now >= was) continue
      const batch = stepped.batches.find(b => b.greenhouseId === plot.id && b.bedIndex === index)
      if (!batch) continue
      stepped.totals.yieldLossKg += Math.max(0, BED_FULL_KG - delta)
      clearDeepBatch(batch)
    }
  }
  stepped.totals.harvestedKg += harvestedKg
  // Вода, физически ушедшая с урожаем: картофель ~80 % воды. Её нельзя вернуть
  // конденсатором, поэтому она списывается из бака в момент уборки.
  if (harvestedKg > 0) {
    const boundL = harvestedKg * DEEP_P.waterBoundLPerKg
    const taken = stockTake(stepped.stock, 'water_clean', boundL)
    if (stepped.lastStep) stepped.lastStep.waterIndustrialL += taken.taken
    stepped.totals.waterIndustrialL += taken.taken
    // Ботва и корневые остатки — тоже масса: она не исчезает, а становится
    // растительным остатком, из которого компост возвращает часть N/P/K.
    startCompost(stepped, harvestedKg * 0.3)
  }

  // 3. Сортировка: только то, что игрок (или политика) отправил на сортировку.
  let sortedKg = 0
  for (const command of stepped.outbox.sort) {
    const kg = Math.min(command.kg, ledger.rawKg)
    if (kg <= 1e-9) continue
    ledger = { ...ledger, rawKg: ledger.rawKg - kg, sortedKg: (ledger.sortedKg ?? 0) + kg }
    applySort(stepped, kg)
    sortedKg += kg
  }

  const next = syncStateFromWorld({ ...state, ledger }, stepped)
  return { state: next, world: stepped, step: stepped.lastStep ?? emptyStepOf(stepped.sol - 1), harvestedKg, sortedKg }
}

export function emptyStepOf(sol: number): SolStep {
  return {
    sol, growthByBed: {}, yieldFactor: {}, waterAggregateUsedL: 0, waterIndustrialL: 0,
    waterSampleL: 0, condensateL: 0, waterProducedL: 0, waterShortfallL: 0, nutrientUsedKg: 0, nutrientProducedKg: 0,
    o2ProducedKg: 0, cropO2Kg: 0, o2DemandKg: 0, o2LeakedKg: 0, o2ShortfallKg: 0, o2VentedKg: 0, foodShortfallKg: 0,
    power: { generationKwh: 0, demandKwh: 0, servedKwh: 0, unmetKwh: 0, curtailedKwh: 0, shed: [] },
    labour: { required: 0, provided: 0, byKind: {} },
    bottleneck: 'none',
  }
}

function clearDeepBatch(batch: CropBatch): void {
  batch.development = 0
  batch.stress = 0
  batch.yieldPenalty = 0
  batch.health = 0
  batch.plantedSol = null
  batch.seedKg = 0
  batch.density = 0
  batch.lastTendSol = null
  batch.harvestedKg = 0
}

// --- Доступ к миру состояния ----------------------------------------------

/**
 * Мир колонии. Создаётся лениво: состояния сессии без `world` получают мир при
 * первом шаге, а не ломаются.
 */
export function ensureWorld(state: ColonyState & { world?: ColonyWorld }): ColonyWorld {
  const existing = state.world
  if (!existing) return createWorldForColony(state)
  if (existing.version === WORLD_VERSION) return existing
  return migrateWorld(state, existing)
}

/**
 * Мир другой версии не догоняется по частям. Состояние колонии владеет
 * модулями и физическими запасами, поэтому мир собирается заново, а
 * `syncWorldFromState` возвращает в него воду, кислород, N/P/K и запчасти —
 * ровно то, что игрок накопил. Глубоко-внутренний учёт (очередь работ,
 * рейсы, пробы) честно сбрасывается: у старой версии этих полей может не
 * быть вовсе, и шагать по ним означает молча получить NaN в отчёте.
 *
 * Накопленные итоги переносятся, но только те поля, которые есть в новой
 * версии и оказались конечными числами: неизвестные старые ключи
 * игнорируются, отсутствующие новые остаются в нуле.
 */
function migrateWorld(state: ColonyState, stale: ColonyWorld): ColonyWorld {
  const rebuilt = createWorldForColony(state)
  rebuilt.sol = Number.isFinite(stale.sol) ? stale.sol : rebuilt.sol
  for (const key of Object.keys(rebuilt.totals) as Array<keyof Totals>) {
    const carried = stale.totals?.[key] as unknown
    const fresh = rebuilt.totals[key] as unknown
    if (typeof fresh === 'number' && typeof carried === 'number' && Number.isFinite(carried)) {
      ;(rebuilt.totals[key] as unknown as number) = carried
    } else if (fresh && typeof fresh === 'object' && carried && typeof carried === 'object') {
      // Например `labourByKind`: часы по видам работ должны дожить до новой версии.
      Object.assign(fresh as object, carried as object)
    }
  }
  pushEvent(rebuilt, 'world-migrated', 'warn',
    `Мир обновлён с версии ${stale.version} до ${WORLD_VERSION}: запасы и модули перенесены, очередь работ и рейсы сброшены`,
    `World rebuilt from version ${stale.version} to ${WORLD_VERSION}: stocks and modules carried over, task queue and haulage reset`,
    null)
  return rebuilt
}

/** Сводка дня с полями глубокого слоя. */
export function withDeepExtras(
  budget: DayBudget, step: SolStep, world: ColonyWorld, harvestedKg: number, sortedKg: number,
): DeepDayBudget {
  // Чистый расход бака: что ушло минус что вернулось (регенерация, очистка,
  // добыча). Так `было − стало = потрачено` сходится при любой замкнутости цикла.
  // Вода на пробы входит в расход: иначе запас убывает, а суточный отчёт
  // этого не показывает и сверка «было − стало = списано» расходится.
  const used = step.waterAggregateUsedL + step.waterIndustrialL + step.waterSampleL
    - step.waterProducedL - step.condensateL
  return {
    ...budget,
    waterUsedLitres: used,
    // Компост возвращает N/P/K, поэтому «потрачено» — это чистый уход со склада.
    nutrientsUsedKg: step.nutrientUsedKg - step.nutrientProducedKg,
    // Бак — якорь кислородного учёта: что электролиз дал в бак, что ушло
    // из бака на подпитку атмосферы. Вклад растений и утечки видны в `deep`,
    // иначе тождество `было + добыча − расход = стало + сброс − дефицит`
    // перестаёт сходиться (растения отдают O2 в атмосферу, а не в бак).
    oxygenProducedKg: step.o2ProducedKg,
    oxygenDemandKg: step.o2DemandKg,
    oxygenShortfallKg: step.o2ShortfallKg,
    oxygenVentedKg: step.o2VentedKg,
    oxygenEndKg: world.stock.amount.o2,
    deep: {
      waterProducedLitres: step.waterProducedL,
      waterNetLitres: used - step.waterProducedL,
      harvestedKg,
      sortedKg,
      cropO2Kg: step.cropO2Kg,
      leakO2Kg: step.o2LeakedKg,
      crewO2Kg: world.crew.length * DEEP_P.crewO2KgPerSol,
      nutrientProducedKg: step.nutrientProducedKg,
      labourHours: step.labour.provided,
      bottleneck: step.bottleneck,
      unmetKwh: step.power.unmetKwh,
      shed: [...step.power.shed],
    },
  }
}
