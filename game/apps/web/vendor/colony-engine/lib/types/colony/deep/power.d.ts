import { type Device } from './devices.js';
export interface PowerLoad {
    id: string;
    /** Номинальная мощность агрегата (без учёта занятости). */
    ratedKw: number;
    wantKw: number;
    priority: number;
    critical: boolean;
    powerFraction: number;
    receivedKw: number;
}
export interface PowerResult {
    generationKw: number;
    demandKw: number;
    servedKw: number;
    unmetKw: number;
    curtailedKw: number;
    batteryChargeKwh: number;
    batteryDischargeKwh: number;
    batteryStartKwh: number;
    batteryEndKwh: number;
    batteryCapacityKwh: number;
    /** Отключённые/недопитанные потребители (id) — видно игроку. */
    shed: string[];
    fractions: Record<string, number>;
}
export interface DispatchInput {
    devices: Device[];
    hours: number;
    solHour: number;
    sunHours: number;
    weatherFactor: number;
    /** Доля ёмкости, зарезервированная только под критические системы. */
    criticalReserveFraction: number;
    /**
     * Пропускная способность канала, кВт (§7). Ключ — `legacyModuleId`, поэтому
     * базовая инфраструктура без модуля каналом не ограничена: она стоит на
     * самом хабе.
     */
    networkCapacity?: Record<string, number>;
}
export declare function dispatchPower(input: DispatchInput): PowerResult;
/**
 * Прогноз времени работы от резерва (солы): сколько протянут критические
 * системы на аккумуляторах при текущем потреблении и нулевой генерации.
 */
export declare function reserveSols(devices: readonly Device[]): number;
/** Накопление пыли: генерация падает, чистка возвращает часть потерь. */
export declare function accumulateDust(device: Device, shareOfSol: number, dustRateMultiplier: number): void;
/** Потеря генерации от пыли по всей базе, 0…1. */
export declare const dustLoss: (devices: readonly Device[]) => number;
/** Доля обеспеченности спроса генерацией (для интерфейса). */
