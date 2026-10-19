/**
 * Экипаж колонии: специализации, квалификация, усталость, жизнедеятельность.
 *
 * Человек — реальный ограничитель производства: один человек не работает
 * над двумя задачами одновременно, устаёт без отдыха и теряет
 * работоспособность без еды, воды и кислорода. Последствия НЕ мгновенные:
 * дефицит накапливается (`hoursWithoutFood`, `fatigue`, `health`), а падение
 * эффективности происходит постепенно.
 */
import { DEEP_P } from './params'
import { clamp01, fraction } from './units'

export type Specialty = 'agronomist' | 'engineer' | 'operator' | 'generalist'


export const SPECIALTY_LABEL: Record<Specialty, { ru: string; en: string }> = {
  agronomist: { ru: 'Агроном', en: 'Agronomist' },
  engineer: { ru: 'Инженер', en: 'Engineer' },
  operator: { ru: 'Оператор техники', en: 'Operator' },
  generalist: { ru: 'Универсал', en: 'Generalist' },
}

export interface CrewMember {
  id: string
  name: string
  specialty: Specialty
  /** Усталость 0…1. Растёт от работы, падает от отдыха. */
  fatigue: number
  /** Состояние 0…1. Падает от недоедания, гипоксии, плохой атмосферы. */
  health: number
  /** Накопленный пищевой дефицит, в человеко-солях без еды. */
  foodDebtSols: number
  taskId: string | null
  /** Отработано за текущий сол, часы. */
  hoursToday: number
  /** Доступно часов в этот сол (смена, уменьшенная усталостью и состоянием). */
  hoursAvailable: number
  /** Где человек: id секции, id машины или 'eva'. */
  location: string
  /** Скафандр надет: наружные работы требуют подготовки и ресурсов. */
  suited: boolean
  /** Затрачено на подготовку к выходу, часы (копится до готовности). */
  evaPrepHours: number
}

export type CrewLocation = string

/**
 * Матрица квалификации: множитель эффективности по типу работы.
 * Игровое допущение (balance): в этой итерации нет десятков психологических
 * характеристик — только специализация, усталость и состояние.
 */
const SKILL_MATRIX: Record<Specialty, Partial<Record<string, number>>> = {
  agronomist: { plant: 1.3, tend: 1.3, harvest: 1.25, sample: 1.2, analysis: 1.15, process: 1.0, clean_panels: 0.7, inspect: 0.8, repair: 0.55, extract: 0.6, haul: 0.7, survey: 0.85, maintain: 0.7 },
  engineer: { plant: 0.6, tend: 0.7, harvest: 0.6, sample: 0.8, analysis: 0.9, process: 0.8, clean_panels: 1.1, inspect: 1.3, repair: 1.35, extract: 0.9, haul: 0.8, survey: 0.8, maintain: 1.3 },
  operator: { plant: 0.7, tend: 0.75, harvest: 0.75, sample: 0.7, analysis: 0.6, process: 0.9, clean_panels: 0.9, inspect: 0.9, repair: 0.85, extract: 1.35, haul: 1.35, survey: 1.3, maintain: 0.95 },
  generalist: { plant: 0.85, tend: 0.85, harvest: 0.85, sample: 0.85, analysis: 0.8, process: 0.85, clean_panels: 0.85, inspect: 0.9, repair: 0.75, extract: 0.85, haul: 0.85, survey: 0.85, maintain: 0.85 },
}

const FALLBACK_SKILL = 0.6

/** Квалификация человека на тип работы (множитель к скорости). */
export function crewSkill(member: CrewMember, kind: string): number {
  const table = SKILL_MATRIX[member.specialty]
  return table[kind] ?? FALLBACK_SKILL
}

/** Множитель эффективности: квалификация × усталость × состояние × питание. */
function crewEfficiency(member: CrewMember, kind: string): number {
  const fatiguePenalty = 1 - 0.6 * clamp01(member.fatigue)
  const healthFactor = 0.35 + 0.65 * clamp01(member.health)
  const nutritionFactor = nutritionFactorOf(member)
  return clamp01(crewSkill(member, kind) * fatiguePenalty * healthFactor * nutritionFactor)
}

/**
 * Питание: последствия нехватки еды нарастают по времени, а не мгновенным штрафом.
 * Первые `starvationOnsetSols` солей дефицит переносится, затем эффективность падает линейно.
 */
function nutritionFactorOf(member: CrewMember): number {
  const grace = Math.max(0, DEEP_P.starvationOnsetSols)
  const debt = Math.max(0, member.foodDebtSols)
  if (debt <= grace) return 1
  return clamp01(1 - 0.18 * (debt - grace))
}

/** Сколько часов человек реально может отработать в этот сол. */
function plannedHours(member: CrewMember): number {
  const base = DEEP_P.crewWorkHoursPerSol
  return Math.max(0, base * (1 - 0.45 * clamp01(member.fatigue)) * (0.4 + 0.6 * clamp01(member.health)) * nutritionFactorOf(member))
}

export const isIdle = (member: CrewMember): boolean => member.taskId === null
export const remainingHours = (member: CrewMember): number => Math.max(0, member.hoursAvailable - member.hoursToday)

export function createCrew(id: string, name: string, specialty: Specialty): CrewMember {
  return {
    id, name, specialty, fatigue: 0.05, health: 1, foodDebtSols: 0,
    taskId: null, hoursToday: 0, hoursAvailable: DEEP_P.crewWorkHoursPerSol,
    location: 'habitat-1', suited: false, evaPrepHours: 0,
  }
}

/** Начало сола: пересчитать доступные часы, сбросить счётчик, снять скафандр. */
export function beginSolForCrew(member: CrewMember): void {
  member.hoursToday = 0
  member.hoursAvailable = plannedHours(member)
  member.suited = false
  member.evaPrepHours = 0
}

/**
 * Работа в течение `hours` часов. Возвращает полезные «человеко-часы»
 * (эффективные), которые задача зачитывает в свой прогресс.
 */
export function workHours(member: CrewMember, kind: string, hours: number): number {
  const available = Math.min(hours, remainingHours(member))
  if (available <= 0) return 0
  member.hoursToday += available
  member.fatigue = clamp01(member.fatigue + DEEP_P.crewFatiguePerWorkHour * available)
  return available * crewEfficiency(member, kind)
}

/** Отдых: сон и восстановление в конце сола. */
export function restCrew(member: CrewMember, restHours: number): void {
  if (restHours <= 0) return
  member.fatigue = clamp01(member.fatigue - DEEP_P.crewRecoveryPerRestHour * restHours)
  // Состояние восстанавливается только при еде; без неё дефицит копится.
  if (member.foodDebtSols <= 0) member.health = clamp01(member.health + 0.03 * restHours / 8)
}

/**
 * Метаболизм за долю сола: еда, вода, кислород, CO2, влага, отходы.
 * `fed` — доля рациона, реально полученная (0…1). Возвращает фактические потоки.
 */
export interface Metabolism {
  foodKg: number
  waterL: number
  o2Kg: number
  co2Kg: number
  moistureL: number
  wasteKg: number
  /** Доля полученного рациона — влияет на накопление пищевого долга. */
  fedFraction: number
}

export function metabolise(crew: number, shareOfSol: number, foodAvailableKg: number, waterAvailableL: number, o2AvailableKg: number): Metabolism {
  const people = Math.max(0, crew)
  const foodWant = people * DEEP_P.crewFoodKgPerSol * shareOfSol
  const waterWant = people * DEEP_P.crewWaterLitresPerSol * shareOfSol
  const o2Want = people * DEEP_P.crewO2KgPerSol * shareOfSol
  const fed = fraction(foodAvailableKg, foodWant)
  const watered = fraction(waterAvailableL, waterWant)
  const breathe = fraction(o2AvailableKg, o2Want)
  // Кислород — самый жёсткий ограничитель: без него человек не работает.
  const alive = Math.min(fed, watered, breathe)
  return {
    foodKg: foodWant * Math.min(1, fed),
    waterL: waterWant * Math.min(1, watered),
    o2Kg: o2Want * Math.min(1, breathe),
    co2Kg: people * DEEP_P.crewCo2KgPerSol * shareOfSol * alive,
    moistureL: people * DEEP_P.crewMoistureLPerSol * shareOfSol * alive,
    wasteKg: people * DEEP_P.crewWasteKgPerSol * shareOfSol,
    fedFraction: Math.min(1, fed),
  }
}

/** Накопление последствий: еда, гипоксия, плохая атмосфера. */
export function applyLifeSupportConsequences(
  member: CrewMember, shareOfSol: number, fedFraction: number, o2PartialKpa: number, co2PartialKpa: number,
): void {
  // Пищевой долг: растёт при недоедании, гасится при нормальном рационе.
  if (fedFraction >= 0.98) member.foodDebtSols = Math.max(0, member.foodDebtSols - shareOfSol * 1.5)
  else member.foodDebtSols += shareOfSol * (1 - fedFraction)
  member.health = clamp01(member.health - DEEP_P.starvationHealthPerSol * shareOfSol * (1 - fedFraction))
  // Кислород ниже минимума и CO2 выше предела ухудшают состояние.
  if (o2PartialKpa < DEEP_P.minO2PartialKpa) {
    const deficit = fraction(DEEP_P.minO2PartialKpa - o2PartialKpa, DEEP_P.minO2PartialKpa)
    member.health = clamp01(member.health - 0.25 * shareOfSol * deficit)
    member.fatigue = clamp01(member.fatigue + 0.12 * shareOfSol * deficit)
  }
  if (co2PartialKpa > DEEP_P.maxCo2PartialKpa) {
    const excess = fraction(co2PartialKpa - DEEP_P.maxCo2PartialKpa, DEEP_P.maxCo2PartialKpa)
    member.health = clamp01(member.health - 0.18 * shareOfSol * excess)
    member.fatigue = clamp01(member.fatigue + 0.1 * shareOfSol * excess)
  }
}

/** Сводка по экипажу для интерфейса. */
export interface CrewSummary {
  total: number
  idle: number
  assigned: number
  /** Средняя доступная работоспособность 0…1. */
  readiness: number
  hoursPlanned: number
  hoursWorked: number
}

export function crewSummary(crew: readonly CrewMember[]): CrewSummary {
  const total = crew.length
  const idle = crew.filter(isIdle).length
  const planned = crew.reduce((sum, m) => sum + m.hoursAvailable, 0)
  const worked = crew.reduce((sum, m) => sum + m.hoursToday, 0)
  const readiness = total > 0
    ? crew.reduce((sum, m) => sum + (1 - m.fatigue) * m.health * nutritionFactorOf(m), 0) / total
    : 0
  return { total, idle, assigned: total - idle, readiness, hoursPlanned: planned, hoursWorked: worked }
}
