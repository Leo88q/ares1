/**
 * Единая очередь работ колонии.
 *
 * Одна система на всё: посадка, уход, уборка, отбор проб, анализ, чистка
 * панелей, осмотр, ремонт, добыча, перевозка, переработка/упаковка,
 * разведка и обслуживание.
 *
 * Инварианты (проверяются тестами):
 *  - один человек одновременно назначен не более чем на одну задачу;
 *  - материалы резервируются один раз: повторное бронирование невозможно;
 *  - при отмене/паузе возвращаются только НЕизрасходованные материалы;
 *  - задача без доступа к объекту или без материалов не «висит» молча —
 *    она переходит в `blocked` с явной причиной.
 */
import type { Specialty } from './crew.js';
import { type CrewMember } from './crew.js';
import type { ResourceId } from './resources.js';
import type { Stock } from './resources.js';
export type TaskKind = 'plant' | 'tend' | 'harvest' | 'sample' | 'analysis' | 'clean_panels' | 'inspect' | 'repair' | 'extract' | 'haul' | 'process' | 'survey' | 'maintain';
export interface TaskMeta {
    kind: TaskKind;
    /** Приоритет по умолчанию: меньше = важнее. */
    priority: number;
    requires: Specialty | null;
    /** Работа снаружи: нужны скафандр, подготовка и расход воды на выход. */
    eva: boolean;
    ru: string;
    en: string;
    /** Что работа производит/изменяет — для журнала причин и последствий. */
    effect: {
        ru: string;
        en: string;
    };
}
export declare const TASK_META: Record<TaskKind, TaskMeta>;
export type TaskStatus = 'queued' | 'active' | 'blocked' | 'paused' | 'done' | 'cancelled';
export interface TaskMaterial {
    resource: ResourceId;
    required: number;
    /** Сколько реально зарезервировано. */
    reserved: number;
    /** Сколько уже списано работой. */
    consumed: number;
}
export interface Task {
    id: string;
    kind: TaskKind;
    /** Объект работы: устройство, машина, месторождение, партия, секция. */
    targetId: string;
    /** Приоритет по умолчанию для вида работ. */
    basePriority: number;
    /** Ручной приоритет игрока (меньше = важнее). Перекрывает автоматический. */
    manualPriority: number | null;
    status: TaskStatus;
    requiredHours: number;
    doneHours: number;
    assignees: string[];
    /** Сколько человек нужно одновременно (например, погрузка). */
    crewNeeded: number;
    requiredSpecialty: Specialty | null;
    materials: TaskMaterial[];
    createdSol: number;
    startedSol: number | null;
    finishedSol: number | null;
    /** Явная причина блокировки (показывается игроку). */
    blockReason: string | null;
    /** Код причины для локализации/тестов. */
    blockCode: string | null;
    /** Создана автоматикой (не игроком). */
    auto: boolean;
    /** Регулярная работа: после завершения создаётся заново. */
    recurring: boolean;
    /** Работа снаружи (костюм, подготовка, расходники). */
    eva: boolean;
    /** Подготовка к выходу завершена. */
    evaReady: boolean;
    /** Сколько полезных часов дала задача за всё время (для метрик труда). */
    spentHoursByKind?: Record<string, number>;
}
export interface NewTask {
    kind: TaskKind;
    targetId: string;
    requiredHours: number;
    materials?: Array<{
        resource: ResourceId;
        amount: number;
    }>;
    crewNeeded?: number;
    priority?: number;
    manualPriority?: number | null;
    auto?: boolean;
    recurring?: boolean;
    sol: number;
}
export declare function createTask(id: string, spec: NewTask): Task;
export declare const taskRemaining: (task: Task) => number;
export declare const isOpen: (task: Task) => boolean;
export declare const isFinished: (task: Task) => boolean;
/** Порядок очереди: приоритет, затем давность создания, затем id (стабильность). */
export declare function compareTasks(a: Task, b: Task): number;
/** Зарезервировать все материалы задачи. Возвращает незакрытые позиции. */
export declare function reserveMaterials(stock: Stock, task: Task): TaskMaterial[];
/** Списать материалы пропорционально выполненной доле. */
export declare function consumeMaterials(stock: Stock, task: Task, ratio: number): void;
/** Отмена: возвращаются только неиспользованные материалы. */
export declare function releaseMaterials(stock: Stock, task: Task): number;
/**
 * Автораспределение: понятные правила, видимые игроку.
 * Сначала важные задачи, затем лучшая квалификация, затем наименее уставший.
 * Человек закрепляется за одной задачей до её завершения (без «микро-перескоков»).
 */
export declare function autoAssign(crew: CrewMember[], tasks: Task[]): number;
/** Сводка очереди для интерфейса. */
export interface TaskQueueSummary {
    open: number;
    active: number;
    blocked: number;
    done: number;
    /** Суммарные требуемые часы по открытым задачам. */
    requiredHours: number;
}
/** Причины блокировки: короткие коды для локализации и лога. */
export declare const BLOCK_CODES: {
    readonly noMaterials: "no-materials";
    readonly noCrew: "no-crew";
    readonly noAccess: "no-access";
    readonly faulty: "faulty";
    readonly offline: "offline";
    readonly noPower: "no-power";
    readonly full: "storage-full";
    readonly noTarget: "no-target";
};
export type BlockCode = typeof BLOCK_CODES[keyof typeof BLOCK_CODES];
