/**
 * Оборудование колонии: одна карточка на каждый агрегат, одна модель износа.
 *
 * Устройство разделяет **мощность** (kW), **энергию** (kWh) и
 * **производительность** (L/h, kg/h): если агрегат половину шага работал на
 * половине доступной мощности, он не выдаёт полный результат.
 */
import { DEEP_P } from './params'
import { clamp01 } from './units'

export type DeviceKind =
  | 'solar' | 'battery' | 'habitat' | 'greenhouse' | 'workshop' | 'lab'
  | 'o2_gen' | 'scrubber' | 'pump' | 'purifier' | 'recycler' | 'extractor' | 'depot'

/** Приоритеты потребителей: меньше = важнее. Отключения идут снизу вверх. */
const POWER_PRIORITY = {
  lifeSupport: 1,
  water: 2,
  crop: 3,
  workshop: 4,
  extraction: 5,
  logistics: 6,
} as const

export interface Fault {
  /** Код поломки для локализации и тестов. */
  code: string
  /** Диагностирована ли причина: до осмотра ремонт невозможен. */
  diagnosed: boolean
  partsNeeded: number
  repairHours: number
  sinceSol: number
  /** Человекочитаемая причина (журнал причин и последствий). */
  cause: string
}

export interface Device {
  id: string
  kind: DeviceKind
  name: string
  /** Номинальная потребляемая мощность, kW (0 у источников и батарей). */
  ratedKw: number
  /** Пиковая генерация, kW (только solar). */
  peakKw: number
  priority: number
  /** Критическая система: резервируется при дефиците. */
  critical: boolean
  /** Состояние 0…1. Влияет на производительность и риск отказа. */
  condition: number
  /** Накопленный износ 0…1. */
  wear: number
  hoursOperating: number
  hoursSinceService: number
  fault: Fault | null
  enabled: boolean
  /** Безопасный режим для ремонта: агрегат остановлен сознательно. */
  safeMode: boolean
  /**
   * Холодный резерв: агрегат стоит готовым и не работает, пока его виды в
   * этой секции исправны. Игрок платит за второй корпус массой, объёмом и
   * обслуживанием — и получает подхват, когда основной встал.
   */
  standby: boolean
  /**
   * Вычисляется раз в сол: резерв не нужен, поэтому стоит. Производный
   * признак, а не настройка: хранится в агрегате, чтобы `deviceUsable`
   * остался чистым предикатом без доступа к миру.
   */
  standbyIdle: boolean
  /**
   * Рискованный ремонт: чинить без диагноза и без запчасти, быстро, но
   * агрегат выходит из ремонта недочиненным и может встать снова.
   */
  risky: boolean
  /**
   * Есть ли подключение по сетям колонии. false — агрегат отсоединён
   * (нет питания/воды/доступа): не потребляет, не выдаёт и не заряжается.
   * Ставится мостом из `networkServices` существующей колонии.
   */
  connected: boolean
  /**
   * Доля времени подшага, когда агрегату ЕСТЬ что делать (0…1).
   * Оборудование без работы не потребляет номинальную мощность: пустой
   * очиститель не греет базу впустую. Ставит `computeDuty` перед распределением.
   */
  duty: number
  /** Доля полученной мощности за последний подшаг 0…1 (от номинала). */
  powerFraction: number
  /** Фактически потреблённая мощность, kW. */
  receivedKw: number
  sectionId: string | null
  /** Пыль на панелях 0…1 (только solar). */
  dust: number
  /** Какая доля потреблённой мощности превращается в тепло. */
  heatFraction: number
  /** Хранимые параметры по типу: батарея — kWh, резервуар — L. */
  storedKwh: number
  capacityKwh: number
  /** Пропущенная энергия для деградации аккумулятора, kWh. */
  throughputKwh: number
  /** Соответствующий модуль существующей колонии (мост в ColonyState). */
  legacyModuleId?: string
}

export interface DeviceProfile {
  kind: DeviceKind
  ratedKw: number
  peakKw: number
  priority: number
  critical: boolean
  heatFraction: number
  /**
   * Износ в долях состояния за сол при номинальной нагрузке.
   * Для узлов, у которых есть аналог в существующей колонии, значение взято
   * из `CATALOG.wearDay` (%), чтобы уже настроенный баланс не поехал.
   */
  wearPerSol: number
  ru: string
  en: string
}

/**
 * Профили оборудования. Значения мощностей согласованы с существующей
 * агрегатной моделью колонии, где это возможно; новые агрегаты помечены
 * как игровые допущения.
 */
export const DEVICE_PROFILES: Record<DeviceKind, DeviceProfile> = {
  solar: { kind: 'solar', ratedKw: 0, peakKw: DEEP_P.solarPeakKw, priority: 0, critical: false, heatFraction: 0, wearPerSol: 0.0025, ru: 'Солнечная батарея', en: 'Solar array' },
  battery: { kind: 'battery', ratedKw: 0, peakKw: 0, priority: 0, critical: false, heatFraction: 0.04, wearPerSol: 0.0015, ru: 'Аккумулятор', en: 'Battery' },
  habitat: { kind: 'habitat', ratedKw: 1.0, peakKw: 0, priority: POWER_PRIORITY.lifeSupport, critical: true, heatFraction: 0.6, wearPerSol: 0.0015, ru: 'Жилой модуль', en: 'Habitat' },
  greenhouse: { kind: 'greenhouse', ratedKw: 4.16, peakKw: 0, priority: POWER_PRIORITY.crop, critical: false, heatFraction: 0.65, wearPerSol: 0.004, ru: 'Теплица', en: 'Greenhouse' },
  workshop: { kind: 'workshop', ratedKw: 0.6, peakKw: 0, priority: POWER_PRIORITY.workshop, critical: false, heatFraction: 0.35, wearPerSol: 0.002, ru: 'Мастерская', en: 'Workshop' },
  lab: { kind: 'lab', ratedKw: 0.5, peakKw: 0, priority: POWER_PRIORITY.workshop, critical: false, heatFraction: 0.3, wearPerSol: 0.002, ru: 'Лаборатория', en: 'Laboratory' },
  o2_gen: { kind: 'o2_gen', ratedKw: 1.2, peakKw: 0, priority: POWER_PRIORITY.lifeSupport, critical: true, heatFraction: 0.4, wearPerSol: 0.003, ru: 'Кислородная установка', en: 'Oxygen generator' },
  scrubber: { kind: 'scrubber', ratedKw: 0.45, peakKw: 0, priority: POWER_PRIORITY.lifeSupport, critical: true, heatFraction: 0.3, wearPerSol: 0.003, ru: 'Скруббер CO₂', en: 'CO₂ scrubber' },
  pump: { kind: 'pump', ratedKw: 0.35, peakKw: 0, priority: POWER_PRIORITY.water, critical: false, heatFraction: 0.4, wearPerSol: 0.003, ru: 'Насос', en: 'Water pump' },
  purifier: { kind: 'purifier', ratedKw: 0.5, peakKw: 0, priority: POWER_PRIORITY.water, critical: false, heatFraction: 0.3, wearPerSol: 0.003, ru: 'Очистка воды', en: 'Water purifier' },
  recycler: { kind: 'recycler', ratedKw: 0.4, peakKw: 0, priority: POWER_PRIORITY.water, critical: false, heatFraction: 0.3, wearPerSol: 0.003, ru: 'Регенерация стоков', en: 'Grey-water recycler' },
  extractor: { kind: 'extractor', ratedKw: 1.1, peakKw: 0, priority: POWER_PRIORITY.extraction, critical: false, heatFraction: 0.45, wearPerSol: 0.0045, ru: 'Добывающая установка', en: 'Extraction rig' },
  depot: { kind: 'depot', ratedKw: 0.25, peakKw: 0, priority: POWER_PRIORITY.logistics, critical: false, heatFraction: 0.2, wearPerSol: 0.0015, ru: 'Склад', en: 'Depot' },
}

let deviceCounter = 0

export function createDevice(
  kind: DeviceKind, name: string, options: Partial<Omit<Device, 'kind' | 'name'>> = {},
): Device {
  const profile = DEVICE_PROFILES[kind]
  deviceCounter += 1
  return {
    id: options.id ?? `${kind}-${deviceCounter}`,
    kind, name,
    ratedKw: options.ratedKw ?? profile.ratedKw,
    peakKw: options.peakKw ?? profile.peakKw,
    priority: options.priority ?? profile.priority,
    critical: options.critical ?? profile.critical,
    condition: options.condition ?? 1,
    wear: 0,
    hoursOperating: 0, hoursSinceService: 0,
    fault: null,
    enabled: options.enabled ?? true,
    safeMode: false,
    standby: options.standby ?? false,
    standbyIdle: false,
    risky: false,
    connected: options.connected ?? true,
    duty: 1,
    powerFraction: 0, receivedKw: 0,
    sectionId: options.sectionId ?? null,
    dust: options.dust ?? 0,
    heatFraction: options.heatFraction ?? profile.heatFraction,
    storedKwh: options.storedKwh ?? 0,
    capacityKwh: options.capacityKwh ?? (kind === 'battery' ? DEEP_P.batteryCapacityKwh : 0),
    throughputKwh: 0,
    ...(options.legacyModuleId ? { legacyModuleId: options.legacyModuleId } : {}),
  }
}

/** Сбросить счётчик имён (используется тестами для детерминированных id). */
export function resetDeviceIds(): void {
  deviceCounter = 0
}

/** Состояние агрегата без учёта резерва: для подсчёта «нужен ли подхват». */
const deviceHealthy = (d: Device): boolean =>
  d.enabled && d.connected && !d.safeMode && d.fault === null

/**
 * Агрегат может работать сейчас: включён, не в безопасном режиме, без
 * отказа — и не простаивает в резерве. Резерв, который стоит без дела,
 * не потребляет и не изнашивается; как только основной его вида в секции
 * выбыл, резерв перестаёт быть праздным и берёт нагрузку.
 */
export const deviceUsable = (d: Device): boolean => deviceHealthy(d) && !d.standbyIdle

/**
 * Пересчитать, какие резервы сейчас нужны. Один раз за сол, до производства.
 * Резерв включается, если в той же секции есть агрегат того же вида, который
 * здоров как узел, но не может работать, либо выбыл сам. Резервы друг друга
 * не подхватывают — иначе два резерва будут ждать третий.
 */
export function syncStandby(devices: Device[]): void {
  for (const d of devices) {
    if (!d.standby) { d.standbyIdle = false; continue }
    const needed = devices.some(o => o !== d && o.kind === d.kind && o.sectionId === d.sectionId
      && !o.standby && !deviceHealthy(o))
    d.standbyIdle = !needed
  }
}

/**
 * Реальная производительность агрегата: доля мощности × состояние.
 * Отдельно от мощности: 0.5 мощности → 0.5 результата, а не полный.
 */
export const deviceOutput = (d: Device): number => deviceUsable(d) ? clamp01(d.powerFraction) * clamp01(d.condition) : 0

/** Тепловыделение агрегата, kW. Учитывается один раз — здесь, а не в секциях. */
export const deviceHeatKw = (d: Device): number => d.receivedKw * d.heatFraction

/** Устройства, которым положено питание (не источники и не батареи). */

export const isGenerator = (d: Device): boolean => d.kind === 'solar'
export const isBattery = (d: Device): boolean => d.kind === 'battery'

/** Краткая причина простоя для интерфейса (без моков: реальное состояние). */
