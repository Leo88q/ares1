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
export const EARTH_DAY_HOURS = 24
/** Сколько земных суток в одном соле (1.0275…). */
export const EARTH_DAYS_PER_SOL = SOL_HOURS / EARTH_DAY_HOURS
/** Сколько солов в одних земных сутках (0.9732…). */
export const SOLS_PER_EARTH_DAY = EARTH_DAY_HOURS / SOL_HOURS

/** Подшагов в соле: достаточно для отключений, ремонта и тепловой инерции. */
export const SUBSTEPS_PER_SOL = 8
export const SUBSTEP_HOURS = SOL_HOURS / SUBSTEPS_PER_SOL

export const solsToEarthDays = (sols: number): number => sols * EARTH_DAYS_PER_SOL
export const earthDaysToSols = (days: number): number => days * SOLS_PER_EARTH_DAY
export const hoursToSols = (hours: number): number => hours / SOL_HOURS
export const solsToHours = (sols: number): number => sols * SOL_HOURS

/** Допуск сравнения для балансов учёта: копится округление float64. */
export const BALANCE_TOLERANCE = 1e-6

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

/** Сумма числовых значений объекта-записи (используется для запасов). */
export const sumRecord = (record: Record<string, number>): number =>
  Object.values(record).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)

/** Добавить к записи, создав новый объект (состояние симуляции неизменяемо снаружи). */
export const addToRecord = (record: Record<string, number>, key: string, delta: number): Record<string, number> =>
  delta === 0 ? record : { ...record, [key]: (record[key] ?? 0) + delta }
