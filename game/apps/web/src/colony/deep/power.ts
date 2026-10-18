/**
 * Энергосистема: генерация, аккумуляторы, приоритеты потребителей, отключения.
 *
 * Разделены три разные величины, которые нельзя смешивать:
 *  - **мощность** (kW) — мгновенная;
 *  - **энергия** (kWh) — запас и её расход за шаг;
 *  - **производительность** (L/h, kg/h) — результат работы агрегата.
 *
 * Агрегат, который половину шага работал на половине доступной мощности,
 * выдаёт половину результата, а не полный.
 *
 * Упрощения, зафиксированные явно:
 *  - `sunHours` — «эквивалентные часы полного солнца за сол» (параметр
 *    существующей колонии). Суточная энергия батареи равна peakKw × sunHours ×
 *    состояние × (1 − пыль) × погода; мгновенная мощность выводится
 *    нормировкой суточного профиля и при sunHours > 9.1 формально превышает
 *    номинальную пиковую мощность. Это упрощение агрегатной модели, а не
 *    измеренная инсоляция Марса.
 *  - сеть не имеет инженерной электромагнитной модели: один кабель выдерживает
 *    `cableLimitKw`, и это ограничение видно игроку.
 */
import { DEEP_P } from './params'
import { SOL_HOURS, clamp01, fraction } from './units'
import { deviceUsable, isBattery, isGenerator, type Device } from './devices'

/** Доля сола со светом. */
export const LIT_FRACTION = 1 - DEEP_P.solarNightFraction
export const LIT_HOURS = SOL_HOURS * LIT_FRACTION

/**
 * Мгновенная мощность одной солнечной батареи, kW.
 * Профиль нормирован так, что интеграл за сол = peakKw × sunHours × (1 − dust).
 */
export function solarOutputKw(device: Device, solHour: number, sunHours: number, weatherFactor: number): number {
  if (!isGenerator(device) || !deviceUsable(device)) return 0
  const start = (SOL_HOURS - LIT_HOURS) / 2
  const t = (solHour - start) / LIT_HOURS
  if (t <= 0 || t >= 1) return 0
  const shape = Math.sin(Math.PI * t)
  const amplitude = (sunHours / LIT_HOURS) * (Math.PI / 2)
  return Math.max(0, device.peakKw * shape * amplitude * (1 - clamp01(device.dust)) * clamp01(device.condition) * clamp01(weatherFactor))
}

/** Суточная выработка батареи, kWh (совпадает с агрегатной моделью колонии). */
export const solarDailyKwh = (device: Device, sunHours: number, weatherFactor: number): number =>
  isGenerator(device) ? device.peakKw * sunHours * (1 - clamp01(device.dust)) * clamp01(device.condition) * clamp01(weatherFactor) : 0

export interface PowerLoad {
  id: string
  /** Номинальная мощность агрегата (без учёта занятости). */
  ratedKw: number
  wantKw: number
  priority: number
  critical: boolean
  powerFraction: number
  receivedKw: number
}

export interface PowerResult {
  generationKw: number
  demandKw: number
  servedKw: number
  unmetKw: number
  curtailedKw: number
  batteryChargeKwh: number
  batteryDischargeKwh: number
  batteryStartKwh: number
  batteryEndKwh: number
  batteryCapacityKwh: number
  /** Отключённые/недопитанные потребители (id) — видно игроку. */
  shed: string[]
  fractions: Record<string, number>
}

export interface DispatchInput {
  devices: Device[]
  hours: number
  solHour: number
  sunHours: number
  weatherFactor: number
  /** Доля ёмкости, зарезервированная только под критические системы. */
  criticalReserveFraction: number
}

const dischargeLimitKw = (battery: Device): number => battery.capacityKwh * DEEP_P.batteryC_rate
const chargeRoomKwh = (battery: Device): number => Math.max(0, battery.capacityKwh - battery.storedKwh)

/** Распределение энергии за подшаг: приоритеты, резерв критических систем, отключения. */
export function dispatchPower(input: DispatchInput): PowerResult {
  const { devices, hours, solHour, sunHours, weatherFactor, criticalReserveFraction } = input
  const generators = devices.filter(d => isGenerator(d) && d.connected)
  const batteries = devices.filter(d => isBattery(d) && d.connected)
  const consumers = devices
    .filter(d => d.ratedKw > 0 && deviceUsable(d))
    .map<PowerLoad>(d => ({
      id: d.id, ratedKw: d.ratedKw,
      // Агрегат без работы не тянет номинальную мощность.
      wantKw: d.ratedKw * clamp01(d.duty ?? 1), priority: d.priority, critical: d.critical,
      powerFraction: 0, receivedKw: 0,
    }))
    .sort((a, b) => (a.priority - b.priority) || (a.id < b.id ? -1 : 1))

  const generationKw = generators.reduce((sum, d) => sum + solarOutputKw(d, solHour, sunHours, weatherFactor), 0)
  let remainingGenKwh = generationKw * hours
  const batteryStartKwh = batteries.reduce((sum, b) => sum + b.storedKwh, 0)
  const batteryCapacityKwh = batteries.reduce((sum, b) => sum + b.capacityKwh, 0)
  const reserveKwh = batteryCapacityKwh * clamp01(criticalReserveFraction)
  let soc = batteryStartKwh
  let batteryDischargeKwh = 0
  const shed: string[] = []

  const demandKw = consumers.reduce((sum, load) => sum + load.wantKw, 0)

  for (const load of consumers) {
    const wantKwh = load.wantKw * hours
    if (wantKwh <= 0) continue
    const usableSoc = load.critical ? soc : Math.max(0, soc - reserveKwh)
    const maxDischargeKw = batteries.reduce((sum, b) => sum + (deviceUsable(b) ? dischargeLimitKw(b) : 0), 0)
    const fromBatteryKwh = Math.min(usableSoc, maxDischargeKw * hours)
    const deliverable = remainingGenKwh + fromBatteryKwh * DEEP_P.batteryDischargeEff
    const givenKwh = Math.min(wantKwh, deliverable)
    const fromGen = Math.min(remainingGenKwh, givenKwh)
    const dischargeKwh = (givenKwh - fromGen) / DEEP_P.batteryDischargeEff
    remainingGenKwh -= fromGen
    soc -= dischargeKwh
    batteryDischargeKwh += dischargeKwh
    load.receivedKw = hours > 0 ? givenKwh / hours : 0
    // Доля мощности считается от НОМИНАЛА: агрегат на половине времени
    // выдаёт половину результата, а не полный.
    load.powerFraction = load.ratedKw > 0 ? clamp01(load.receivedKw / load.ratedKw) : 0
    if (load.wantKw > 0 && load.receivedKw < load.wantKw - 1e-9) shed.push(load.id)
  }

  // Заряд излишком: ограничен свободным местом и пределом мощности.
  const maxChargeKw = batteries.reduce((sum, b) => sum + (deviceUsable(b) ? dischargeLimitKw(b) : 0), 0)
  const roomKwh = batteries.reduce((sum, b) => sum + (deviceUsable(b) ? chargeRoomKwh(b) : 0), 0)
  const wantedChargeKwh = Math.min(remainingGenKwh, maxChargeKw * hours, roomKwh / DEEP_P.batteryChargeEff)
  const storedKwh = wantedChargeKwh * DEEP_P.batteryChargeEff
  const curtailedKwh = Math.max(0, remainingGenKwh - wantedChargeKwh)

  // Запись результата в устройства и деградация аккумуляторов.
  const fractions: Record<string, number> = {}
  for (const load of consumers) fractions[load.id] = load.powerFraction
  for (const device of devices) {
    if (device.ratedKw > 0) {
      device.powerFraction = deviceUsable(device) ? (fractions[device.id] ?? 0) : 0
      device.receivedKw = device.powerFraction * device.ratedKw
    } else {
      device.powerFraction = isGenerator(device) ? (device.peakKw > 0 ? solarOutputKw(device, solHour, sunHours, weatherFactor) / device.peakKw : 0) : 0
      device.receivedKw = 0
    }
  }
  const batteryEndKwh = Math.max(0, soc + storedKwh)
  // Раздача заряда по свободному месту, а не пропорционально текущему заряду:
  // при пропорциональной раздаче аккумулятор, севший в ноль, больше никогда не
  // заряжается (0 × scale = 0), и база навсегда теряет его ёмкость — именно так
  // две из трёх батарей эксперимента простояли 180 солов пустыми.
  const rooms = batteries.map(b => (deviceUsable(b) ? Math.max(0, chargeRoomKwh(b)) : 0))
  const totalRoom = rooms.reduce((sum, room) => sum + room, 0)
  for (const battery of batteries) battery.storedKwh = 0
  let toPlace = batteryEndKwh
  // Первый проход — пропорционально свободному месту, второй — добор остатка
  // в любое оставшееся место. Без добора хвост упирался в ёмкость последней
  // батареи и пропадал: банка теряла энергию, которой было достаточно.
  for (let pass = 0; pass < 2 && toPlace > 1e-9; pass++) {
    for (let i = 0; i < batteries.length; i++) {
      const room = Math.max(0, chargeRoomKwh(batteries[i]))
      if (room <= 1e-9) continue
      const want = pass === 0 && totalRoom > 0 ? batteryEndKwh * (rooms[i] / totalRoom) : toPlace
      const put = Math.min(want, room, toPlace)
      batteries[i].storedKwh = Math.min(batteries[i].capacityKwh, batteries[i].storedKwh + put)
      toPlace -= put
    }
  }
  for (const battery of batteries) {
    const throughput = batteryDischargeKwh + wantedChargeKwh
    battery.throughputKwh += throughput
    if (throughput > 0) {
      battery.capacityKwh = Math.max(battery.capacityKwh * 0.6, battery.capacityKwh - DEEP_P.batteryWearPerKwh * throughput)
      battery.storedKwh = Math.min(battery.storedKwh, battery.capacityKwh)
    }
  }

  const servedKw = consumers.reduce((sum, load) => sum + load.receivedKw, 0)
  return {
    generationKw, demandKw, servedKw,
    unmetKw: Math.max(0, demandKw - servedKw),
    curtailedKw: curtailedKwh,
    batteryChargeKwh: wantedChargeKwh,
    batteryDischargeKwh,
    batteryStartKwh, batteryEndKwh, batteryCapacityKwh,
    shed,
    fractions,
  }
}

/**
 * Прогноз времени работы от резерва (солы): сколько протянут критические
 * системы на аккумуляторах при текущем потреблении и нулевой генерации.
 */
export function reserveSols(devices: readonly Device[]): number {
  const criticalKw = devices.filter(d => d.ratedKw > 0 && d.critical).reduce((sum, d) => sum + d.ratedKw, 0)
  const stored = devices.filter(isBattery).reduce((sum, b) => sum + b.storedKwh, 0)
  if (criticalKw <= 0) return Infinity
  return (stored * DEEP_P.batteryDischargeEff) / (criticalKw * SOL_HOURS)
}

/** Накопление пыли: генерация падает, чистка возвращает часть потерь. */
export function accumulateDust(device: Device, shareOfSol: number, dustRateMultiplier: number): void {
  if (!isGenerator(device)) return
  device.dust = clamp01(device.dust + DEEP_P.dustAccumulationPerSol * shareOfSol * dustRateMultiplier)
}

export function cleanPanels(device: Device): number {
  if (!isGenerator(device)) return 0
  const before = device.dust
  device.dust = clamp01(device.dust * (1 - DEEP_P.dustCleanRestore))
  return before - device.dust
}

/** Потеря генерации от пыли по всей базе, 0…1. */
export const dustLoss = (devices: readonly Device[]): number => {
  const arrays = devices.filter(isGenerator)
  if (!arrays.length) return 0
  return arrays.reduce((sum, d) => sum + clamp01(d.dust), 0) / arrays.length
}

/** Доля обеспеченности спроса генерацией (для интерфейса). */
export const supplyAdequacy = (result: PowerResult): number => fraction(result.servedKw, result.demandKw)
