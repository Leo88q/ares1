/**
 * ARES «Единый организм», P1 (docs/ORGANISM_INTEGRATION.md §32.4).
 *
 * One ledger for the whole base. A kilogram goes:
 *   growth → harvest → storage → processing → crew food | export | craft
 * Off-chain accounting only. Nothing here mints POTATO. Crafting stays disabled
 * until PotatoPerKg is calibrated (§13.2, marked H), so `potatoPerKg === null` means "not calibrated".
 *
 * Conservation (checked by tests and by `unifiedBalance`):
 *   startKg + harvestedKg = rawKg + processedKg + eatenKg + exportedKg + craftedKg + processingLossKg (+ sortedKg + spoiledKg + seedReturnedKg)
 *
 * Глубокая симуляция колонии (colony/deep) — НЕ вторая экономика еды: она
 * считает, СКОЛЬКО развития получает грядка и какую долю урожая потеряла,
 * а масса по-прежнему проходит через этот реестр. Расширения backward compatible:
 *  - `GrowthInput` может быть функцией (plotId, bedIndex) → прирост в днях;
 *  - `UnifiedPlot.planted` — физическая посадка (семенной картофель ограничен);
 *  - `advanceDay(b, growth, { yieldFactor, autoReplant })` — доля урожая при уборке
 *    и запрет автоматического пересева (решает слой симуляции).
 */
import { BEDS, LAB, PARAMETERS } from './parameters.js';
import { bedCycleKg, harvestFactor } from './beds.js';
/** Tier yield multipliers. Taken from LAB (1 / 1.35 / 1.7) until the on-chain tiers are reconciled (§13.4 G7). */
export const UNIFIED_TIER_MULT = [1, 1.35, 1.7];
/** One cycle of growth for every bed, in days (colony value, §13.4 G8 resolved to this). */
export const UNIFIED_CYCLE_DAYS = PARAMETERS.cropCycleDays;
/** kg of one full field cycle for a tier. */
export function fieldCycleKg(tier) {
    return PARAMETERS.cropAreaM2 * PARAMETERS.cropKgM2Day * UNIFIED_CYCLE_DAYS * UNIFIED_TIER_MULT[tier];
}
/** kg of one bed at full cycle for a tier. */
export function bedFullKg(tier) {
    return bedCycleKg(fieldCycleKg(tier), BEDS.perField);
}
/** Грядка засажена (старые состояния без `planted` считаются засаженными). */
export function isPlanted(b, plotId, index) {
    const plot = b.plots.find(p => p.id === plotId);
    if (!plot || !Number.isInteger(index) || index < 0)
        return false;
    return plot.planted?.[index] ?? true;
}
export function initialUnifiedBase(init) {
    if (!(init.storageCapKg >= 0) || !(init.startKg >= 0) || !(init.crew >= 0))
        throw new RangeError('invalid base parameters');
    return {
        day: 0,
        plots: init.plots.map(p => ({ ...p, beds: [...p.beds], harvestedKg: p.harvestedKg ?? 0 })),
        crew: init.crew,
        storageCapKg: init.storageCapKg,
        rawKg: 0,
        processedKg: init.startKg,
        startKg: init.startKg,
        harvestedKg: 0,
        eatenKg: 0,
        exportedKg: 0,
        craftedKg: 0,
        processingLossKg: 0,
        foodShortfallKg: 0,
        sortedKg: 0, spoiledKg: 0, seedReturnedKg: 0, heldBackKg: 0,
        potatoLedger: 0,
        potatoPerKg: init.potatoPerKg ?? null,
    };
}
/** Kilograms in storage (raw + processed). */
export const storedKg = (b) => b.rawKg + b.processedKg;
const freeKg = (b) => Math.max(0, b.storageCapKg - storedKg(b));
/** Kilograms that leave the base or are used; together with stock they must equal the inflow. */
export function unifiedBalance(b) {
    const inflow = b.startKg + b.harvestedKg;
    const stock = b.rawKg + b.processedKg;
    const outflow = b.eatenKg + b.exportedKg + b.craftedKg + b.processingLossKg
        + (b.sortedKg ?? 0) + (b.spoiledKg ?? 0) + (b.seedReturnedKg ?? 0) + (b.heldBackKg ?? 0);
    return { inflow, stock, outflow, residual: inflow - stock - outflow };
}
function findPlot(b, plotId) {
    return b.plots.findIndex(p => p.id === plotId);
}
/** A bed can be harvested by hand when the harvest factor (T2 + window, §31.2) is above zero and the bed is planted. */
export function canHarvestBed(b, plotId, index) {
    const pi = findPlot(b, plotId);
    if (pi < 0 || !Number.isInteger(index) || index < 0 || index >= BEDS.perField)
        return false;
    const plot = b.plots[pi];
    const v = plot.beds[index];
    if (v === undefined || v < 0)
        return false;
    if (!isPlanted(b, plotId, index))
        return false;
    const kg = bedFullKg(plot.tier) * harvestFactor(v / UNIFIED_CYCLE_DAYS);
    return kg > 0 && kg <= freeKg(b) + 1e-9;
}
/**
 * Manual harvest. Refused (same object returned) when the factor is zero or storage is full.
 * `opts.autoReplant === false` помечает грядку пустой: пересев решает слой
 * симуляции (нужны семенной картофель и труд), а не «бесконечная кнопка».
 */
export function harvestBed(b, plotId, index, opts = {}) {
    if (!canHarvestBed(b, plotId, index))
        return b;
    const pi = findPlot(b, plotId);
    const plot = b.plots[pi];
    const kg = bedFullKg(plot.tier) * harvestFactor(plot.beds[index] / UNIFIED_CYCLE_DAYS);
    const beds = [...plot.beds];
    beds[index] = 0;
    const planted = plot.planted ? [...plot.planted] : beds.map(() => true);
    if (opts.autoReplant === false)
        planted[index] = false;
    const plots = b.plots.map((p, i) => (i === pi ? { ...p, beds, planted, harvestedKg: p.harvestedKg + kg } : p));
    return { ...b, plots, rawKg: b.rawKg + kg, harvestedKg: b.harvestedKg + kg };
}
/** Посадить грядку заново. Семенной материал списывает вызывающий слой (colony/deep). */
export function plantBed(b, plotId, index) {
    const pi = findPlot(b, plotId);
    if (pi < 0 || !Number.isInteger(index) || index < 0 || index >= BEDS.perField)
        return b;
    const plot = b.plots[pi];
    const planted = [...(plot.planted ?? plot.beds.map(() => true))];
    while (planted.length < plot.beds.length)
        planted.push(true);
    if (planted[index])
        return b;
    planted[index] = true;
    const beds = [...plot.beds];
    beds[index] = 0;
    const plots = b.plots.map((p, i) => (i === pi ? { ...p, beds, planted } : p));
    return { ...b, plots };
}
/** Grow every planted bed by its plot's growth. A bed at full cycle is harvested automatically if storage has room; otherwise it waits (no loss). */
function growBeds(b, growth, opts = {}) {
    const growOf = (id, index) => (typeof growth === 'number' ? growth : growth(id, index));
    const yieldOf = opts.yieldFactor ?? (() => 1);
    let cur = b;
    cur = { ...cur, plots: cur.plots.map(p => {
            return { ...p, beds: p.beds.map((v, bi) => {
                    if (p.planted && p.planted[bi] === false)
                        return v;
                    const g = growOf(p.id, bi);
                    if (!(g >= 0))
                        throw new RangeError('growth must be ≥ 0');
                    return v < 0 ? (v + g >= 0 ? 0 : v + g) : v + g;
                }) };
        }) };
    // automatic harvest of ripe beds (value ≥ cycle), one bed at a time, while storage allows
    for (let pi = 0; pi < cur.plots.length; pi++) {
        for (let bi = 0; bi < BEDS.perField; bi++) {
            const plot = cur.plots[pi];
            const v = plot.beds[bi];
            if (v < UNIFIED_CYCLE_DAYS - 1e-9)
                continue;
            if (plot.planted && plot.planted[bi] === false)
                continue;
            const kg = bedFullKg(plot.tier) * Math.max(0, Math.min(1, yieldOf(plot.id, bi)));
            if (kg > freeKg(cur) + 1e-9)
                continue; // waits at full cycle; retried next day
            // Люди ограничивают уборку так же, как её уже ограничивает место на
            // складе: созревшая грядка стоит и ждёт, копя стресс запущенности, а не
            // собирается сама. Предикат необязателен — базовая колония его не
            // передаёт и убирает как прежде.
            if (opts.harvestAllow && !opts.harvestAllow(plot.id, bi))
                continue;
            const beds = [...plot.beds];
            beds[bi] = v - UNIFIED_CYCLE_DAYS;
            const planted = [...(plot.planted ?? plot.beds.map(() => true))];
            if (opts.autoReplant === false) {
                planted[bi] = false;
                beds[bi] = 0;
            }
            cur = {
                ...cur,
                plots: cur.plots.map((p, i) => (i === pi ? { ...p, beds, planted, harvestedKg: p.harvestedKg + kg } : p)),
                rawKg: cur.rawKg + kg,
                harvestedKg: cur.harvestedKg + kg,
            };
        }
    }
    return cur;
}
/** Raw → processed, one sol at the LAB line rate (4,2 кг/сол = processorRateKgph × solHours) with its 85 % yield. */
function processDay(b) {
    const x = Math.min(b.rawKg, LAB.processorRateKgph * LAB.solHours);
    if (x <= 0)
        return b;
    return {
        ...b,
        rawKg: b.rawKg - x,
        processedKg: b.processedKg + x * LAB.processingYield,
        processingLossKg: b.processingLossKg + x * (1 - LAB.processingYield),
    };
}
/** Crew eats processed food first; any deficit is recorded, not hidden. */
function feedCrew(b) {
    const demand = b.crew * PARAMETERS.freshFoodKgCrewDay;
    const eaten = Math.min(b.processedKg, demand);
    return { ...b, processedKg: b.processedKg - eaten, eatenKg: b.eatenKg + eaten, foodShortfallKg: b.foodShortfallKg + (demand - eaten) };
}
/**
 * One day. `growth` is growth in days added to each planted bed (1 = a full day of growth).
 * `opts.yieldFactor` — доля полного выхода при уборке (стресс/плотность из colony/deep);
 * `opts.autoReplant === false` — грядка после уборки пуста и требует посадки.
 */
export function advanceDay(b, growth, opts = {}) {
    let cur = growBeds({ ...b, day: b.day + 1 }, growth, opts);
    // Глубокий слой делит сырьё сам (семена / товарная / некондиция), поэтому
    // реестр здесь сырьё не трогает — иначе две цепочки съедят одну массу.
    if (!opts.skipProcessing)
        cur = processDay(cur);
    cur = feedCrew(cur);
    return cur;
}
/** Add a new plot (e.g. a newly built greenhouse). Its beds start as given; no kg are created. */
export function addPlot(b, plot) {
    if (b.plots.some(p => p.id === plot.id))
        throw new RangeError(`duplicate plot ${plot.id}`);
    return { ...b, plots: [...b.plots, { ...plot, beds: [...plot.beds], harvestedKg: plot.harvestedKg }] };
}
/** Export processed kg to a buyer. Only processed food leaves the base. */
export function exportKg(b, kg) {
    const x = Math.min(b.processedKg, Math.max(0, kg));
    if (x <= 0)
        return b;
    return { ...b, processedKg: b.processedKg - x, exportedKg: b.exportedKg + x };
}
/** Craft processed kg into POTATO (off-chain ledger). Refused until PotatoPerKg is calibrated. */
export function craftPotato(b, kg) {
    if (b.potatoPerKg === null)
        return b;
    const x = Math.min(b.processedKg, Math.max(0, kg));
    if (x <= 0)
        return b;
    return {
        ...b,
        processedKg: b.processedKg - x,
        craftedKg: b.craftedKg + x,
        potatoLedger: b.potatoLedger + x * b.potatoPerKg,
    };
}
