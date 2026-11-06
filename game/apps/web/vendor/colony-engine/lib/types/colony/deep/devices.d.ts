export type DeviceKind = 'solar' | 'battery' | 'habitat' | 'greenhouse' | 'workshop' | 'lab' | 'o2_gen' | 'scrubber' | 'pump' | 'purifier' | 'recycler' | 'extractor' | 'depot';
export interface Fault {
    /** Код поломки для локализации и тестов. */
    code: string;
    /** Диагностирована ли причина: до осмотра ремонт невозможен. */
    diagnosed: boolean;
    partsNeeded: number;
    repairHours: number;
    sinceSol: number;
    /** Человекочитаемая причина (журнал причин и последствий). */
    cause: string;
}
export interface Device {
    id: string;
    kind: DeviceKind;
    name: string;
    /** Номинальная потребляемая мощность, kW (0 у источников и батарей). */
    ratedKw: number;
    /** Пиковая генерация, kW (только solar). */
    peakKw: number;
    priority: number;
    /** Критическая система: резервируется при дефиците. */
    critical: boolean;
    /** Состояние 0…1. Влияет на производительность и риск отказа. */
    condition: number;
    /** Накопленный износ 0…1. */
    wear: number;
    hoursOperating: number;
    hoursSinceService: number;
    fault: Fault | null;
    enabled: boolean;
    /** Безопасный режим для ремонта: агрегат остановлен сознательно. */
    safeMode: boolean;
    /**
     * Холодный резерв: агрегат стоит готовым и не работает, пока его виды в
     * этой секции исправны. Игрок платит за второй корпус массой, объёмом и
     * обслуживанием — и получает подхват, когда основной встал.
     */
    standby: boolean;
    /**
     * Вычисляется раз в сол: резерв не нужен, поэтому стоит. Производный
     * признак, а не настройка: хранится в агрегате, чтобы `deviceUsable`
     * остался чистым предикатом без доступа к миру.
     */
    standbyIdle: boolean;
    /**
     * Рискованный ремонт: чинить без диагноза и без запчасти, быстро, но
     * агрегат выходит из ремонта недочиненным и может встать снова.
     */
    risky: boolean;
    /**
     * Есть ли подключение по сетям колонии. false — агрегат отсоединён
     * (нет питания/воды/доступа): не потребляет, не выдаёт и не заряжается.
     * Ставится мостом из `networkServices` существующей колонии.
     */
    connected: boolean;
    /**
     * Доля времени подшага, когда агрегату ЕСТЬ что делать (0…1).
     * Оборудование без работы не потребляет номинальную мощность: пустой
     * очиститель не греет базу впустую. Ставит `computeDuty` перед распределением.
     */
    duty: number;
    /** Доля полученной мощности за последний подшаг 0…1 (от номинала). */
    powerFraction: number;
    /** Фактически потреблённая мощность, kW. */
    receivedKw: number;
    sectionId: string | null;
    /** Пыль на панелях 0…1 (только solar). */
    dust: number;
    /** Какая доля потреблённой мощности превращается в тепло. */
    heatFraction: number;
    /** Хранимые параметры по типу: батарея — kWh, резервуар — L. */
    storedKwh: number;
    capacityKwh: number;
    /** Пропущенная энергия для деградации аккумулятора, kWh. */
    throughputKwh: number;
    /** Соответствующий модуль существующей колонии (мост в ColonyState). */
    legacyModuleId?: string;
}
export interface DeviceProfile {
    kind: DeviceKind;
    ratedKw: number;
    peakKw: number;
    priority: number;
    critical: boolean;
    heatFraction: number;
    /**
     * Износ в долях состояния за сол при номинальной нагрузке.
     * Для узлов, у которых есть аналог в существующей колонии, значение взято
     * из `CATALOG.wearDay` (%), чтобы уже настроенный баланс не поехал.
     */
    wearPerSol: number;
    ru: string;
    en: string;
}
/**
 * Профили оборудования. Значения мощностей согласованы с существующей
 * агрегатной моделью колонии, где это возможно; новые агрегаты помечены
 * как игровые допущения.
 */
export declare const DEVICE_PROFILES: Record<DeviceKind, DeviceProfile>;
export declare function createDevice(kind: DeviceKind, name: string, options?: Partial<Omit<Device, 'kind' | 'name'>>): Device;
/** Сбросить счётчик имён (используется тестами для детерминированных id). */
export declare function resetDeviceIds(): void;
/**
 * Агрегат может работать сейчас: включён, не в безопасном режиме, без
 * отказа — и не простаивает в резерве. Резерв, который стоит без дела,
 * не потребляет и не изнашивается; как только основной его вида в секции
 * выбыл, резерв перестаёт быть праздным и берёт нагрузку.
 */
export declare const deviceUsable: (d: Device) => boolean;
/**
 * Пересчитать, какие резервы сейчас нужны. Один раз за сол, до производства.
 * Резерв включается, если в той же секции есть агрегат того же вида, который
 * здоров как узел, но не может работать, либо выбыл сам. Резервы друг друга
 * не подхватывают — иначе два резерва будут ждать третий.
 */
export declare function syncStandby(devices: Device[]): void;
/**
 * Реальная производительность агрегата: доля мощности × состояние.
 * Отдельно от мощности: 0.5 мощности → 0.5 результата, а не полный.
 */
export declare const deviceOutput: (d: Device) => number;
/** Тепловыделение агрегата, kW. Учитывается один раз — здесь, а не в секциях. */
export declare const deviceHeatKw: (d: Device) => number;
/** Устройства, которым положено питание (не источники и не батареи). */
export declare const isGenerator: (d: Device) => boolean;
export declare const isBattery: (d: Device) => boolean;
/** Краткая причина простоя для интерфейса (без моков: реальное состояние). */
