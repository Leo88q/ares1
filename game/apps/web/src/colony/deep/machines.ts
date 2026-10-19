/**
 * Машины и логистика: разведывательная машина, добывающая техника, грузовой ровер.
 *
 * Сырьё НЕ телепортируется с месторождения на склад: нужен рейс, время,
 * энергия и (частью) оператор. Одна машина не участвует в двух рейсах
 * одновременно; груз не дублируется и не переполняет кузов.
 *
 * Проезды, трубы, кабели и гермопереходы — РАЗНЫЕ инфраструктурные сущности:
 * машина ездит по грунту и не заменяет ни одну из сетей.
 */
import { DEEP_P } from './params'
import { clamp01, fraction } from './units'
import type { ResourceId } from './resources'
import type { Fault } from './devices'

export type VehicleClass = 'scout' | 'excavator' | 'hauler'
export type VehicleState = 'idle' | 'travelling' | 'loading' | 'unloading' | 'working' | 'charging' | 'stalled'

export interface VehicleProfile {
  class: VehicleClass
  capacityKg: number
  capacityKwh: number
  speedKmh: number
  kwhPerKm: number
  autonomy: number
  ru: string
  en: string
}

export const VEHICLE_PROFILES: Record<VehicleClass, VehicleProfile> = {
  scout: {
    class: 'scout', capacityKg: DEEP_P.scoutCapacityKg, capacityKwh: DEEP_P.scoutBatteryKwh,
    speedKmh: DEEP_P.scoutSpeedKmh, kwhPerKm: DEEP_P.vehicleKwhPerKm * 0.6, autonomy: DEEP_P.vehicleAutonomy,
    ru: 'Разведывательная машина', en: 'Survey vehicle',
  },
  excavator: {
    class: 'excavator', capacityKg: DEEP_P.excavatorCapacityKg, capacityKwh: DEEP_P.excavatorBatteryKwh,
    speedKmh: DEEP_P.excavatorSpeedKmh, kwhPerKm: DEEP_P.vehicleKwhPerKm * 1.8, autonomy: DEEP_P.vehicleAutonomy,
    ru: 'Добывающая техника', en: 'Excavator',
  },
  hauler: {
    class: 'hauler', capacityKg: DEEP_P.haulerCapacityKg, capacityKwh: DEEP_P.haulerBatteryKwh,
    speedKmh: DEEP_P.haulerSpeedKmh, kwhPerKm: DEEP_P.vehicleKwhPerKm, autonomy: DEEP_P.vehicleAutonomy,
    ru: 'Грузовой ровер', en: 'Cargo rover',
  },
}

export interface Vehicle {
  id: string
  name: string
  class: VehicleClass
  condition: number
  wear: number
  hoursSinceService: number
  fault: Fault | null
  /** Запас энергии, kWh. */
  batteryKwh: number
  capacityKwh: number
  capacityKg: number
  speedKmh: number
  kwhPerKm: number
  /** Груз в кузове, кг. */
  payloadKg: number
  payloadResource: ResourceId | null
  /** Где машина: 'base' или id месторождения. */
  at: string
  /** Куда едет (узел маршрута). */
  destination: string | null
  /** Пройдено от текущего узла, км. */
  travelledKm: number
  /** Длина текущего плеча, км. */
  legKm: number
  state: VehicleState
  jobId: string | null
  operatorId: string | null
  /** Уровень автономности 0…1: доля времени работы без человека. */
  autonomy: number
  odometerKm: number
  /** Часов работы без оператора в текущем рейсе (для требования оператора). */
  unattendedHours: number
  /** Простой по причине (для журнала). */
  idleReason: string | null
  /**
   * Рискованный ремонт: чинить без диагноза и без запчасти, быстро, но
   * машина выходит недочиненной и может встать снова. Решение игрока, а не
   * автоматическая политика — отказ ровера стоит дороже отказа насоса.
   */
  risky: boolean
}

export function createVehicle(id: string, name: string, vehicleClass: VehicleClass): Vehicle {
  const profile = VEHICLE_PROFILES[vehicleClass]
  return {
    id, name, class: vehicleClass,
    condition: 1, wear: 0, hoursSinceService: 0, fault: null,
    batteryKwh: profile.capacityKwh, capacityKwh: profile.capacityKwh,
    capacityKg: profile.capacityKg, speedKmh: profile.speedKmh, kwhPerKm: profile.kwhPerKm,
    payloadKg: 0, payloadResource: null,
    at: 'base', destination: null, travelledKm: 0, legKm: 0,
    state: 'idle', jobId: null, operatorId: null,
    autonomy: profile.autonomy, odometerKm: 0, unattendedHours: 0, idleReason: null,
    risky: false,
  }
}

export type HaulPhase = 'to_pickup' | 'loading' | 'to_drop' | 'unloading' | 'done'

export interface HaulJob {
  id: string
  vehicleId: string
  /** Узел отправления: 'base' или id месторождения. */
  from: string
  to: string
  resource: ResourceId
  /** Сколько запрошено к перевозке, кг. */
  requestedKg: number
  loadedKg: number
  deliveredKg: number
  phase: HaulPhase
  taskId: string | null
  createdSol: number
  /** Расстояние плеча «откуда» → «куда», км. */
  legKm: number
}

export interface HaulHandlers {
  /** Взять груз в узле `node`. Возвращает фактически погружённое, кг. */
  pickUp(node: string, resource: ResourceId, kg: number): number
  /** Отдать груз в узле `node`. Возвращает фактически принятое, кг. */
  dropOff(node: string, resource: ResourceId, kg: number): number
  /** Расстояние между узлами, км. */
  distanceKm(from: string, to: string): number
}

/** Свободное место в кузове, кг. */
export const payloadRoom = (vehicle: Vehicle): number => Math.max(0, vehicle.capacityKg - vehicle.payloadKg)
/** Машина может работать: нет отказа, есть энергия. */
export const vehicleUsable = (vehicle: Vehicle): boolean => vehicle.fault === null && vehicle.batteryKwh > 0.01

const travelKwh = (vehicle: Vehicle, km: number): number => km * vehicle.kwhPerKm * (2 - clamp01(vehicle.condition))

/**
 * Один шаг рейса. Возвращает, сколько часов реально потрачено и что произошло.
 * Груз не дублируется: погрузка уменьшает склад источника, разгрузка
 * увеличивает склад приёмника ровно на принятое количество.
 */
export function stepHaulJob(
  job: HaulJob, vehicle: Vehicle, hours: number, handlers: HaulHandlers, operatorPresent: boolean,
): { hoursUsed: number; notes: string[] } {
  const notes: string[] = []
  if (!vehicleUsable(vehicle)) {
    vehicle.state = vehicle.fault ? 'stalled' : 'charging'
    vehicle.idleReason = vehicle.fault ? 'vehicle-fault' : 'vehicle-no-energy'
    return { hoursUsed: 0, notes: [vehicle.idleReason ?? 'idle'] }
  }
  let remaining = Math.max(0, hours)
  let guard = 0
  while (remaining > 1e-9 && job.phase !== 'done' && guard++ < 8) {
    if (job.phase === 'to_pickup' || job.phase === 'to_drop') {
      const target = job.phase === 'to_pickup' ? job.from : job.to
      if (vehicle.at === target) {
        job.phase = job.phase === 'to_pickup' ? 'loading' : 'unloading'
        vehicle.destination = null
        vehicle.travelledKm = 0
        continue
      }
      if (vehicle.legKm <= 0 || vehicle.destination !== target) {
        vehicle.legKm = handlers.distanceKm(vehicle.at, target)
        vehicle.destination = target
        vehicle.travelledKm = 0
      }
      const leftKm = Math.max(0, vehicle.legKm - vehicle.travelledKm)
      const hoursNeeded = vehicle.speedKmh > 0 ? leftKm / vehicle.speedKmh : Infinity
      const drive = Math.min(remaining, hoursNeeded)
      const km = drive * vehicle.speedKmh
      const energy = travelKwh(vehicle, km)
      if (energy > vehicle.batteryKwh) {
        // Энергии не хватает: машина идёт, пока может, потом встаёт.
        const possibleKm = vehicle.kwhPerKm > 0 ? vehicle.batteryKwh / (vehicle.kwhPerKm * (2 - clamp01(vehicle.condition))) : 0
        const partialHours = vehicle.speedKmh > 0 ? possibleKm / vehicle.speedKmh : 0
        vehicle.batteryKwh = 0
        vehicle.travelledKm += Math.min(leftKm, possibleKm)
        vehicle.odometerKm += Math.min(leftKm, possibleKm)
        vehicle.state = 'charging'
        vehicle.idleReason = 'vehicle-no-energy'
        notes.push('vehicle-no-energy')
        return { hoursUsed: hours - remaining + Math.min(partialHours, remaining), notes }
      }
      vehicle.batteryKwh -= energy
      vehicle.travelledKm += km
      vehicle.odometerKm += km
      vehicle.state = 'travelling'
      vehicle.unattendedHours += operatorPresent ? 0 : drive
      remaining -= drive
      if (vehicle.travelledKm >= vehicle.legKm - 1e-9) {
        vehicle.at = target
        vehicle.destination = null
        vehicle.travelledKm = 0
        vehicle.legKm = 0
        notes.push('arrived')
      }
      continue
    }
    if (job.phase === 'loading') {
      const room = payloadRoom(vehicle)
      const want = Math.min(job.requestedKg - job.loadedKg, room, DEEP_P.extractionRateKgPerHour * remaining)
      if (want <= 1e-9) {
        job.phase = 'to_drop'
        continue
      }
      const got = handlers.pickUp(job.from, job.resource, want)
      if (got <= 1e-9) {
        notes.push('nothing-to-load')
        job.phase = 'to_drop'
        continue
      }
      vehicle.payloadKg += got
      vehicle.payloadResource = job.resource
      job.loadedKg += got
      vehicle.state = 'loading'
      const spent = Math.max(0.05, got / DEEP_P.extractionRateKgPerHour)
      remaining -= Math.min(remaining, spent)
      if (job.loadedKg >= job.requestedKg - 1e-9 || room - got <= 1e-9) job.phase = 'to_drop'
      continue
    }
    if (job.phase === 'unloading') {
      const amount = Math.min(vehicle.payloadKg, DEEP_P.extractionRateKgPerHour * remaining)
      if (amount <= 1e-9) { job.phase = 'done'; continue }
      const accepted = handlers.dropOff(job.to, job.resource, amount)
      if (accepted <= 1e-9) {
        notes.push('storage-full')
        vehicle.state = 'idle'
        vehicle.idleReason = 'storage-full'
        return { hoursUsed: hours - remaining, notes }
      }
      vehicle.payloadKg = Math.max(0, vehicle.payloadKg - accepted)
      job.deliveredKg += accepted
      vehicle.state = 'unloading'
      remaining -= Math.max(0.05, accepted / DEEP_P.extractionRateKgPerHour)
      if (vehicle.payloadKg <= 1e-9) {
        vehicle.payloadResource = null
        job.phase = 'done'
      }
      continue
    }
    break
  }
  if (job.phase === 'done') {
    vehicle.state = 'idle'
    vehicle.jobId = null
    vehicle.idleReason = null
    vehicle.unattendedHours = 0
  }
  return { hoursUsed: hours - remaining, notes }
}

/** Зарядка на базе: расход энергии базы, возврат в строй. */
export function chargeVehicle(vehicle: Vehicle, kwh: number): number {
  const room = Math.max(0, vehicle.capacityKwh - vehicle.batteryKwh)
  const taken = Math.min(room, Math.max(0, kwh))
  vehicle.batteryKwh += taken
  if (vehicle.batteryKwh > 0.01 && vehicle.state === 'charging' && vehicle.fault === null) {
    vehicle.state = 'idle'
    vehicle.idleReason = null
  }
  return taken
}

/** Требуется ли оператор прямо сейчас: автономность не бесконечна. */
export function needsOperator(vehicle: Vehicle): boolean {
  return vehicle.unattendedHours > DEEP_P.crewWorkHoursPerSol * vehicle.autonomy
}

/** Расстояние «в одну сторону» до узла, км (для планирования рейса). */
export const legDistance = (job: HaulJob): number => job.legKm

/** Оценка длительности рейса, часы. */
export function estimateTripHours(vehicle: Vehicle, distanceKm: number, kg: number): number {
  const drive = vehicle.speedKmh > 0 ? (distanceKm * 2) / vehicle.speedKmh : 0
  const handling = 2 * DEEP_P.vehicleLoadUnloadHours + kg / Math.max(1, DEEP_P.extractionRateKgPerHour)
  return drive + handling
}

/** Запас хода, км, при текущем заряде. */
export const rangeKm = (vehicle: Vehicle): number =>
  vehicle.kwhPerKm > 0 ? vehicle.batteryKwh / (vehicle.kwhPerKm * (2 - clamp01(vehicle.condition))) : 0

/** Доля заряда 0…1. */
export const chargeRatio = (vehicle: Vehicle): number => fraction(vehicle.batteryKwh, vehicle.capacityKwh)

/** Простой машины по причине — агрегированное отображение «работа/простой». */
export function vehicleStatus(vehicle: Vehicle): { state: VehicleState; reason: string | null } {
  if (vehicle.fault) return { state: 'stalled', reason: vehicle.fault.diagnosed ? 'fault-diagnosed' : 'fault-undiagnosed' }
  if (vehicle.batteryKwh <= 0.01) return { state: 'stalled', reason: 'no-energy' }
  if (needsOperator(vehicle)) return { state: 'idle', reason: 'no-operator' }
  return { state: vehicle.state, reason: vehicle.idleReason }
}
