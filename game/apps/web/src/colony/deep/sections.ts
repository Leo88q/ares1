/**
 * Герметичные секции и жизнеобеспечение.
 *
 * Модель агрегированная: для каждой секции (жилой модуль, теплица, мастерская,
 * лаборатория) считается объём, давление, парциальные давления O2/CO2,
 * температура и влажность. Газовой динамики по клеткам карты НЕТ: воздух внутри
 * секции считается перемешанным, обмен между секциями — через вентиляцию и
 * гермопереходы, с явной потерей при выходе наружу.
 *
 * Идеальный газ: p_i = n_i · R · T / V. Единицы: kPa, m³, kg, °C.
 */
import { DEEP_P } from './params'
import { clamp, clamp01, fraction } from './units'

/** Универсальная газовая постоянная, Дж/(моль·К). */
export const R_GAS = 8.314462618
export const MOLAR_O2 = 0.032
export const MOLAR_CO2 = 0.044
export const MOLAR_N2 = 0.028
export const KELVIN = 273.15

export type SectionKind = 'habitat' | 'greenhouse' | 'workshop' | 'lab'

export interface Section {
  id: string
  name: string
  deviceId: string
  kind: SectionKind
  volumeM3: number
  /** Массы газов, кг. Давление выводится из них, а не хранится отдельно. */
  o2Kg: number
  co2Kg: number
  n2Kg: number
  temperatureC: number
  /** Относительная влажность 0…1. */
  humidity: number
  /** Состояние оболочки 0…1: влияет на утечку. */
  condition: number
  /** Секция изолирована гермодверьми (аварийный режим). */
  isolated: boolean
  /** Подключена к системе жизнеобеспечения (вентиляция, подача O2, скруббер). */
  connected: boolean
  /** Люди, находящиеся в секции (обновляется каждый подшаг). */
  crewIds: string[]
  /** Накопленная влага на конденсаторе, L (источник стоков). */
  condensateL: number
  /** Сколько атмосферы потеряно за всё время, кг (диагностика утечек). */
  lostKg: number
  /** Питание нагревателя, kW (реально выделено). */
  heaterKw: number
  /** Теплообмен снаружей, kW (знаковый: «+» — приток, «−» — потери). */
  envelopeKw: number
  /** Внутренние тепловыделения, kW. */
  internalHeatKw: number
}

const moles = (massKg: number, molarMass: number): number => massKg / molarMass
const safeVolume = (v: number): number => (v > 0 ? v : 1)

/** Парциальное давление газа, kPa. */
export function partialPressureKpa(massKg: number, molarMass: number, volumeM3: number, temperatureC: number): number {
  const n = moles(massKg, molarMass)
  return (n * R_GAS * (temperatureC + KELVIN)) / safeVolume(volumeM3) / 1000
}

/** Масса газа, соответствующая парциальному давлению, кг. */
export function massForPartialKpa(kpa: number, molarMass: number, volumeM3: number, temperatureC: number): number {
  const n = (kpa * 1000 * safeVolume(volumeM3)) / (R_GAS * (temperatureC + KELVIN))
  return n * molarMass
}

export const o2PartialKpa = (s: Section): number => partialPressureKpa(s.o2Kg, MOLAR_O2, s.volumeM3, s.temperatureC)
export const co2PartialKpa = (s: Section): number => partialPressureKpa(s.co2Kg, MOLAR_CO2, s.volumeM3, s.temperatureC)
export const n2PartialKpa = (s: Section): number => partialPressureKpa(s.n2Kg, MOLAR_N2, s.volumeM3, s.temperatureC)
export const totalPressureKpa = (s: Section): number => o2PartialKpa(s) + co2PartialKpa(s) + n2PartialKpa(s)
export const airMassKg = (s: Section): number => s.o2Kg + s.co2Kg + s.n2Kg

/** Целевое парциальное давление кислорода, kPa (запас выше минимума). */
export const TARGET_O2_PARTIAL_KPA = 18

export function createSection(id: string, name: string, deviceId: string, kind: SectionKind, volumeM3: number): Section {
  const temperatureC = kind === 'greenhouse' ? 20 : 21
  const o2Kg = massForPartialKpa(TARGET_O2_PARTIAL_KPA, MOLAR_O2, volumeM3, temperatureC)
  const co2Kg = massForPartialKpa(DEEP_P.targetCo2PartialKpa, MOLAR_CO2, volumeM3, temperatureC)
  const restKpa = Math.max(2, DEEP_P.nominalPressureKpa - TARGET_O2_PARTIAL_KPA - DEEP_P.targetCo2PartialKpa)
  const n2Kg = massForPartialKpa(restKpa, MOLAR_N2, volumeM3, temperatureC)
  return {
    id, name, deviceId, kind, volumeM3, o2Kg, co2Kg, n2Kg,
    temperatureC, humidity: 0.45, condition: 1, isolated: false, connected: true,
    crewIds: [], condensateL: 0, lostKg: 0, heaterKw: 0, envelopeKw: 0, internalHeatKw: 0,
  }
}

/** Подать кислород в секцию из общего запаса. Возвращает фактически поданное, кг. */
export function injectO2(s: Section, kg: number): number {
  const amount = Math.max(0, kg)
  s.o2Kg += amount
  return amount
}

/** Забрать CO2 скруббером. Возвращает фактически удалённое, кг. */
export function scrubCo2(s: Section, kg: number): number {
  const amount = Math.min(Math.max(0, kg), s.co2Kg)
  s.co2Kg -= amount
  return amount
}

/** Утечка атмосферы за долю сола: пропорционально составу и состоянию оболочки. */
export function leakSection(s: Section, shareOfSol: number): number {
  const conditionFactor = (1 / Math.max(0.2, s.condition)) ** DEEP_P.leakConditionExponent
  const fractionLost = clamp01(DEEP_P.leakFractionPerSol * shareOfSol * conditionFactor)
  const before = airMassKg(s)
  s.o2Kg *= 1 - fractionLost
  s.co2Kg *= 1 - fractionLost
  s.n2Kg *= 1 - fractionLost
  const lost = before - airMassKg(s)
  s.lostKg += lost
  return lost
}

/** Потеря атмосферы на один выход через шлюз: гермопереход ≠ выход наружу. */
export function airlockLoss(s: Section): number {
  const before = airMassKg(s)
  const keep = 1 - clamp01(DEEP_P.airlockLossFraction)
  s.o2Kg *= keep; s.co2Kg *= keep; s.n2Kg *= keep
  const lost = before - airMassKg(s)
  s.lostKg += lost
  return lost
}

/**
 * Тепловой шаг секции. Заданная температура НЕ достигается мгновенно:
 * есть эффективная теплоёмкость, обмен через оболочку и ОГРАНИЧЕННЫЕ
 * обогрев и охлаждение. Теплица без охлаждения уходит за +70 °C за сутки:
 * лампы дают 2.7 kW тепла, а оболочка отводит 0.36 kW.
 *
 * `hvacFraction` — доля доступной мощности климатической системы (0…1).
 * Мощность обогревателя и холодильника входит в номинальную мощность
 * агрегата секции, поэтому здесь она не списывается повторно.
 */
export function stepSectionThermal(
  s: Section, hours: number, internalHeatKw: number, outsideC: number, targetC: number, hvacFraction: number,
): { heaterKw: number; coolerKw: number; envelopeKw: number } {
  const scale = s.volumeM3 / DEEP_P.habitatVolumeM3
  // Знаковый обмен: наружу при положительной разнице, внутрь при отрицательной.
  const envelopeKw = DEEP_P.envelopeKwPerC * (outsideC - s.temperatureC) * scale
  const capacityKwhPerC = Math.max(1e-6, DEEP_P.thermalCapacityKwhPerC)
  // Сколько kW нужно, чтобы выйти на целевую температуру за этот шаг.
  const wantedKw = ((targetC - s.temperatureC) * capacityKwhPerC) / Math.max(1e-9, hours) - (internalHeatKw + envelopeKw)
  const hvac = clamp01(hvacFraction)
  const heaterKw = clamp(wantedKw, 0, DEEP_P.heaterKw * hvac)
  const coolerKw = clamp(-wantedKw, 0, DEEP_P.coolerKw * hvac)
  const netKw = internalHeatKw + envelopeKw + heaterKw - coolerKw
  s.temperatureC += (netKw * hours) / capacityKwhPerC
  s.heaterKw = heaterKw
  s.envelopeKw = envelopeKw
  s.internalHeatKw = internalHeatKw
  return { heaterKw, coolerKw, envelopeKw }
}

/** Сколько литров влаги удерживает воздух секции при текущей влажности (агрегированно). */
export const sectionMoistureCapacityL = (s: Section): number =>
  Math.max(0.5, (s.volumeM3 / DEEP_P.habitatVolumeM3) * 8)

/**
 * Влажность: люди и растения дают влагу, конденсатор собирает её в стоки.
 * Возвращает сколько литров собрано в конденсат за этот шаг.
 */
export function stepSectionHumidity(s: Section, addedLitres: number, condenserLitresPerSol: number, shareOfSol: number): number {
  const capacity = sectionMoistureCapacityL(s)
  s.humidity = clamp01(s.humidity + addedLitres / capacity)
  const removable = Math.min(s.humidity * capacity, condenserLitresPerSol * shareOfSol)
  s.humidity = clamp01(s.humidity - removable / capacity)
  s.condensateL += removable
  return removable
}

/** Забрать конденсат в стоки. Возвращает литры. */
export function drainCondensate(s: Section): number {
  const litres = s.condensateL
  s.condensateL = 0
  return litres
}

/**
 * Фактор роста по CO2. Оптимум 0.06–0.12 kPa парциального давления
 * (≈ 800–1700 ppm при 70 kPa): ниже — ограничение фотосинтеза, выше — стресс.
 * Игровая кривая, не измерение конкретного сорта.
 */
export function co2GrowthFactor(ppCo2Kpa: number): number {
  if (ppCo2Kpa <= 0.004) return 0.15
  if (ppCo2Kpa < 0.06) return 0.15 + 0.85 * fraction(ppCo2Kpa - 0.004, 0.056)
  if (ppCo2Kpa <= 0.12) return 1
  if (ppCo2Kpa < 0.5) return 1 - 0.5 * fraction(ppCo2Kpa - 0.12, 0.38)
  return 0.4
}

/**
 * Кислород в корневой зоне: при избыточном поливе субстрат заливается и корни
 * задыхаются. Агрегированная оценка по парциальному давлению O2 и доле перелива.
 */
export function rootOxygenFactor(ppO2Kpa: number, waterlogRatio: number): number {
  const airFactor = clamp01(fraction(ppO2Kpa, 12))
  return clamp01(airFactor * (1 - 0.6 * clamp01(waterlogRatio)))
}

/** Качество атмосферы 0…1 для интерфейса и последствий (давление, O2, CO2). */
export function atmosphereQuality(s: Section): number {
  const o2 = clamp01(fraction(o2PartialKpa(s), DEEP_P.minO2PartialKpa))
  const co2 = clamp01(1 - fraction(Math.max(0, co2PartialKpa(s) - DEEP_P.targetCo2PartialKpa), DEEP_P.maxCo2PartialKpa))
  const pressure = clamp01(fraction(totalPressureKpa(s), DEEP_P.nominalPressureKpa * 0.85))
  return clamp01(Math.min(o2, co2, pressure))
}

/** Наружная температура: детерминированная суточная кривая (LAB/2) + пылевое похолодание. */
export function outsideTemperatureC(solHour: number, dustDropC: number): number {
  const phase = Math.sin(Math.PI * ((solHour / 24.6229) * 2 - 0.5))
  return DEEP_P.outsideMinC + DEEP_P.outsideDayAmplitudeC * Math.max(0, phase) - dustDropC
}

export type PressureBand = 'nominal' | 'low' | 'critical'
export function pressureBand(kpa: number): PressureBand {
  const nominal = DEEP_P.nominalPressureKpa
  return kpa >= nominal * 0.9 ? 'nominal' : kpa >= nominal * 0.6 ? 'low' : 'critical'
}

/** Температурная кривая роста (совпадает с LAB/2, чтобы не вводить вторую физику). */
export const temperatureGrowthFactor = (celsius: number): number =>
  !Number.isFinite(celsius) || celsius <= 4 || celsius >= 36 ? 0
    : celsius < 16 ? ((celsius - 4) / 12) ** 2 : celsius <= 22 ? 1 : (36 - celsius) / 14
