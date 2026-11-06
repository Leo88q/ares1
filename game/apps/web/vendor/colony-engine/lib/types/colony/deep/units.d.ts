/**
 * Единицы времени и преобразования для глубокой симуляции колонии.
 *
 * Игрок видит **солы**. Внутренний шаг фиксированный и не зависит от FPS:
 * сол делится на SUBSTEPS_PER_SOL одинаковых подшагов. Земные сутки и сол
 * никогда не смешиваются неявно — только через функции этого модуля.
 *
 * Источник длительности сола: NASA Mars Fact Sheet (24 h 37 m 22.7 s).
 */
export declare const SOL_HOURS = 24.6229;
/** Сколько земных суток в одном соле (1.0275…). */
/** Сколько солов в одних земных сутках (0.9732…). */
/** Подшагов в соле: достаточно для отключений, ремонта и тепловой инерции. */
export declare const SUBSTEPS_PER_SOL = 8;
export declare const SUBSTEP_HOURS: number;
/** Допуск сравнения для балансов учёта: копится округление float64. */
export declare const clamp: (value: number, min: number, max: number) => number;
export declare const clamp01: (value: number) => number;
/** Доля требуемого, которая реально доступна. 0 требований → 1 (нет ограничения). */
export declare const fraction: (available: number, required: number) => number;
/** Округление до знаков: убирает «пыль» float64 из отчётов и UI. */
export declare const round: (value: number, decimals?: number) => number;
