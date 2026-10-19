/**
 * Отходы и переработка.
 *
 * Часть веществ возвращается в производство, но только с затратами времени,
 * энергии, труда, оборудования и расходников. Универсального «рециклера»,
 * превращающего любые отходы в любые ресурсы со 100 % эффективностью, НЕТ:
 *  - растительные остатки и испорченная еда → компост → часть N/P/K;
 *  - стоки → регенерация → часть воды + шлам (см. extraction.ts);
 *  - изношенные расходники (фильтры) не перерабатываются в этой итерации.
 *
 * Переработка не создаёт воду или питательные элементы из ничего.
 */
import { DEEP_P } from './params'
import { clamp01 } from './units'

export interface CompostBatch {
  id: string
  /** Входная масса, кг (растительные остатки + испорченная еда). */
  inputKg: number
  startSol: number
  readySol: number
  /** Прогресс 0…1. */
  progress: number
  /** Затрачено энергии, kWh. */
  kwh: number
  /** Затрачено труда, человеко-часов. */
  hours: number
  done: boolean
}

export function createCompostBatch(id: string, inputKg: number, sol: number): CompostBatch {
  return {
    id, inputKg: Math.max(0, inputKg), startSol: sol,
    readySol: sol + DEEP_P.compostSols, progress: 0, kwh: 0, hours: 0, done: false,
  }
}

/** Шаг компостирования. Возвращает затраты за шаг и готовый компост. */
export function stepComposting(
  batches: CompostBatch[], dtSols: number,
  budget: { energyFraction: number; labourFraction: number; inputLimitKg: number },
): { compostKg: number; kwh: number; hours: number } {
  let compostKg = 0, kwh = 0, hours = 0
  for (const batch of batches) {
    if (batch.done) continue
    const rate = clamp01(Math.min(budget.energyFraction, budget.labourFraction))
    const advance = (dtSols / DEEP_P.compostSols) * rate
    batch.progress = clamp01(batch.progress + advance)
    const shareKwh = batch.inputKg * DEEP_P.compostKwhPerKg * advance
    const shareHours = batch.inputKg * DEEP_P.compostLabourHoursPerKg * advance
    batch.kwh += shareKwh
    batch.hours += shareHours
    kwh += shareKwh
    hours += shareHours
    if (batch.progress >= 1) {
      batch.done = true
      compostKg += batch.inputKg * DEEP_P.compostKgPerKg
    }
  }
  return { compostKg, kwh, hours }
}

/** Компост → питательные элементы. Доля возврата меньше 100 %. */
export function compostToNutrients(compostKg: number): { n: number; p: number; k: number } {
  // Соотношение N:P:K в компосте — игровое допущение (примерно 2:1:2).
  const total = Math.max(0, compostKg) * DEEP_P.compostNutrientKgPerKg
  return { n: total * 0.4, p: total * 0.2, k: total * 0.4 }
}

/** Сколько килограммов отходов можно принять сейчас (ёмкость переработки). */

/** Потери: что уходит безвозвратно при переработке (CO2, испарение). */

/** Изношенные расходники: в этой итерации не перерабатываются (явное ограничение). */

/** Оценка замкнутости: доля питательных элементов, возвращённая из отходов. */
export function nutrientClosureRatio(returnedKg: number, appliedKg: number): number {
  if (appliedKg <= 0) return 0
  return clamp01(returnedKg / appliedKg)
}
