import type { Rng } from './rng.js';
export interface Deposit {
    id: string;
    name: string;
    /** Координаты на карте колонии (клетки). */
    x: number;
    z: number;
    /** Расстояние до базы, км. Влияет на время, энергию и занятость оператора. */
    distanceKm: number;
    /** Оценка запаса породы, кг (видимая игроку). */
    estimateKg: number;
    /** Реальный оставшийся запас, кг (скрыт; разведка только сужает оценку). */
    actualKg: number;
    /** Степень изученности 0…1. */
    confidence: number;
    /** Содержание льда, доля массы. */
    iceFraction: number;
    /** Сложность добычи: множитель времени и энергии. */
    hardness: number;
    discovered: boolean;
    surveys: number;
    /** Добыто за всё время, кг. */
    minedKg: number;
    /** Склад сырья НА месторождении, кг. Само на базу не телепортируется. */
    stockpileKg: number;
    /** Работает ли здесь установка. */
    rigId: string | null;
}
export interface DepositSeed {
    id: string;
    name: string;
    x: number;
    z: number;
    distanceKm: number;
    actualKg: number;
    iceFraction: number;
    hardness: number;
}
export declare function createDeposit(seed: DepositSeed, rng: Rng, discovered?: boolean): Deposit;
/** Разведка: уточняет оценку и повышает изученность. Ресурс не создаётся. */
export declare function surveyDeposit(deposit: Deposit, rng: Rng): {
    confidenceGain: number;
    estimateBefore: number;
    estimateAfter: number;
};
/** Сколько породы можно добыть за `hours` часов при заданном состоянии установки. */
export declare function extractionCapacity(hours: number, hoursAllocated: number, condition: number, hardness: number): number;
/** Энергия на добычу, kWh. */
export declare const extractionEnergyKwh: (kg: number, hardness: number) => number;
/** Труд оператора на добычу, человеко-часы. */
/** Добыча: порода остаётся на месторождении (потом её нужно привезти). */
export declare function mineDeposit(deposit: Deposit, kg: number): {
    mined: number;
    depleted: boolean;
};
/** Погрузка сырья на машину: груз не дублируется, склад месторождения пустеет. */
export declare function loadStockpile(deposit: Deposit, kg: number): number;
export interface SublimationResult {
    /** Получено неочищенной воды, L. */
    waterL: number;
    /** Переработано породы, кг. */
    oreKg: number;
    /** Отвал, кг. */
    tailingsKg: number;
    kwhUsed: number;
    /** Сколько воды не поместилось в резервуар (потеря). */
    overflowL: number;
}
/**
 * Извлечение воды из породы (плавка/сублимация). Агрегированная модель:
 * никакой теплофизики льда — только выход и энергия на литр.
 */
export declare function sublimateOre(oreKg: number, energyKwh: number, roomL: number): SublimationResult;
export interface PurificationResult {
    cleanL: number;
    brineL: number;
    rawUsedL: number;
    kwhUsed: number;
    filtersUsed: number;
}
/** Очистка: неочищенная вода → очищенная + концентрат. Выход < 100 %. */
export declare function purifyWater(rawL: number, energyKwh: number, roomL: number, filters: number, litresPerHour: number, hours: number): PurificationResult;
export interface RecyclingResult {
    cleanL: number;
    sludgeKg: number;
    greyUsedL: number;
    kwhUsed: number;
    filtersUsed: number;
}
/**
 * Регенерация стоков: возвращает часть воды, остальное — шлам.
 * Не 100 % и не бесплатно: энергия, фильтры, труд и время.
 */
export declare function recycleGreyWater(greyL: number, energyKwh: number, roomL: number, filters: number, litresPerHour: number, hours: number): RecyclingResult;
/** Приготовление питательного раствора: вода + N/P/K. */
export declare function prepareSolution(waterL: number, nutrientKg: number, ratioKgPerL: number): {
    solutionL: number;
    waterUsed: number;
    nutrientUsed: number;
};
/** Энергия перекачки объёма, kWh (агрегированная модель насосов). */
/** Оценка: сколько солов продержится месторождение при текущем темпе. */
export declare function depositLifeSols(deposit: Deposit, kgPerSol: number): number;
/** Доступность месторождения для добычи: найдено, есть остаток, есть установка. */
export declare function depositWorkable(deposit: Deposit): boolean;
/** Причина недоступности — для журнала причин и последствий. */
export declare function depositBlockReason(deposit: Deposit): string | null;
/** Доля соответствия оценки и факта: насколько данные разведки полезны. */
export declare const estimateError: (deposit: Deposit) => number;
/** Уверенность в оценке 0…1 для UI. */
