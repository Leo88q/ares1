export type CropStage = 'empty' | 'sprout' | 'vegetative' | 'tuber' | 'mature' | 'dead';
export interface GrowthFactors {
    light: number;
    /** Температура ВОЗДУХА: то, что чувствует ботва. */
    temperature: number;
    /**
     * Температура КОРНЕВОЙ ЗОНЫ. Держится отдельно и отстаёт от воздуха:
     * субстрат инертен, а холодная поливная вода остужает корни быстрее, чем
     * воздух успевает их прогреть. Корни куда чувствительнее ботвы к холоду —
     * ниже 10 °C усвоение фосфора practically останавливается.
     */
    rootTemperature: number;
    water: number;
    /** Азот: рост вегетативной массы. */
    nitrogen: number;
    /** Фосфор: корни и клубнеобразование. */
    phosphorus: number;
    /** Калий: транспорт сахаров и водный режим. */
    potassium: number;
    co2: number;
    rootO2: number;
    contamination: number;
    neglect: number;
}
/** Доли доступности каждого элемента 0…1. */
export interface NutrientFractions {
    n: number;
    p: number;
    k: number;
}
export interface CropBatch {
    id: string;
    greenhouseId: string;
    bedIndex: number;
    /** Сол посадки; null — грядка пуста. */
    plantedSol: number | null;
    /** Площадь грядки, m². */
    areaM2: number;
    /** Фактически израсходовано семенного картофеля, кг. */
    seedKg: number;
    /** Плотность/норма посадки 0…1 (1 = полная норма). */
    density: number;
    /** Накопленное развитие 0…1. */
    development: number;
    /** Текущий стресс 0…1 (может убывать). */
    stress: number;
    /** Невозвратимая потеря будущего урожая 0…1 (только растёт). */
    yieldPenalty: number;
    /** Состояние растений 0…1. */
    health: number;
    /** Скрытое загрязнение субстрата 0…1: видно только через анализ. */
    contamination: number;
    /** Скрытое накопление солей 0…1: видно только через анализ. */
    saltIndex: number;
    /** Сол последнего ухода. */
    lastTendSol: number | null;
    /** Сол последнего полива с избытком (перелив → заливание корней). */
    waterlogSol: number | null;
    /** Ожидаемый выход при идеальных условиях, кг. */
    expectedKg: number;
    harvestedKg: number;
    stage: CropStage;
    /** Факторы последнего шага — для диагностики «почему урожай падает». */
    factors: GrowthFactors;
    /** Режим (рецепт), применённый к партии: приходит из лаборатории. */
    recipeId: string | null;
    /** Целевая температура режима, °C. */
    targetC: number;
    /** Целевая норма питания 0…1.5. */
    feedRate: number;
    /**
     * Температура корневой зоны этой грядки, °C. Своя у каждой грядки: субстрат
     * инертен и остывает от полива, поэтому корни почти всегда холоднее воздуха.
     */
    rootTemperatureC: number;
    /**
     * Грядка подготовлена к уборке: работа выполнена в текущем солу. Созревшая
     * грядка стоит и ждёт, пока за неё возьмутся, — люди ограничивают уборку
     * так же, как её ограничивает место на складе. Сбрасывается каждые сутки.
     */
    harvestReady: boolean;
    /** Сол, на котором грядка дозрела. null — ещё не дозрела. */
    ripeSinceSol: number | null;
}
export declare const NEUTRAL_FACTORS: GrowthFactors;
export declare function createBatch(id: string, greenhouseId: string, bedIndex: number, areaM2: number, planted?: boolean): CropBatch;
export declare const batchStage: (batch: CropBatch) => CropStage;
export declare const STAGE_LABEL: Record<CropStage, {
    ru: string;
    en: string;
}>;
export interface GrowthEnvironment {
    /** Температура воздуха в секции, °C. */
    temperatureC: number;
    /** Температура корневой зоны, °C: своя у каждой грядки. */
    rootTemperatureC: number;
    co2PartialKpa: number;
    o2PartialKpa: number;
    /** Доля светового режима 0…1: мощность досветки и фотопериод. */
    lightFraction: number;
    /** Доступность воды 0…1. */
    waterFraction: number;
    /** Доступность каждого элемента 0…1 (закон минимума Либиха). */
    nutrients: NutrientFractions;
    /** Перелив: доля избыточного полива 0…1. */
    waterlogRatio: number;
    /** Текущий сол (для запущенности). */
    sol: number;
    /** Длительность шага в солях. */
    dtSols: number;
}
export declare const temperatureFactor: (celsius: number) => number;
/**
 * Температура корневой зоны. Оптимум у́же и ниже, чем у воздуха: 15–20 °C
 * против 16–22 °C для ботвы, а провал вниз резче — холодные корни перестают
 * тянуть фосфор задолго до того, как ботва покажет хоть что-то.
 */
export declare const rootTemperatureFactor: (celsius: number) => number;
/**
 * Один шаг развития партии. Возвращает прирост развития (в долях цикла) и
 * факторы, чтобы интерфейс мог объяснить причину.
 */
/**
 * К какой температуре стремится корневая зона.
 *
 * Вода приходит из очистки холодной — она из льдосодержащей породы, — и
 * каждый полив тянет субстрат вниз. Чем обильнее полив, тем холоднее корням:
 * именно поэтому «залить водой» не помогает, а вредит, и отсюда же берётся
 * настоящий выбор — дать воде отстояться и прогреться перед подачей.
 */
export declare const rootZoneTargetC: (airC: number, irrigationRatio: number) => number;
/**
 * Субстрат инертен: он не принимает температуру полива мгновенно, а идёт к
 * ней с постоянной времени. Экспонента устойчива при любом размере подшага.
 */
export declare function relaxRootTemperatureC(currentC: number, targetC: number, dtSols: number): number;
export declare function stepBatch(batch: CropBatch, env: GrowthEnvironment): {
    dDevelopment: number;
    factors: GrowthFactors;
};
/** Ожидаемый выход с учётом стресса и плотности посадки, кг. */
export declare function projectedYieldKg(batch: CropBatch): number;
/** Фактор окна уборки: перестой и ранняя уборка снижают выход (правило T2). */
/** Сброс грядки после уборки: развитие обнуляется, требуется посадка заново. */
/** Посадка: семенной картофель — физический ресурс, норма посадки ограничена. */
export declare function plantBatch(batch: CropBatch, sol: number, seedKg: number, areaM2: number): {
    planted: boolean;
    density: number;
};
/** Норма посадки для площади, кг. */
export declare const seedNeededKg: (areaM2: number) => number;
/**
 * Предел размножения: из одного кг семян за цикл нельзя получить сколько угодно
 * посадочного материала — ограничено массой, временем и условиями.
 */
/** Потребность партии в воде на шаг, L. */
export declare const batchWaterDemandL: (batch: CropBatch, dtSols: number) => number;
/**
 * Потребность партии в питании на шаг, kg NPK.
 *
 * Верхний предел 2, а не 1: рецепт из лаборатории и пресеты режимов задают
 * `feedRate` выше единицы («rich» = 1.35), и при `clamp01` он молча превращался
 * в ровно 1 — лаборатория честно сравнивала режимы, а теплица этот же рецепт
 * обрезала. Теперь обе стороны считают одинаково, но предел остаётся: кормить
 * сверх двойной нормы нельзя (засоление и осмос).
 */
export declare const batchNutrientDemandKg: (batch: CropBatch, dtSols: number) => number;
/** Связывание CO2 фотосинтезом, кг за шаг (только при реальном росте). */
export declare const batchCo2UptakeKg: (batch: CropBatch, dDevelopment: number) => number;
/** Выделение O2 фотосинтезом, кг за шаг. */
export declare const batchO2OutputKg: (batch: CropBatch, dDevelopment: number) => number;
/** Сводка по партии для интерфейса. */
export interface BatchSummary {
    id: string;
    stage: CropStage;
    development: number;
    health: number;
    stress: number;
    yieldPenalty: number;
    quality: number;
    projectedKg: number;
    limiting: keyof GrowthFactors | null;
}
export declare function batchSummary(batch: CropBatch): BatchSummary;
export declare const FACTOR_LABEL: Record<keyof GrowthFactors, {
    ru: string;
    en: string;
}>;
