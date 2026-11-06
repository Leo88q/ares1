import { type ResourceId, type Stock } from './resources.js';
import { type CrewMember, type Specialty } from './crew.js';
import { TASK_META, type Task } from './tasks.js';
import { type Device } from './devices.js';
import { type Section } from './sections.js';
import { type Deposit, type DepositSeed } from './extraction.js';
import { type HaulJob, type Vehicle, type VehicleClass } from './machines.js';
import { type CropBatch } from './growth.js';
import { type Analysis, type AnalysisKind, type Experiment, type Recipe, type Regime, type Sample, type SampleKind } from './lab.js';
import { type CompostBatch } from './waste.js';
import { type Contract, type ContractSeed, type PotatoEstimate } from './contracts.js';
export declare const WORLD_VERSION = 4;
export interface DeepScenario {
    /** Эквивалентные часы полного солнца за сол (параметр существующей колонии). */
    sunHours: number;
    /** Множитель погоды: 1 — ясно, < 1 — пылевое событие. */
    weatherFactor: number;
    /** Множитель скорости накопления пыли. */
    dustRate: number;
    /** Знаковый сдвиг наружной температуры, °C: отрицательный — холоднее. */
    coldDropC: number;
    /** Принудительный отказ: устройство выходит из строя на заданном солу. */
    forcedFault?: {
        sol: number;
        deviceKind: Device['kind'];
    } | null;
}
export type EventSeverity = 'info' | 'warn' | 'critical';
export interface WorldEvent {
    sol: number;
    code: string;
    severity: EventSeverity;
    ru: string;
    en: string;
    targetId: string | null;
}
export interface Metrics {
    sol: number;
    waterCleanL: number;
    waterRawL: number;
    waterGreyL: number;
    brineL: number;
    /** Конденсат, собранный за сутки, л. */
    condensateL: number;
    /** Энергия на отвод тепла, kWh. */
    coolingKwh: number;
    seedKg: number;
    wareKg: number;
    cullKg: number;
    o2Kg: number;
    co2Kg: number;
    batteryKwh: number;
    batteryCapacityKwh: number;
    generationKwh: number;
    demandKwh: number;
    servedKwh: number;
    unmetKwh: number;
    curtailedKwh: number;
    dustLoss: number;
    labourHours: number;
    labourByKind: Record<string, number>;
    idleHours: number;
    blockedTasks: number;
    openTasks: number;
    minedKg: number;
    hauledKg: number;
    cleanProducedL: number;
    recycledL: number;
    harvestedKg: number;
    yieldLossKg: number;
    nutrientUsedKg: number;
    filtersUsed: number;
    partsUsed: number;
    crewFoodKg: number;
    crewWaterL: number;
    crewO2Kg: number;
    crewShortfallFood: number;
    crewShortfallO2: number;
    exportedKg: number;
    importedWaterL: number;
    importedNutrientKg: number;
    importedParts: number;
    downtimeDeviceSols: number;
    faults: number;
    pressureKpa: number;
    co2PartialKpa: number;
    o2PartialKpa: number;
    greenhouseTempC: number;
    crewReadiness: number;
    bottleneck: string;
    contractsDeliveredKg: number;
    contractsPaidCR: number;
}
export interface Totals {
    sols: number;
    generationKwh: number;
    servedKwh: number;
    unmetKwh: number;
    minedKg: number;
    hauledKg: number;
    cleanProducedL: number;
    rawProducedL: number;
    recycledL: number;
    waterUsedL: number;
    waterIndustrialL: number;
    waterAggregateUsedL: number;
    /** Конденсат, собранный в стоки, л (транспирация + влага экипажа). */
    condensateL: number;
    /** Энергия, отведённая системой охлаждения, kWh. */
    coolingKwh: number;
    harvestedKg: number;
    yieldLossKg: number;
    sortedKg: number;
    exportedKg: number;
    nutrientAppliedKg: number;
    nutrientReturnedKg: number;
    filtersUsed: number;
    partsUsed: number;
    packagingUsed: number;
    labourHours: number;
    labourByKind: Record<string, number>;
    /** Часы, потраченные на подготовку к выходам наружу (костюм, шлюз, проверки). */
    evaPrepHours: number;
    /** Кислород, стравленный шлюзами при выходах, кг. */
    evaO2Kg: number;
    /** Товарная партия и некондиция, потерянные при хранении, кг. */
    spoiledHeldKg: number;
    downtimeDeviceSols: number;
    faults: number;
    importedWaterL: number;
    importedNutrientKg: number;
    importedParts: number;
    importedFilters: number;
    crewFoodKg: number;
    crewWaterL: number;
    crewO2Kg: number;
    foodShortfallKg: number;
    o2ShortfallKg: number;
    o2ProducedKg: number;
    cropO2Kg: number;
    o2LeakedKg: number;
    o2VentedKg: number;
    contractPaidCR: number;
}
export interface WorldConfig {
    crew: Array<{
        id: string;
        name: string;
        specialty: Specialty;
    }>;
    greenhouses: number;
    greenhouseAreaM2: number;
    bedsPerGreenhouse: number;
    solarArrays: number;
    batteries: number;
    habitats: number;
    workshops: number;
    labs: number;
    pumps: number;
    purifiers: number;
    recyclers: number;
    extractors: number;
    depots: number;
    o2Generators: number;
    scrubbers: number;
    vehicles: VehicleClass[];
    /**
     * Явные идентификаторы устройств, сгруппированные по виду. Нужны, чтобы
     * глубокий мир ссылался на те же объекты, что и существующая колония
     * (модуль `greenhouse-5` = устройство `greenhouse-5`).
     */
    deviceIds?: Partial<Record<Device['kind'], string[]>>;
    deposits: DepositSeed[];
    startingStock: Partial<Record<ResourceId, number>>;
    contracts: ContractSeed[];
    seed: number;
    scenario: DeepScenario;
    credits: number;
    baseTankLitres: number;
    tankLitresPerDepot: number;
    /** Автоматически создавать работы (уход, чистка, обслуживание, добыча, рейсы). */
    autoTasks: boolean;
    /** Автоматически сортировать урожай. */
    autoSort: boolean;
    /**
     * Сколько солов еды держать в резерве, прежде чем излишек считается
     * вывозимым. Ниже этого запаса товарная партия идёт в еду целиком.
     */
    exportReserveSols: number;
    /** Автоматически отправлять излишек по контракту. */
    autoDeliver: boolean;
    /** Доля ёмкости аккумуляторов, зарезервированная под критические системы. */
    criticalReserveFraction: number;
    /** Доля годного урожая, идущая в семенной фонд. */
    seedSplitShare: number;
    /** Доля годного урожая, не проходящая в товарную партию. */
    cullShare: number;
    condensateLitresPerSol: number;
    /** Производительность электролиза, кг O2/час на установку. */
    o2GenKgPerHour: number;
    scrubberKgPerHour: number;
    purifierLitresPerHour: number;
    recyclerLitresPerHour: number;
    maxEvents: number;
    maxHistory: number;
    /** Грядки стартуют засаженными с этим развитием (0…1). */
    initialDevelopment: number;
    /**
     * Пропускная способность силового канала по устройству, кВт (§7).
     * Пересчитывается мостом при каждом синхроне; устройство без ключа
     * каналом не ограничено.
     */
    powerCapacityByDevice?: Record<string, number>;
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
export declare function applyStorageCapacity(world: ColonyWorld): void;
export interface WorldOutbox {
    /** Посадить грядку: команда для реестра еды (семена уже списаны здесь). */
    plant: Array<{
        plotId: string;
        bedIndex: number;
        seedKg: number;
    }>;
    /** Отсортировать столько кг немытого картофеля из реестра. */
    sort: Array<{
        kg: number;
    }>;
}
export interface SolStep {
    sol: number;
    /** Прирост развития по грядкам: plotId → bedIndex → дней цикла. */
    growthByBed: Record<string, number[]>;
    /** Доля выхода при уборке: plotId → bedIndex → 0…1. */
    yieldFactor: Record<string, number[]>;
    waterAggregateUsedL: number;
    waterIndustrialL: number;
    /** Вода, ушедшая в лабораторные пробы, л. */
    waterSampleL: number;
    /** Товарная партия и некондиция, испортившиеся на складе за сол, кг. */
    heldSpoiledKg: number;
    /** Конденсат, собранный за шаг, л. */
    condensateL: number;
    waterProducedL: number;
    waterShortfallL: number;
    nutrientUsedKg: number;
    nutrientProducedKg: number;
    /** Кислород, добытый электролизом и зачисленный в БАК (кг). */
    o2ProducedKg: number;
    /** Кислород, выделенный растениями в атмосферу секций (кг). */
    cropO2Kg: number;
    /** Кислород, взятый из бака на подпитку атмосферы (кг) + не закрытый спрос. */
    o2DemandKg: number;
    /** Кислород, потерянный с утечками атмосферы (кг). */
    o2LeakedKg: number;
    o2ShortfallKg: number;
    o2VentedKg: number;
    foodShortfallKg: number;
    power: {
        generationKwh: number;
        demandKwh: number;
        servedKwh: number;
        unmetKwh: number;
        curtailedKwh: number;
        shed: string[];
    };
    labour: {
        required: number;
        provided: number;
        byKind: Record<string, number>;
    };
    bottleneck: string;
}
export interface ColonyWorld {
    version: number;
    sol: number;
    seed: number;
    rngState: number;
    scenario: DeepScenario;
    config: WorldConfig;
    crew: CrewMember[];
    devices: Device[];
    sections: Section[];
    batches: CropBatch[];
    vehicles: Vehicle[];
    haulJobs: HaulJob[];
    deposits: Deposit[];
    tasks: Task[];
    counters: Record<string, number>;
    stock: Stock;
    samples: Sample[];
    analyses: Analysis[];
    experiments: Experiment[];
    recipes: Recipe[];
    compost: CompostBatch[];
    contracts: Contract[];
    events: WorldEvent[];
    metrics: Metrics;
    history: Metrics[];
    totals: Totals;
    potatoEstimate: PotatoEstimate;
    credits: number;
    outbox: WorldOutbox;
    lastStep: SolStep | null;
    /** Зеркало `ledger.rawKg`: сколько немытого картофеля ждёт сортировки. */
    sortableRawKg: number;
}
/**
 * Номинальная мощность теплицы — это пик с включёнными лампами (kW).
 * Средняя за сол получается через `duty`: лампы горят только фотопериод,
 * постоянные нужды (насосы, климат) — всегда. Так ночная нагрузка базы
 * не равна дневной, что и определяет требуемую ёмкость аккумуляторов.
 */
export declare const greenhouseRatedKw: (areaM2: number) => number;
export declare function createWorld(config: WorldConfig): ColonyWorld;
export declare function pushEvent(world: ColonyWorld, code: string, severity: EventSeverity, ru: string, en: string, targetId: string | null): void;
/**
 * Состав смеси N/P/K — единственный источник правды для обеих сторон моста:
 * и стартового запаса, и ежесуточной синхронизации, и расхода грядок.
 * Если доли здесь и при закупке разойдутся, смесь перестанет сходиться.
 */
export declare const splitNutrients: (kg: number) => Array<[ResourceId, number]>;
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
export declare function prepareEva(world: ColonyWorld, member: CrewMember, hours: number, step: SolStep): number;
export interface SolInputs {
    /** Доля рациона, доступная экипажу (0…1) — из реестра еды. */
    foodFraction: number;
    /** Агрегатный спрос на воду (habitat + урожай + электролиз), L за сол. */
    waterDemandL?: number;
    /** Агрегатный спрос на питание, кг за сол. */
    nutrientDemandKg?: number;
    /** Агрегатный потенциал роста по теплицам (энергия/вода/питание/труд агрегатной модели). */
    growthPotential?: Record<string, number>;
    sunHours?: number;
    weatherFactor?: number;
}
export declare function cloneWorld(world: ColonyWorld): ColonyWorld;
/** Один сол. Возвращает НОВЫЙ мир; исходный не мутируется. */
export declare function stepSol(world: ColonyWorld, inputs: SolInputs): ColonyWorld;
/** Отсортировать урожай: немытый картофель → семена / товарная / некондиция / остатки. */
/**
 * Разделка сырого урожая на семенную, товарную и некондиционную фракции.
 *
 * Масса сохраняется: seed + cull + ware в точности равна входу. Прежняя
 * формула добавляла сверху ещё `kg * 0.3` на остатки и при этом считала
 * некондицию дважды, превращая 100 кг в 137. Остатки ботвы и корней —
 * отдельная масса, она учитывается при уборке (`startCompost`), а не здесь.
 */
export declare function applySort(world: ColonyWorld, rawKg: number): {
    ware: number;
    seed: number;
    cull: number;
    biomass: number;
    used: number;
    overflowKg: number;
};
/** Отправить остатки и испорченную еду в компост: время, энергия и труд. */
export declare function startCompost(world: ColonyWorld, kg: number): number;
/** Поставка по контракту: физический товар списывается, фонд ограничен, повторной оплаты нет. */
export declare function deliverContract(world: ColonyWorld, contractId: string, kg: number): {
    ok: boolean;
    kg: number;
    reward: number;
    reason: string | null;
};
/** Цена за единицу ресурса, CR. 0 — ресурс не завозят. */
export declare const pricePerUnit: (resource: ResourceId) => number;
/** Импорт: явная импортозависимость первых этапов колонии. */
export declare function importResource(world: ColonyWorld, resource: ResourceId, amount: number): {
    ok: boolean;
    spent: number;
    got: number;
};
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
export declare function deliverSamples(world: ColonyWorld): number;
export declare function takeSample(world: ColonyWorld, kind: SampleKind, sourceId: string, step?: SolStep): Sample | null;
/** Поставить анализ: реагенты списываются сразу, результат придёт через время. */
export declare function requestAnalysis(world: ColonyWorld, kind: AnalysisKind, targetId: string): Analysis | null;
/** Начать эксперимент: две делянки, два режима, реальные ресурсы колонии. */
export declare function startExperiment(world: ColonyWorld, name: string, sols: number, regimeA: Regime, regimeB: Regime): Experiment;
/** Сохранить удачный режим как производственный рецепт. */
export declare function saveRecipe(world: ColonyWorld, experimentId: string): Recipe | null;
/** Применить рецепт к теплице: меняет режим, НЕ переписывая выращенный урожай. */
export declare function applyRecipe(world: ColonyWorld, recipeId: string, greenhouseId: string): number;
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
export declare function cancelTask(world: ColonyWorld, taskId: string): {
    ok: boolean;
    released: number;
};
export declare function setTaskPriority(world: ColonyWorld, taskId: string, priority: number | null): boolean;
/** Пауза/продолжение: неиспользованные материалы возвращаются. */
export declare function setTaskPaused(world: ColonyWorld, taskId: string, paused: boolean): number;
/** Назначить человека на задачу вручную (снимает с предыдущей). */
/** Изолировать секцию: аварийная мера при утечке. */
export declare function isolateSection(world: ColonyWorld, sectionId: string, isolated: boolean): boolean;
/** Безопасный режим агрегата (для ремонта). */
export declare function setSafeMode(world: ColonyWorld, deviceId: string, on: boolean): boolean;
/** Назначить агрегат холодным резервом своего вида в своей секции. */
export declare function setStandby(world: ColonyWorld, deviceId: string, on: boolean): boolean;
/**
 * Разрешить рискованный ремонт: без диагноза, без запчасти и вдвое быстрее,
 * но агрегат выходит недочиненным и может встать снова. Разрешение даётся
 * агрегату или машине, а не задаче: пока флаг снят, обычный порядок
 * восстановлен.
 */
export declare function setRisky(world: ColonyWorld, targetId: string, on: boolean): boolean;
/** Зеркало немытого картофеля из реестра еды. */
export declare const setSortableRawKg: (world: ColonyWorld, kg: number) => void;
export declare const reserveSolsOf: (world: ColonyWorld) => number;
export declare const attention: (world: ColonyWorld) => {
    id: string;
    kind: "device" | "vehicle";
    reason: string;
    severity: "info" | "warning" | "critical";
}[];
export { TASK_META };
