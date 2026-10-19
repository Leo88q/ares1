/**
 * Износ, обслуживание, отказы, диагностика и ремонт.
 *
 * Поломка связана с условиями эксплуатации, нагрузкой и просроченным
 * обслуживанием, а не только с произвольным таймером. Случайное событие
 * использует seeded RNG: тот же seed даёт тот же прогон.
 *
 * Ремонт — не бесплатная мгновенная кнопка: нужен специалист, время, детали,
 * доступ к объекту и (при необходимости) безопасный режим.
 */
import type { Device, Fault } from './devices'
import { DEVICE_PROFILES, deviceUsable } from './devices'
import type { Vehicle } from './machines'
import { DEEP_P } from './params'
import { clamp01, fraction, SOL_HOURS } from './units'
import { hazardProbability, type Rng } from './rng'

export const FAULT_CODES = {
  pumpSeizure: 'pump-seizure',
  beltSlip: 'belt-slip',
  sealLeak: 'seal-leak',
  inverterFault: 'inverter-fault',
  bearingWear: 'bearing-wear',
  filterClog: 'filter-clog',
  controllerFault: 'controller-fault',
  dustShort: 'dust-short',
} as const

const FAULT_BY_KIND: Record<Device['kind'], { code: string; ru: string; en: string }[]> = {
  solar: [{ code: FAULT_CODES.dustShort, ru: 'Пылевой пробой', en: 'Dust short' }],
  battery: [{ code: FAULT_CODES.inverterFault, ru: 'Отказ инвертора', en: 'Inverter fault' }],
  habitat: [{ code: FAULT_CODES.sealLeak, ru: 'Утечка через уплотнение', en: 'Seal leak' }],
  greenhouse: [{ code: FAULT_CODES.controllerFault, ru: 'Отказ контроллера климата', en: 'Climate controller fault' }],
  workshop: [{ code: FAULT_CODES.controllerFault, ru: 'Отказ оснастки', en: 'Tooling fault' }],
  lab: [{ code: FAULT_CODES.controllerFault, ru: 'Сбой измерителя', en: 'Instrument fault' }],
  o2_gen: [{ code: FAULT_CODES.pumpSeizure, ru: 'Заклинивание компрессора', en: 'Compressor seizure' }],
  scrubber: [{ code: FAULT_CODES.filterClog, ru: 'Засор фильтра', en: 'Filter clog' }],
  pump: [{ code: FAULT_CODES.pumpSeizure, ru: 'Заклинивание насоса', en: 'Pump seizure' }, { code: FAULT_CODES.sealLeak, ru: 'Утечка уплотнения', en: 'Seal leak' }],
  purifier: [{ code: FAULT_CODES.filterClog, ru: 'Засор мембраны', en: 'Membrane clog' }],
  recycler: [{ code: FAULT_CODES.filterClog, ru: 'Засор регенератора', en: 'Recycler clog' }],
  extractor: [{ code: FAULT_CODES.bearingWear, ru: 'Износ привода', en: 'Drive wear' }, { code: FAULT_CODES.beltSlip, ru: 'Пробуксовка привода', en: 'Belt slip' }],
  depot: [{ code: FAULT_CODES.controllerFault, ru: 'Сбой учёта склада', en: 'Inventory fault' }],
}

/** Интенсивность отказа за час: база × износ × просрочка обслуживания. */
/** Поднять отказ устройства: причина берётся из профиля вида. */
export function raiseFault(device: Device, rng: Rng): Fault {
  const candidates = FAULT_BY_KIND[device.kind] ?? [{ code: FAULT_CODES.controllerFault, ru: 'Отказ узла', en: 'Unit fault' }]
  const pick = candidates[Math.min(candidates.length - 1, Math.floor(rng.next() * candidates.length))]
  const parts = Math.max(1, Math.round(DEEP_P.repairPartsBase + device.wear * 3))
  const fault: Fault = {
    code: pick.code, diagnosed: false, partsNeeded: parts,
    repairHours: DEEP_P.repairHoursPerPart * parts, sinceSol: 0, cause: pick.ru,
  }
  device.fault = fault
  return fault
}

/** Диагностика: до неё ремонт невозможен (нет списка работ). */
export function diagnoseFault(device: Device): boolean {
  if (!device.fault || device.fault.diagnosed) return false
  device.fault.diagnosed = true
  return true
}

/** Ремонт: нужен диагноз, детали и время. Мгновенного бесплатного ремонта нет. */
export function repairDevice(
  device: Device, partsAvailable: number,
  opts: { risky?: boolean; rng?: Rng } = {},
): { ok: boolean; parts: number; reason: string } {
  const fault = device.fault
  if (!fault) return { ok: false, parts: 0, reason: 'no-fault' }
  // Рискованный ремонт идёт без диагноза: чинят «по symptoms», а не по списку
  // работ. Диагноз — это отдельный выход специалиста и отдельные часы.
  if (!fault.diagnosed && !opts.risky) return { ok: false, parts: 0, reason: 'not-diagnosed' }
  // И без запчасти: перемычка, обмотка, обрезка — но ресурс не вернуть.
  if (!opts.risky && partsAvailable < fault.partsNeeded) return { ok: false, parts: 0, reason: 'no-parts' }
  const parts = opts.risky ? 0 : fault.partsNeeded
  if (!opts.risky && partsAvailable < parts) return { ok: false, parts: 0, reason: 'no-parts' }
  device.fault = null
  device.safeMode = false
  // Рискованный ремонт возвращает лишь долю ресурса: агрегат на ходу, но
  // хрупкий, и следующий отказ придёт раньше.
  const share = opts.risky ? DEEP_P.riskyRepairConditionShare : 1
  device.wear = clamp01(device.wear * (1 - DEEP_P.repairRestoresCondition * share))
  device.condition = clamp01(1 - device.wear)
  device.hoursSinceService = 0
  // И он может не продержаться: перемычка не лечит причину. Отказ приходит
  // немедленно, а не «когда-нибудь» — игрок видит цену решения в тот же сол.
  if (opts.risky && opts.rng && opts.rng.next() < DEEP_P.riskyRepairRefaultChance) {
    // Тот же код поломки: причина не устранена, перемычка лишь сняла симптом.
    device.fault = {
      code: fault.code, diagnosed: false, partsNeeded: fault.partsNeeded,
      repairHours: fault.repairHours, sinceSol: 0,
      cause: 'рискованный ремонт: причина не устранена',
    }
    device.wear = clamp01(device.wear + 0.05)
    device.condition = clamp01(1 - device.wear)
    return { ok: true, parts: 0, reason: 'repaired-risky-refault' }
  }
  return { ok: true, parts, reason: opts.risky ? 'repaired-risky' : 'repaired' }
}

/** Регламентное обслуживание: сбрасывает счётчик и частично возвращает ресурс. */
export function serviceDevice(device: Device): boolean {
  if (device.fault) return false
  device.hoursSinceService = 0
  device.wear = clamp01(device.wear * (1 - DEEP_P.repairRestoresCondition))
  device.condition = clamp01(1 - device.wear)
  return true
}

export function faultHazardPerHour(device: Device): number {
  if (device.fault) return 0
  const overdue = clamp01(fraction(device.hoursSinceService, DEEP_P.serviceIntervalHours) - 1)
  const wear = clamp01(device.wear)
  return DEEP_P.faultBaseHazardPerHour
    * (1 + DEEP_P.faultOverdueMultiplier * overdue)
    * (1 + DEEP_P.faultWearMultiplier * wear)
}

/** Насколько просрочено обслуживание: 0 — вовремя, 1 — в два раза просрочено. */
export const serviceOverdue = (device: Device): number =>
  clamp01(fraction(device.hoursSinceService, DEEP_P.serviceIntervalHours) - 1)

/** Износ за сол при номинальной нагрузке: из профиля вида (согласовано с CATALOG). */
export const wearPerSol = (device: Device): number => DEVICE_PROFILES[device.kind]?.wearPerSol ?? DEEP_P.wearPerOperatingHour * SOL_HOURS

/** Работа в течение `hours` часов с долей нагрузки `load`. */
export function stepDeviceReliability(device: Device, hours: number, load: number, rng: Rng, dustRate: number): void {
  const active = deviceUsable(device) && load > 0
  if (active) {
    const loadFactor = clamp01(load) ** DEEP_P.wearLoadExponent
    const dust = 1 + (DEEP_P.wearDustMultiplier - 1) * clamp01(dustRate)
    device.wear = clamp01(device.wear + wearPerSol(device) * (hours / SOL_HOURS) * loadFactor * dust)
    device.condition = clamp01(1 - device.wear)
    device.hoursOperating += hours
    device.hoursSinceService += hours
  }
  if (device.fault) return
  const hazard = faultHazardPerHour(device)
  if (hazard > 0 && rng.next() < hazardProbability(hazard, hours)) raiseFault(device, rng)
}

/**
 * Износ и отказ машины. Та же модель, что у стационарного оборудования:
 * пробег и пыль ускоряют износ, просроченное обслуживание повышает риск.
 * Машина на ходу изнашивается быстрее стационарного узла (коэффициент 1.4).
 */
export function stepVehicleReliability(vehicle: Vehicle, hours: number, load: number, rng: Rng, dustRate: number): void {
  if (vehicle.fault === null && load > 0) {
    const dust = 1 + (DEEP_P.wearDustMultiplier - 1) * clamp01(dustRate)
    vehicle.wear = clamp01(vehicle.wear + DEEP_P.wearPerOperatingHour * hours * (clamp01(load) ** DEEP_P.wearLoadExponent) * dust * 1.4)
    vehicle.condition = clamp01(1 - vehicle.wear)
    vehicle.hoursSinceService += hours
  }
  if (vehicle.fault) return
  const overdue = clamp01(fraction(vehicle.hoursSinceService, DEEP_P.serviceIntervalHours) - 1)
  const hazard = DEEP_P.faultBaseHazardPerHour
    * (1 + DEEP_P.faultOverdueMultiplier * overdue)
    * (1 + DEEP_P.faultWearMultiplier * clamp01(vehicle.wear))
  if (rng.next() < hazardProbability(hazard, hours)) raiseVehicleFault(vehicle, rng)
}

const VEHICLE_FAULTS = [
  { code: 'traction-drive', ru: 'Отказ тягового привода' },
  { code: 'battery-pack', ru: 'Деградация батареи' },
  { code: 'suspension', ru: 'Поломка подвески' },
]

/** Отказ машины: до диагностики ремонт невозможен, машина стоит. */
export function raiseVehicleFault(vehicle: Vehicle, rng: Rng): Fault {
  const pick = VEHICLE_FAULTS[Math.min(VEHICLE_FAULTS.length - 1, Math.floor(rng.next() * VEHICLE_FAULTS.length))]
  const parts = Math.max(1, Math.round(DEEP_P.repairPartsBase + vehicle.wear * 3))
  const fault: Fault = {
    code: pick.code, diagnosed: false, partsNeeded: parts,
    repairHours: DEEP_P.repairHoursPerPart * parts, sinceSol: 0, cause: pick.ru,
  }
  vehicle.fault = fault
  vehicle.state = 'stalled'
  vehicle.idleReason = 'vehicle-fault'
  if (vehicle.jobId) vehicle.state = 'stalled'
  return fault
}

/** Диагностика машины: до неё ремонт невозможен (нет списка работ). */
export function diagnoseVehicle(vehicle: Vehicle): boolean {
  if (!vehicle.fault || vehicle.fault.diagnosed) return false
  vehicle.fault.diagnosed = true
  return true
}

/** Ремонт машины: нужен диагноз, детали и время; мгновенного ремонта нет. */
export function repairVehicle(vehicle: Vehicle, partsAvailable: number): { ok: boolean; parts: number; reason: string } {
  const fault = vehicle.fault
  if (!fault) return { ok: false, parts: 0, reason: 'no-fault' }
  if (!fault.diagnosed) return { ok: false, parts: 0, reason: 'not-diagnosed' }
  if (partsAvailable < fault.partsNeeded) return { ok: false, parts: 0, reason: 'no-parts' }
  vehicle.fault = null
  vehicle.state = 'idle'
  vehicle.idleReason = null
  vehicle.wear = clamp01(vehicle.wear * (1 - DEEP_P.repairRestoresCondition))
  vehicle.condition = clamp01(1 - vehicle.wear)
  vehicle.hoursSinceService = 0
  return { ok: true, parts: fault.partsNeeded, reason: 'repaired' }
}

/** Обслуживание машины: сбрасывает счётчик и частично возвращает состояние. */
export function serviceVehicle(vehicle: Vehicle): boolean {
  if (vehicle.fault) return false
  vehicle.hoursSinceService = 0
  vehicle.wear = clamp01(vehicle.wear * (1 - DEEP_P.repairRestoresCondition))
  vehicle.condition = clamp01(1 - vehicle.wear)
  return true
}

/** Всё, что требует внимания: отказы, просроченное обслуживание, износ, пыль. */
export function attentionList(world: {
  devices: Device[]
  vehicles: Vehicle[]
}): Array<{ id: string; kind: 'device' | 'vehicle'; reason: string; severity: 'info' | 'warning' | 'critical' }> {
  const out: Array<{ id: string; kind: 'device' | 'vehicle'; reason: string; severity: 'info' | 'warning' | 'critical' }> = []
  for (const device of world.devices) {
    if (device.fault) {
      out.push({
        id: device.id, kind: 'device',
        reason: device.fault.diagnosed ? `Отказ: ${device.fault.code}` : `Отказ не диагностирован (${device.fault.code})`,
        severity: device.priority <= 1 ? 'critical' : 'warning',
      })
      continue
    }
    const overdue = serviceOverdue(device)
    if (overdue > 0) {
      out.push({
        id: device.id, kind: 'device',
        reason: `Обслуживание просрочено на ${Math.round(overdue * DEEP_P.serviceIntervalHours)} ч`,
        severity: overdue > 1 ? 'warning' : 'info',
      })
    }
  }
  for (const vehicle of world.vehicles) {
    if (vehicle.fault) {
      out.push({ id: vehicle.id, kind: 'vehicle', reason: `Отказ: ${vehicle.fault.code}`, severity: 'critical' })
      continue
    }
    const overdue = clamp01(fraction(vehicle.hoursSinceService, DEEP_P.serviceIntervalHours) - 1)
    if (overdue > 0) out.push({ id: vehicle.id, kind: 'vehicle', reason: `ТО просрочено (${Math.round(overdue * 100)} %)`, severity: 'warning' })
  }
  return out
}
