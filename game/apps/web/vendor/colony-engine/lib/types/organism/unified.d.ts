/** Tier yield multipliers. Taken from LAB (1 / 1.35 / 1.7) until the on-chain tiers are reconciled (§13.4 G7). */
export declare const UNIFIED_TIER_MULT: readonly [number, number, number];
/** One cycle of growth for every bed, in days (colony value, §13.4 G8 resolved to this). */
export declare const UNIFIED_CYCLE_DAYS: number;
/** kg of one full field cycle for a tier. */
export declare function fieldCycleKg(tier: 0 | 1 | 2): number;
/** kg of one bed at full cycle for a tier. */
export declare function bedFullKg(tier: 0 | 1 | 2): number;
export interface UnifiedPlot {
    id: string;
    tier: 0 | 1 | 2;
    /** Days of growth per bed. Negative = not planted yet. Harvest resets a bed to 0. */
    beds: number[];
    /**
     * Физически засажена ли грядка. `undefined` (старые сохранения) = засажена.
     * Снимается уборкой; ставится `plantBed`, когда есть семенной картофель и труд.
     */
    planted?: boolean[];
    /** Cumulative kg harvested from this plot (both manual and automatic). */
    harvestedKg: number;
}
/** Грядка засажена (старые состояния без `planted` считаются засаженными). */
export declare function isPlanted(b: UnifiedBase, plotId: string, index: number): boolean;
export interface UnifiedBase {
    day: number;
    plots: UnifiedPlot[];
    crew: number;
    /** Storage limit for raw + processed kg. Harvest that does not fit is refused, never silently lost. */
    storageCapKg: number;
    rawKg: number;
    processedKg: number;
    /** Accounting base: kg that were in the base at the start. */
    startKg: number;
    harvestedKg: number;
    eatenKg: number;
    exportedKg: number;
    craftedKg: number;
    processingLossKg: number;
    foodShortfallKg: number;
    /** Учётные счётчики глубокого слоя. По умолчанию 0: старые балансы не меняются. */
    sortedKg?: number;
    spoiledKg?: number;
    /**
     * Килограммы урожая, отправленные в семенной фонд. Это такой же выход, как
     * еда или потери: масса покидает продовольственный контур и больше в нём не
     * участвует. По умолчанию 0 — старые балансы не меняются.
     */
    seedReturnedKg?: number;
    /**
     * Килограммы, физически лежащие в товарной партии глубокого склада и ещё не
     * переведённые в еду: резерв удержан, масса ждёт решения игрока — везти по
     * контракту или пустить в продовольствие. Масса уже покинула сырьё реестра,
     * но ещё не стала едой, поэтому без этого члена тождество расходится ровно
     * на задержанный объём. Зеркало склада, а не独立 счётчик: пересчитывается
     * мостом каждый сол. По умолчанию 0 — старые балансы не меняются.
     */
    heldBackKg?: number;
    /** POTATO earned from crafting, off-chain ledger only. Never minted by this module. */
    potatoLedger: number;
    /** POTATO per crafted kg. `null` = not calibrated, crafting refused. */
    potatoPerKg: number | null;
}
export interface UnifiedInit {
    plots: Array<Omit<UnifiedPlot, 'harvestedKg'> & {
        harvestedKg?: number;
    }>;
    crew: number;
    storageCapKg: number;
    startKg: number;
    potatoPerKg?: number | null;
}
/** Дополнительные учётные счётчики глубокого слоя (по умолчанию 0 → совместимость). */
export interface UnifiedDeepCounters {
    /** Кг немытого картофеля, ушедшего на сортировку (товарная/семена/некондиция/остатки). */
    sortedKg?: number;
    /** Кг, потерянные при хранении (порча). */
    spoiledKg?: number;
}
export declare function initialUnifiedBase(init: UnifiedInit): UnifiedBase;
/** Kilograms in storage (raw + processed). */
export declare const storedKg: (b: UnifiedBase) => number;
/** Kilograms that leave the base or are used; together with stock they must equal the inflow. */
export declare function unifiedBalance(b: UnifiedBase): {
    inflow: number;
    stock: number;
    outflow: number;
    residual: number;
};
/** A bed can be harvested by hand when the harvest factor (T2 + window, §31.2) is above zero and the bed is planted. */
export declare function canHarvestBed(b: UnifiedBase, plotId: string, index: number): boolean;
/**
 * Manual harvest. Refused (same object returned) when the factor is zero or storage is full.
 * `opts.autoReplant === false` помечает грядку пустой: пересев решает слой
 * симуляции (нужны семенной картофель и труд), а не «бесконечная кнопка».
 */
export declare function harvestBed(b: UnifiedBase, plotId: string, index: number, opts?: AdvanceOptions): UnifiedBase;
/** Посадить грядку заново. Семенной материал списывает вызывающий слой (colony/deep). */
export declare function plantBed(b: UnifiedBase, plotId: string, index: number): UnifiedBase;
/** Снять урожайный выход в долях: стресс и плотность посадки (слой colony/deep). */
export interface AdvanceOptions {
    /** Доля от полного выхода грядки на момент уборки (0…1). */
    yieldFactor?: (plotId: string, bedIndex: number) => number;
    /** false — после уборки грядка пуста и требует посадки (по умолчанию true). */
    autoReplant?: boolean;
    /**
     * Разрешение на уборку конкретной грядки. Если передано, созревшая грядка
     * ждёт, пока работа не будет выполнена, — точно так же, как она уже ждёт
     * места на складе. Не передано (базовая колония) — уборка идёт как раньше.
     */
    harvestAllow?: (plotId: string, bedIndex: number) => boolean;
    /**
     * true — реестр не перерабатывает сырьё сам: разделкой управляет глубокий
     * слой, который возвращает семена и выделяет товарную долю. По умолчанию
     * false, то есть прежнее поведение.
     */
    skipProcessing?: boolean;
}
/** Growth input per plot: a number for every plot, or a function of the plot id (energy and water limits). */
/**
 * Прирост развития: одно число на все грядки, либо функция (plotId, bedIndex) → дни.
 * Функция от одного аргумента остаётся корректной (второй игнорируется).
 */
export type GrowthInput = number | ((plotId: string, bedIndex: number) => number);
/**
 * One day. `growth` is growth in days added to each planted bed (1 = a full day of growth).
 * `opts.yieldFactor` — доля полного выхода при уборке (стресс/плотность из colony/deep);
 * `opts.autoReplant === false` — грядка после уборки пуста и требует посадки.
 */
export declare function advanceDay(b: UnifiedBase, growth: GrowthInput, opts?: AdvanceOptions): UnifiedBase;
/** Add a new plot (e.g. a newly built greenhouse). Its beds start as given; no kg are created. */
export declare function addPlot(b: UnifiedBase, plot: UnifiedPlot): UnifiedBase;
/** Export processed kg to a buyer. Only processed food leaves the base. */
export declare function exportKg(b: UnifiedBase, kg: number): UnifiedBase;
/** Craft processed kg into POTATO (off-chain ledger). Refused until PotatoPerKg is calibrated. */
export declare function craftPotato(b: UnifiedBase, kg: number): UnifiedBase;
