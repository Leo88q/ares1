/**
 * Мост между существующей колонией (`colony/simulation`) и глубоким миром.
 *
 * Здесь зафиксировано, КТО ВЛАДЕЕТ КАЖДЫМ ПОТОКОМ. У каждого потока ровно
 * один писатель, поэтому масса и энергия не расходуются дважды:
 *
 * | Поток                                       | Владелец                        |
 * |---------------------------------------------|---------------------------------|
 * | Физические запасы: вода, O2, N/P/K, запчасти | глубокий мир                    |
 * | Масса картофеля и еды (кг)                   | реестр `organism/unified`       |
 * | Агрегатный спрос воды/питания на сол         | `dailyBudget` → прикладывает мир |
 * | Темп роста грядок (дни)                      | реестр, по приросту от мира     |
 * | Кредиты                                      | существующая игра (через `credits`) |
 *
 * `dailyBudget` остаётся **прогнозом**: ничего не списывает, отдаёт спрос и
 * потенциал роста. Глубокий мир прикладывает спрос к единому складу и добавляет
 * промышленный контур (добыча → возгонка → очистка → регенерация), последствия
 * дефицита и трудозатраты.
 */
import { type ColonyModule, type ColonyState, type DayBudget, type ModuleKind, type Scenario } from '../simulation.js';
import type { Device, DeviceKind } from './devices.js';
import { type VehicleClass } from './machines.js';
import type { ColonyWorld, WorldConfig } from './world.js';
import { type SolStep } from './world.js';
/** Дополнительные поля сводки дня, которые заполняет глубокий слой. */
export interface DeepDayExtras {
    /** Произведено очищенной воды за сол, л (добыча + регенерация). */
    waterProducedLitres: number;
    /** Чистое изменение запаса воды: расход − производство, л. */
    waterNetLitres: number;
    /** Сколько кг убрано за сол (физическая масса). */
    harvestedKg: number;
    /** Сколько кг отправлено на сортировку. */
    sortedKg: number;
    /** Кислород, выделенный растениями в атмосферу, кг. */
    cropO2Kg: number;
    /** Кислород, потерянный через утечки атмосферы, кг. */
    leakO2Kg: number;
    /** Физиологический спрос экипажа в кислороде, кг. */
    crewO2Kg: number;
    nutrientProducedKg: number;
    labourHours: number;
    bottleneck: string;
    unmetKwh: number;
    shed: string[];
}
export interface DeepDayBudget extends DayBudget {
    deep?: DeepDayExtras;
}
export declare const DEVICE_FOR_MODULE: Record<ModuleKind, DeviceKind[]>;
/** Стартовые месторождения: конкретные участки, а не «лёд в любой клетке». */
export declare const COLONY_DEPOSITS: {
    id: string;
    name: string;
    x: number;
    z: number;
    distanceKm: number;
    actualKg: number;
    iceFraction: number;
    hardness: number;
}[];
export declare function colonyWorldConfig(state: ColonyState, seed?: number): WorldConfig;
/** Создать глубокий мир по текущей колонии. */
export declare function createWorldForColony(state: ColonyState, seed?: number): ColonyWorld;
/**
 * Из существующего состояния в мир: кредиты, запчасти, состояние модулей и
 * подключение по сетям. Сети колонии — не украшение: отсоединённый агрегат
 * не потребляет, не выдаёт продукт и не заряжается.
 */
export declare function syncWorldFromState(world: ColonyWorld, state: ColonyState): void;
/** Из мира в существующее состояние: все физические запасы. */
export declare function syncStateFromWorld(state: ColonyState, world: ColonyWorld): ColonyState;
/** Полное обслуживание базы: существующая кнопка «ремонт». */
export declare function overhaulWorld(world: ColonyWorld): void;
/** Добавить устройства глубокого слоя при постройке модуля. */
export declare function addDeepModule(world: ColonyWorld, module: ColonyModule): (Device | {
    kind: 'vehicle';
})[];
/** Удалить устройства глубокого слоя при сносе модуля. */
export type { VehicleClass };
export interface AdvanceResult {
    state: ColonyState;
    world: ColonyWorld;
    step: SolStep;
    harvestedKg: number;
    sortedKg: number;
}
/**
 * Один сол колонии: агрегатный прогноз → шаг глубокого мира → реестр еды.
 * Порядок важен: мир шагает первым, поэтому посадка выполняется до роста.
 */
export declare function advanceColonyDay(state: ColonyState, scenario: Scenario, budget: DayBudget): AdvanceResult;
export declare function emptyStepOf(sol: number): SolStep;
/**
 * Мир колонии. Создаётся лениво: состояния сессии без `world` получают мир при
 * первом шаге, а не ломаются.
 */
export declare function ensureWorld(state: ColonyState & {
    world?: ColonyWorld;
}): ColonyWorld;
/** Сводка дня с полями глубокого слоя. */
export declare function withDeepExtras(budget: DayBudget, step: SolStep, world: ColonyWorld, harvestedKg: number, sortedKg: number): DeepDayBudget;
