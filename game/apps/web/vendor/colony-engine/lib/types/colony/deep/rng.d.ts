/**
 * Детерминированный генератор случайных чисел.
 *
 * Симуляция не использует `Math.random()` и не читает время: один seed
 * даёт один и тот же прогон, поэтому эксперимент можно повторить.
 * Алгоритм mulberry32 — компактный, быстрый, без внешних зависимостей.
 */
export interface Rng {
    /** Текущее 32-битное состояние. Сохраняется в мире, чтобы клон мира был воспроизводим. */
    state: number;
    next(): number;
}
/** Создать ГПСЧ из seed. */
export declare function createRng(seed: number): Rng;
/** Восстановить ГПСЧ из сохранённого состояния (например, после structuredClone). */
export declare function rngFromState(state: number): Rng;
/** Равномерное число в [min, max). */
export declare function uniform(rng: Rng, min: number, max: number): number;
/** Целое число в [min, max]. */
/** Нормальное распределение (Марсалья). Используется для шума измерений. */
export declare function normal(rng: Rng, mean?: number, deviation?: number): number;
/**
 * Вероятность наступления за интервал при постоянной интенсивности (экспоненциальная модель).
 * callers: hazard per hour × hours → P(отказ за интервал).
 */
export declare function hazardProbability(hazardPerHour: number, hours: number): number;
/** Стабильный строковый хеш → 32-битный seed (для seed от названия сценария). */
