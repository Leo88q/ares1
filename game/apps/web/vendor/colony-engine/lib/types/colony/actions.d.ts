import { type ColonyState, type ModuleKind, type Scenario } from './simulation.js';
import { type NetworkType } from './networks.js';
import type { Placement } from './layout.js';
import { type ResourceId } from './deep/resources.js';
import { type AnalysisKind, type Regime } from './deep/lab.js';
import { type LabSupplyResource } from './supply.js';
/** Версия правил движка. Меняется вместе с золотым хешем в test/determinism.test.mjs. */
export declare const ENGINE_VERSION = 1;
/** Лимит дней за один запрос: полный год ≈ 2 с, поэтому длинные прогоны идут пачками. */
export declare const MAX_ADVANCE_DAYS = 7;
/** Сеанс: состояние колонии и настройки сценария (солнце, рекуперация воды). Всё — JSON. */
export interface SimSession {
    state: ColonyState;
    scenario: Scenario;
}
export type DeepAction = {
    op: 'taskPriority';
    taskId: string;
    priority: number | null;
} | {
    op: 'taskPaused';
    taskId: string;
    paused: boolean;
} | {
    op: 'taskCancel';
    taskId: string;
} | {
    op: 'importResource';
    resource: ResourceId;
    amount: number;
} | {
    op: 'isolateSection';
    sectionId: string;
    isolated: boolean;
} | {
    op: 'safeMode';
    deviceId: string;
    on: boolean;
} | {
    op: 'standby';
    deviceId: string;
    on: boolean;
} | {
    op: 'risky';
    targetId: string;
    on: boolean;
} | {
    op: 'contractDeliver';
    contractId: string;
    kg: number;
} | {
    op: 'analysis';
    kind: AnalysisKind;
    targetId: string;
} | {
    op: 'experimentStart';
    name: string;
    sols: number;
    regimeA: Regime;
    regimeB: Regime;
} | {
    op: 'recipeSave';
    experimentId: string;
} | {
    op: 'recipeApply';
    recipeId: string;
    greenhouseId: string;
};
export type SimAction = {
    type: 'advance';
    days: number;
} | {
    type: 'scenario';
    scenario: Scenario;
} | {
    type: 'build';
    kind: ModuleKind;
    at: Placement;
} | {
    type: 'move';
    moduleId: string;
    at: Placement;
} | {
    type: 'repair';
} | {
    type: 'supplies';
} | {
    type: 'deliver';
} | {
    type: 'harvestBed';
    moduleId: string;
    index: number;
} | {
    type: 'harvestBedV2';
    moduleId: string;
    index: number;
} | {
    type: 'networkAdd';
    network: {
        type: NetworkType;
        from: string;
        to: string;
        cells: {
            x: number;
            z: number;
        }[];
    };
} | {
    type: 'networkRemove';
    networkId: string;
} | {
    type: 'labDraw';
    resource: LabSupplyResource;
    kg: number;
} | {
    type: 'deep';
    deep: DeepAction;
} | {
    type: 'reset';
};
export type ApplyFailure = 'NO_EFFECT' | 'ENDED' | 'NO_WORLD';
export type ApplyResult = {
    ok: true;
    session: SimSession;
} | {
    ok: false;
    code: ApplyFailure;
};
/** Стартовый сеанс: новая колония и сценарий по умолчанию (как reset в клиенте). */
export declare function freshSession(): SimSession;
/** Каноническая строка сеанса. Порядок ключей сохраняется, поэтому хеш воспроизводим. */
export declare function serializeSession(session: SimSession): string;
/**
 * Сколько POTATO стоит действие (вариант B: 1 POTATO = 1 CR). Оплачивается только стройка и ремонт,
 * как в клиенте до серверной симуляции. Остальные действия тратят CR стартового бюджета без POTATO.
 */
export declare function spendFor(action: SimAction): {
    purpose: 1 | 2;
    cr: number;
} | null;
/**
 * Применить действие к копии сеанса. Исходный сеанс не меняется.
 * Если состояние после действия совпало с исходным, возвращается NO_EFFECT.
 */
export declare function applyAction(session: SimSession, action: SimAction): ApplyResult;
/**
 * Разбор действия из недоверенного JSON. Возвращает нормализованный объект (только известные поля)
 * или null. Нормализация важна: в журнал пишется разобранная форма, а не то, что прислал клиент.
 */
export declare function parseSimAction(input: unknown): SimAction | null;
