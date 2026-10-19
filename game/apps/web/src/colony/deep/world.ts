/**
 * Глубокий мир колонии: один источник истины по времени, запасам, людям,
 * машинам и производственным событиям.
 *
 * Здесь сходятся все подсистемы. Владение потоками (кто что списывает)
 * зафиксировано в docs/COLONY_DEEP_SIM.md §3: у каждого потока ровно один
 * писатель, поэтому масса не расходуется дважды.
 *
 * Детерминированность: фиксированный шаг (сол / SUBSTEPS_PER_SOL), seeded RNG,
 * никаких обращений ко времени, FPS или `Math.random()`. Порядок обхода не
 * влияет на результат: суммы берутся по стабильно отсортированным спискам.
 */
import { SOL_HOURS, SUBSTEPS_PER_SOL, SUBSTEP_HOURS, clamp, clamp01, fraction, round } from './units'
import { DEEP_P } from './params'
import { createRng, rngFromState, type Rng } from './rng'
import {
  RESOURCE_IDS, emptyStock, nutrientTotal, setCapacity, stockAdd, stockTake,
  type ResourceId, type Stock,
} from './resources'
import {
  applyLifeSupportConsequences, beginSolForCrew, createCrew, crewSummary, metabolise,
  remainingHours, restCrew, workHours, type CrewMember, type Specialty,
} from './crew'
import {
  BLOCK_CODES, TASK_META, autoAssign, compareTasks, consumeMaterials, createTask,
  isFinished, isOpen, releaseMaterials, reserveMaterials, taskRemaining,
  type Task, type TaskKind,
} from './tasks'
import {
  createDevice, deviceHeatKw, deviceOutput, deviceUsable, isGenerator, resetDeviceIds,
  syncStandby, type Device,
} from './devices'
import {
  airlockLoss, createSection, drainCondensate, injectO2, leakSection, outsideTemperatureC, scrubCo2,
  stepSectionCirculation, stepSectionHumidity, stepSectionThermal, atmosphereQuality, co2PartialKpa, o2PartialKpa,
  totalPressureKpa, KELVIN, R_GAS, MOLAR_O2, type Section,
} from './sections'
import { accumulateDust, dispatchPower, reserveSols } from './power'
import {
  attentionList, diagnoseFault, diagnoseVehicle, repairDevice, repairVehicle, serviceDevice, serviceVehicle,
  stepDeviceReliability, stepVehicleReliability,
} from './reliability'
import {
  createDeposit, depositBlockReason, depositWorkable, extractionCapacity,
  loadStockpile, mineDeposit, prepareSolution, purifyWater, recycleGreyWater, sublimateOre, surveyDeposit,
  type Deposit, type DepositSeed,
} from './extraction'
import {
  chargeVehicle, createVehicle, estimateTripHours, rangeKm, stepHaulJob, vehicleUsable,
  type HaulJob, type Vehicle, type VehicleClass,
} from './machines'
import {
  batchCo2UptakeKg, batchNutrientDemandKg, batchO2OutputKg, batchWaterDemandL,
  relaxRootTemperatureC, rootZoneTargetC,
  createBatch, plantBatch, seedNeededKg, stepBatch,
  type CropBatch, type GrowthEnvironment,
} from './growth'
import {
  ANALYSIS_KINDS, ANALYSIS_META, createAnalysis, createExperiment, finishAnalysis, finishExperiment,
  recipeFromExperiment, stepExperiment,
  type Analysis, type AnalysisKind, type Experiment, type Recipe, type Regime,
  type Sample, type SampleKind,
} from './lab'
import { compostToNutrients, createCompostBatch, stepComposting, type CompostBatch } from './waste'
import {
  createContract, deliverToContract, estimatePotato, expireContract,
  type Contract, type ContractSeed, type PotatoEstimate,
} from './contracts'

export const WORLD_VERSION = 4

/** Целевое парциальное давление O2 в жилой секции, kPa. */
const TARGET_O2_HABITAT = 18
/** Целевое парциальное давление CO2 в теплице (обогащение), kPa. */
const TARGET_CO2_GREENHOUSE = 0.09

// --- Сценарий --------------------------------------------------------------

export interface DeepScenario {
  /** Эквивалентные часы полного солнца за сол (параметр существующей колонии). */
  sunHours: number
  /** Множитель погоды: 1 — ясно, < 1 — пылевое событие. */
  weatherFactor: number
  /** Множитель скорости накопления пыли. */
  dustRate: number
  /** Знаковый сдвиг наружной температуры, °C: отрицательный — холоднее. */
  coldDropC: number
  /** Принудительный отказ: устройство выходит из строя на заданном солу. */
  forcedFault?: { sol: number; deviceKind: Device['kind'] } | null
}

// --- События и метрики -----------------------------------------------------

export type EventSeverity = 'info' | 'warn' | 'critical'

export interface WorldEvent {
  sol: number
  code: string
  severity: EventSeverity
  ru: string
  en: string
  targetId: string | null
}

export interface Metrics {
  sol: number
  waterCleanL: number
  waterRawL: number
  waterGreyL: number
  brineL: number
  /** Конденсат, собранный за сутки, л. */
  condensateL: number
  /** Энергия на отвод тепла, kWh. */
  coolingKwh: number
  seedKg: number
  wareKg: number
  cullKg: number
  o2Kg: number
  co2Kg: number
  batteryKwh: number
  batteryCapacityKwh: number
  generationKwh: number
  demandKwh: number
  servedKwh: number
  unmetKwh: number
  curtailedKwh: number
  dustLoss: number
  labourHours: number
  labourByKind: Record<string, number>
  idleHours: number
  blockedTasks: number
  openTasks: number
  minedKg: number
  hauledKg: number
  cleanProducedL: number
  recycledL: number
  harvestedKg: number
  yieldLossKg: number
  nutrientUsedKg: number
  filtersUsed: number
  partsUsed: number
  crewFoodKg: number
  crewWaterL: number
  crewO2Kg: number
  crewShortfallFood: number
  crewShortfallO2: number
  exportedKg: number
  importedWaterL: number
  importedNutrientKg: number
  importedParts: number
  downtimeDeviceSols: number
  faults: number
  pressureKpa: number
  co2PartialKpa: number
  o2PartialKpa: number
  greenhouseTempC: number
  crewReadiness: number
  bottleneck: string
  contractsDeliveredKg: number
  contractsPaidCR: number
}

export interface Totals {
  sols: number
  generationKwh: number
  servedKwh: number
  unmetKwh: number
  minedKg: number
  hauledKg: number
  cleanProducedL: number
  rawProducedL: number
  recycledL: number
  waterUsedL: number
  waterIndustrialL: number
  waterAggregateUsedL: number
  /** Конденсат, собранный в стоки, л (транспирация + влага экипажа). */
  condensateL: number
  /** Энергия, отведённая системой охлаждения, kWh. */
  coolingKwh: number
  harvestedKg: number
  yieldLossKg: number
  sortedKg: number
  exportedKg: number
  nutrientAppliedKg: number
  nutrientReturnedKg: number
  filtersUsed: number
  partsUsed: number
  packagingUsed: number
  labourHours: number
  labourByKind: Record<string, number>
  /** Часы, потраченные на подготовку к выходам наружу (костюм, шлюз, проверки). */
  evaPrepHours: number
  /** Кислород, стравленный шлюзами при выходах, кг. */
  evaO2Kg: number
  /** Товарная партия и некондиция, потерянные при хранении, кг. */
  spoiledHeldKg: number
  downtimeDeviceSols: number
  faults: number
  importedWaterL: number
  importedNutrientKg: number
  importedParts: number
  importedFilters: number
  crewFoodKg: number
  crewWaterL: number
  crewO2Kg: number
  foodShortfallKg: number
  o2ShortfallKg: number
  o2ProducedKg: number
  cropO2Kg: number
  o2LeakedKg: number
  o2VentedKg: number
  contractPaidCR: number
}

// --- Конфигурация ----------------------------------------------------------

export interface WorldConfig {
  crew: Array<{ id: string; name: string; specialty: Specialty }>
  greenhouses: number
  greenhouseAreaM2: number
  bedsPerGreenhouse: number
  solarArrays: number
  batteries: number
  habitats: number
  workshops: number
  labs: number
  pumps: number
  purifiers: number
  recyclers: number
  extractors: number
  depots: number
  o2Generators: number
  scrubbers: number
  vehicles: VehicleClass[]
  /**
   * Явные идентификаторы устройств, сгруппированные по виду. Нужны, чтобы
   * глубокий мир ссылался на те же объекты, что и существующая колония
   * (модуль `greenhouse-5` = устройство `greenhouse-5`).
   */
  deviceIds?: Partial<Record<Device['kind'], string[]>>
  deposits: DepositSeed[]
  startingStock: Partial<Record<ResourceId, number>>
  contracts: ContractSeed[]
  seed: number
  scenario: DeepScenario
  credits: number
  baseTankLitres: number
  tankLitresPerDepot: number
  /** Автоматически создавать работы (уход, чистка, обслуживание, добыча, рейсы). */
  autoTasks: boolean
  /** Автоматически сортировать урожай. */
  autoSort: boolean
  /**
   * Сколько солов еды держать в резерве, прежде чем излишек считается
   * вывозимым. Ниже этого запаса товарная партия идёт в еду целиком.
   */
  exportReserveSols: number
  /** Автоматически отправлять излишек по контракту. */
  autoDeliver: boolean
  /** Доля ёмкости аккумуляторов, зарезервированная под критические системы. */
  criticalReserveFraction: number
  /** Доля годного урожая, идущая в семенной фонд. */
  seedSplitShare: number
  /** Доля годного урожая, не проходящая в товарную партию. */
  cullShare: number
  condensateLitresPerSol: number
  /** Производительность электролиза, кг O2/час на установку. */
  o2GenKgPerHour: number
  scrubberKgPerHour: number
  purifierLitresPerHour: number
  recyclerLitresPerHour: number
  maxEvents: number
  maxHistory: number
  /** Грядки стартуют засаженными с этим развитием (0…1). */
  initialDevelopment: number

  /**
   * Пропускная способность силового канала по устройству, кВт (§7).
   * Пересчитывается мостом при каждом синхроне; устройство без ключа
   * каналом не ограничено.
   */
  powerCapacityByDevice?: Record<string, number>
}

/**
 * Базовые ёмкости сухих и газовых складов. Вода считается отдельно: её
 * резервуар растёт со складами (`applyStorageCapacity`).
 */
const BASE_SOLID_CAPS: Partial<Record<ResourceId, number>> = {
  o2: 60, co2: 40, ice_ore: 6000, tailings: 30_000, sludge: 2000,
  biomass: 800, food_waste: 400, compost: 800,
  nutrient_n: 40, nutrient_p: 40, nutrient_k: 40,
  filters: 60, parts: 120, packaging: 400, reagents: 120,
  seed_potato: 300, ware_potato: 600, cull_potato: 400,
}

/**
 * Пересчитать ёмкости хранилища по фактическому составу складов.
 *
 * Раньше ёмкости задавались один раз при создании мира, поэтому построенный
 * игроком склад был чистым расходом: он потреблял мощность, изнашивался, мог
 * отказать — и не увеличивал ни одного резервуара. Теперь ёмкость следует за
 * устройствами, а не за конфигурацией, замороженной в момент старта.
 *
 * Ёмкость только растёт: если склад снесён, уже принятый груз остаётся на
 * площадке и перестаёт пополняться, но не исчезает. Молча удалять массу ради
 * соблюдения предела — именно тот дефект, который здесь систематически ловят.
 */
export function applyStorageCapacity(world: ColonyWorld): void {
  const cfg = world.config
  const depots = world.devices.filter(d => d.kind === 'depot').length
  const tanks = cfg.baseTankLitres + depots * cfg.tankLitresPerDepot
  // Стартовый набор уже учтён в `cfg.depots`; расширяют хранилище только
  // склады, построенные сверх него.
  const extraDepots = Math.max(0, depots - cfg.depots)
  const solidGain = 1 + extraDepots * DEEP_P.depotSolidGain
  const caps: Partial<Record<ResourceId, number>> = {
    water_clean: tanks,
    water_raw: Math.max(200, tanks * 0.7),
    water_grey: Math.max(150, tanks * 0.4),
    brine: Math.max(120, tanks * 0.3),
    solution: Math.max(60, tanks * 0.2),
  }
  for (const [id, base] of Object.entries(BASE_SOLID_CAPS) as Array<[ResourceId, number]>) {
    caps[id] = base * solidGain
  }
  for (const [id, cap] of Object.entries(caps) as Array<[ResourceId, number]>) {
    setCapacity(world.stock, id, cap)
  }
}

// --- Мир -------------------------------------------------------------------

export interface WorldOutbox {
  /** Посадить грядку: команда для реестра еды (семена уже списаны здесь). */
  plant: Array<{ plotId: string; bedIndex: number; seedKg: number }>
  /** Отсортировать столько кг немытого картофеля из реестра. */
  sort: Array<{ kg: number }>
}

export interface SolStep {
  sol: number
  /** Прирост развития по грядкам: plotId → bedIndex → дней цикла. */
  growthByBed: Record<string, number[]>
  /** Доля выхода при уборке: plotId → bedIndex → 0…1. */
  yieldFactor: Record<string, number[]>
  waterAggregateUsedL: number
  waterIndustrialL: number
  /** Вода, ушедшая в лабораторные пробы, л. */
  waterSampleL: number
  /** Товарная партия и некондиция, испортившиеся на складе за сол, кг. */
  heldSpoiledKg: number
  /** Конденсат, собранный за шаг, л. */
  condensateL: number
  waterProducedL: number
  waterShortfallL: number
  nutrientUsedKg: number
  nutrientProducedKg: number
  /** Кислород, добытый электролизом и зачисленный в БАК (кг). */
  o2ProducedKg: number
  /** Кислород, выделенный растениями в атмосферу секций (кг). */
  cropO2Kg: number
  /** Кислород, взятый из бака на подпитку атмосферы (кг) + не закрытый спрос. */
  o2DemandKg: number
  /** Кислород, потерянный с утечками атмосферы (кг). */
  o2LeakedKg: number
  o2ShortfallKg: number
  o2VentedKg: number
  foodShortfallKg: number
  power: {
    generationKwh: number
    demandKwh: number
    servedKwh: number
    unmetKwh: number
    curtailedKwh: number
    shed: string[]
  }
  labour: { required: number; provided: number; byKind: Record<string, number> }
  bottleneck: string
}

export interface ColonyWorld {
  version: number
  sol: number
  seed: number
  rngState: number
  scenario: DeepScenario
  config: WorldConfig
  crew: CrewMember[]
  devices: Device[]
  sections: Section[]
  batches: CropBatch[]
  vehicles: Vehicle[]
  haulJobs: HaulJob[]
  deposits: Deposit[]
  tasks: Task[]
  counters: Record<string, number>
  stock: Stock
  samples: Sample[]
  analyses: Analysis[]
  experiments: Experiment[]
  recipes: Recipe[]
  compost: CompostBatch[]
  contracts: Contract[]
  events: WorldEvent[]
  metrics: Metrics
  history: Metrics[]
  totals: Totals
  potatoEstimate: PotatoEstimate
  credits: number
  outbox: WorldOutbox
  lastStep: SolStep | null
  /** Зеркало `ledger.rawKg`: сколько немытого картофеля ждёт сортировки. */
  sortableRawKg: number
}

const emptyTotals = (): Totals => ({
  sols: 0, generationKwh: 0, servedKwh: 0, unmetKwh: 0, minedKg: 0, hauledKg: 0,
  cleanProducedL: 0, rawProducedL: 0, recycledL: 0, waterUsedL: 0, waterIndustrialL: 0,
  waterAggregateUsedL: 0,
  condensateL: 0, coolingKwh: 0,
  harvestedKg: 0, yieldLossKg: 0, sortedKg: 0, exportedKg: 0, nutrientAppliedKg: 0,
  nutrientReturnedKg: 0, filtersUsed: 0, partsUsed: 0, packagingUsed: 0, labourHours: 0,
  labourByKind: {}, evaPrepHours: 0, evaO2Kg: 0, spoiledHeldKg: 0,
  downtimeDeviceSols: 0, faults: 0, importedWaterL: 0, importedNutrientKg: 0,
  importedParts: 0, importedFilters: 0, crewFoodKg: 0, crewWaterL: 0, crewO2Kg: 0,
  foodShortfallKg: 0, o2ShortfallKg: 0, o2ProducedKg: 0, cropO2Kg: 0, o2VentedKg: 0, o2LeakedKg: 0,
  contractPaidCR: 0,
})

const emptyMetrics = (sol: number): Metrics => ({
  sol, waterCleanL: 0, waterRawL: 0, waterGreyL: 0, brineL: 0, seedKg: 0, wareKg: 0, cullKg: 0,
  o2Kg: 0, co2Kg: 0, batteryKwh: 0, batteryCapacityKwh: 0, generationKwh: 0, demandKwh: 0,
  servedKwh: 0, unmetKwh: 0, curtailedKwh: 0, dustLoss: 0, labourHours: 0, labourByKind: {},
  idleHours: 0, blockedTasks: 0, openTasks: 0, minedKg: 0, hauledKg: 0, cleanProducedL: 0,
  recycledL: 0, harvestedKg: 0, yieldLossKg: 0, nutrientUsedKg: 0, filtersUsed: 0, partsUsed: 0,
  condensateL: 0, coolingKwh: 0,
  crewFoodKg: 0, crewWaterL: 0, crewO2Kg: 0, crewShortfallFood: 0, crewShortfallO2: 0,
  exportedKg: 0, importedWaterL: 0, importedNutrientKg: 0, importedParts: 0,
  downtimeDeviceSols: 0, faults: 0, pressureKpa: 0, co2PartialKpa: 0, o2PartialKpa: 0,
  greenhouseTempC: 0, crewReadiness: 0, bottleneck: 'none', contractsDeliveredKg: 0, contractsPaidCR: 0,
})

const emptyStep = (sol: number): SolStep => ({
  sol, growthByBed: {}, yieldFactor: {},
  waterAggregateUsedL: 0, waterIndustrialL: 0, waterSampleL: 0, condensateL: 0, waterProducedL: 0, waterShortfallL: 0,
  nutrientUsedKg: 0, nutrientProducedKg: 0, o2ProducedKg: 0, cropO2Kg: 0, o2LeakedKg: 0,
  o2DemandKg: 0, o2ShortfallKg: 0, o2VentedKg: 0, foodShortfallKg: 0, heldSpoiledKg: 0,
  power: { generationKwh: 0, demandKwh: 0, servedKwh: 0, unmetKwh: 0, curtailedKwh: 0, shed: [] },
  labour: { required: 0, provided: 0, byKind: {} },
  bottleneck: 'none',
})

// --- Создание мира ---------------------------------------------------------

/**
 * Номинальная мощность теплицы — это пик с включёнными лампами (kW).
 * Средняя за сол получается через `duty`: лампы горят только фотопериод,
 * постоянные нужды (насосы, климат) — всегда. Так ночная нагрузка базы
 * не равна дневной, что и определяет требуемую ёмкость аккумуляторов.
 */
export const greenhouseRatedKw = (areaM2: number): number =>
  areaM2 * (DEEP_P.lampKwPerM2 + DEEP_P.greenhouseUtilitiesKwPerM2)

function buildDevices(config: WorldConfig): Device[] {
  const devices: Device[] = []
  const add = (kind: Device['kind'], count: number, name: (i: number) => string, extra?: Partial<Device>): void => {
    const explicit = config.deviceIds?.[kind] ?? []
    for (let i = 1; i <= count; i++) {
      const id = explicit[i - 1]
      devices.push(createDevice(kind, name(i), id ? { ...extra, id } : extra))
    }
  }
  add('habitat', config.habitats, i => `HAB-${i}`)
  add('greenhouse', config.greenhouses, i => `GH-${i}`, {
    ratedKw: greenhouseRatedKw(config.greenhouseAreaM2),
  })
  add('solar', config.solarArrays, i => `PV-${i}`)
  add('battery', config.batteries, i => `BAT-${i}`, {
    storedKwh: DEEP_P.batteryCapacityKwh * 0.8, capacityKwh: DEEP_P.batteryCapacityKwh,
  })
  add('workshop', config.workshops, i => `WS-${i}`)
  add('lab', config.labs, i => `LAB-${i}`)
  add('o2_gen', config.o2Generators, i => `O2G-${i}`)
  add('scrubber', config.scrubbers, i => `SCR-${i}`)
  add('pump', config.pumps, i => `PMP-${i}`)
  add('purifier', config.purifiers, i => `PUR-${i}`)
  add('recycler', config.recyclers, i => `RCY-${i}`)
  add('extractor', config.extractors, i => `EXC-${i}`)
  add('depot', config.depots, i => `DEP-${i}`)
  return devices
}

function buildSections(devices: Device[], config: WorldConfig): Section[] {
  const sections: Section[] = []
  for (const device of devices) {
    const volume = device.kind === 'habitat' ? DEEP_P.habitatVolumeM3
      : device.kind === 'greenhouse' ? Math.max(DEEP_P.greenhouseVolumeM3, config.greenhouseAreaM2 * 4.5)
        : device.kind === 'lab' ? 40 : device.kind === 'workshop' ? 55 : 0
    if (volume <= 0) continue
    const kind = device.kind === 'greenhouse' ? 'greenhouse'
      : device.kind === 'habitat' ? 'habitat'
        : device.kind === 'lab' ? 'lab' : 'workshop'
    const section = createSection(`sec-${device.id}`, device.name, device.id, kind, volume)
    if (kind === 'greenhouse') {
      // Теплица стартует с обогащённой атмосферой: это рабочий режим, не подарок.
      section.co2Kg = (TARGET_CO2_GREENHOUSE * 1000 * volume) / (R_GAS * (section.temperatureC + KELVIN)) * 0.044
    }
    sections.push(section)
    device.sectionId = section.id
  }
  return sections
}

/** Стартовые ёмкости: то же, что получилось бы из `applyStorageCapacity`. */
function buildCaps(config: WorldConfig): Partial<Record<ResourceId, number>> {
  const tanks = config.baseTankLitres + config.depots * config.tankLitresPerDepot
  return {
    ...BASE_SOLID_CAPS,
    water_clean: tanks,
    water_raw: Math.max(200, tanks * 0.7),
    water_grey: Math.max(150, tanks * 0.4),
    brine: Math.max(120, tanks * 0.3),
    solution: Math.max(60, tanks * 0.2),
  }
}

export function createWorld(config: WorldConfig): ColonyWorld {
  const rng = createRng(config.seed)
  // Идентификаторы устройств должны быть воспроизводимы: иначе два мира из
  // одного конфига не совпадут побайтово (проверяется тестами детерминизма).
  resetDeviceIds()
  const devices = buildDevices(config)
  const sections = buildSections(devices, config)
  const stock = emptyStock(buildCaps(config))
  for (const id of RESOURCE_IDS) {
    const value = config.startingStock[id]
    if (value) stockAdd(stock, id, value)
  }
  const batches: CropBatch[] = []
  for (const device of devices) {
    if (device.kind !== 'greenhouse') continue
    for (let bed = 0; bed < config.bedsPerGreenhouse; bed++) {
      const batch = createBatch(`${device.id}-bed-${bed}`, device.id, bed,
        config.greenhouseAreaM2 / config.bedsPerGreenhouse, config.initialDevelopment > 0)
      batch.development = clamp01(config.initialDevelopment)
      batch.plantedSol = config.initialDevelopment > 0 ? 0 : null
      batch.lastTendSol = config.initialDevelopment > 0 ? 0 : null
      batch.health = config.initialDevelopment > 0 ? 1 : 0
      batch.density = config.initialDevelopment > 0 ? 1 : 0
      batches.push(batch)
    }
  }
  const deposits = config.deposits.map(seed => createDeposit(seed, rng, seed.distanceKm <= 3))
  const rig = devices.find(d => d.kind === 'extractor')
  if (rig && deposits.length) deposits[0].rigId = rig.id
  const world: ColonyWorld = {
    version: WORLD_VERSION,
    sol: 0,
    seed: config.seed,
    rngState: rng.state,
    scenario: { ...config.scenario },
    config: { ...config },
    crew: config.crew.map(c => createCrew(c.id, c.name, c.specialty)),
    devices, sections, batches,
    vehicles: config.vehicles.map((vehicleClass, index) => createVehicle(`VEH-${index + 1}`, vehicleClass, vehicleClass)),
    haulJobs: [],
    deposits,
    tasks: [],
    counters: { task: 0, sample: 0, analysis: 0, experiment: 0, recipe: 0, compost: 0 },
    stock,
    samples: [], analyses: [], experiments: [], recipes: [], compost: [],
    contracts: config.contracts.map(createContract),
    events: [],
    metrics: emptyMetrics(0),
    history: [],
    totals: emptyTotals(),
    potatoEstimate: estimatePotato(0, 0),
    credits: config.credits,
    outbox: { plant: [], sort: [] },
    lastStep: null,
    sortableRawKg: 0,
  }
  // Ёмкости пересчитываются из устройств, а не берутся из конфигурации: на
  // старте это то же самое число, но дальше хранилище следует за складами.
  applyStorageCapacity(world)
  pushEvent(world, 'world-created', 'info', 'Мир колонии создан', 'Colony world created', null)
  return world
}

// --- Утилиты ---------------------------------------------------------------

export function pushEvent(world: ColonyWorld, code: string, severity: EventSeverity, ru: string, en: string, targetId: string | null): void {
  world.events.push({ sol: world.sol, code, severity, ru, en, targetId })
  const max = Math.max(10, world.config.maxEvents)
  if (world.events.length > max) world.events.splice(0, world.events.length - max)
}

const nextId = (world: ColonyWorld, key: string): number => {
  world.counters[key] = (world.counters[key] ?? 0) + 1
  return world.counters[key]
}

const addTask = (world: ColonyWorld, spec: Parameters<typeof createTask>[1]): Task => {
  const task = createTask(`T-${nextId(world, 'task')}`, spec)
  world.tasks.push(task)
  return task
}

const hasOpenTask = (world: ColonyWorld, kind: TaskKind, targetId: string): boolean =>
  world.tasks.some(t => isOpen(t) && t.kind === kind && t.targetId === targetId)

/** Дом для человека: жилая секция с лучшей атмосферой. */
function homeSection(world: ColonyWorld): Section | undefined {
  const habitats = world.sections.filter(s => s.kind === 'habitat')
  return habitats.sort((a, b) => atmosphereQuality(b) - atmosphereQuality(a))[0] ?? world.sections[0]
}

const availableOf = (world: ColonyWorld, id: ResourceId): number =>
  Math.max(0, world.stock.amount[id] - world.stock.reserved[id])

/**
 * Состав смеси N/P/K — единственный источник правды для обеих сторон моста:
 * и стартового запаса, и ежесуточной синхронизации, и расхода грядок.
 * Если доли здесь и при закупке разойдутся, смесь перестанет сходиться.
 */
export const splitNutrients = (kg: number): Array<[ResourceId, number]> => [
  ['nutrient_n', kg * 0.45], ['nutrient_p', kg * 0.2], ['nutrient_k', kg * 0.35],
]

/**
 * Доли элементов в смеси — прямо из `splitNutrients`, чтобы доступность
 * каждого элемента считалась по тем же пропорциям, по которым он и
 * расходуется. Иначе грядка могла бы требовать калия больше, чем его есть
 * в смеси.
 */
const NUTRIENT_SHARE = Object.fromEntries(splitNutrients(1)) as Record<'nutrient_n' | 'nutrient_p' | 'nutrient_k', number>

/** Масса газа, нужная чтобы поднять парциальное давление на `deltaKpa`. */
const massForDelta = (section: Section, deltaKpa: number, molar: number): number =>
  (deltaKpa * 1000 * section.volumeM3) / (R_GAS * (section.temperatureC + KELVIN)) * molar

// --- Планирование работ ----------------------------------------------------

function planTasks(world: ColonyWorld): void {
  if (!world.config.autoTasks) return
  const sol = world.sol
  // Разрешение на уборку действительно одни сутки: прошлые сутки уже не
  // повод собирать грядку сегодня, иначе одна выполненная работа открывала бы
  // уборку навсегда.
  for (const batch of world.batches) batch.harvestReady = false
  for (const device of world.devices) {
    // Рискованный ремонт чинит по симптомам: ни осмотра, ни запчасти.
    if (device.fault && device.risky && !hasOpenTask(world, 'repair', device.id)) {
      addTask(world, {
        kind: 'repair', targetId: device.id, sol, priority: 1,
        requiredHours: device.fault.repairHours * DEEP_P.riskyRepairHoursShare,
      })
    } else if (device.fault && !device.fault.diagnosed && !hasOpenTask(world, 'inspect', device.id)) {
      addTask(world, { kind: 'inspect', targetId: device.id, requiredHours: DEEP_P.inspectHours, sol, priority: 1 })
    } else if (device.fault?.diagnosed && !hasOpenTask(world, 'repair', device.id)) {
      addTask(world, {
        kind: 'repair', targetId: device.id, requiredHours: device.fault.repairHours, sol, priority: 1,
        materials: [{ resource: 'parts', amount: device.fault.partsNeeded }],
      })
    } else if (!device.fault && device.hoursSinceService > DEEP_P.serviceIntervalHours * 0.85 && !hasOpenTask(world, 'maintain', device.id)) {
      addTask(world, { kind: 'maintain', targetId: device.id, requiredHours: 2.2, sol, priority: 5 })
    }
  }
  // Машины обслуживаются по тем же правилам, что и стационарные узлы. Без
  // этого цикла ровер изнашивался безвозвратно: `stepVehicleReliability`
  // копил износ и отказы, а `repairVehicle` и `serviceVehicle` не вызывал
  // никто — машина умирала навсегда, и вернуть её мог только капремонт всей
  // базы. Отказ машины дороже отказа насоса: она одна возит всю руду.
  for (const vehicle of world.vehicles) {
    if (vehicle.fault && !vehicle.fault.diagnosed && !hasOpenTask(world, 'inspect', vehicle.id)) {
      addTask(world, { kind: 'inspect', targetId: vehicle.id, requiredHours: DEEP_P.inspectHours, sol, priority: 1 })
    } else if (vehicle.fault?.diagnosed && !hasOpenTask(world, 'repair', vehicle.id)) {
      addTask(world, {
        kind: 'repair', targetId: vehicle.id, requiredHours: vehicle.fault.repairHours, sol, priority: 1,
        materials: [{ resource: 'parts', amount: vehicle.fault.partsNeeded }],
      })
    } else if (!vehicle.fault && vehicle.hoursSinceService > DEEP_P.serviceIntervalHours * 0.85
      && !hasOpenTask(world, 'maintain', vehicle.id)) {
      addTask(world, { kind: 'maintain', targetId: vehicle.id, requiredHours: 2.2, sol, priority: 5 })
    }
  }
  for (const device of world.devices) {
    if (isGenerator(device) && device.dust > 0.06 && !hasOpenTask(world, 'clean_panels', device.id)) {
      addTask(world, { kind: 'clean_panels', targetId: device.id, requiredHours: 1.6, sol, priority: 6 })
    }
  }
  for (const batch of world.batches) {
    if (batch.plantedSol !== null) continue
    const needed = seedNeededKg(batch.areaM2)
    if (availableOf(world, 'seed_potato') < needed) continue
    if (hasOpenTask(world, 'plant', batch.id)) continue
    addTask(world, {
      kind: 'plant', targetId: batch.id, requiredHours: 1.1, sol, priority: 2,
      materials: [{ resource: 'seed_potato', amount: needed }],
    })
  }
  for (const batch of world.batches) {
    if (batch.plantedSol === null) continue
    const since = batch.lastTendSol === null ? 999 : sol - batch.lastTendSol
    if (since < DEEP_P.tendIntervalSols * 0.7) continue
    if (hasOpenTask(world, 'tend', batch.id)) continue
    addTask(world, { kind: 'tend', targetId: batch.id, requiredHours: 0.8, sol, priority: 4, recurring: true })
  }
  // Уборка: созревшая грядка не собирается сама по себе. Работа уходит в ту же
  // очередь, и пока её не выполнят, грядка стоит на полном цикле — копит стресс
  // запущенности и теряет будущий урожай. Это тот же механизм ожидания, что и
  // у нехватки места на складе, только причина — люди, а не тара.
  for (const batch of world.batches) {
    if (batch.plantedSol === null) continue
    if (batch.development < 1 - 1e-6) continue
    if (batch.ripeSinceSol === null) batch.ripeSinceSol = sol
    if (batch.harvestReady) continue
    if (hasOpenTask(world, 'harvest', batch.id)) continue
    addTask(world, { kind: 'harvest', targetId: batch.id, requiredHours: DEEP_P.harvestHours, sol, priority: 3 })
  }
  // Плановый мониторинг теплиц. Пробы берутся по РАСПИСАНИЮ, а не по
  // показаниям: загрязнение и соли скрыты, и запускать отбор по их значению
  // значило бы выдать игроку ответ до анализа. Вид пробы чередуется, чтобы
  // мониторинг накрывал обе скрытые величины (соли и загрязнение идут по
  // субстрату) и воду.
  const greenhouseIds = [...new Set(world.batches.map(b => b.greenhouseId))]
  for (const id of greenhouseIds) {
    const plantedHere = world.batches.some(b => b.greenhouseId === id && b.plantedSol !== null)
    if (!plantedHere) continue
    const cycle = Math.floor(sol / Math.max(1, DEEP_P.sampleIntervalSols))
    const kind: SampleKind = cycle % 2 === 0 ? 'substrate' : 'water'
    if (hasOpenTask(world, 'sample', `${id}:${kind}`)) continue
    const lastSample = world.samples.filter(s => s.sourceId === id).reduce((m, s) => Math.max(m, s.sol), -1)
    if (sol - lastSample < DEEP_P.sampleIntervalSols) continue
    if (availableOf(world, 'water_clean') < DEEP_P.sampleLitres) continue
    addTask(world, { kind: 'sample', targetId: `${id}:${kind}`, requiredHours: DEEP_P.sampleHours, sol, priority: 5 })
  }
  // Анализ ставится на каждую доставленную пробу, у которой ещё нет анализа.
  // Реагенты — конечный ресурс: нет реактивов — нет результата, а не «результат
  // с потолка». Скрытая причина не становится известной раньше анализа.
  for (const sample of world.samples) {
    if (!sample.delivered) continue
    if (world.analyses.some(a => a.sampleId === sample.id)) continue
    if (hasOpenTask(world, 'analysis', sample.id)) continue
    const kinds = ANALYSIS_KINDS.filter(k => ANALYSIS_META[k].sample === sample.kind)
    const kind = kinds.find(k => world.stock.amount.reagents >= ANALYSIS_META[k].reagents)
    if (!kind) continue
    addTask(world, {
      kind: 'analysis', targetId: sample.id, requiredHours: ANALYSIS_META[kind].hours, sol, priority: 5,
    })
  }
  for (const deposit of world.deposits) {
    if (deposit.confidence >= 0.95 || hasOpenTask(world, 'survey', deposit.id)) continue
    addTask(world, { kind: 'survey', targetId: deposit.id, requiredHours: 3.2, sol, priority: 7 })
  }
  for (const deposit of world.deposits) {
    if (!depositWorkable(deposit) || hasOpenTask(world, 'extract', deposit.id)) continue
    addTask(world, { kind: 'extract', targetId: deposit.id, requiredHours: 6, sol, priority: 4, recurring: true })
  }
  for (const deposit of world.deposits) {
    if (deposit.stockpileKg < 120 || hasOpenTask(world, 'haul', deposit.id)) continue
    const vehicle = world.vehicles.find(v => v.class === 'hauler' && v.jobId === null && vehicleUsable(v))
    if (!vehicle) continue
    const job: HaulJob = {
      id: `J-${deposit.id}-${sol}`, vehicleId: vehicle.id, from: deposit.id, to: 'base',
      resource: 'ice_ore', requestedKg: Math.min(vehicle.capacityKg, deposit.stockpileKg),
      loadedKg: 0, deliveredKg: 0, phase: 'to_pickup', taskId: null, createdSol: sol, legKm: deposit.distanceKm,
    }
    world.haulJobs.push(job)
    vehicle.jobId = job.id
    const hours = estimateTripHours(vehicle, deposit.distanceKm, job.requestedKg)
    const task = addTask(world, { kind: 'haul', targetId: job.id, requiredHours: Math.max(1, hours), sol, priority: 3 })
    job.taskId = task.id
  }
  if (world.config.autoSort && world.sortableRawKg > 1 && !hasOpenTask(world, 'process', 'sort')) {
    addTask(world, {
      kind: 'process', targetId: 'sort', requiredHours: Math.min(6, 0.3 + world.sortableRawKg * 0.04), sol, priority: 4,
    })
  }
}

// --- Выполнение работ ------------------------------------------------------

/** Через сколько солов незавершённый рейс отменяется (машина не должна вечно висеть с грузом). */
const HAUL_ABANDON_SOLS = 12

/**
 * Кислород, стравливаемый шлюзом за один цикл, кг.
 *
 * Шлюз — это МАЛЫЙ гермообъём, а не вся секция: он стравливается наружу и
 * снова заполняется. Терять долю атмосферы секции за каждый выход значило бы
 * терять проценты воздуха базы ежедневно — база осталась бы без атмосферы за
 * считанные соли. Поэтому доля берётся от воздуха шлюза при той же плотности
 * кислорода, что в секции, и восполняется из общего запаса O2.
 */
function airlockCycleO2Kg(world: ColonyWorld, member: CrewMember): number {
  const section = world.sections.find(s => s.deviceId === member.location)
    ?? world.sections.find(s => s.kind === 'habitat')
  if (!section || section.volumeM3 <= 0) return 0
  return airlockLoss(section, DEEP_P.airlockVolumeM3).o2Kg
}

/**
 * Подготовка к выходу наружу. Возвращает часы, реально потраченные на неё.
 *
 * Выход — это не «начал копать». Сначала костюм, шлюз и проверки
 * (`evaPrepHours`), вода на сублиматор (`evaWaterLitres`, она становится
 * стоками, а не исчезает) и два цикла шлюза — на выход и на возврат
 * (`airlockLossFraction`). Человек выходит один раз в сол: подготовка
 * накапливается и сохраняется до конца суток, поэтому каждый выход наружу не
 * стоит новых полутора часов.
 */
export function prepareEva(world: ColonyWorld, member: CrewMember, hours: number, step: SolStep): number {
  const need = DEEP_P.evaPrepHours - member.evaPrepHours
  const spend = Math.min(hours, Math.max(0, need), remainingHours(member))
  if (spend <= 0) return 0
  member.hoursToday += spend
  member.fatigue = clamp01(member.fatigue + DEEP_P.crewFatiguePerWorkHour * spend)
  member.evaPrepHours += spend
  if (member.evaPrepHours + 1e-9 < DEEP_P.evaPrepHours) return spend

  member.suited = true
  member.location = 'eva'
  const water = stockTake(world.stock, 'water_clean', DEEP_P.evaWaterLitres)
  if (water.taken > 0) {
    // Сублиматор возгоняет воду наружу: она физически покидает колонию и
    // стоками НЕ возвращается. Забирать её в `water_grey` значило бы
    // притворяться, что замкнутый контур воды бесплатный.
    step.waterIndustrialL += water.taken
    world.totals.waterIndustrialL += water.taken
  }
  const perCycle = airlockCycleO2Kg(world, member)
  const lost = perCycle * 2
  if (lost > 0) {
    const taken = stockTake(world.stock, 'o2', lost)
    // Бак — якорь кислородного учёта: воздух шлюза уходит наружу и
    // восполняется из бака, поэтому это такой же расход бака, как подпитка
    // атмосферы. Без этого тождество «было + выработка − расход = стало»
    // расходилось бы ровно на объём стравленного воздуха.
    step.o2DemandKg += taken.taken
    step.o2LeakedKg += taken.taken
    world.totals.o2LeakedKg += taken.taken
    world.totals.evaO2Kg += taken.taken
  }
  pushEvent(world, 'eva-begins', 'info',
    `${member.name} выходит наружу: шлюз, ${round(water.taken, 1)} л на сублиматор`,
    `${member.name} steps outside: airlock, ${round(water.taken, 1)} L for the sublimator`, member.id)
  return spend
}

function progressTasks(world: ColonyWorld, hours: number, step: SolStep): void {
  if (world.config.autoTasks) autoAssign(world.crew, world.tasks)
  for (const task of [...world.tasks].sort(compareTasks)) {
    if (!isOpen(task) || task.status === 'paused') continue
    const block = blockReason(world, task)
    if (block) {
      // Люди обязаны отпускаться, и не только в момент перехода в «blocked»:
      // внутри суток несколько подшагов, и задача может быть переведена в
      // «queued» и снова заблокирована, поэтому чистка делается безусловно.
      // Раньше заблокированная работа держала назначенных за собой: `taskId`
      // указывал на неё, а `isOpen` для неё ложен, поэтому человек не продвигал
      // её и не назначался на другую — простаивал до конца прогона.
      for (const crewId of task.assignees) {
        const member = world.crew.find(c => c.id === crewId)
        if (member && member.taskId === task.id) member.taskId = null
      }
      task.assignees = []
      if (task.status !== 'blocked') {
        task.status = 'blocked'
        task.blockCode = block.code
        task.blockReason = block.reason
        pushEvent(world, 'task-blocked', 'warn', `Работа «${TASK_META[task.kind].ru}» остановлена: ${block.reason}`,
          `Task "${TASK_META[task.kind].en}" blocked: ${block.reason}`, task.targetId)
      }
      continue
    }
    if (task.status === 'blocked') { task.status = 'queued'; task.blockReason = null; task.blockCode = null }
    if (task.startedSol === null) {
      task.startedSol = world.sol
      reserveMaterials(world.stock, task)
    }
    if (!task.assignees.length) { task.status = 'queued'; continue }
    task.status = 'active'
    let applied = 0
    let prep = 0
    for (const crewId of [...task.assignees]) {
      const member = world.crew.find(c => c.id === crewId)
      if (!member || member.taskId !== task.id) { task.assignees = task.assignees.filter(id => id !== crewId); continue }
      // Наружная работа требует подготовки; пока человек её не прошёл, он
      // тратит смену на костюм и шлюз, а не на саму работу.
      if (task.eva && !member.suited) { prep += prepareEva(world, member, hours, step); continue }
      applied += workHours(member, task.kind, hours)
    }
    if (prep > 1e-9) {
      step.labour.provided += prep
      world.totals.labourHours += prep
      world.totals.evaPrepHours += prep
    }
    if (applied <= 1e-9) continue
    task.doneHours += applied
    step.labour.byKind[task.kind] = round((step.labour.byKind[task.kind] ?? 0) + applied, 6)
    step.labour.provided += applied
    world.totals.labourHours += applied
    world.totals.labourByKind[task.kind] = round((world.totals.labourByKind[task.kind] ?? 0) + applied, 6)
    if (task.kind === 'extract') mineWithTask(world, task, applied)
    if (task.kind === 'haul') advanceHaulWithTask(world, task, applied)
    if (task.kind === 'plant') consumeMaterials(world.stock, task, clamp01(task.doneHours / task.requiredHours))
    // Рейс — это не «часы работы», а законченный цикл: погрузка → путь →
    // разгрузка → возврат. Если закрывать задачу по часам, машина замирает в
    // разгрузке с грузом в кузове, задание висит вечно и ровер больше никогда
    // не выходит на маршрут (груз не теряется и не раздваивается).
    if (task.kind === 'haul' && taskRemaining(task) <= 1e-9) {
      const job = world.haulJobs.find(j => j.id === task.targetId)
      if (job && job.phase !== 'done') {
        if (world.sol - job.createdSol > HAUL_ABANDON_SOLS) {
          const vehicle = world.vehicles.find(v => v.id === job.vehicleId)
          if (vehicle) { vehicle.jobId = null; vehicle.destination = null; vehicle.idleReason = 'haul-abandoned' }
          world.haulJobs = world.haulJobs.filter(j => j.id !== job.id)
          pushEvent(world, 'haul-abandoned', 'warn',
            `Рейс ${job.id} отменён: не завершён за ${HAUL_ABANDON_SOLS} солов`,
            `Haul ${job.id} abandoned: not finished in ${HAUL_ABANDON_SOLS} sols`, job.id)
        } else {
          task.requiredHours = task.doneHours + 1
        }
        continue
      }
    }
    if (taskRemaining(task) <= 1e-9) completeTask(world, task, step)
  }
}

function blockReason(world: ColonyWorld, task: Task): { code: string; reason: string } | null {
  const target = task.targetId
  switch (task.kind) {
    case 'haul': {
      const job = world.haulJobs.find(j => j.id === target)
      const vehicle = job ? world.vehicles.find(v => v.id === job.vehicleId) : undefined
      if (!job) return { code: BLOCK_CODES.noTarget, reason: 'нет рейса' }
      if (!vehicle) return { code: BLOCK_CODES.noTarget, reason: 'нет машины' }
      if (!vehicleUsable(vehicle)) return { code: BLOCK_CODES.noPower, reason: `машина ${vehicle.id}: нет заряда` }
      if (vehicle.fault) return { code: BLOCK_CODES.faulty, reason: `машина ${vehicle.id}: отказ` }
      if (rangeKm(vehicle) < job.legKm * 0.5) return { code: BLOCK_CODES.noPower, reason: 'мало заряда для рейса' }
      return null
    }
    case 'extract': {
      const deposit = world.deposits.find(d => d.id === target)
      if (!deposit) return { code: BLOCK_CODES.noTarget, reason: 'нет месторождения' }
      const reason = depositBlockReason(deposit)
      if (reason) return { code: BLOCK_CODES.noAccess, reason: `месторождение: ${reason}` }
      const rig = world.devices.find(d => d.id === deposit.rigId)
      if (!rig || !deviceUsable(rig)) return { code: BLOCK_CODES.faulty, reason: 'добывающая установка не работает' }
      if (rig.powerFraction <= 0.01) return { code: BLOCK_CODES.noPower, reason: 'нет питания установки' }
      if (world.stock.cap.ice_ore - world.stock.amount.ice_ore < 5) return { code: BLOCK_CODES.full, reason: 'склад сырья заполнен' }
      return null
    }
    case 'plant':
    case 'tend': {
      const batch = world.batches.find(b => b.id === target)
      if (!batch) return { code: BLOCK_CODES.noTarget, reason: 'нет грядки' }
      if (task.kind === 'plant' && batch.plantedSol !== null) return { code: BLOCK_CODES.noTarget, reason: 'грядка уже засажена' }
      if (task.kind === 'tend' && batch.plantedSol === null) return { code: BLOCK_CODES.noTarget, reason: 'грядка пуста' }
      const greenhouse = world.devices.find(d => d.id === batch.greenhouseId)
      if (greenhouse?.fault) return { code: BLOCK_CODES.faulty, reason: `теплица ${greenhouse.id}: отказ` }
      return null
    }
    case 'repair':
    case 'inspect':
    case 'maintain':
    case 'clean_panels': {
      const device = world.devices.find(d => d.id === target)
      const vehicle = device ? undefined : world.vehicles.find(v => v.id === target)
      if (!device && !vehicle) return { code: BLOCK_CODES.noTarget, reason: 'нет оборудования' }
      // Не `??`: отсутствие отказа — это законное `undefined`, и его нельзя
      // принимать за «цели нет» и проваливаться в ветку машины.
      const fault = device ? device.fault : vehicle!.fault
      if (task.kind === 'maintain' && fault) return { code: BLOCK_CODES.faulty, reason: 'сначала ремонт' }
      const risky = device ? device.risky : vehicle!.risky
      if (task.kind === 'repair' && (!fault || (!fault.diagnosed && !risky))) {
        return { code: BLOCK_CODES.noAccess, reason: 'отказ не диагностирован' }
      }
      if (task.kind === 'inspect' && !fault) return { code: BLOCK_CODES.noTarget, reason: 'отказа нет' }
      return null
    }
    case 'survey': {
      const deposit = world.deposits.find(d => d.id === target)
      if (!deposit) return { code: BLOCK_CODES.noTarget, reason: 'нет месторождения' }
      const scout = world.vehicles.find(v => v.class === 'scout')
      if (!scout || !vehicleUsable(scout)) return { code: BLOCK_CODES.noAccess, reason: 'нет исправной разведмашины' }
      if (scout.fault) return { code: BLOCK_CODES.faulty, reason: 'разведмашина неисправна' }
      if (rangeKm(scout) < deposit.distanceKm * 2) return { code: BLOCK_CODES.noPower, reason: 'мало заряда для разведки' }
      return null
    }
    default: return null
  }
}

function completeTask(world: ColonyWorld, task: Task, step?: SolStep): void {
  task.status = 'done'
  task.finishedSol = world.sol
  consumeMaterials(world.stock, task, 1)
  for (const crewId of task.assignees) {
    const member = world.crew.find(c => c.id === crewId)
    if (member && member.taskId === task.id) member.taskId = null
  }
  const target = task.targetId
  switch (task.kind) {
    case 'plant': {
      const batch = world.batches.find(b => b.id === target)
      const seedKg = task.materials.reduce((sum, m) => sum + m.consumed, 0)
      if (batch && seedKg > 0) {
        plantBatch(batch, world.sol, seedKg, batch.areaM2)
        world.outbox.plant.push({ plotId: batch.greenhouseId, bedIndex: batch.bedIndex, seedKg })
        pushEvent(world, 'planted', 'info',
          `Грядка ${batch.greenhouseId}/${batch.bedIndex + 1} засажена: ${round(seedKg, 2)} кг семян`,
          `Bed ${batch.greenhouseId}/${batch.bedIndex + 1} planted with ${round(seedKg, 2)} kg of seed`, batch.id)
      }
      break
    }
    case 'tend': {
      const batch = world.batches.find(b => b.id === target)
      if (batch) batch.lastTendSol = world.sol
      break
    }
    case 'harvest': {
      // Сама масса уходит через реестр — он единственный писатель еды. Здесь
      // работа лишь снимает запрет: грядка открыта к уборке в эти сутки.
      const batch = world.batches.find(b => b.id === target)
      if (batch) {
        batch.harvestReady = true
        batch.lastTendSol = world.sol
      }
      break
    }
    case 'clean_panels': {
      const device = world.devices.find(d => d.id === target)
      if (device) {
        const before = device.dust
        device.dust = clamp01(device.dust * (1 - DEEP_P.dustCleanRestore))
        pushEvent(world, 'panels-cleaned', 'info',
          `${device.name}: пыль ${round(before * 100)} % → ${round(device.dust * 100)} %`,
          `${device.name}: dust ${round(before * 100)} % → ${round(device.dust * 100)} %`, device.id)
      }
      break
    }
    case 'inspect': {
      const device = world.devices.find(d => d.id === target)
      const vehicle = device ? undefined : world.vehicles.find(v => v.id === target)
      if (device && diagnoseFault(device)) {
        pushEvent(world, 'diagnosed', 'info', `${device.name}: причина — ${device.fault?.cause}`,
          `${device.name}: cause — ${device.fault?.code}`, device.id)
      } else if (vehicle && diagnoseVehicle(vehicle)) {
        pushEvent(world, 'diagnosed', 'info', `${vehicle.name}: причина — ${vehicle.fault?.cause}`,
          `${vehicle.name}: cause — ${vehicle.fault?.code}`, vehicle.id)
      }
      break
    }
    case 'repair': {
      const device = world.devices.find(d => d.id === target)
      const vehicle = device ? undefined : world.vehicles.find(v => v.id === target)
      const parts = task.materials.reduce((sum, m) => sum + m.consumed, 0)
      if (device?.fault) {
        // Риск бросает ГПСЧ мира: решение игрока не должно менять
        // воспроизводимость прогона.
        const rng = rngFromState(world.rngState)
        const result = repairDevice(device, parts, device.risky ? { risky: true, rng } : {})
        world.rngState = rng.state
        if (result.ok) {
          world.totals.partsUsed += result.parts
          const risky = result.reason === 'repaired-risky' || result.reason === 'repaired-risky-refault'
          if (risky) pushEvent(world, 'repaired-risky', 'warn',
            `${device.name}: рискованный ремонт без запчасти — состояние ${round(device.condition, 2)}`
            + (result.reason === 'repaired-risky-refault' ? ', агрегат встал снова' : ''),
            `${device.name}: risky repair with no spare — condition ${round(device.condition, 2)}`
            + (result.reason === 'repaired-risky-refault' ? ', failed again' : ''), device.id)
          else pushEvent(world, 'repaired', 'info', `${device.name}: ремонт завершён (${result.parts} деталей)`,
            `${device.name}: repair finished (${result.parts} parts)`, device.id)
        }
      } else if (vehicle?.fault) {
        const result = repairVehicle(vehicle, parts)
        if (result.ok) {
          world.totals.partsUsed += result.parts
          pushEvent(world, 'repaired', 'info', `${vehicle.name}: ремонт завершён (${result.parts} деталей)`,
            `${vehicle.name}: repair finished (${result.parts} parts)`, vehicle.id)
        }
      }
      break
    }
    case 'maintain': {
      const device = world.devices.find(d => d.id === target)
      const vehicle = device ? undefined : world.vehicles.find(v => v.id === target)
      if (device) serviceDevice(device)
      else if (vehicle && serviceVehicle(vehicle)) {
        pushEvent(world, 'serviced', 'info', `${vehicle.name}: обслуживание выполнено`,
          `${vehicle.name}: serviced`, vehicle.id)
      }
      break
    }
    case 'sample': {
      // targetId — «теплица:вид пробы». Проба стоит воды; не хватило воды —
      // пробы не будет, а не «проба из воздуха».
      const [source, kind] = target.split(':')
      if (source && kind) takeSample(world, kind as SampleKind, source, step)
      break
    }
    case 'analysis': {
      const sample = world.samples.find(s => s.id === target)
      if (!sample) break
      const kinds = ANALYSIS_KINDS.filter(k => ANALYSIS_META[k].sample === sample.kind)
      const kind = kinds.find(k => world.stock.amount.reagents >= ANALYSIS_META[k].reagents)
      // Проба уже взята; анализ всё равно требует реактивов и времени
      // специалиста. Результат приходит с указанной точностью, а не мгновенно.
      if (kind) requestAnalysis(world, kind, sample.sourceId)
      break
    }
    case 'survey': {
      const deposit = world.deposits.find(d => d.id === target)
      if (deposit) {
        const before = deposit.estimateKg
        surveyDeposit(deposit, rngFromState(world.rngState))
        pushEvent(world, 'surveyed', 'info',
          `${deposit.name}: оценка ${Math.round(before / 1000)} т → ${Math.round(deposit.estimateKg / 1000)} т, изученность ${round(deposit.confidence * 100)} %`,
          `${deposit.name}: estimate ${Math.round(before / 1000)} t → ${Math.round(deposit.estimateKg / 1000)} t, confidence ${round(deposit.confidence * 100)} %`, deposit.id)
      }
      break
    }
    case 'process': {
      const kg = Math.min(world.sortableRawKg, 40)
      if (kg > 0.01) world.outbox.sort.push({ kg })
      break
    }
    default: break
  }
  // `tend` здесь нет: уход за грядкой планируется `planTasks` по интервалу
  // (`tendIntervalSols`), а безусловное пересоздание этот интервал обходило.
  // Грядка получала задачу в тот же сол, когда её закончили, и 12 грядок
  // крутили бесконечную ленту, съедая 70 % рабочего времени экипажа на условия,
  // которые и так были идеальными, — а на посадку времени не оставалось вовсе.
  if (task.recurring && ['extract', 'maintain', 'clean_panels'].includes(task.kind)) {
    const again = addTask(world, {
      kind: task.kind, targetId: task.targetId, requiredHours: task.requiredHours, sol: world.sol,
      priority: task.basePriority, recurring: true,
      materials: task.materials.map(m => ({ resource: m.resource, amount: m.required })),
    })
    again.manualPriority = task.manualPriority
  }
}

function mineWithTask(world: ColonyWorld, task: Task, effectiveHours: number): void {
  const deposit = world.deposits.find(d => d.id === task.targetId)
  const rig = world.devices.find(d => d.id === deposit?.rigId)
  if (!deposit || !rig) return
  const hours = effectiveHours / Math.max(0.3, deposit.hardness)
  const energyKwh = rig.receivedKw * SUBSTEP_HOURS
  const byEnergy = DEEP_P.extractionKwhPerKg > 0 ? energyKwh / (DEEP_P.extractionKwhPerKg * Math.max(0.3, deposit.hardness)) : Infinity
  const kg = Math.min(extractionCapacity(SUBSTEP_HOURS, hours, rig.condition, deposit.hardness), byEnergy)
  if (!(kg > 0)) return
  const mined = mineDeposit(deposit, kg)
  if (mined.mined > 0) {
    world.totals.minedKg += mined.mined
    if (mined.depleted) pushEvent(world, 'deposit-depleted', 'warn', `${deposit.name}: запас выработан`,
      `${deposit.name}: deposit depleted`, deposit.id)
  }
}

function advanceHaulWithTask(world: ColonyWorld, task: Task, effectiveHours: number): void {
  const job = world.haulJobs.find(j => j.id === task.targetId)
  const vehicle = world.vehicles.find(v => v.id === job?.vehicleId)
  if (!job || !vehicle) return
  stepHaulJob(job, vehicle, effectiveHours, {
    pickUp: (node, resource, kg) => {
      if (node === 'base') return stockTake(world.stock, resource, kg).taken
      const deposit = world.deposits.find(d => d.id === node)
      return deposit ? loadStockpile(deposit, kg) : 0
    },
    dropOff: (node, resource, kg) => {
      if (node === 'base') return stockAdd(world.stock, resource, kg).added
      return 0
    },
    distanceKm: (from, to) => {
      if (from === to) return 0
      const deposit = world.deposits.find(d => d.id === (from === 'base' ? to : from))
      return deposit ? deposit.distanceKm : 1
    },
  }, true)
  if (job.phase === 'done') {
    world.totals.hauledKg += job.deliveredKg
    vehicle.jobId = null
    vehicle.at = 'base'
    pushEvent(world, 'hauled', 'info', `${vehicle.name}: доставлено ${round(job.deliveredKg, 1)} кг сырья`,
      `${vehicle.name}: delivered ${round(job.deliveredKg, 1)} kg of ore`, vehicle.id)
  }
}

// --- Оборудование ----------------------------------------------------------

function operateEquipment(world: ColonyWorld, hours: number, step: SolStep): void {
  const config = world.config
  const stock = world.stock
  // Электролиз: вода → кислород в бак.
  for (const device of world.devices) {
    if (device.kind !== 'o2_gen') continue
    const output = deviceOutput(device)
    if (output <= 0) continue
    const kgPerHour = config.o2GenKgPerHour * output
    const waterKg = kgPerHour * hours * DEEP_P.electrolysisWaterKgPerKgO2
    const taken = stockTake(stock, 'water_clean', waterKg)
    const produced = taken.taken / DEEP_P.electrolysisWaterKgPerKgO2
    const added = stockAdd(stock, 'o2', produced)
    step.o2ProducedKg += added.added
    world.totals.o2ProducedKg += added.added
    step.waterIndustrialL += taken.taken
    world.totals.waterIndustrialL += taken.taken
    if (taken.shortage > 0.01) {
      pushEvent(world, 'o2-no-water', 'warn', 'Кислородной установке не хватает воды',
        'Oxygen generator is short of water', device.id)
    }
  }
  // Скруббер: CO2 из секций в бак (потом идёт в теплицы).
  for (const device of world.devices) {
    if (device.kind !== 'scrubber') continue
    const output = deviceOutput(device)
    if (output <= 0) continue
    let removed = 0
    for (const section of world.sections) {
      if (section.isolated) continue
      const share = section.volumeM3 / DEEP_P.habitatVolumeM3
      removed += scrubCo2(section, config.scrubberKgPerHour * output * hours * share)
    }
    if (removed > 0) stockAdd(stock, 'co2', removed)
  }
  // Обогащение теплиц CO2: расход из бака по потребности.
  for (const section of world.sections) {
    if (section.kind !== 'greenhouse' || section.isolated) continue
    const deficit = TARGET_CO2_GREENHOUSE - co2PartialKpa(section)
    if (deficit <= 0.002) continue
    const need = massForDelta(section, deficit, 0.044)
    const taken = stockTake(stock, 'co2', need)
    if (taken.taken > 0) section.co2Kg += taken.taken
  }
  // Извлечение воды из породы.
  for (const device of world.devices) {
    if (device.kind !== 'extractor') continue
    const output = deviceOutput(device)
    if (output <= 0) continue
    const ore = stock.amount.ice_ore
    if (ore <= 0) continue
    const result = sublimateOre(ore, device.receivedKw * hours, stock.cap.water_raw - stock.amount.water_raw)
    if (result.oreKg <= 0) continue
    const used = stockTake(stock, 'ice_ore', result.oreKg)
    const added = stockAdd(stock, 'water_raw', result.waterL)
    stockAdd(stock, 'tailings', used.taken)
    world.totals.rawProducedL += added.added
    if (result.overflowL > 0.01) {
      pushEvent(world, 'raw-tank-full', 'warn', `Резервуар неочищенной воды полон: потеряно ${round(result.overflowL, 1)} л`,
        `Raw-water tank full: ${round(result.overflowL, 1)} L lost`, device.id)
    }
  }
  // Очистка.
  for (const device of world.devices) {
    if (device.kind !== 'purifier') continue
    const output = deviceOutput(device)
    if (output <= 0) continue
    const result = purifyWater(
      stock.amount.water_raw, device.receivedKw * hours,
      stock.cap.water_clean - stock.amount.water_clean,
      Math.floor(availableOf(world, 'filters')),
      config.purifierLitresPerHour * output, hours,
    )
    if (result.rawUsedL <= 0) continue
    stockTake(stock, 'water_raw', result.rawUsedL)
    const added = stockAdd(stock, 'water_clean', result.cleanL)
    stockAdd(stock, 'brine', result.brineL)
    const filters = stockTake(stock, 'filters', result.filtersUsed)
    world.totals.filtersUsed += filters.taken
    step.waterProducedL += added.added
    world.totals.cleanProducedL += added.added
  }
  // Регенерация стоков.
  for (const device of world.devices) {
    if (device.kind !== 'recycler') continue
    const output = deviceOutput(device)
    if (output <= 0) continue
    const result = recycleGreyWater(
      stock.amount.water_grey, device.receivedKw * hours,
      stock.cap.water_clean - stock.amount.water_clean,
      Math.floor(availableOf(world, 'filters')),
      config.recyclerLitresPerHour * output, hours,
    )
    if (result.greyUsedL <= 0) continue
    stockTake(stock, 'water_grey', result.greyUsedL)
    const added = stockAdd(stock, 'water_clean', result.cleanL)
    stockAdd(stock, 'sludge', result.sludgeKg)
    const filters = stockTake(stock, 'filters', result.filtersUsed)
    world.totals.filtersUsed += filters.taken
    step.waterProducedL += added.added
    world.totals.cleanProducedL += added.added
    world.totals.recycledL += added.added
  }
}

// --- Секции ----------------------------------------------------------------

function updateSections(world: ColonyWorld, hours: number, outsideC: number, step: SolStep): void {
  const shareOfSol = hours / SOL_HOURS
  const stock = world.stock
  const home = homeSection(world)
  for (const section of world.sections) section.crewIds = []
  for (const member of world.crew) {
    const section = world.sections.find(s => s.id === member.location) ?? home
    if (section) { section.crewIds.push(member.id); member.location = section.id }
    else member.location = 'base'
  }
  for (const section of world.sections) {
    const device = world.devices.find(d => d.id === section.deviceId)
    const internalKw = (device ? deviceHeatKw(device) : 0) + section.crewIds.length * 0.1
    // Климат секции работает только при питании агрегата: без энергии нет ни обогрева, ни охлаждения.
    const hvacFraction = device ? clamp01(device.powerFraction) : 0
    const targetC = section.kind === 'greenhouse' ? DEEP_P.targetGreenhouseC
      : section.kind === 'habitat' ? DEEP_P.targetHabitatC : DEEP_P.targetHabitatC
    const hvac = stepSectionThermal(section, hours, internalKw, outsideC, targetC, hvacFraction)
    if (hvac.coolerKw > 0) world.totals.coolingKwh = round((world.totals.coolingKwh ?? 0) + hvac.coolerKw * hours, 6)
    // Перемешивание воздуха питается от того же агрегата, что и климат: нет
    // энергии — нет вентилятора, и атмосфера портится раньше, чем секция
    // успевает остыть. Это отдельная причина стресса, а не дубль температуры.
    stepSectionCirculation(section, hours, hvacFraction)
    const beforeO2 = section.o2Kg
    leakSection(section, shareOfSol)
    step.o2LeakedKg += Math.max(0, beforeO2 - section.o2Kg)
    // Влага людей → конденсат → стоки. Транспирацию собирает `growCrops`:
    // иначе одна и та же вода приходила бы в стоки дважды.
    const people = section.crewIds.length * DEEP_P.crewMoistureLPerSol * shareOfSol
    const collected = stepSectionHumidity(section, people, world.config.condensateLitresPerSol, shareOfSol)
    if (collected > 0) {
      const got = stockAdd(stock, 'water_grey', collected)
      world.totals.condensateL += got.added
    }
    const drained = drainCondensate(section)
    if (drained > 0) stockAdd(stock, 'water_grey', drained)
    // Кислород: секция добирает из бака до целевого парциального давления.
    if (!section.isolated) {
      const deficit = TARGET_O2_HABITAT - o2PartialKpa(section)
      if (deficit > 0.01) {
        const need = massForDelta(section, deficit, MOLAR_O2)
        const drawn = stockTake(stock, 'o2', need)
        injectO2(section, drawn.taken)
        // Бак — якорь кислородного учёта: сколько ушло на подпитку атмосферы.
        step.o2DemandKg += drawn.taken
      }
    }
  }
}

// --- Растения --------------------------------------------------------------

function growCrops(world: ColonyWorld, hours: number, step: SolStep, potential: Record<string, number> | undefined): void {
  const shareOfSol = hours / SOL_HOURS
  const stock = world.stock
  const planted = world.batches.filter(b => b.plantedSol !== null)
  const waterDemand = planted.reduce((sum, b) => sum + batchWaterDemandL(b, shareOfSol), 0)
  const nutrientDemand = planted.reduce((sum, b) => sum + batchNutrientDemandKg(b, shareOfSol), 0)
  // Раствор готовится по рецепту: вода + N/P/K в фиксированной пропорции.
  // `prepareSolution` — единственное место, где считается, сколько раствора
  // выйдет из наличных воды и удобрений; раньше эта физика была продублирована
  // здесь же вручную, и две копии расходились.
  const recipeKgPerL = DEEP_P.nutrientSolutionKgPerL
  const solution = prepareSolution(
    availableOf(world, 'water_clean'), nutrientTotal(world.stock), recipeKgPerL,
  )
  const waterFraction = fraction(availableOf(world, 'water_clean'), waterDemand)
  // Носитель питания: какая доля нормы полива реально дошла до корня.
  // Ограничение снизу — и по воде, и по удобрениям: пустой склад при полном
  // баке даёт не раствор, а воду, поэтому предел берётся по раствору.
  const carrierFraction = clamp01(fraction(solution.solutionL, waterDemand))

  // CO₂ — общий ресурс секции. Снимок парциального давления делается ДО того,
  // как грядки начнут его забирать: иначе первые грядки в цикле получают всю
  // атмосферу, а последние видят искусственно опустошённую секцию, копят стресс
  // и теряют урожай навсегда. Доступное количество делится по спросу поровну.
  const co2Partial = new Map<string, number>()
  const co2Demand = new Map<string, number>()
  for (const batch of world.batches) {
    if (batch.plantedSol === null) continue
    const device = world.devices.find(d => d.id === batch.greenhouseId)
    const section = world.sections.find(s => s.id === device?.sectionId)
    if (!section) continue
    if (!co2Partial.has(section.id)) co2Partial.set(section.id, co2PartialKpa(section))
    const demand = batch.areaM2 * DEEP_P.cropKgPerM2PerSol * DEEP_P.cropCo2KgPerKgFresh * shareOfSol
    co2Demand.set(section.id, (co2Demand.get(section.id) ?? 0) + demand)
  }
  const co2Share = new Map<string, number>()
  for (const [sectionId, demand] of co2Demand) {
    const section = world.sections.find(s => s.id === sectionId)
    co2Share.set(sectionId, demand > 1e-9 && section ? clamp01(section.co2Kg / demand) : 1)
  }

  for (const batch of world.batches) {
    const key = batch.greenhouseId
    step.growthByBed[key] = step.growthByBed[key] ?? []
    step.yieldFactor[key] = step.yieldFactor[key] ?? []
    if (batch.plantedSol === null) {
      step.growthByBed[key][batch.bedIndex] = (step.growthByBed[key][batch.bedIndex] ?? 0) + 0
      step.yieldFactor[key][batch.bedIndex] = 0
      continue
    }
    const device = world.devices.find(d => d.id === batch.greenhouseId)
    const section = world.sections.find(s => s.id === device?.sectionId)
    // Если потенциал не передан агрегатным слоем, свет учитывается здесь.
    const lightFraction = potential ? 1 : clamp01(device ? device.powerFraction : 0)
    const climate = section ? clamp01(atmosphereQuality(section)) : 0
    // Корневая зона своя у каждой грядки: субстрат инертен и остывает от
    // полива холодной водой, поэтому корни почти всегда холоднее воздуха.
    // Полив обильнее обычного — корням холоднее: отсюда настоящий предел у
    // стратегии «залить водой».
    // Сколько полива реально дошло, в долях от нормы. Прежняя формула
    // (1 / max(0.2, waterFraction)) при waterFraction ≤ 1 давала ровно 1 при
    // ЛЮБОМ дефиците: `fraction` уже обрезает в 0…1, а 1/x ≥ 1 снова
    // обрезалось. Механизм охлаждения корневой зоны был константой, а не
    // динамикой. Теперь это честная доля доставленного полива: бак пустеет —
    // корни поливаются меньше, греются сильнее и недоедают (см. carrier ниже).
    const irrigationRatio = clamp01(waterFraction)
    const rootC = relaxRootTemperatureC(
      batch.rootTemperatureC,
      rootZoneTargetC(section?.temperatureC ?? 20, irrigationRatio),
      shareOfSol,
    )
    batch.rootTemperatureC = rootC
    const env: GrowthEnvironment = {
      temperatureC: section?.temperatureC ?? 20,
      rootTemperatureC: rootC,
      co2PartialKpa: section ? (co2Partial.get(section.id) ?? co2PartialKpa(section)) * (co2Share.get(section.id) ?? 1) : 0.03,
      o2PartialKpa: section ? o2PartialKpa(section) : 18,
      lightFraction,
      waterFraction: waterFraction * (0.4 + 0.6 * climate),
      // Питание доставляется РАСТВОРОМ: ион доходит до корня только с водой.
      // Полный склад удобрений при сухом субстрате не кормит ничего — поэтому
      // каждый элемент ограничен не только наличием на складе, но и долей
      // доставленного полива (Либих: минимум из двух).
      nutrients: {
        n: Math.min(carrierFraction, clamp01(availableOf(world, 'nutrient_n') / Math.max(1e-9, nutrientDemand * NUTRIENT_SHARE.nutrient_n))),
        p: Math.min(carrierFraction, clamp01(availableOf(world, 'nutrient_p') / Math.max(1e-9, nutrientDemand * NUTRIENT_SHARE.nutrient_p))),
        k: Math.min(carrierFraction, clamp01(availableOf(world, 'nutrient_k') / Math.max(1e-9, nutrientDemand * NUTRIENT_SHARE.nutrient_k))),
      },
      waterlogRatio: Math.max(0, 1 - waterFraction) * 0.5,
      sol: world.sol,
      dtSols: shareOfSol,
    }
    const before = batch.development
    const { dDevelopment } = stepBatch(batch, env)
    const potentialFactor = potential ? clamp01(potential[batch.greenhouseId] ?? 0) : 1
    const effective = dDevelopment * potentialFactor
    batch.development = clamp01(before + effective)
    // Расход воды и питания пропорционален реальному росту.
    const waterUsed = batchWaterDemandL(batch, shareOfSol) * clamp01(0.2 + 0.8 * (potentialFactor > 0 ? 1 : 0))
    // Списывается только то, что раствор реально донёс: недолитый раствор
    // означает, что часть нормы просто не была смешана и осталась на складе.
    const nutrientUsed = batchNutrientDemandKg(batch, shareOfSol) * potentialFactor * carrierFraction
    // Учитывается только фактически списанное: склад может быть пуст.
    const waterGot = stockTake(stock, 'water_clean', waterUsed)
    let nutrientGot = 0
    for (const [id, amount] of splitNutrients(nutrientUsed)) nutrientGot += stockTake(stock, id, amount).taken
    step.waterIndustrialL += waterGot.taken
    world.totals.waterIndustrialL += waterGot.taken
    step.nutrientUsedKg += nutrientGot
    world.totals.nutrientAppliedKg += nutrientGot
    // Транспирация не исчезает: конденсатор теплицы собирает её обратно. Это
    // дистиллят (чище стоков), поэтому он возвращается прямо в бак чистой воды;
    // невозвращённая доля — реальные потери контура теплицы.
    const captured = stockAdd(stock, 'water_clean', waterGot.taken * clamp01(DEEP_P.transpirationCaptureFraction))
    step.condensateL += captured.added
    world.totals.condensateL += captured.added
    if (section && effective > 0) {
      section.co2Kg = Math.max(0, section.co2Kg - batchCo2UptakeKg(batch, effective))
      const o2 = batchO2OutputKg(batch, effective)
      injectO2(section, o2)
      step.cropO2Kg += o2
      world.totals.cropO2Kg += o2
    }
    step.growthByBed[key][batch.bedIndex] = (step.growthByBed[key][batch.bedIndex] ?? 0) + effective * DEEP_P.cropCycleSols
    step.yieldFactor[key][batch.bedIndex] = clamp01(batch.density) * clamp01(batch.health) * (1 - batch.yieldPenalty)
  }
}

/**
 * Занятость оборудования на подшаг. Агрегат без работы не тянет номинальную
 * мощность: пустой очиститель не греет базу впустую, лампы теплицы горят
 * только фотопериод. Отсюда же берутся честные причины простоя для игрока.
 */
function computeDuty(world: ColonyWorld, solHour: number): void {
  const stock = world.stock
  const cleanRoom = Math.max(0, stock.cap.water_clean - stock.amount.water_clean)
  const photoStart = (SOL_HOURS - DEEP_P.photoperiodHours) / 2
  const lampsOn = solHour >= photoStart && solHour < photoStart + DEEP_P.photoperiodHours
  const idleGreenhouse = DEEP_P.greenhouseUtilitiesKwPerM2
    / Math.max(1e-9, DEEP_P.lampKwPerM2 + DEEP_P.greenhouseUtilitiesKwPerM2)
  const o2Needed = world.sections.some(s => !s.isolated && TARGET_O2_HABITAT - o2PartialKpa(s) > 0.05)
  const co2High = world.sections.some(s => co2PartialKpa(s) > DEEP_P.targetCo2PartialKpa * 1.15)
  const labBusy = world.analyses.some(a => a.status === 'running') || world.experiments.some(e => e.status === 'running')
  const shopBusy = world.devices.some(d => d.fault !== null) || world.vehicles.some(v => v.fault !== null)
  const oreRoom = stock.cap.ice_ore - stock.amount.ice_ore
  for (const device of world.devices) {
    switch (device.kind) {
      case 'greenhouse': device.duty = lampsOn ? 1 : idleGreenhouse; break
      case 'purifier': device.duty = stock.amount.water_raw > 1 && cleanRoom > 1 ? 1 : 0; break
      case 'recycler': device.duty = stock.amount.water_grey > 1 && cleanRoom > 1 ? 1 : 0; break
      case 'extractor':
        // Установка берёт мощность, только когда реально работает месторождение
        // и на базе есть куда складывать породу. Раньше здесь стояло «есть руда»,
        // и цепочка висела: руды нет → мощности нет → добыча заблокирована.
        device.duty = world.deposits.some(d => d.rigId === device.id && depositWorkable(d)) && oreRoom > 1 ? 1 : 0
        break
      case 'pump': device.duty = stock.amount.water_raw > 1 || stock.amount.water_grey > 1 ? 1 : 0.2; break
      case 'o2_gen': device.duty = o2Needed ? 1 : 0.1; break
      case 'scrubber': device.duty = co2High ? 1 : 0.1; break
      case 'lab': device.duty = labBusy ? 1 : 0.15; break
      case 'workshop': device.duty = shopBusy ? 1 : 0.25; break
      case 'depot': device.duty = 0.4; break
      default: device.duty = 1
    }
  }
}

// --- Лаборатория, отходы, надёжность, экипаж ------------------------------

const ANALYSIS_HOURS: Record<AnalysisKind, number> = {
  water_quality: DEEP_P.analysisHours * 0.8,
  solution_composition: DEEP_P.analysisHours,
  salt_index: DEEP_P.analysisHours * 1.2,
  contamination: DEEP_P.analysisHours * 1.4,
  root_zone: DEEP_P.analysisHours * 1.1,
}

function stepLaboratory(world: ColonyWorld, hours: number, step: SolStep): void {
  const lab = world.devices.find(d => d.kind === 'lab')
  const labPower = lab && deviceUsable(lab) ? clamp01(lab.powerFraction) : 0
  for (const analysis of world.analyses) {
    if (analysis.status !== 'running' || labPower <= 0.01) continue
    const member = world.crew.find(c => c.taskId === null)
    if (!member) continue
    const work = workHours(member, 'analysis', hours)
    analysis.doneHours += work
    world.totals.labourHours += work
    world.totals.labourByKind.analysis = round((world.totals.labourByKind.analysis ?? 0) + work, 6)
    if (analysis.doneHours >= ANALYSIS_HOURS[analysis.kind]) {
      finishAnalysis(analysis, world.sol, hiddenValueOf(world, analysis), rngFromState(world.rngState))
      pushEvent(world, 'analysis-done', 'info',
        `Анализ «${ANALYSIS_META[analysis.kind].ru}»: ${round(analysis.result!.value, 2)} ± ${round(analysis.result!.ci, 2)}`,
        `Analysis "${ANALYSIS_META[analysis.kind].en}": ${round(analysis.result!.value, 2)} ± ${round(analysis.result!.ci, 2)}`, analysis.targetId)
    }
  }
  for (const experiment of world.experiments) {
    if (experiment.status !== 'running') continue
    const need = stepExperiment(experiment, world.sol, hours / SOL_HOURS, {
      waterFraction: fraction(availableOf(world, 'water_clean'), 20),
      nutrientFraction: fraction(nutrientTotal(world.stock), 1),
      energyFraction: labPower,
      labourFraction: 1,
    })
    stockTake(world.stock, 'water_clean', need.waterL)
    for (const [id, amount] of splitNutrients(need.nutrientKg)) stockTake(world.stock, id, amount)
    step.waterIndustrialL += need.waterL
    step.nutrientUsedKg += need.nutrientKg
    world.totals.waterIndustrialL += need.waterL
    world.totals.nutrientAppliedKg += need.nutrientKg
    world.totals.labourHours += need.labourHours
    if (world.sol - experiment.startSol >= experiment.sols) {
      const result = finishExperiment(experiment)
      pushEvent(world, 'experiment-done', 'info',
        `Эксперимент «${experiment.name}»: A ${round(result.a.yieldKg, 2)} кг / B ${round(result.b.yieldKg, 2)} кг`,
        `Experiment "${experiment.name}": A ${round(result.a.yieldKg, 2)} kg / B ${round(result.b.yieldKg, 2)} kg`, experiment.id)
    }
  }
  void step
}

/** Скрытое состояние, которое измеряет анализ. До анализа игрок его не видит. */
function hiddenValueOf(world: ColonyWorld, analysis: Analysis): number {
  const batch = world.batches.find(b => b.greenhouseId === analysis.targetId || b.id === analysis.targetId)
  switch (analysis.kind) {
    case 'contamination': return batch?.contamination ?? 0
    case 'salt_index': return batch?.saltIndex ?? 0
    case 'root_zone': return batch ? clamp01(batch.stress * 0.6 + Math.max(0, 1 - batch.health)) : 0
    case 'water_quality': return clamp01(world.stock.amount.brine / Math.max(1, world.stock.cap.brine))
    case 'solution_composition': return clamp01(1 - fraction(nutrientTotal(world.stock), 2))
    default: return 0
  }
}

function stepWaste(world: ColonyWorld, hours: number, step: SolStep): void {
  // Остатки не компостируются сами: база запускает партию, когда есть из чего.
  if (world.compost.length === 0
    && world.stock.amount.biomass + world.stock.amount.food_waste > 5) {
    startCompost(world, 60)
  }
  const result = stepComposting(world.compost, hours / SOL_HOURS, {
    energyFraction: world.devices.some(d => d.kind === 'workshop' && d.powerFraction > 0.2) ? 1 : 0,
    labourFraction: world.crew.some(c => c.taskId === null) ? 1 : 0,
    inputLimitKg: 60,
  })
  if (result.compostKg > 0) {
    const nutrients = compostToNutrients(result.compostKg)
    stockAdd(world.stock, 'nutrient_n', nutrients.n)
    stockAdd(world.stock, 'nutrient_p', nutrients.p)
    stockAdd(world.stock, 'nutrient_k', nutrients.k)
    const returned = nutrients.n + nutrients.p + nutrients.k
    world.totals.nutrientReturnedKg += returned
    step.nutrientProducedKg += returned
    pushEvent(world, 'compost-ready', 'info', `Компост готов: +${round(returned, 3)} кг NPK возвращено`,
      `Compost ready: +${round(returned, 3)} kg NPK returned`, null)
  }
  world.compost = world.compost.filter(b => !b.done)
}

function stepReliabilityAll(world: ColonyWorld, hours: number, rng: Rng): void {
  const scenario = world.scenario
  for (const device of world.devices) {
    if (isGenerator(device)) accumulateDust(device, hours / SOL_HOURS, scenario.dustRate)
    const load = device.ratedKw > 0 ? clamp01(device.powerFraction) : 0
    stepDeviceReliability(device, hours, load, rng, scenario.dustRate)
    if (device.ratedKw > 0 && !deviceUsable(device)) world.totals.downtimeDeviceSols += hours / SOL_HOURS
    if (device.fault && device.fault.sinceSol === 0 && device.fault.diagnosed === false) {
      device.fault.sinceSol = world.sol
      world.totals.faults += 1
      pushEvent(world, 'fault', 'critical', `${device.name}: отказ (${device.fault.code})`,
        `${device.name}: failure (${device.fault.code})`, device.id)
    }
  }
  for (const vehicle of world.vehicles) {
    stepVehicleReliability(vehicle, hours, vehicle.jobId ? 1 : 0, rng, scenario.dustRate)
    if (vehicle.fault && vehicle.fault.sinceSol === 0) {
      vehicle.fault.sinceSol = world.sol
      world.totals.faults += 1
      pushEvent(world, 'fault', 'critical', `${vehicle.name}: отказ (${vehicle.fault.code})`,
        `${vehicle.name}: failure (${vehicle.fault.code})`, vehicle.id)
    }
  }
}

function stepCrew(world: ColonyWorld, hours: number, step: SolStep, foodFraction: number): void {
  const shareOfSol = hours / SOL_HOURS
  const crewCount = world.crew.length
  const home = homeSection(world)
  const foodWant = crewCount * DEEP_P.crewFoodKgPerSol * shareOfSol
  const breathableKg = world.stock.amount.o2
    + world.sections.reduce((sum, s) => sum + (s.isolated ? 0 : s.o2Kg), 0)
  const metabolism = metabolise(crewCount, shareOfSol, foodWant * clamp01(foodFraction),
    availableOf(world, 'water_clean'), breathableKg)
  // Кислород люди берут из атмосферы своей секции, а не напрямую из бака:
  // бак — резерв, секции — то, чем дышат. Доля спроса — по числу людей.
  const occupants = world.sections.reduce((sum, s) => sum + s.crewIds.length, 0)
  const carriers = occupants > 0 ? world.sections.filter(s => s.crewIds.length > 0) : (home ? [home] : [])
  const spread = occupants > 0 ? occupants : crewCount
  let shortO2 = 0
  for (const section of carriers) {
    const share = (occupants > 0 ? section.crewIds.length : crewCount) / spread
    if (share <= 0) continue
    const want = metabolism.o2Kg * share
    const taken = Math.min(want, section.o2Kg)
    section.o2Kg = Math.max(0, section.o2Kg - taken)
    section.co2Kg += metabolism.co2Kg * share
    shortO2 += want - taken
  }
  if (carriers.length === 0) shortO2 = metabolism.o2Kg
  if (shortO2 > 1e-9) {
    step.o2ShortfallKg += shortO2
    world.totals.o2ShortfallKg += shortO2
  }
  step.o2DemandKg += shortO2
  world.totals.crewO2Kg += metabolism.o2Kg
  world.totals.crewFoodKg += metabolism.foodKg
  // Вода экипажа: полный забор из бака, а не только «невозвратная» доля.
  // Возврат идёт физически — часть уходит в конденсат (её собирают секции),
  // остальное (гигиена, смывы) становится стоками и требует регенерации.
  const drank = stockTake(world.stock, 'water_clean', metabolism.waterL)
  step.waterAggregateUsedL += drank.taken
  world.totals.waterAggregateUsedL += drank.taken
  const toGrey = Math.max(0, drank.taken - metabolism.moistureL)
  if (toGrey > 0) stockAdd(world.stock, 'water_grey', toGrey)
  if (drank.shortage > 1e-6) {
    pushEvent(world, 'crew-no-water', 'warn', 'Экипажу не хватает воды',
      'Crew is short of water', null)
  }
  const shortfallFood = foodWant * (1 - clamp01(foodFraction))
  step.foodShortfallKg += shortfallFood
  world.totals.foodShortfallKg += shortfallFood
  for (const member of world.crew) {
    const section = world.sections.find(s => s.id === member.location) ?? home
    applyLifeSupportConsequences(
      member, shareOfSol, metabolism.fedFraction,
      section ? o2PartialKpa(section) : 0, section ? co2PartialKpa(section) : 0,
    )
    // Сон есть у всех, а не только у свободных: иначе прикреплённый к задаче
    // человек не восстанавливается никогда. Выгоревших снимаем с работы, чтобы
    // очередь из десятков работ не замирала на четырёх занятых бойцах.
    if (member.fatigue > DEEP_P.crewExhaustedFatigue && member.taskId !== null) {
      const task = world.tasks.find(t => t.id === member.taskId)
      if (task) task.assignees = task.assignees.filter(id => id !== member.id)
      member.taskId = null
    }
    restCrew(member, hours * (member.taskId === null ? 0.4 : 0.25))
  }
}

function chargeVehicles(world: ColonyWorld, hours: number): void {
  const depot = world.devices.find(d => d.kind === 'depot')
  const budgetKw = depot ? depot.receivedKw : 0
  const waiting = world.vehicles.filter(v => v.at === 'base' && v.batteryKwh < v.capacityKwh * 0.98)
  if (!waiting.length || budgetKw <= 0) return
  const share = (budgetKw * hours) / waiting.length
  for (const vehicle of waiting) chargeVehicle(vehicle, share)
}

// --- Порча и итоги ---------------------------------------------------------

function stepSpoilage(world: ColonyWorld, shareOfSol: number, step?: SolStep): void {
  const spoil = (resource: ResourceId, shelfSols: number, to: ResourceId): number => {
    if (shelfSols <= 0) return 0
    const rate = shareOfSol / shelfSols
    const amount = world.stock.amount[resource] * rate
    if (amount <= 1e-9) return 0
    const taken = stockTake(world.stock, resource, amount)
    stockAdd(world.stock, to, taken.taken)
    return taken.taken
  }
  const ware = spoil('ware_potato', DEEP_P.wareShelfSols, 'food_waste')
  const seed = spoil('seed_potato', DEEP_P.seedShelfSols, 'food_waste')
  const cull = spoil('cull_potato', DEEP_P.wareShelfSols * 0.4, 'biomass')
  // Испорченная товарная партия и некондиция числились в реестре как
  // «задержанные» (`heldBackKg`). Если не записать порчу, масса исчезает из
  // тождества: она уже не на складе и никогда не станет едой. Пока партия
  // целиком уходила в еду в тот же сол, это было незаметно.
  if (step) step.heldSpoiledKg += ware + cull
  world.totals.spoiledHeldKg += ware + cull
  if (ware + seed + cull > 0.005) {
    pushEvent(world, 'spoilage', 'warn', `Потери хранения: ${round(ware + seed + cull, 2)} кг`,
      `Storage losses: ${round(ware + seed + cull, 2)} kg`, null)
  }
}

function recordMetrics(world: ColonyWorld, step: SolStep): void {
  const stock = world.stock
  const home = homeSection(world)
  const greenhouse = world.sections.find(s => s.kind === 'greenhouse')
  const batteries = world.devices.filter(d => d.kind === 'battery')
  const metrics: Metrics = {
    ...emptyMetrics(world.sol),
    waterCleanL: stock.amount.water_clean,
    waterRawL: stock.amount.water_raw,
    waterGreyL: stock.amount.water_grey,
    brineL: stock.amount.brine,
    seedKg: stock.amount.seed_potato,
    wareKg: stock.amount.ware_potato,
    cullKg: stock.amount.cull_potato,
    o2Kg: stock.amount.o2,
    co2Kg: stock.amount.co2,
    batteryKwh: batteries.reduce((sum, b) => sum + b.storedKwh, 0),
    batteryCapacityKwh: batteries.reduce((sum, b) => sum + b.capacityKwh, 0),
    generationKwh: step.power.generationKwh,
    demandKwh: step.power.demandKwh,
    servedKwh: step.power.servedKwh,
    unmetKwh: step.power.unmetKwh,
    curtailedKwh: step.power.curtailedKwh,
    dustLoss: world.devices.filter(isGenerator).reduce((s, d) => s + d.dust, 0) / Math.max(1, world.devices.filter(isGenerator).length),
    labourHours: world.totals.labourHours,
    labourByKind: { ...world.totals.labourByKind },
    idleHours: world.crew.reduce((sum, m) => sum + Math.max(0, m.hoursAvailable - m.hoursToday), 0),
    blockedTasks: world.tasks.filter(t => t.status === 'blocked').length,
    openTasks: world.tasks.filter(isOpen).length,
    minedKg: world.totals.minedKg,
    hauledKg: world.totals.hauledKg,
    cleanProducedL: world.totals.cleanProducedL,
    recycledL: world.totals.recycledL,
    condensateL: step.condensateL,
    coolingKwh: world.totals.coolingKwh,
    harvestedKg: world.totals.harvestedKg,
    yieldLossKg: world.totals.yieldLossKg,
    nutrientUsedKg: world.totals.nutrientAppliedKg,
    filtersUsed: world.totals.filtersUsed,
    partsUsed: world.totals.partsUsed,
    crewFoodKg: world.totals.crewFoodKg,
    crewWaterL: world.totals.crewWaterL,
    crewO2Kg: world.totals.crewO2Kg,
    crewShortfallFood: world.totals.foodShortfallKg,
    crewShortfallO2: world.totals.o2ShortfallKg,
    exportedKg: world.totals.exportedKg,
    importedWaterL: world.totals.importedWaterL,
    importedNutrientKg: world.totals.importedNutrientKg,
    importedParts: world.totals.importedParts,
    downtimeDeviceSols: world.totals.downtimeDeviceSols,
    faults: world.totals.faults,
    pressureKpa: home ? totalPressureKpa(home) : 0,
    co2PartialKpa: home ? co2PartialKpa(home) : 0,
    o2PartialKpa: home ? o2PartialKpa(home) : 0,
    greenhouseTempC: greenhouse?.temperatureC ?? 0,
    crewReadiness: crewSummary(world.crew).readiness,
    bottleneck: step.bottleneck,
    contractsDeliveredKg: world.contracts.reduce((sum, c) => sum + c.deliveredKg, 0),
    contractsPaidCR: world.contracts.reduce((sum, c) => sum + c.paidCR, 0),
  }
  world.metrics = metrics
  world.history.push(metrics)
  const max = Math.max(20, world.config.maxHistory)
  if (world.history.length > max) world.history.splice(0, world.history.length - max)
}

/** Первое узкое место: причина, а не список симптомов. */
function detectBottleneck(world: ColonyWorld, step: SolStep): string {
  if (step.power.unmetKwh > 0.5) return 'power'
  if (world.stock.amount.water_clean < 40 && step.waterProducedL < step.waterAggregateUsedL + step.waterIndustrialL) return 'water'
  if (nutrientTotal(world.stock) < 0.2) return 'nutrients'
  if (world.stock.amount.o2 < 1) return 'oxygen'
  const blocked = world.tasks.filter(t => t.status === 'blocked')
  const crewBusy = world.crew.filter(m => m.taskId !== null).length
  if (blocked.length > 0 && crewBusy === 0) return 'crew'
  if (blocked.some(t => t.blockCode === BLOCK_CODES.noMaterials)) return 'materials'
  if (blocked.some(t => t.blockCode === BLOCK_CODES.noAccess || t.blockCode === BLOCK_CODES.faulty)) return 'equipment'
  if (world.devices.some(d => d.fault !== null)) return 'reliability'
  if (world.batches.some(b => b.plantedSol === null) && world.stock.amount.seed_potato < 0.5) return 'seed'
  if (world.stock.amount.ice_ore <= 0 && world.deposits.some(depositWorkable)) return 'logistics'
  return 'none'
}

// --- Основной шаг ----------------------------------------------------------

export interface SolInputs {
  /** Доля рациона, доступная экипажу (0…1) — из реестра еды. */
  foodFraction: number
  /** Агрегатный спрос на воду (habitat + урожай + электролиз), L за сол. */
  waterDemandL?: number
  /** Агрегатный спрос на питание, кг за сол. */
  nutrientDemandKg?: number
  /** Агрегатный потенциал роста по теплицам (энергия/вода/питание/труд агрегатной модели). */
  growthPotential?: Record<string, number>
  sunHours?: number
  weatherFactor?: number
}

export function cloneWorld(world: ColonyWorld): ColonyWorld {
  return JSON.parse(JSON.stringify(world)) as ColonyWorld
}

/** Один сол. Возвращает НОВЫЙ мир; исходный не мутируется. */
export function stepSol(world: ColonyWorld, inputs: SolInputs): ColonyWorld {
  const next = cloneWorld(world)
  const rng = rngFromState(next.rngState)
  next.outbox = { plant: [], sort: [] }
  const step = emptyStep(next.sol)
  // Вчерашние пробы доезжают до лаборатории: анализ возможен только с ними
  // в руках, а не с момента отбора.
  deliverSamples(next)
  // Резерв включается до производства: подхват должен состояться в тот же
  // сол, когда основной выбыл, а не на следующий.
  syncStandby(next.devices)
  const scenario = next.scenario
  const sunHours = inputs.sunHours ?? scenario.sunHours
  const weatherFactor = inputs.weatherFactor ?? scenario.weatherFactor
  const shareOfSol = 1 / SUBSTEPS_PER_SOL

  if (scenario.forcedFault && scenario.forcedFault.sol === next.sol) {
    const device = next.devices.find(d => d.kind === scenario.forcedFault!.deviceKind)
    if (device && !device.fault) {
      device.wear = Math.max(device.wear, 0.75)
      device.condition = clamp01(1 - device.wear)
      device.fault = {
        code: 'scenario-fault', diagnosed: false,
        partsNeeded: 2, repairHours: DEEP_P.repairHoursPerPart * 2,
        sinceSol: 0, cause: 'отказ по сценарию',
      }
      next.totals.faults += 1
      pushEvent(next, 'fault', 'critical', `${device.name}: отказ по сценарию`,
        `${device.name}: scenario failure`, device.id)
    }
  }

  for (const member of next.crew) beginSolForCrew(member)
  const home = homeSection(next)
  for (const member of next.crew) {
    if (!next.sections.some(s => s.id === member.location)) member.location = home?.id ?? 'base'
  }
  planTasks(next)

  for (let sub = 0; sub < SUBSTEPS_PER_SOL; sub++) {
    const solHour = (sub + 0.5) * SUBSTEP_HOURS
    const hours = SUBSTEP_HOURS
    const outsideC = outsideTemperatureC(solHour, scenario.coldDropC)
    computeDuty(next, solHour)
    const power = dispatchPower({
      devices: next.devices, hours, solHour, sunHours, weatherFactor,
      criticalReserveFraction: next.config.criticalReserveFraction,
      networkCapacity: next.config.powerCapacityByDevice,
    })
    step.power.generationKwh += power.generationKw * hours
    step.power.demandKwh += power.demandKw * hours
    step.power.servedKwh += power.servedKw * hours
    step.power.unmetKwh += power.unmetKw * hours
    step.power.curtailedKwh += power.curtailedKw
    for (const id of power.shed) if (!step.power.shed.includes(id)) step.power.shed.push(id)
    next.totals.generationKwh += power.generationKw * hours
    next.totals.servedKwh += power.servedKw * hours
    next.totals.unmetKwh += power.unmetKw * hours

    // Агрегатный контур воды и питания: ровно один писатель — этот вызов.
    if (inputs.waterDemandL !== undefined) {
      const taken = stockTake(next.stock, 'water_clean', inputs.waterDemandL * shareOfSol)
      step.waterAggregateUsedL += taken.taken
      step.waterShortfallL += taken.shortage
      next.totals.waterUsedL += taken.taken
      next.totals.crewWaterL += taken.taken * 0.16
    }
    if (inputs.nutrientDemandKg !== undefined) {
      let got = 0
      for (const [id, amount] of splitNutrients(inputs.nutrientDemandKg * shareOfSol)) got += stockTake(next.stock, id, amount).taken
      step.nutrientUsedKg += got
      next.totals.nutrientAppliedKg += got
    }

    progressTasks(next, hours, step)
    operateEquipment(next, hours, step)
    updateSections(next, hours, outsideC, step)
    growCrops(next, hours, step, inputs.growthPotential)
    stepLaboratory(next, hours, step)
    stepWaste(next, hours, step)
    chargeVehicles(next, hours)
    stepReliabilityAll(next, hours, rng)
    stepCrew(next, hours, step, inputs.foodFraction)
    stepSpoilage(next, shareOfSol, step)
  }

  // Вентинг избыточного кислорода: бак ограничен, излишек не хранится.
  const o2Cap = next.stock.cap.o2
  if (next.stock.amount.o2 > o2Cap) {
    const vented = next.stock.amount.o2 - o2Cap
    next.stock.amount.o2 = o2Cap
    step.o2VentedKg += vented
    next.totals.o2VentedKg += vented
  }

  // Резервный путь разделки. Если до задачи «переработка» за сутки руки не
  // дошли, сырьё всё равно обязано превращаться в еду — иначе колония гибнет
  // от голода из-за неразобранной очереди, а это отказ интерфейса, а не
  // физики. Но без людей разделка идёт вчетверо медленнее, поэтому нанимать
  // их по-прежнему выгодно, и переработка остаётся реальным ограничением.
  const sortedByTask = next.outbox.sort.reduce((sum, c) => sum + c.kg, 0)
  if (sortedByTask <= 1e-9 && next.sortableRawKg > 0.01) {
    const unstaffed = Math.min(next.sortableRawKg, DEEP_P.processUnstaffedKgPerSol)
    if (unstaffed > 1e-9) next.outbox.sort.push({ kg: unstaffed })
  }

  step.bottleneck = detectBottleneck(next, step)
  next.sol += 1
  next.rngState = rng.state
  next.totals.sols = next.sol
  // Очереди не растут бесконечно.
  //
  // Удаляя задачу, надо отпустить людей, которые на неё записаны. Раньше
  // чистка ссылок жила только в `completeTask`, а здесь задачи выкидывались
  // пачкой — и человек, попавший под срез, навсегда оставался «занятым»
  // несуществующей работой: `taskId` ссылался на удалённую задачу, и он больше
  // не назначался ни на что. С появлением регулярных проб и анализов очередь
  // выросла, и срез начал срабатывать в штатном прогоне.
  const kept = new Set(next.tasks.filter(t => !isFinished(t)).slice(-400).map(t => t.id))
  next.tasks = next.tasks.filter(t => kept.has(t.id))
  for (const member of next.crew) {
    if (member.taskId !== null && !kept.has(member.taskId)) member.taskId = null
  }
  next.haulJobs = next.haulJobs.filter(j => j.phase !== 'done').slice(-40)
  next.compost = next.compost.slice(-40)
  next.samples = next.samples.slice(-60)
  next.analyses = next.analyses.filter(a => a.status !== 'done').slice(-40).concat(next.analyses.filter(a => a.status === 'done').slice(-20))
  next.lastStep = step
  recordMetrics(next, step)
  for (const contract of next.contracts) {
    if (expireContract(contract, next.sol)) {
      pushEvent(next, 'contract-expired', 'warn', `Контракт «${contract.title}» просрочен`,
        `Contract "${contract.title}" expired`, contract.id)
    }
  }
  if (next.config.autoDeliver) autoDeliverToContract(next)
  return next
}

/** Сколько килограммов уходит за один рейс: покупатель принимает партиями. */
const DELIVERY_BATCH_KG = 10

/**
 * Автоотгрузка излишка по контракту.
 *
 * Везём только то, что физически лежит в товарной партии сверх продовольственного
 * резерва: резерв удерживается на шаге переработки, поэтому в `ware_potato`
 * остаётся ровно излишек. Ничего не создаётся в момент отгрузки.
 *
 * Нужен исправный ровер: покупатель локальный, но товар всё равно надо
 * довезти. И упаковка: без неё поставку не принимают.
 */
function autoDeliverToContract(world: ColonyWorld): void {
  const contract = world.contracts.find(c => c.status === 'active')
  if (!contract) return
  const remaining = contract.requiredKg - contract.deliveredKg
  if (remaining <= 1e-9) return
  if (!world.vehicles.some(v => vehicleUsable(v))) return
  const surplus = world.stock.amount.ware_potato
  if (surplus <= 1e-9) return
  const kg = Math.min(surplus, remaining, DELIVERY_BATCH_KG)
  const result = deliverContract(world, contract.id, kg)
  if (!result.ok && result.reason === 'no-packaging') {
    // Партия есть, везти не в чем: это должно быть видно, а не молча
    // откладываться до срока контракта.
    pushEvent(world, 'contract-no-packaging', 'warn',
      `Партия ${round(kg, 1)} кг готова, но нет упаковки — поставка не принята`,
      `${round(kg, 1)} kg ready but there is no packaging — delivery refused`, contract.id)
  }
}

// --- Действия игрока -------------------------------------------------------

/** Отсортировать урожай: немытый картофель → семена / товарная / некондиция / остатки. */
/**
 * Разделка сырого урожая на семенную, товарную и некондиционную фракции.
 *
 * Масса сохраняется: seed + cull + ware в точности равна входу. Прежняя
 * формула добавляла сверху ещё `kg * 0.3` на остатки и при этом считала
 * некондицию дважды, превращая 100 кг в 137. Остатки ботвы и корней —
 * отдельная масса, она учитывается при уборке (`startCompost`), а не здесь.
 */
export function applySort(world: ColonyWorld, rawKg: number): {
  ware: number; seed: number; cull: number; biomass: number; used: number; overflowKg: number
} {
  const kg = Math.max(0, rawKg)
  if (kg <= 1e-9) return { ware: 0, seed: 0, cull: 0, biomass: 0, used: 0, overflowKg: 0 }
  const seed = kg * clamp01(world.config.seedSplitShare)
  const cull = kg * clamp01(world.config.cullShare)
  const ware = kg - seed - cull
  const biomass = 0
  // Учитывается ФАКТИЧЕСКИ принятое, а не запрошенное: у бака есть ёмкость, и
  // если он полон, `stockAdd` положит меньше. Раньше разница молча исчезала,
  // хотя реестр сырьё уже списал, — и тождество переставало сходиться.
  const gotSeed = stockAdd(world.stock, 'seed_potato', seed).added
  const gotWare = stockAdd(world.stock, 'ware_potato', ware).added
  const gotCull = stockAdd(world.stock, 'cull_potato', cull).added
  const stored = gotSeed + gotWare + gotCull
  world.totals.sortedKg += kg
  return {
    ware: gotWare, seed: gotSeed, cull: gotCull, biomass, used: kg,
    /** Не влезло в баки, кг. Реестр обязан это списать, иначе масса пропадает. */
    overflowKg: Math.max(0, kg - stored),
  }
}

/** Отправить остатки и испорченную еду в компост: время, энергия и труд. */
export function startCompost(world: ColonyWorld, kg: number): number {
  const biomass = stockTake(world.stock, 'biomass', kg).taken
  const waste = stockTake(world.stock, 'food_waste', kg).taken
  const total = biomass + waste
  if (total <= 1e-9) return 0
  world.compost.push(createCompostBatch(`C-${nextId(world, 'compost')}`, total, world.sol))
  return total
}

/** Поставка по контракту: физический товар списывается, фонд ограничен, повторной оплаты нет. */
export function deliverContract(world: ColonyWorld, contractId: string, kg: number): { ok: boolean; kg: number; reward: number; reason: string | null } {
  const contract = world.contracts.find(c => c.id === contractId)
  if (!contract) return { ok: false, kg: 0, reward: 0, reason: 'no-contract' }
  const take = stockTake(world.stock, 'ware_potato', Math.max(0, kg))
  if (take.taken <= 1e-9) return { ok: false, kg: 0, reward: 0, reason: 'no-goods' }
  const outcome = deliverToContract(contract, {
    sol: world.sol, kg: take.taken, quality: 0.92, packaging: Math.floor(world.stock.amount.packaging),
  })
  if (!outcome.ok) {
    stockAdd(world.stock, 'ware_potato', take.taken)
    return { ok: false, kg: 0, reward: 0, reason: outcome.reason }
  }
  stockTake(world.stock, 'packaging', outcome.packaging)
  world.totals.packagingUsed += outcome.packaging
  world.totals.exportedKg += outcome.kg
  world.credits += outcome.rewardCR
  world.totals.contractPaidCR += outcome.rewardCR
  world.potatoEstimate = estimatePotato(world.totals.exportedKg, 0)
  pushEvent(world, 'contract-delivery', 'info',
    `Поставка ${round(outcome.kg, 1)} кг: +${round(outcome.rewardCR)} CR (${outcome.deliveryId})`,
    `Delivery ${round(outcome.kg, 1)} kg: +${round(outcome.rewardCR)} CR (${outcome.deliveryId})`, contract.id)
  return { ok: true, kg: outcome.kg, reward: outcome.rewardCR, reason: null }
}

/** Цена за единицу ресурса, CR. 0 — ресурс не завозят. */
export const pricePerUnit = (resource: ResourceId): number => {
  switch (resource) {
    case 'water_clean': return 1 / DEEP_P.importWaterLitresPerCredit
    case 'nutrient_n': case 'nutrient_p': case 'nutrient_k': return 1 / DEEP_P.importNutrientKgPerCredit
    case 'parts': return 1 / DEEP_P.importPartsPerCredit
    case 'filters': return 1 / DEEP_P.importFilterPerCredit
    default: return 0
  }
}

/** Импорт: явная импортозависимость первых этапов колонии. */
export function importResource(world: ColonyWorld, resource: ResourceId, amount: number): { ok: boolean; spent: number; got: number } {
  const price = pricePerUnit(resource)
  if (!(price > 0) || !(amount > 0)) return { ok: false, spent: 0, got: 0 }
  const room = world.stock.cap[resource] - world.stock.amount[resource]
  const wanted = Math.min(amount, world.credits / price, room)
  const take = RESOURCES_DISCRETE.has(resource) ? Math.floor(wanted) : wanted
  if (take <= 0) return { ok: false, spent: 0, got: 0 }
  const cost = take * price
  world.credits -= cost
  stockAdd(world.stock, resource, take)
  if (resource === 'water_clean') world.totals.importedWaterL += take
  if (resource.startsWith('nutrient')) world.totals.importedNutrientKg += take
  if (resource === 'parts') world.totals.importedParts += take
  if (resource === 'filters') world.totals.importedFilters += take
  return { ok: true, spent: cost, got: take }
}

const RESOURCES_DISCRETE = new Set<ResourceId>(['filters', 'parts', 'packaging', 'reagents'])

/** Взять пробу: расход воды и труд. */
/**
 * Доставка проб в лабораторию: проба, взятая сегодня, попадает на стол
 * завтра.
 *
 * Берут пробы там, где среда — в теплице или у резервуара, а анализируют в
 * лаборатории. Пока проба не донесена, анализ невозможен: планировщик
 * (`planTasks`) не ставит работу на неё, а ручной заказ отвергается. Раньше
 * проба создавалась сразу доставленной, поэтому «транспорт» существовал
 * только как поле в интерфейсе, и цепочка «проба → доставка → анализ»
 * разрывалась в самом начале.
 */
export function deliverSamples(world: ColonyWorld): number {
  let n = 0
  for (const sample of world.samples) {
    if (sample.delivered || sample.sol >= world.sol) continue
    sample.delivered = true
    n += 1
  }
  if (n > 0) {
    pushEvent(world, 'sample-delivered', 'info',
      `В лабораторию доставлено проб: ${n}`,
      `${n} sample(s) delivered to the lab`, null)
  }
  return n
}

export function takeSample(world: ColonyWorld, kind: SampleKind, sourceId: string, step?: SolStep): Sample | null {
  if (availableOf(world, 'water_clean') < DEEP_P.sampleLitres) return null
  const taken = stockTake(world.stock, 'water_clean', DEEP_P.sampleLitres)
  // Проба стоит воды, и эта вода обязана попасть в отчётность: иначе запас
  // убывает, а `waterUsedLitres` за сутки этого не показывает, и сверка
  // «было − стало = списано» расходится ровно на объём пробы.
  if (step) step.waterSampleL += taken.taken
  world.totals.waterIndustrialL += taken.taken
  const sample: Sample = { id: `S-${nextId(world, 'sample')}`, kind, sourceId, sol: world.sol, delivered: false }
  world.samples.push(sample)
  return sample
}

/** Поставить анализ: реагенты списываются сразу, результат придёт через время. */
export function requestAnalysis(world: ColonyWorld, kind: AnalysisKind, targetId: string): Analysis | null {
  const meta = ANALYSIS_META[kind]
  if (world.stock.amount.reagents < meta.reagents) return null
  const sample = world.samples.find(s => s.delivered && (s.sourceId === targetId || s.kind === meta.sample))
  if (!sample) return null
  stockTake(world.stock, 'reagents', meta.reagents)
  const analysis = createAnalysis(`A-${nextId(world, 'analysis')}`, kind, sample.id, targetId)
  analysis.status = 'running'
  analysis.startedSol = world.sol
  world.analyses.push(analysis)
  return analysis
}

/** Начать эксперимент: две делянки, два режима, реальные ресурсы колонии. */
export function startExperiment(world: ColonyWorld, name: string, sols: number, regimeA: Regime, regimeB: Regime): Experiment {
  const experiment = createExperiment(`E-${nextId(world, 'experiment')}`, name, world.sol, sols, regimeA, regimeB)
  experiment.status = 'running'
  world.experiments.push(experiment)
  return experiment
}

/** Сохранить удачный режим как производственный рецепт. */
export function saveRecipe(world: ColonyWorld, experimentId: string): Recipe | null {
  const experiment = world.experiments.find(e => e.id === experimentId)
  if (!experiment || experiment.status !== 'done') return null
  const recipe = recipeFromExperiment(experiment, `R-${nextId(world, 'recipe')}`, world.sol)
  world.recipes.push(recipe)
  // Без этой записи опыт остаётся «несохранённым» навсегда: интерфейс смотрит
  // именно на `savedRecipeId`, решая, показывать ли кнопку, и игрок нажимал бы
  // её сколько угодно раз, плодя одинаковые режимы.
  experiment.savedRecipeId = recipe.id
  return recipe
}

/** Применить рецепт к теплице: меняет режим, НЕ переписывая выращенный урожай. */
export function applyRecipe(world: ColonyWorld, recipeId: string, greenhouseId: string): number {
  const recipe = world.recipes.find(r => r.id === recipeId)
  if (!recipe) return 0
  let applied = 0
  for (const batch of world.batches) {
    if (batch.greenhouseId !== greenhouseId) continue
    batch.recipeId = recipe.id
    batch.targetC = recipe.regime.targetC
    batch.feedRate = recipe.regime.feedRate
    applied++
  }
  return applied
}

/** Ручной приоритет задачи (меньше = важнее). */
/**
 * Отмена работы: задача снимается навсегда, а не ждёт на паузе.
 *
 * Возвращаются только неиспользованные материалы — то, что уже пошло в дело
 * (запчасть, снятая с полки под конкретный ремонт, семена, отданные грядке),
 * остаётся списанным: работа частью сделана, и отмена её не отменяет.
 *
 * Отмена не лечит причину. Пока агрегат сломан, планировщик поднимет работу
 * снова — это правильное поведение, и интерфейс прямо об этом говорит.
 */
export function cancelTask(world: ColonyWorld, taskId: string): { ok: boolean; released: number } {
  const task = world.tasks.find(t => t.id === taskId)
  if (!task || !isOpen(task)) return { ok: false, released: 0 }
  const released = releaseMaterials(world.stock, task)
  for (const crewId of task.assignees) {
    const member = world.crew.find(c => c.id === crewId)
    if (member && member.taskId === task.id) member.taskId = null
  }
  task.assignees = []
  task.status = 'cancelled'
  const meta = TASK_META[task.kind]
  const back = released > 1e-9 ? `, возвращено ${round(released, 2)}` : ''
  pushEvent(world, 'task-cancelled', 'info',
    `Работа снята: ${meta.ru}${back === '' ? '' : back.replace(', возвращено', ', возвращено')}`,
    `Task cancelled: ${meta.en}${released > 1e-9 ? `, ${round(released, 2)} returned` : ''}`,
    task.targetId)
  return { ok: true, released }
}

export function setTaskPriority(world: ColonyWorld, taskId: string, priority: number | null): boolean {
  const task = world.tasks.find(t => t.id === taskId)
  if (!task || !isOpen(task)) return false
  task.manualPriority = priority === null ? null : clamp(Math.round(priority), 0, 9)
  return true
}

/** Пауза/продолжение: неиспользованные материалы возвращаются. */
export function setTaskPaused(world: ColonyWorld, taskId: string, paused: boolean): number {
  const task = world.tasks.find(t => t.id === taskId)
  if (!task || !isOpen(task)) return 0
  if (paused && task.status !== 'paused') {
    const released = releaseMaterials(world.stock, task)
    for (const crewId of task.assignees) {
      const member = world.crew.find(c => c.id === crewId)
      if (member && member.taskId === task.id) member.taskId = null
    }
    task.assignees = []
    task.status = 'paused'
    return released
  }
  if (!paused && task.status === 'paused') task.status = 'queued'
  return 0
}

/** Назначить человека на задачу вручную (снимает с предыдущей). */

/** Изолировать секцию: аварийная мера при утечке. */
export function isolateSection(world: ColonyWorld, sectionId: string, isolated: boolean): boolean {
  const section = world.sections.find(s => s.id === sectionId)
  if (!section) return false
  section.isolated = isolated
  section.connected = !isolated
  return true
}

/** Безопасный режим агрегата (для ремонта). */
export function setSafeMode(world: ColonyWorld, deviceId: string, on: boolean): boolean {
  const device = world.devices.find(d => d.id === deviceId)
  if (!device) return false
  device.safeMode = on
  return true
}

/** Назначить агрегат холодным резервом своего вида в своей секции. */
export function setStandby(world: ColonyWorld, deviceId: string, on: boolean): boolean {
  const device = world.devices.find(d => d.id === deviceId)
  if (!device) return false
  device.standby = on
  syncStandby(world.devices)
  return true
}

/**
 * Разрешить рискованный ремонт: без диагноза, без запчасти и вдвое быстрее,
 * но агрегат выходит недочиненным и может встать снова. Разрешение даётся
 * агрегату или машине, а не задаче: пока флаг снят, обычный порядок
 * восстановлен.
 */
export function setRisky(world: ColonyWorld, targetId: string, on: boolean): boolean {
  const device = world.devices.find(d => d.id === targetId)
  if (device) { device.risky = on; return true }
  const vehicle = world.vehicles.find(v => v.id === targetId)
  if (vehicle) { vehicle.risky = on; return true }
  return false
}

/** Зеркало немытого картофеля из реестра еды. */
export const setSortableRawKg = (world: ColonyWorld, kg: number): void => { world.sortableRawKg = Math.max(0, kg) }

// --- Сводки для интерфейса -------------------------------------------------

export const reserveSolsOf = (world: ColonyWorld): number => reserveSols(world.devices)
export const attention = (world: ColonyWorld) => attentionList(world)
export { TASK_META }
