import type { ResourceId } from './resources.js';
import type { Fault } from './devices.js';
export type VehicleClass = 'scout' | 'excavator' | 'hauler';
export type VehicleState = 'idle' | 'travelling' | 'loading' | 'unloading' | 'working' | 'charging' | 'stalled';
export interface VehicleProfile {
    class: VehicleClass;
    capacityKg: number;
    capacityKwh: number;
    speedKmh: number;
    kwhPerKm: number;
    autonomy: number;
    ru: string;
    en: string;
}
export interface Vehicle {
    id: string;
    name: string;
    class: VehicleClass;
    condition: number;
    wear: number;
    hoursSinceService: number;
    fault: Fault | null;
    /** Запас энергии, kWh. */
    batteryKwh: number;
    capacityKwh: number;
    capacityKg: number;
    speedKmh: number;
    kwhPerKm: number;
    /** Груз в кузове, кг. */
    payloadKg: number;
    payloadResource: ResourceId | null;
    /** Где машина: 'base' или id месторождения. */
    at: string;
    /** Куда едет (узел маршрута). */
    destination: string | null;
    /** Пройдено от текущего узла, км. */
    travelledKm: number;
    /** Длина текущего плеча, км. */
    legKm: number;
    state: VehicleState;
    jobId: string | null;
    operatorId: string | null;
    /** Уровень автономности 0…1: доля времени работы без человека. */
    autonomy: number;
    odometerKm: number;
    /** Часов работы без оператора в текущем рейсе (для требования оператора). */
    unattendedHours: number;
    /** Простой по причине (для журнала). */
    idleReason: string | null;
    /**
     * Рискованный ремонт: чинить без диагноза и без запчасти, быстро, но
     * машина выходит недочиненной и может встать снова. Решение игрока, а не
     * автоматическая политика — отказ ровера стоит дороже отказа насоса.
     */
    risky: boolean;
}
export declare function createVehicle(id: string, name: string, vehicleClass: VehicleClass): Vehicle;
export type HaulPhase = 'to_pickup' | 'loading' | 'to_drop' | 'unloading' | 'done';
export interface HaulJob {
    id: string;
    vehicleId: string;
    /** Узел отправления: 'base' или id месторождения. */
    from: string;
    to: string;
    resource: ResourceId;
    /** Сколько запрошено к перевозке, кг. */
    requestedKg: number;
    loadedKg: number;
    deliveredKg: number;
    phase: HaulPhase;
    taskId: string | null;
    createdSol: number;
    /** Расстояние плеча «откуда» → «куда», км. */
    legKm: number;
}
export interface HaulHandlers {
    /** Взять груз в узле `node`. Возвращает фактически погружённое, кг. */
    pickUp(node: string, resource: ResourceId, kg: number): number;
    /** Отдать груз в узле `node`. Возвращает фактически принятое, кг. */
    dropOff(node: string, resource: ResourceId, kg: number): number;
    /** Расстояние между узлами, км. */
    distanceKm(from: string, to: string): number;
}
/** Машина может работать: нет отказа, есть энергия. */
export declare const vehicleUsable: (vehicle: Vehicle) => boolean;
/**
 * Один шаг рейса. Возвращает, сколько часов реально потрачено и что произошло.
 * Груз не дублируется: погрузка уменьшает склад источника, разгрузка
 * увеличивает склад приёмника ровно на принятое количество.
 */
export declare function stepHaulJob(job: HaulJob, vehicle: Vehicle, hours: number, handlers: HaulHandlers, operatorPresent: boolean): {
    hoursUsed: number;
    notes: string[];
};
/** Зарядка на базе: расход энергии базы, возврат в строй. */
export declare function chargeVehicle(vehicle: Vehicle, kwh: number): number;
/** Требуется ли оператор прямо сейчас: автономность не бесконечна. */
/** Расстояние «в одну сторону» до узла, км (для планирования рейса). */
/** Оценка длительности рейса, часы. */
export declare function estimateTripHours(vehicle: Vehicle, distanceKm: number, kg: number): number;
/** Запас хода, км, при текущем заряде. */
export declare const rangeKm: (vehicle: Vehicle) => number;
/** Доля заряда 0…1. */
/** Простой машины по причине — агрегированное отображение «работа/простой». */
