/**
 * Лаборатория как инструмент исследования.
 *
 * Лаборатория даёт информацию и проверенные режимы, а не «магические проценты»:
 *   отбор пробы → доставка/передача образца → постановка анализа → расход
 *   реагентов → работа специалиста → время → результат с понятной точностью.
 *
 * Скрытые состояния (загрязнение субстрата, накопление солей) игроку
 * заранее не показываются: в этом смысл анализа. Базовые эксплуатационные
 * датчики (температура, поток, давление, влажность) остаются доступными.
 *
 * Эксперимент расходует реальные ресурсы общей колонии. Изменение режима
 * НЕ меняет задним числом уже выращенный урожай.
 */
import { DEEP_P } from './params'
import { clamp01 } from './units'
import type { Rng } from './rng'
import { normal } from './rng'
import { createBatch, stepBatch, type CropBatch, type GrowthEnvironment } from './growth'

export type SampleKind = 'water' | 'solution' | 'substrate' | 'tissue'

export interface Sample {
  id: string
  kind: SampleKind
  /** Откуда проба: id резервуара/теплицы/грядки. */
  sourceId: string
  sol: number
  /** Проба доставлена в лабораторию (иначе анализ невозможен). */
  delivered: boolean
}

export type AnalysisKind = 'water_quality' | 'solution_composition' | 'salt_index' | 'contamination' | 'root_zone'

export const ANALYSIS_KINDS: readonly AnalysisKind[] = [
  'water_quality', 'solution_composition', 'salt_index', 'contamination', 'root_zone',
]

export interface AnalysisMeta {
  kind: AnalysisKind
  sample: SampleKind
  hours: number
  reagents: number
  kwh: number
  ru: string
  en: string
  /** Что именно измеряет: смысл результата. */
  measures: { ru: string; en: string }
}

export const ANALYSIS_META: Record<AnalysisKind, AnalysisMeta> = {
  water_quality: {
    kind: 'water_quality', sample: 'water', hours: DEEP_P.analysisHours * 0.8, reagents: 1, kwh: DEEP_P.analysisKwh * 0.7,
    ru: 'Качество воды', en: 'Water quality',
    measures: { ru: 'пригодность воды по загрязнению', en: 'water fitness by contamination' },
  },
  solution_composition: {
    kind: 'solution_composition', sample: 'solution', hours: DEEP_P.analysisHours, reagents: 1, kwh: DEEP_P.analysisKwh,
    ru: 'Состав раствора', en: 'Solution composition',
    measures: { ru: 'концентрация питания N/P/K', en: 'N/P/K concentration' },
  },
  salt_index: {
    kind: 'salt_index', sample: 'substrate', hours: DEEP_P.analysisHours * 1.2, reagents: 1, kwh: DEEP_P.analysisKwh * 1.1,
    ru: 'Накопление солей', en: 'Salt build-up',
    measures: { ru: 'долю солей в субстрате', en: 'salt fraction in substrate' },
  },
  contamination: {
    kind: 'contamination', sample: 'substrate', hours: DEEP_P.analysisHours * 1.4, reagents: 2, kwh: DEEP_P.analysisKwh * 1.3,
    ru: 'Загрязнение субстрата', en: 'Substrate contamination',
    measures: { ru: 'уровень загрязнения субстрата', en: 'substrate contamination level' },
  },
  root_zone: {
    kind: 'root_zone', sample: 'tissue', hours: DEEP_P.analysisHours * 1.1, reagents: 1, kwh: DEEP_P.analysisKwh,
    ru: 'Состояние корневой зоны', en: 'Root-zone condition',
    measures: { ru: 'состояние корней и риск заливания', en: 'root condition and waterlogging risk' },
  },
}

export interface AnalysisResult {
  sol: number
  kind: AnalysisKind
  /** Измеренное значение в долях 0…1. */
  value: number
  /** Половина доверительного интервала. */
  ci: number
  /** Короткий вывод: «норма», «внимание», «опасно». */
  band: 'ok' | 'watch' | 'critical'
}

export type AnalysisStatus = 'queued' | 'running' | 'done' | 'cancelled'

export interface Analysis {
  id: string
  kind: AnalysisKind
  sampleId: string
  targetId: string
  startedSol: number | null
  finishSol: number | null
  /** Выполнено человеко-часов специалиста. */
  doneHours: number
  status: AnalysisStatus
  reagents: number
  kwh: number
  result: AnalysisResult | null
}

export function createAnalysis(id: string, kind: AnalysisKind, sampleId: string, targetId: string): Analysis {
  const meta = ANALYSIS_META[kind]
  return {
    id, kind, sampleId, targetId,
    startedSol: null, finishSol: null, doneHours: 0,
    status: 'queued', reagents: meta.reagents, kwh: meta.kwh, result: null,
  }
}

export function bandOf(value: number): AnalysisResult['band'] {
  return value < 0.3 ? 'ok' : value < 0.6 ? 'watch' : 'critical'
}

/**
 * Результат анализа: измеренное значение = скрытое состояние + шум прибора.
 * Точность задана параметром; игрок видит интервал, а не «истину».
 */
export function finishAnalysis(analysis: Analysis, sol: number, hiddenValue: number, rng: Rng): AnalysisResult {
  const noise = normal(rng, 0, DEEP_P.analysisPrecision / 2)
  const value = clamp01(hiddenValue + noise)
  const result: AnalysisResult = { sol, kind: analysis.kind, value, ci: DEEP_P.analysisPrecision, band: bandOf(value) }
  analysis.result = result
  analysis.status = 'done'
  analysis.finishSol = sol
  return result
}

/** Какое скрытое состояние измеряет анализ на объекте (для движка). */
export function hiddenValueFor(analysis: Analysis, read: (targetId: string, kind: AnalysisKind) => number): number {
  return clamp01(read(analysis.targetId, analysis.kind))
}

// --- Контролируемые эксперименты ------------------------------------------

export interface Regime {
  /** Целевая температура, °C. */
  targetC: number
  /** Норма питания 0…1.5. */
  feedRate: number
  /** Доля светового режима 0…1. */
  light: number
  /** Доля полива от базовой потребности 0…2. */
  irrigation: number
}

export const DEFAULT_REGIME: Regime = { targetC: 20, feedRate: 1, light: 1, irrigation: 1 }

export interface ExperimentArm {
  label: string
  regime: Regime
  batch: CropBatch
  waterL: number
  energyKwh: number
  labourHours: number
  yieldKg: number
  quality: number
}

export type ExperimentStatus = 'planned' | 'running' | 'done' | 'cancelled'

export interface Experiment {
  id: string
  name: string
  status: ExperimentStatus
  startSol: number
  sols: number
  a: ExperimentArm
  b: ExperimentArm
  /** Выявленный риск: что показал опыт. */
  risk: string | null
  /** Сохранённый производственный рецепт. */
  savedRecipeId: string | null
}

export interface ExperimentResult {
  id: string
  sols: number
  a: { yieldKg: number; quality: number; waterL: number; energyKwh: number; labourHours: number }
  b: { yieldKg: number; quality: number; waterL: number; energyKwh: number; labourHours: number }
  winner: 'a' | 'b' | 'tie'
  risk: string | null
}

export function createExperiment(
  id: string, name: string, sol: number, sols: number, regimeA: Regime, regimeB: Regime,
): Experiment {
  const arm = (label: string, regime: Regime): ExperimentArm => ({
    label, regime,
    batch: createBatch(`${id}-${label}`, 'lab', label === 'A' ? 0 : 1, DEEP_P.experimentAreaM2, true),
    waterL: 0, energyKwh: 0, labourHours: 0, yieldKg: 0, quality: 0,
  })
  const experiment: Experiment = {
    id, name, status: 'planned', startSol: sol, sols: Math.max(DEEP_P.experimentMinSols, sols),
    a: arm('A', regimeA), b: arm('B', regimeB), risk: null, savedRecipeId: null,
  }
  for (const side of [experiment.a, experiment.b]) {
    side.batch.targetC = side.regime.targetC
    side.batch.feedRate = side.regime.feedRate
    side.batch.plantedSol = sol
    side.batch.lastTendSol = sol
    side.batch.health = 1
    side.batch.density = 1
    side.batch.stage = 'sprout'
  }
  return experiment
}

/** Шаг эксперимента: расходует реальные ресурсы общей колонии. */
export function stepExperiment(
  experiment: Experiment, sol: number, dtSols: number,
  resources: { waterFraction: number; nutrientFraction: number; energyFraction: number; labourFraction: number },
): { waterL: number; energyKwh: number; labourHours: number; nutrientKg: number } {
  let waterL = 0, energyKwh = 0, labourHours = 0, nutrientKg = 0
  for (const arm of [experiment.a, experiment.b]) {
    const env: GrowthEnvironment = {
      temperatureC: arm.regime.targetC,
      co2PartialKpa: 0.09,
      o2PartialKpa: 18,
      lightFraction: arm.regime.light * resources.energyFraction,
      waterFraction: clamp01(resources.waterFraction) / Math.max(0.2, arm.regime.irrigation),
      nutrientFraction: clamp01(resources.nutrientFraction),
      waterlogRatio: Math.max(0, arm.regime.irrigation - 1.2),
      sol, dtSols,
    }
    stepBatch(arm.batch, env)
    const demand = DEEP_P.experimentAreaM2 * DEEP_P.cropWaterLPerM2PerSol * arm.regime.irrigation * dtSols
    arm.waterL += demand
    waterL += demand
    const kwh = DEEP_P.experimentAreaM2 * DEEP_P.lampKwPerM2 * DEEP_P.photoperiodHours * arm.regime.light * dtSols
    arm.energyKwh += kwh
    energyKwh += kwh
    const hours = DEEP_P.experimentLabourHoursPerSol * dtSols * resources.labourFraction
    arm.labourHours += hours
    labourHours += hours
    const nutrient = DEEP_P.experimentAreaM2 * DEEP_P.cropKgPerM2PerSol * 0.01 * arm.regime.feedRate * dtSols
    nutrientKg += nutrient
    arm.batch.lastTendSol = sol
  }
  return { waterL, energyKwh, labourHours, nutrientKg }
}

/** Завершение эксперимента: сравниваем режимы по реальным результатам. */
export function finishExperiment(experiment: Experiment): ExperimentResult {
  const yieldOf = (arm: ExperimentArm): number =>
    arm.batch.expectedKg * clamp01(arm.batch.development) * clamp01(arm.batch.health) * (1 - arm.batch.yieldPenalty)
  for (const arm of [experiment.a, experiment.b]) {
    arm.yieldKg = yieldOf(arm)
    arm.quality = clamp01(1 - arm.batch.yieldPenalty * 0.8 - Math.max(0, arm.batch.contamination - 0.2))
  }
  experiment.status = 'done'
  const diff = experiment.a.yieldKg - experiment.b.yieldKg
  const winner: ExperimentResult['winner'] = Math.abs(diff) < 0.05 ? 'tie' : diff > 0 ? 'a' : 'b'
  const risks: string[] = []
  for (const arm of [experiment.a, experiment.b]) {
    if (arm.batch.stress > 0.3) risks.push(`${arm.label}: стресс ${(arm.batch.stress * 100).toFixed(0)} %`)
    if (arm.batch.saltIndex > 0.4) risks.push(`${arm.label}: соли ${(arm.batch.saltIndex * 100).toFixed(0)} %`)
    if (arm.regime.irrigation > 1.4) risks.push(`${arm.label}: риск заливания корней`)
    if (arm.regime.targetC > 26) risks.push(`${arm.label}: перегрев`)
  }
  experiment.risk = risks.length ? risks.join('; ') : null
  return {
    id: experiment.id, sols: experiment.sols,
    a: { yieldKg: experiment.a.yieldKg, quality: experiment.a.quality, waterL: experiment.a.waterL, energyKwh: experiment.a.energyKwh, labourHours: experiment.a.labourHours },
    b: { yieldKg: experiment.b.yieldKg, quality: experiment.b.quality, waterL: experiment.b.waterL, energyKwh: experiment.b.energyKwh, labourHours: experiment.b.labourHours },
    winner, risk: experiment.risk,
  }
}

export interface Recipe {
  id: string
  name: string
  regime: Regime
  sourceExperimentId: string | null
  solCreated: number
  /** Подтверждённый результат: выход, качество, вода, энергия. */
  evidence: { yieldKg: number; quality: number; waterL: number; energyKwh: number } | null
}

export function recipeFromExperiment(experiment: Experiment, id: string, sol: number): Recipe {
  const winner = experiment.a.yieldKg >= experiment.b.yieldKg ? experiment.a : experiment.b
  return {
    id,
    name: experiment.name,
    regime: { ...winner.regime },
    sourceExperimentId: experiment.id,
    solCreated: sol,
    evidence: {
      yieldKg: winner.yieldKg, quality: winner.quality,
      waterL: winner.waterL, energyKwh: winner.energyKwh,
    },
  }
}

/** Сводка лаборатории для интерфейса. */
export interface LabSummary {
  samples: number
  queued: number
  running: number
  done: number
  experiments: number
  recipes: number
}

export function labSummary(
  samples: readonly Sample[], analyses: readonly Analysis[],
  experiments: readonly Experiment[], recipes: readonly Recipe[],
): LabSummary {
  return {
    samples: samples.filter(s => s.delivered).length,
    queued: analyses.filter(a => a.status === 'queued').length,
    running: analyses.filter(a => a.status === 'running').length,
    done: analyses.filter(a => a.status === 'done').length,
    experiments: experiments.filter(e => e.status === 'running').length,
    recipes: recipes.length,
  }
}
