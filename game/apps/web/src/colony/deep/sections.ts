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
  /** Питание охладителя, kW (реально отведено). Без этого поля тепловой
   *  баланс секции не читается: отвод тепла был виден только в общих
   *  итогах мира, но не в самой секции. */
  coolerKw: number
  /** Теплообмен снаружей, kW (знаковый: «+» — приток, «−» — потери). */
  envelopeKw: number
  /** Внутренние тепловыделения, kW. */
  internalHeatKw: number
  /**
   * Перемешивание воздуха 0…1. Без вентилятора состав газа в сумме верен,
   * но в зоне дыхания он перестаёт соответствовать сумме: CO₂ скапливается
   * у людей и грядок, кислород расслаивается. Это отдельная функция
   * жизнеобеспечения, а не следствие температуры: при отказе вентиляции
   * атмосфера портится быстрее, чем секция успевает остыть.
   */
  circulation: number
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
    crewIds: [], condensateL: 0, lostKg: 0, heaterKw: 0, coolerKw: 0, envelopeKw: 0, internalHeatKw: 0,
    circulation: 1,
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

/** Потеря атмосферы на один цикл шлюза, кг по газам. */
export interface AirlockLoss {
  o2Kg: number
  co2Kg: number
  n2Kg: number
  totalKg: number
}

/**
 * Потеря атмосферы на один цикл шлюза: гермопереход ≠ выход наружу.
 *
 * Шлюз — это МАЛЫЙ гермообъём, а не вся секция: стравливается его воздух, а
 * не весь объём помещения. Доля берётся от объёма шлюза, поэтому она мала
 * (доли процента), а не составляет проценты атмосферы базы за каждый выход.
 *
 * Функция ничего не списывает: решение, откуда восполнять потерю (запас O2,
 * буферный азот), принимает вызывающий слой, потому что только он знает
 * склад. Азот и CO2 в этой модели не имеют склада — они буферные газы.
 */
export function airlockLoss(s: Section, lockVolumeM3: number = s.volumeM3): AirlockLoss {
  const share = clamp01(DEEP_P.airlockLossFraction)
    * clamp01(lockVolumeM3 / Math.max(1e-9, s.volumeM3))
  const o2Kg = s.o2Kg * share
  const co2Kg = s.co2Kg * share
  const n2Kg = s.n2Kg * share
  return { o2Kg, co2Kg, n2Kg, totalKg: o2Kg + co2Kg + n2Kg }
}

/**
 * Тепловой шаг секции.
 *
 * Как это ведёт себя на самом деле (измерено, а не задумано):
 *
 *  - Постоянная времени C/UA ≈ 6 солов, поэтому при ОТКАЗЕ питания секция
 *    не падает мгновенно, а дрейфует: среда обитания в блэкауте уходит
 *    21.0 → 23.8 °C за 30 солов и продолжает ползти к равновесию
 *    «внутреннее тепло 0.4 kW против потерь через оболочку».
 *  - При ДОСТАТОЧНОМ питании регулятор держит уставку точно: в номинале
 *    и в пылевой сезон температура секции — одно и то же значение все
 *    30 солов. Это верное поведение термостата, а не отсутствие инерции:
 *    инерция проявляется тогда, когда мощности не хватает, и именно там
 *    она даёт отложенное последствие.
 *  - Теплица в номинале: лампы 0.52 kW, оболочка −0.32 kW, охлаждение
 *    снимает остальные 0.20 kW. Если охлаждение отказало, избыток
 *    0.20 kW при её теплоёмкости даёт ≈19 °C за сол, пока оболочка не
 *    выйдет на равновесие примерно в 100 °C над наружной температурой.
 *    (Прежний комментарий обещал «за +70 °C за сутки» при 2.7 kW ламп —
 *    ни одна из этих цифр не соответствовала коду.)
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
  s.coolerKw = coolerKw
  s.envelopeKw = envelopeKw
  s.internalHeatKw = internalHeatKw
  return { heaterKw, coolerKw, envelopeKw }
}

/**
 * Перемешивание воздуха. Вентилятор не мгновенный: он раскручивается и
 * останавливается, а stratification развивается постепенно. Поэтому
 * циркуляция идёт к целевой экспонентой с постоянной `circulationTauHours`
 * — так шаг остаётся устойчивым при любом размере подшага.
 *
 * Цель — `poweredFraction`: сколько мощности реально подано на
 * климатический агрегат секции (он же гонит воздух).
 */
export function stepSectionCirculation(s: Section, hours: number, poweredFraction: number): number {
  // Вентилятору нужна некоторая мощность, чтобы вообще крутиться. Доля
  // мощности агрегата — это сколько он потребляет от номинала, а не «на
  // сколько процентов дует вентилятор»: теплица в номинале берёт 0.17 и при
  // этом проветривается полностью. Поэтому ниже порога поток гаснет, а выше
  // порога циркуляция сразу полная.
  const need = Math.max(1e-6, DEEP_P.circulationMinPowerFraction)
  const target = clamp01(poweredFraction / need)
  const tau = Math.max(1e-6, DEEP_P.circulationTauHours)
  const alpha = 1 - Math.exp(-Math.max(0, hours) / tau)
  s.circulation = clamp01(s.circulation + (target - s.circulation) * alpha)
  return s.circulation
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

/**
 * Кислород в корневой зоне: при избыточном поливе субстрат заливается и корни
 * задыхаются. Агрегированная оценка по парциальному давлению O2 и доле перелива.
 */

/**
 * Качество атмосферы 0…1 для интерфейса и последствий (давление, O2, CO2).
 *
 * Суммарные массы газов отвечают за состав, но НЕ за то, чем дышит человек:
 * без перемешивания CO₂ стоит облаком у источника, а кислород расслаивается.
 * Поэтому качество умножается на перемешивание: при работающем вентиляторе
 * множитель равен единице и расчёт совпадает с прежним, при остановленном —
 * опускается до `circulationMinQuality`, и секция с формально верным составом
 * становится непригодной. Это и есть отдельная функция жизнеобеспечения.
 */
export function atmosphereQuality(s: Section): number {
  const o2 = clamp01(fraction(o2PartialKpa(s), DEEP_P.minO2PartialKpa))
  const co2 = clamp01(1 - fraction(Math.max(0, co2PartialKpa(s) - DEEP_P.targetCo2PartialKpa), DEEP_P.maxCo2PartialKpa))
  const pressure = clamp01(fraction(totalPressureKpa(s), DEEP_P.nominalPressureKpa * 0.85))
  const floor = clamp01(DEEP_P.circulationMinQuality)
  const mixing = floor + (1 - floor) * clamp01(s.circulation)
  return clamp01(Math.min(o2, co2, pressure) * mixing)
}

/**
 * Наружная температура: детерминированная суточная кривая + сдвиг сценария.
 *
 * `coldDropC` — знаковый сдвиг в °C: отрицательное значение делает снаружу
 * холоднее. Раньше он вычитался, поэтому сценарий «пылевой сезон» со
 * значением −6 получался на 6 °C ТЕПЛЕЕ номинала и не проверял то, что
 * обещал: пылевое событие должно охлаждать.
 */
export function outsideTemperatureC(solHour: number, coldDropC: number): number {
  const phase = Math.sin(Math.PI * ((solHour / 24.6229) * 2 - 0.5))
  return DEEP_P.outsideMinC + DEEP_P.outsideDayAmplitudeC * Math.max(0, phase) + coldDropC
}

export type PressureBand = 'nominal' | 'low' | 'critical'

/** Температурная кривая роста (совпадает с LAB/2, чтобы не вводить вторую физику). */
export const temperatureGrowthFactor = (celsius: number): number =>
  !Number.isFinite(celsius) || celsius <= 4 || celsius >= 36 ? 0
    : celsius < 16 ? ((celsius - 4) / 12) ** 2 : celsius <= 22 ? 1 : (36 - celsius) / 14
