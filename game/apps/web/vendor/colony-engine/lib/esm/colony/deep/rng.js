const DEFAULT_SEED = 0x9e3779b9;
/** Создать ГПСЧ из seed. */
export function createRng(seed) {
    let state = (Number.isFinite(seed) ? Math.trunc(seed) : DEFAULT_SEED) >>> 0;
    if (state === 0)
        state = DEFAULT_SEED;
    return {
        get state() { return state; },
        next() {
            state = (state + 0x6d2b79f5) >>> 0;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        },
    };
}
/** Восстановить ГПСЧ из сохранённого состояния (например, после structuredClone). */
export function rngFromState(state) {
    return createRng(state);
}
/** Равномерное число в [min, max). */
export function uniform(rng, min, max) {
    return min + rng.next() * (max - min);
}
/** Целое число в [min, max]. */
/** Нормальное распределение (Марсалья). Используется для шума измерений. */
export function normal(rng, mean = 0, deviation = 1) {
    const u = Math.max(1e-12, rng.next());
    const v = rng.next();
    const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + n * deviation;
}
/**
 * Вероятность наступления за интервал при постоянной интенсивности (экспоненциальная модель).
 * callers: hazard per hour × hours → P(отказ за интервал).
 */
export function hazardProbability(hazardPerHour, hours) {
    if (!(hazardPerHour > 0) || !(hours > 0))
        return 0;
    return 1 - Math.exp(-hazardPerHour * hours);
}
/** Стабильный строковый хеш → 32-битный seed (для seed от названия сценария). */
