export type Specialty = 'agronomist' | 'engineer' | 'operator' | 'generalist';
export declare const SPECIALTY_LABEL: Record<Specialty, {
    ru: string;
    en: string;
}>;
export interface CrewMember {
    id: string;
    name: string;
    specialty: Specialty;
    /** Усталость 0…1. Растёт от работы, падает от отдыха. */
    fatigue: number;
    /** Состояние 0…1. Падает от недоедания, гипоксии, плохой атмосферы. */
    health: number;
    /** Накопленный пищевой дефицит, в человеко-солях без еды. */
    foodDebtSols: number;
    taskId: string | null;
    /** Отработано за текущий сол, часы. */
    hoursToday: number;
    /** Доступно часов в этот сол (смена, уменьшенная усталостью и состоянием). */
    hoursAvailable: number;
    /** Где человек: id секции, id машины или 'eva'. */
    location: string;
    /** Скафандр надет: наружные работы требуют подготовки и ресурсов. */
    suited: boolean;
    /** Затрачено на подготовку к выходу, часы (копится до готовности). */
    evaPrepHours: number;
}
export type CrewLocation = string;
/** Квалификация человека на тип работы (множитель к скорости). */
export declare function crewSkill(member: CrewMember, kind: string): number;
export declare const isIdle: (member: CrewMember) => boolean;
export declare const remainingHours: (member: CrewMember) => number;
export declare function createCrew(id: string, name: string, specialty: Specialty): CrewMember;
/** Начало сола: пересчитать доступные часы, сбросить счётчик, снять скафандр. */
export declare function beginSolForCrew(member: CrewMember): void;
/**
 * Работа в течение `hours` часов. Возвращает полезные «человеко-часы»
 * (эффективные), которые задача зачитывает в свой прогресс.
 */
export declare function workHours(member: CrewMember, kind: string, hours: number): number;
/** Отдых: сон и восстановление в конце сола. */
export declare function restCrew(member: CrewMember, restHours: number): void;
/**
 * Метаболизм за долю сола: еда, вода, кислород, CO2, влага, отходы.
 * `fed` — доля рациона, реально полученная (0…1). Возвращает фактические потоки.
 */
export interface Metabolism {
    foodKg: number;
    waterL: number;
    o2Kg: number;
    co2Kg: number;
    moistureL: number;
    wasteKg: number;
    /** Доля полученного рациона — влияет на накопление пищевого долга. */
    fedFraction: number;
}
export declare function metabolise(crew: number, shareOfSol: number, foodAvailableKg: number, waterAvailableL: number, o2AvailableKg: number): Metabolism;
/** Накопление последствий: еда, гипоксия, плохая атмосфера. */
export declare function applyLifeSupportConsequences(member: CrewMember, shareOfSol: number, fedFraction: number, o2PartialKpa: number, co2PartialKpa: number): void;
/** Сводка по экипажу для интерфейса. */
export interface CrewSummary {
    total: number;
    idle: number;
    assigned: number;
    /** Средняя доступная работоспособность 0…1. */
    readiness: number;
    hoursPlanned: number;
    hoursWorked: number;
}
export declare function crewSummary(crew: readonly CrewMember[]): CrewSummary;
