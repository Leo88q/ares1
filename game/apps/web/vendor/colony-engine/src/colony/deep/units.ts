/**
 * Единицы времени и преобразования для глубокой симуляции колонии.
 *
 * Игрок видит **солы**. Внутренний шаг фиксированный и не зависит от FPS:
 * сол делится на SUBSTEPS_PER_SOL одинаковых подшагов. Земные сутки и сол
 * никогда не смешиваются неявно — только через функции этого модуля.
 *
 * Источник длительности сола: NASA Mars Fact Sheet (24 h 37 m 22.7 s).
 */
export const SOL_HOURS = 24.6229
/** Сколько земных суток в одном соле (1.0275…). */
/** Сколько солов в одних земных сутках (0.9732…). */

/** Подшагов в соле: достаточно для отключений, ремонта и тепловой инерции. */
export const SUBSTEPS_PER_SOL = 8
export const SUBSTEP_HOURS = SOL_HOURS / SUBSTEPS_PER_SOL

/** Допуск сравнения для балансов учёта: копится округление float64. */

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value
export const clamp01 = (value: number): number => clamp(Number.isFinite(value) ? value : 0, 0, 1)

/** Доля требуемого, которая реально доступна. 0 требований → 1 (нет ограничения). */
export const fraction = (available: number, required: number): number => {
  if (!Number.isFinite(available) || !Number.isFinite(required)) return 0
  if (required <= 0) return 1
  return clamp01(available / required)
}

/** Округление до знаков: убирает «пыль» float64 из отчётов и UI. */
export const round = (value: number, decimals = 6): number => {
  if (!Number.isFinite(value)) return 0
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

