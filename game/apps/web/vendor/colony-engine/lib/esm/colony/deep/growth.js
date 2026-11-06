/**
 * Партии растений: развитие, стресс, качество, выходы.
 *
 * Развитие существующей системы грядок НЕ заменяется второй моделью:
 * таймер грядки остаётся единственным хранилищем возраста посадки
 * (organism/unified.ts), а этот модуль считает, СКОЛЬКО развития грядка
 * получает за шаг и какой доли урожая лишилась из-за стресса.
 *
 * Ключевое правило: неблагоприятные условия имеют накопительный эффект,
 * а исправление условий НЕ возвращает уже потерянную урожайность
 * (`yieldPenalty` только растёт, `stress` может убывать).
 *
 * Необработанный марсианский реголит не работает как земная почва:
 * базовый сценарий — подготовленный субстрат/гидропоника в герметичной теплице.
 */
import { DEEP_P } from './params.js';
import { clamp, clamp01, fraction } from './units.js';
export const NEUTRAL_FACTORS = {
    light: 1, temperature: 1, rootTemperature: 1, water: 1,
    nitrogen: 1, phosphorus: 1, potassium: 1,
    co2: 1, rootO2: 1, contamination: 1, neglect: 1,
};
export function createBatch(id, greenhouseId, bedIndex, areaM2, planted = false) {
    const expected = areaM2 * DEEP_P.cropKgPerM2PerSol * DEEP_P.cropCycleSols;
    return {
        id, greenhouseId, bedIndex,
        plantedSol: planted ? 0 : null,
        areaM2,
        seedKg: 0,
        density: planted ? 1 : 0,
        development: 0,
        stress: 0, yieldPenalty: 0, health: planted ? 1 : 0,
        contamination: 0, saltIndex: 0,
        lastTendSol: planted ? 0 : null,
        waterlogSol: null,
        expectedKg: expected,
        harvestedKg: 0,
        stage: planted ? 'sprout' : 'empty',
        factors: { ...NEUTRAL_FACTORS },
        recipeId: null,
        targetC: 20,
        rootTemperatureC: 20,
        feedRate: 1,
        harvestReady: false,
        ripeSinceSol: null,
    };
}
export const batchStage = (batch) => {
    if (batch.plantedSol === null && batch.development <= 0)
        return 'empty';
    if (batch.health <= 1e-6)
        return 'dead';
    if (batch.development >= 1)
        return 'mature';
    if (batch.development < 0.2)
        return 'sprout';
    if (batch.development < 0.55)
        return 'vegetative';
    return 'tuber';
};
export const STAGE_LABEL = {
    empty: { ru: 'Пусто', en: 'Empty' },
    sprout: { ru: 'Всходы', en: 'Sprout' },
    vegetative: { ru: 'Вегетация', en: 'Vegetative' },
    tuber: { ru: 'Клубнеобразование', en: 'Tuber' },
    mature: { ru: 'Зрелость', en: 'Mature' },
    dead: { ru: 'Погибла', en: 'Dead' },
};
export const temperatureFactor = (celsius) => !Number.isFinite(celsius) || celsius <= 4 || celsius >= 36 ? 0
    : celsius < 16 ? ((celsius - 4) / 12) ** 2 : celsius <= 22 ? 1 : (36 - celsius) / 14;
/**
 * Температура корневой зоны. Оптимум у́же и ниже, чем у воздуха: 15–20 °C
 * против 16–22 °C для ботвы, а провал вниз резче — холодные корни перестают
 * тянуть фосфор задолго до того, как ботва покажет хоть что-то.
 */
export const rootTemperatureFactor = (celsius) => !Number.isFinite(celsius) || celsius <= 6 || celsius >= 32 ? 0
    : celsius < 10 ? ((celsius - 6) / 4) ** 2 * 0.5
        : celsius < 15 ? 0.5 + 0.5 * ((celsius - 10) / 5) ** 1.5
            : celsius <= 20 ? 1 : (32 - celsius) / 12;
const lightFactor = (lightFraction) => {
    // Ниже 40 % светового режима растения не просто «медленнее», а стрессуют.
    const f = clamp01(lightFraction);
    return f < 0.4 ? (f / 0.4) ** 1.5 : Math.min(1, f);
};
const contaminationFactor = (contamination, salt) => {
    const threshold = DEEP_P.contaminationStressThreshold;
    const excess = Math.max(0, contamination - threshold) + Math.max(0, salt - threshold) * 0.8;
    return clamp01(1 - excess * 1.4);
};
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
export const rootZoneTargetC = (airC, irrigationRatio) => 
// Верхняя граница не 1: полив СВЕРХ нормы должен остужать сильнее, иначе
// стратегия «залить водой» не имеет никакой цены, хотя именно за неё
// колония платит и водой, и корнями.
airC - DEEP_P.rootZoneChillC * Math.min(4, Math.max(0, irrigationRatio));
/**
 * Субстрат инертен: он не принимает температуру полива мгновенно, а идёт к
 * ней с постоянной времени. Экспонента устойчива при любом размере подшага.
 */
export function relaxRootTemperatureC(currentC, targetC, dtSols) {
    const tau = Math.max(1e-6, DEEP_P.rootZoneTauSols);
    const alpha = 1 - Math.exp(-Math.max(0, dtSols) / tau);
    return currentC + (targetC - currentC) * alpha;
}
export function stepBatch(batch, env) {
    const dt = Math.max(0, env.dtSols);
    if (batch.plantedSol === null || batch.health <= 1e-6) {
        batch.factors = { ...NEUTRAL_FACTORS };
        return { dDevelopment: 0, factors: batch.factors };
    }
    const neglectSols = batch.lastTendSol === null ? 0 : Math.max(0, env.sol - batch.lastTendSol);
    const neglect = clamp01(1 - Math.max(0, neglectSols - DEEP_P.tendIntervalSols) / DEEP_P.tendIntervalSols);
    // Закон минимума Либиха: рост определяет тот элемент, которого не хватает,
    // а не среднее по трем. Агрегатная доля скрывала ситуацию «азота нет, а
    // фосфора завались» и выдавала корням питание, которого у них не было.
    // Асимметрия намеренная: завышенный `feedRate` не даёт сверхроста (избыток —
    // это «роскошное» потребление), но списывается по полной норме и быстрее
    // копит соли (`saltIndexGrowthPerSol` берёт feedRate без обрезки). Перекорм
    // стоит дорого и не окупается — именно поэтому он не срезается здесь молча.
    const feed = clamp01(batch.feedRate);
    const factors = {
        light: lightFactor(env.lightFraction),
        temperature: temperatureFactor(env.temperatureC),
        rootTemperature: rootTemperatureFactor(env.rootTemperatureC),
        water: clamp01(env.waterFraction),
        nitrogen: clamp01(env.nutrients.n) * feed,
        phosphorus: clamp01(env.nutrients.p) * feed,
        potassium: clamp01(env.nutrients.k) * feed,
        co2: co2FactorOf(env.co2PartialKpa),
        rootO2: rootOxygenFactorOf(env.o2PartialKpa, env.waterlogRatio),
        contamination: contaminationFactor(batch.contamination, batch.saltIndex),
        neglect: 0.6 + 0.4 * neglect,
    };
    batch.factors = factors;
    // Стресс копится, когда любой фактор ниже порога «хорошо».
    let pressure = 0;
    let worst = 1;
    for (const value of Object.values(factors)) {
        pressure += Math.max(0, 0.9 - value);
        worst = Math.min(worst, value);
    }
    const stressRate = DEEP_P.stressAccumulationRate;
    if (pressure > 0)
        batch.stress = clamp01(batch.stress + pressure * stressRate * dt);
    else
        batch.stress = clamp01(batch.stress - DEEP_P.stressRecoveryRate * dt);
    // Потеря урожая необратима: копится, пока есть стресс.
    if (batch.stress > 0) {
        batch.yieldPenalty = clamp01(batch.yieldPenalty + batch.stress * DEEP_P.yieldPenaltyPerStress * dt);
    }
    // Здоровье падает при экстремумах: plants не восстанавливаются мгновенно.
    const extreme = Math.max(0, 0.5 - worst) * 2;
    batch.health = clamp01(batch.health - extreme * 0.05 * dt + (pressure > 0 ? 0 : 0.01 * dt));
    // Скрытые факторы субстрата растут всегда: их снимает промывка/замена.
    batch.contamination = clamp01(batch.contamination + DEEP_P.contaminationGrowthPerSol * dt);
    batch.saltIndex = clamp01(batch.saltIndex + DEEP_P.saltIndexGrowthPerSol * dt * (0.5 + batch.feedRate * 0.5));
    const product = Object.values(factors).reduce((acc, value) => acc * clamp01(value), 1);
    const dDevelopment = (dt / DEEP_P.cropCycleSols) * product * (1 - 0.5 * batch.stress);
    batch.development = clamp01(batch.development + dDevelopment);
    batch.stage = batchStage(batch);
    return { dDevelopment, factors };
}
const co2FactorOf = (ppCo2Kpa) => {
    if (ppCo2Kpa <= 0.004)
        return 0.15;
    if (ppCo2Kpa < 0.06)
        return 0.15 + 0.85 * fraction(ppCo2Kpa - 0.004, 0.056);
    if (ppCo2Kpa <= 0.12)
        return 1;
    if (ppCo2Kpa < 0.5)
        return 1 - 0.5 * fraction(ppCo2Kpa - 0.12, 0.38);
    return 0.4;
};
const rootOxygenFactorOf = (ppO2Kpa, waterlogRatio) => clamp01(fraction(ppO2Kpa, 12)) * (1 - 0.6 * clamp01(waterlogRatio));
/** Качество урожая 0…1: стресс, загрязнение, соли, состояние. */
function batchQuality(batch) {
    return clamp01(1 - batch.yieldPenalty * 0.8 - Math.max(0, batch.contamination - 0.2) * 0.6
        - Math.max(0, batch.saltIndex - 0.2) * 0.5) * clamp01(batch.health);
}
/** Ожидаемый выход с учётом стресса и плотности посадки, кг. */
export function projectedYieldKg(batch) {
    return batch.expectedKg * clamp01(batch.density) * clamp01(batch.health) * (1 - batch.yieldPenalty);
}
/** Фактор окна уборки: перестой и ранняя уборка снижают выход (правило T2). */
/** Сброс грядки после уборки: развитие обнуляется, требуется посадка заново. */
/** Посадка: семенной картофель — физический ресурс, норма посадки ограничена. */
export function plantBatch(batch, sol, seedKg, areaM2) {
    const needed = areaM2 * DEEP_P.seedRateKgPerM2;
    const density = clamp01(seedKg / Math.max(1e-9, needed));
    batch.plantedSol = sol;
    batch.seedKg = seedKg;
    batch.density = density;
    batch.development = 0;
    batch.health = density > 0.05 ? 1 : 0;
    batch.stress = 0;
    batch.yieldPenalty = 0;
    batch.lastTendSol = sol;
    // Свежий субстрат прогревается вместе с секцией: у новой грядки корни
    // начинают с температуры воздуха, а не с холодного старта.
    batch.rootTemperatureC = rootZoneTargetC(batch.targetC, 1);
    batch.stage = 'sprout';
    return { planted: density > 0.05, density };
}
/** Норма посадки для площади, кг. */
export const seedNeededKg = (areaM2) => areaM2 * DEEP_P.seedRateKgPerM2;
/**
 * Предел размножения: из одного кг семян за цикл нельзя получить сколько угодно
 * посадочного материала — ограничено массой, временем и условиями.
 */
/** Потребность партии в воде на шаг, L. */
export const batchWaterDemandL = (batch, dtSols) => batch.plantedSol === null ? 0 : batch.areaM2 * DEEP_P.cropWaterLPerM2PerSol * clamp01(batch.density) * dtSols;
/**
 * Потребность партии в питании на шаг, kg NPK.
 *
 * Верхний предел 2, а не 1: рецепт из лаборатории и пресеты режимов задают
 * `feedRate` выше единицы («rich» = 1.35), и при `clamp01` он молча превращался
 * в ровно 1 — лаборатория честно сравнивала режимы, а теплица этот же рецепт
 * обрезала. Теперь обе стороны считают одинаково, но предел остаётся: кормить
 * сверх двойной нормы нельзя (засоление и осмос).
 */
export const batchNutrientDemandKg = (batch, dtSols) => batch.plantedSol === null
    ? 0
    : batch.areaM2 * DEEP_P.cropKgPerM2PerSol * 0.01 * clamp(batch.feedRate, 0, 2) * dtSols;
/** Связывание CO2 фотосинтезом, кг за шаг (только при реальном росте). */
export const batchCo2UptakeKg = (batch, dDevelopment) => {
    if (batch.plantedSol === null)
        return 0;
    const grown = batch.expectedKg * dDevelopment;
    return grown * DEEP_P.cropCo2KgPerKgFresh;
};
/** Выделение O2 фотосинтезом, кг за шаг. */
export const batchO2OutputKg = (batch, dDevelopment) => {
    if (batch.plantedSol === null)
        return 0;
    return batch.expectedKg * dDevelopment * DEEP_P.cropO2KgPerKgFresh;
};
export function batchSummary(batch) {
    let limiting = null;
    let worst = 1;
    for (const [key, value] of Object.entries(batch.factors)) {
        if (value < worst) {
            worst = value;
            limiting = key;
        }
    }
    return {
        id: batch.id, stage: batch.stage, development: batch.development, health: batch.health,
        stress: batch.stress, yieldPenalty: batch.yieldPenalty, quality: batchQuality(batch),
        projectedKg: projectedYieldKg(batch), limiting: worst < 0.9 ? limiting : null,
    };
}
export const FACTOR_LABEL = {
    light: { ru: 'Свет', en: 'Light' },
    temperature: { ru: 'Температура воздуха', en: 'Air temperature' },
    rootTemperature: { ru: 'Температура корней', en: 'Root-zone temperature' },
    water: { ru: 'Вода', en: 'Water' },
    nitrogen: { ru: 'Азот (N)', en: 'Nitrogen (N)' },
    phosphorus: { ru: 'Фосфор (P)', en: 'Phosphorus (P)' },
    potassium: { ru: 'Калий (K)', en: 'Potassium (K)' },
    co2: { ru: 'CO₂', en: 'CO₂' },
    rootO2: { ru: 'O₂ в корнях', en: 'Root O₂' },
    contamination: { ru: 'Загрязнение', en: 'Contamination' },
    neglect: { ru: 'Запущенность', en: 'Neglect' },
};
