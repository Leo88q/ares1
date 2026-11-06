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
import type { Device } from './devices.js';
import type { Vehicle } from './machines.js';
import { type Rng } from './rng.js';
/** Диагностика: до неё ремонт невозможен (нет списка работ). */
export declare function diagnoseFault(device: Device): boolean;
/** Ремонт: нужен диагноз, детали и время. Мгновенного бесплатного ремонта нет. */
export declare function repairDevice(device: Device, partsAvailable: number, opts?: {
    risky?: boolean;
    rng?: Rng;
}): {
    ok: boolean;
    parts: number;
    reason: string;
};
/** Регламентное обслуживание: сбрасывает счётчик и частично возвращает ресурс. */
export declare function serviceDevice(device: Device): boolean;
/** Износ за сол при номинальной нагрузке: из профиля вида (согласовано с CATALOG). */
export declare const wearPerSol: (device: Device) => number;
/** Работа в течение `hours` часов с долей нагрузки `load`. */
export declare function stepDeviceReliability(device: Device, hours: number, load: number, rng: Rng, dustRate: number): void;
/**
 * Износ и отказ машины. Та же модель, что у стационарного оборудования:
 * пробег и пыль ускоряют износ, просроченное обслуживание повышает риск.
 * Машина на ходу изнашивается быстрее стационарного узла (коэффициент 1.4).
 */
export declare function stepVehicleReliability(vehicle: Vehicle, hours: number, load: number, rng: Rng, dustRate: number): void;
/** Диагностика машины: до неё ремонт невозможен (нет списка работ). */
export declare function diagnoseVehicle(vehicle: Vehicle): boolean;
/** Ремонт машины: нужен диагноз, детали и время; мгновенного ремонта нет. */
export declare function repairVehicle(vehicle: Vehicle, partsAvailable: number): {
    ok: boolean;
    parts: number;
    reason: string;
};
/** Обслуживание машины: сбрасывает счётчик и частично возвращает состояние. */
export declare function serviceVehicle(vehicle: Vehicle): boolean;
/** Всё, что требует внимания: отказы, просроченное обслуживание, износ, пыль. */
export declare function attentionList(world: {
    devices: Device[];
    vehicles: Vehicle[];
}): Array<{
    id: string;
    kind: 'device' | 'vehicle';
    reason: string;
    severity: 'info' | 'warning' | 'critical';
}>;
