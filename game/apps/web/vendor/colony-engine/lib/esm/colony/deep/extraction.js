/**
 * Добыча и водоснабжение.
 *
 * Цепочка: разведка → месторождение → добыча сырья → перевозка → извлечение
 * воды → очистка → резервуар → распределение → использование → сбор стоков →
 * регенерация → возврат части воды.
 *
 * Одинаково доступного льда «в любой клетке Марса» НЕТ: у месторождения есть
 * координаты, оценка запаса, содержание льда, сложность добычи и степень
 * изученности. Разведка уточняет оценку, но не создаёт ресурс.
 *
 * Где модель агрегированная: гидравлика (напоры, diameters, потери по длине)
 * не моделируется — труба имеет пропускную способность и расход энергии
 * (`pumpKwhPerCubicMetre`); трубы, кабели и гермопереходы — разные сущности.
 */
import { DEEP_P } from './params.js';
import { clamp01 } from './units.js';
import { uniform } from './rng.js';
export function createDeposit(seed, rng, discovered = false) {
    const confidence = discovered ? 0.35 : 0;
    // Стартовая оценка — грубая: случайное смещение, которое разведка убирает.
    const bias = uniform(rng, 0.55, 1.7);
    return {
        id: seed.id, name: seed.name, x: seed.x, z: seed.z, distanceKm: seed.distanceKm,
        estimateKg: Math.max(0, seed.actualKg * bias),
        actualKg: seed.actualKg,
        confidence,
        iceFraction: seed.iceFraction,
        hardness: seed.hardness,
        discovered,
        surveys: 0,
        minedKg: 0,
        stockpileKg: 0,
        rigId: null,
    };
}
/** Разведка: уточняет оценку и повышает изученность. Ресурс не создаётся. */
export function surveyDeposit(deposit, rng) {
    const before = deposit.estimateKg;
    deposit.discovered = true;
    deposit.surveys += 1;
    const gain = DEEP_P.surveyConfidenceGain * (0.85 + 0.3 * rng.next());
    deposit.confidence = clamp01(deposit.confidence + gain);
    // Оценка сходится к реальному остатку, но никогда не становится точной.
    const noise = 1 + (rng.next() - 0.5) * 0.25 * (1 - deposit.confidence);
    deposit.estimateKg = Math.max(0, deposit.actualKg * noise);
    return { confidenceGain: gain, estimateBefore: before, estimateAfter: deposit.estimateKg };
}
/** Сколько породы можно добыть за `hours` часов при заданном состоянии установки. */
export function extractionCapacity(hours, hoursAllocated, condition, hardness) {
    const effective = Math.min(hours, Math.max(0, hoursAllocated));
    return DEEP_P.extractionRateKgPerHour * effective * clamp01(condition) / Math.max(0.3, hardness);
}
/** Энергия на добычу, kWh. */
export const extractionEnergyKwh = (kg, hardness) => kg * DEEP_P.extractionKwhPerKg * Math.max(0.3, hardness);
/** Труд оператора на добычу, человеко-часы. */
/** Добыча: порода остаётся на месторождении (потом её нужно привезти). */
export function mineDeposit(deposit, kg) {
    const want = Math.min(Math.max(0, kg), deposit.actualKg);
    deposit.actualKg -= want;
    deposit.minedKg += want;
    deposit.stockpileKg += want;
    return { mined: want, depleted: deposit.actualKg <= 1e-6 };
}
/** Погрузка сырья на машину: груз не дублируется, склад месторождения пустеет. */
export function loadStockpile(deposit, kg) {
    const amount = Math.min(Math.max(0, kg), deposit.stockpileKg);
    deposit.stockpileKg -= amount;
    return amount;
}
/**
 * Извлечение воды из породы (плавка/сублимация). Агрегированная модель:
 * никакой теплофизики льда — только выход и энергия на литр.
 */
export function sublimateOre(oreKg, energyKwh, roomL) {
    const maxByEnergy = energyKwh / DEEP_P.sublimationKwhPerL;
    const waterWanted = Math.min(oreKg, maxByEnergy) * DEEP_P.sublimationYield;
    const waterL = Math.min(waterWanted, Math.max(0, roomL));
    const processed = waterWanted > 0 ? (waterL / waterWanted) * Math.min(oreKg, maxByEnergy) : 0;
    return {
        waterL,
        oreKg: processed,
        tailingsKg: processed,
        kwhUsed: waterL * DEEP_P.sublimationKwhPerL,
        overflowL: Math.max(0, waterWanted - waterL),
    };
}
/** Очистка: неочищенная вода → очищенная + концентрат. Выход < 100 %. */
export function purifyWater(rawL, energyKwh, roomL, filters, litresPerHour, hours) {
    const filterCap = DEEP_P.filterLifeLitres * Math.max(0, filters);
    const throughput = Math.min(rawL, litresPerHour * hours, energyKwh / DEEP_P.purifierKwhPerLitre, filterCap, Math.max(0, roomL) / DEEP_P.purificationYield);
    const raw = Math.max(0, throughput);
    const clean = raw * DEEP_P.purificationYield;
    return {
        cleanL: clean,
        brineL: raw - clean,
        rawUsedL: raw,
        kwhUsed: raw * DEEP_P.purifierKwhPerLitre,
        filtersUsed: DEEP_P.filterLifeLitres > 0 ? raw / DEEP_P.filterLifeLitres : 0,
    };
}
/**
 * Регенерация стоков: возвращает часть воды, остальное — шлам.
 * Не 100 % и не бесплатно: энергия, фильтры, труд и время.
 */
export function recycleGreyWater(greyL, energyKwh, roomL, filters, litresPerHour, hours) {
    const filterCap = DEEP_P.filterLifeLitres * Math.max(0, filters);
    const throughput = Math.min(greyL, litresPerHour * hours, energyKwh / DEEP_P.recyclerKwhPerLitre, filterCap, Math.max(0, roomL) / DEEP_P.recyclerYield);
    const grey = Math.max(0, throughput);
    const clean = grey * DEEP_P.recyclerYield;
    return {
        cleanL: clean,
        sludgeKg: grey - clean,
        greyUsedL: grey,
        kwhUsed: grey * DEEP_P.recyclerKwhPerLitre,
        filtersUsed: DEEP_P.filterLifeLitres > 0 ? grey / DEEP_P.filterLifeLitres : 0,
    };
}
/** Приготовление питательного раствора: вода + N/P/K. */
export function prepareSolution(waterL, nutrientKg, ratioKgPerL) {
    const byNutrient = ratioKgPerL > 0 ? nutrientKg / ratioKgPerL : Infinity;
    const litres = Math.min(waterL, byNutrient);
    return { solutionL: litres, waterUsed: litres, nutrientUsed: litres * ratioKgPerL };
}
/** Энергия перекачки объёма, kWh (агрегированная модель насосов). */
/** Оценка: сколько солов продержится месторождение при текущем темпе. */
export function depositLifeSols(deposit, kgPerSol) {
    if (kgPerSol <= 0)
        return Infinity;
    return deposit.actualKg / kgPerSol;
}
/** Доступность месторождения для добычи: найдено, есть остаток, есть установка. */
export function depositWorkable(deposit) {
    return deposit.discovered && deposit.actualKg > 1e-6 && deposit.rigId !== null;
}
/** Причина недоступности — для журнала причин и последствий. */
export function depositBlockReason(deposit) {
    if (!deposit.discovered)
        return 'not-discovered';
    if (deposit.actualKg <= 1e-6)
        return 'depleted';
    if (deposit.rigId === null)
        return 'no-rig';
    return null;
}
/** Доля соответствия оценки и факта: насколько данные разведки полезны. */
export const estimateError = (deposit) => deposit.actualKg > 0 ? Math.abs(deposit.estimateKg - deposit.actualKg) / deposit.actualKg : 0;
/** Уверенность в оценке 0…1 для UI. */
