// Действия колонии: единственный способ изменить состояние (вариант 2, авторитетная симуляция на сервере).
//
// Клиент отправляет действие, сервер проверяет его строго (parseSimAction), применяет к копии сеанса
// (applyAction) и сохраняет журнал. Любое действие, которое не меняет состояние, отклоняется как
// NO_EFFECT: тогда и оплата POTATO не списывается (см. docs/COLONY_SERVER_SIM_PLAN.md).
// Без Node-модулей: этот файл входит и в браузерный бандл web.
import { CATALOG, DEFAULT_SCENARIO, MODULE_KINDS, PARAMETERS, advanceDays, buildModuleAt, buySupplies, canBuild, canHarvestBed, canRepair, deliverFood, harvestBed, initialColony, moveModule, repairColony, } from './simulation.js';
import { addNetwork, NETWORK_TYPES, removeNetwork } from './networks.js';
import { RESOURCE_IDS } from './deep/resources.js';
import { ANALYSIS_KINDS, ANALYSIS_META } from './deep/lab.js';
import { applyRecipe, cancelTask, deliverContract, importResource, isolateSection, requestAnalysis, saveRecipe, setRisky, setSafeMode, setStandby, setTaskPaused, setTaskPriority, startExperiment, takeSample, } from './deep/world.js';
import { drawFromColony } from './supply.js';
/** Ресурсы, которые лаборатория может забрать из стока колонии (совпадает с веб-мостом). */
const LAB_RESOURCES = ['water', 'nutrients', 'spares'];
/** Версия правил движка. Меняется вместе с золотым хешем в test/determinism.test.mjs. */
export const ENGINE_VERSION = 1;
/** Лимит дней за один запрос: полный год ≈ 2 с, поэтому длинные прогоны идут пачками. */
export const MAX_ADVANCE_DAYS = 7;
/** Лимит клеток одной сети за одно действие. */
const MAX_NETWORK_CELLS = 256;
/** Стартовый сеанс: новая колония и сценарий по умолчанию (как reset в клиенте). */
export function freshSession() {
    return { state: initialColony(), scenario: { ...DEFAULT_SCENARIO } };
}
/** Каноническая строка сеанса. Порядок ключей сохраняется, поэтому хеш воспроизводим. */
export function serializeSession(session) {
    return JSON.stringify(session);
}
/**
 * Сколько POTATO стоит действие (вариант B: 1 POTATO = 1 CR). Оплачивается только стройка и ремонт,
 * как в клиенте до серверной симуляции. Остальные действия тратят CR стартового бюджета без POTATO.
 */
export function spendFor(action) {
    if (action.type === 'build')
        return { purpose: 1, cr: CATALOG[action.kind].credits };
    if (action.type === 'repair')
        return { purpose: 2, cr: PARAMETERS.repairCredits };
    return null;
}
/**
 * Применить действие к копии сеанса. Исходный сеанс не меняется.
 * Если состояние после действия совпало с исходным, возвращается NO_EFFECT.
 */
export function applyAction(session, action) {
    if (action.type === 'reset')
        return { ok: true, session: freshSession() };
    if (action.type === 'advance' && session.state.day >= PARAMETERS.maxDays)
        return { ok: false, code: 'ENDED' };
    const before = serializeSession(session);
    // Клонирование через JSON: состояние полностью JSON-совместимо (Map/Set живут только внутри функций).
    const next = JSON.parse(before);
    const s = next.state;
    const world = s.world;
    switch (action.type) {
        case 'advance':
            next.state = advanceDays(s, action.days, next.scenario);
            break;
        case 'scenario':
            next.scenario = { sunHours: action.scenario.sunHours, waterRecovery: action.scenario.waterRecovery };
            break;
        case 'build':
            if (canBuild(s, action.kind))
                next.state = buildModuleAt(s, action.kind, action.at);
            break;
        case 'move':
            next.state = moveModule(s, action.moduleId, action.at);
            break;
        case 'repair':
            if (canRepair(s))
                next.state = repairColony(s);
            break;
        case 'supplies':
            next.state = buySupplies(s);
            break;
        case 'deliver':
            next.state = deliverFood(s);
            break;
        case 'harvestBed':
            if (canHarvestBed(s, action.moduleId, action.index))
                next.state = harvestBed(s, action.moduleId, action.index);
            break;
        case 'networkAdd':
            next.state = addNetwork(s, { id: '', ...action.network });
            break;
        case 'networkRemove':
            next.state = removeNetwork(s, action.networkId);
            break;
        case 'labDraw':
            next.state = drawFromColony(s, action.resource, action.kg).state;
            break;
        case 'deep': {
            if (!world)
                return { ok: false, code: 'NO_WORLD' };
            applyDeep(world, action.deep);
            break;
        }
    }
    if (serializeSession(next) === before)
        return { ok: false, code: 'NO_EFFECT' };
    return { ok: true, session: next };
}
function applyDeep(world, op) {
    switch (op.op) {
        case 'taskPriority':
            setTaskPriority(world, op.taskId, op.priority);
            break;
        case 'taskPaused':
            setTaskPaused(world, op.taskId, op.paused);
            break;
        case 'taskCancel':
            cancelTask(world, op.taskId);
            break;
        case 'importResource':
            importResource(world, op.resource, op.amount);
            break;
        case 'isolateSection':
            isolateSection(world, op.sectionId, op.isolated);
            break;
        case 'safeMode':
            setSafeMode(world, op.deviceId, op.on);
            break;
        case 'standby':
            setStandby(world, op.deviceId, op.on);
            break;
        case 'risky':
            setRisky(world, op.targetId, op.on);
            break;
        case 'contractDeliver':
            deliverContract(world, op.contractId, op.kg);
            break;
        // Проба и анализ — одна операция: так же, как кнопка «Анализ» в клиенте (проба тратит воду).
        case 'analysis':
            takeSample(world, ANALYSIS_META[op.kind].sample, op.targetId);
            requestAnalysis(world, op.kind, op.targetId);
            break;
        case 'experimentStart':
            startExperiment(world, op.name, op.sols, op.regimeA, op.regimeB);
            break;
        case 'recipeSave':
            saveRecipe(world, op.experimentId);
            break;
        case 'recipeApply':
            applyRecipe(world, op.recipeId, op.greenhouseId);
            break;
    }
}
// ---------- Строгий разбор входа (вход недоверенный: сюда попадает JSON из сети) ----------
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isId = (v) => typeof v === 'string' && v.length >= 1 && v.length <= 64;
const isText = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;
function parsePlacement(v) {
    if (!isObject(v) || !isInt(v.x, 0, 47) || !isInt(v.z, 0, 47) || !isInt(v.rotation, 0, 3))
        return null;
    return { x: v.x, z: v.z, rotation: v.rotation };
}
function parseRegime(v) {
    if (!isObject(v) || !isNum(v.targetC, -10, 60) || !isNum(v.feedRate, 0, 1.5) || !isNum(v.light, 0, 1) || !isNum(v.irrigation, 0, 2))
        return null;
    return { targetC: v.targetC, feedRate: v.feedRate, light: v.light, irrigation: v.irrigation };
}
function parseDeep(v) {
    if (!isObject(v) || typeof v.op !== 'string')
        return null;
    switch (v.op) {
        case 'taskPriority':
            if (!isId(v.taskId) || !(v.priority === null || isInt(v.priority, -50, 50)))
                return null;
            return { op: 'taskPriority', taskId: v.taskId, priority: v.priority };
        case 'taskPaused':
            return isId(v.taskId) && typeof v.paused === 'boolean' ? { op: 'taskPaused', taskId: v.taskId, paused: v.paused } : null;
        case 'taskCancel':
            return isId(v.taskId) ? { op: 'taskCancel', taskId: v.taskId } : null;
        case 'importResource':
            return typeof v.resource === 'string' && RESOURCE_IDS.includes(v.resource) && isNum(v.amount, 0, 100_000)
                ? { op: 'importResource', resource: v.resource, amount: v.amount } : null;
        case 'isolateSection':
            return isId(v.sectionId) && typeof v.isolated === 'boolean' ? { op: 'isolateSection', sectionId: v.sectionId, isolated: v.isolated } : null;
        case 'safeMode':
        case 'standby':
            return isId(v.deviceId) && typeof v.on === 'boolean' ? { op: v.op, deviceId: v.deviceId, on: v.on } : null;
        case 'risky':
            return isId(v.targetId) && typeof v.on === 'boolean' ? { op: 'risky', targetId: v.targetId, on: v.on } : null;
        case 'contractDeliver':
            return isId(v.contractId) && isNum(v.kg, 0, 100_000) ? { op: 'contractDeliver', contractId: v.contractId, kg: v.kg } : null;
        case 'analysis':
            return typeof v.kind === 'string' && ANALYSIS_KINDS.includes(v.kind) && isId(v.targetId)
                ? { op: 'analysis', kind: v.kind, targetId: v.targetId } : null;
        case 'experimentStart': {
            const a = parseRegime(v.regimeA);
            const b = parseRegime(v.regimeB);
            if (!isText(v.name, 80) || !isInt(v.sols, 1, 90) || !a || !b)
                return null;
            return { op: 'experimentStart', name: v.name, sols: v.sols, regimeA: a, regimeB: b };
        }
        case 'recipeSave':
            return isId(v.experimentId) ? { op: 'recipeSave', experimentId: v.experimentId } : null;
        case 'recipeApply':
            return isId(v.recipeId) && isId(v.greenhouseId) ? { op: 'recipeApply', recipeId: v.recipeId, greenhouseId: v.greenhouseId } : null;
        default:
            return null;
    }
}
/**
 * Разбор действия из недоверенного JSON. Возвращает нормализованный объект (только известные поля)
 * или null. Нормализация важна: в журнал пишется разобранная форма, а не то, что прислал клиент.
 */
export function parseSimAction(input) {
    if (!isObject(input) || typeof input.type !== 'string')
        return null;
    switch (input.type) {
        case 'advance':
            return isInt(input.days, 1, MAX_ADVANCE_DAYS) ? { type: 'advance', days: input.days } : null;
        case 'scenario': {
            const sc = input.scenario;
            if (!isObject(sc) || !isNum(sc.sunHours, 0, 24) || !isNum(sc.waterRecovery, 0, 0.98))
                return null;
            return { type: 'scenario', scenario: { sunHours: sc.sunHours, waterRecovery: sc.waterRecovery } };
        }
        case 'build': {
            const at = parsePlacement(input.at);
            if (typeof input.kind !== 'string' || !MODULE_KINDS.includes(input.kind) || !at)
                return null;
            return { type: 'build', kind: input.kind, at };
        }
        case 'move': {
            const at = parsePlacement(input.at);
            return isId(input.moduleId) && at ? { type: 'move', moduleId: input.moduleId, at } : null;
        }
        case 'repair':
            return { type: 'repair' };
        case 'supplies':
            return { type: 'supplies' };
        case 'deliver':
            return { type: 'deliver' };
        case 'harvestBed':
            return isId(input.moduleId) && isInt(input.index, 0, 63) ? { type: 'harvestBed', moduleId: input.moduleId, index: input.index } : null;
        case 'networkAdd': {
            const n = input.network;
            if (!isObject(n) || typeof n.type !== 'string' || !NETWORK_TYPES.includes(n.type)
                || !isId(n.from) || !isId(n.to) || !Array.isArray(n.cells) || n.cells.length < 1 || n.cells.length > MAX_NETWORK_CELLS)
                return null;
            const cells = [];
            for (const c of n.cells) {
                if (!isObject(c) || !isInt(c.x, 0, 47) || !isInt(c.z, 0, 47))
                    return null;
                cells.push({ x: c.x, z: c.z });
            }
            return { type: 'networkAdd', network: { type: n.type, from: n.from, to: n.to, cells } };
        }
        case 'networkRemove':
            return isId(input.networkId) ? { type: 'networkRemove', networkId: input.networkId } : null;
        case 'labDraw':
            return typeof input.resource === 'string' && LAB_RESOURCES.includes(input.resource)
                && isNum(input.kg, 0, 1_000)
                ? { type: 'labDraw', resource: input.resource, kg: input.kg } : null;
        case 'deep': {
            const deep = parseDeep(input.deep);
            return deep ? { type: 'deep', deep } : null;
        }
        case 'reset':
            return { type: 'reset' };
        default:
            return null;
    }
}
