/**
 * Лаборатория как инструмент исследования.
 *
 * Лаборатория даёт информацию и проверенные режимы, а не «магические проценты»:
 *   отбор пробы → доставка/передача образца → постановка анализа → расход
 *   реагентов → работа специалиста → время → результат с понятной точностью.
 *
 * Скрытые состояния (загрязнение субстрата, накопление солей) игроку
 * заранее не показываются: в этом смысл анализа. Базовые эксплуатационные
 * датчики (температура, поток, давление, влажность) остаются доступными.
 *
 * Эксперимент расходует реальные ресурсы общей колонии. Изменение режима
 * НЕ меняет задним числом уже выращенный урожай.
 */
import { DEEP_P } from './params.js';
import { clamp01 } from './units.js';
import { normal } from './rng.js';
import { createBatch, relaxRootTemperatureC, rootZoneTargetC, stepBatch, } from './growth.js';
export const ANALYSIS_KINDS = [
    'water_quality', 'solution_composition', 'salt_index', 'contamination', 'root_zone',
];
export const ANALYSIS_META = {
    water_quality: {
        kind: 'water_quality', sample: 'water', hours: DEEP_P.analysisHours * 0.8, reagents: 1, kwh: DEEP_P.analysisKwh * 0.7,
        ru: 'Качество воды', en: 'Water quality',
        measures: { ru: 'пригодность воды по загрязнению', en: 'water fitness by contamination' },
    },
    solution_composition: {
        kind: 'solution_composition', sample: 'solution', hours: DEEP_P.analysisHours, reagents: 1, kwh: DEEP_P.analysisKwh,
        ru: 'Состав раствора', en: 'Solution composition',
        measures: { ru: 'концентрация питания N/P/K', en: 'N/P/K concentration' },
    },
    salt_index: {
        kind: 'salt_index', sample: 'substrate', hours: DEEP_P.analysisHours * 1.2, reagents: 1, kwh: DEEP_P.analysisKwh * 1.1,
        ru: 'Накопление солей', en: 'Salt build-up',
        measures: { ru: 'долю солей в субстрате', en: 'salt fraction in substrate' },
    },
    contamination: {
        kind: 'contamination', sample: 'substrate', hours: DEEP_P.analysisHours * 1.4, reagents: 2, kwh: DEEP_P.analysisKwh * 1.3,
        ru: 'Загрязнение субстрата', en: 'Substrate contamination',
        measures: { ru: 'уровень загрязнения субстрата', en: 'substrate contamination level' },
    },
    root_zone: {
        kind: 'root_zone', sample: 'tissue', hours: DEEP_P.analysisHours * 1.1, reagents: 1, kwh: DEEP_P.analysisKwh,
        ru: 'Состояние корневой зоны', en: 'Root-zone condition',
        measures: { ru: 'состояние корней и риск заливания', en: 'root condition and waterlogging risk' },
    },
};
export function createAnalysis(id, kind, sampleId, targetId) {
    const meta = ANALYSIS_META[kind];
    return {
        id, kind, sampleId, targetId,
        startedSol: null, finishSol: null, doneHours: 0,
        status: 'queued', reagents: meta.reagents, kwh: meta.kwh, result: null,
    };
}
function bandOf(value) {
    return value < 0.3 ? 'ok' : value < 0.6 ? 'watch' : 'critical';
}
/**
 * Результат анализа: измеренное значение = скрытое состояние + шум прибора.
 * Точность задана параметром; игрок видит интервал, а не «истину».
 */
export function finishAnalysis(analysis, sol, hiddenValue, rng) {
    const noise = normal(rng, 0, DEEP_P.analysisPrecision / 2);
    const value = clamp01(hiddenValue + noise);
    const result = { sol, kind: analysis.kind, value, ci: DEEP_P.analysisPrecision, band: bandOf(value) };
    analysis.result = result;
    analysis.status = 'done';
    analysis.finishSol = sol;
    return result;
}
export const DEFAULT_REGIME = { targetC: 20, feedRate: 1, light: 1, irrigation: 1 };
export function createExperiment(id, name, sol, sols, regimeA, regimeB) {
    const arm = (label, regime) => ({
        label, regime,
        batch: createBatch(`${id}-${label}`, 'lab', label === 'A' ? 0 : 1, DEEP_P.experimentAreaM2, true),
        waterL: 0, energyKwh: 0, labourHours: 0, yieldKg: 0, quality: 0,
    });
    const experiment = {
        id, name, status: 'planned', startSol: sol, sols: Math.max(DEEP_P.experimentMinSols, sols),
        a: arm('A', regimeA), b: arm('B', regimeB), risk: null, savedRecipeId: null,
    };
    for (const side of [experiment.a, experiment.b]) {
        side.batch.targetC = side.regime.targetC;
        side.batch.feedRate = side.regime.feedRate;
        side.batch.plantedSol = sol;
        side.batch.lastTendSol = sol;
        side.batch.health = 1;
        side.batch.density = 1;
        side.batch.stage = 'sprout';
    }
    return experiment;
}
/** Шаг эксперимента: расходует реальные ресурсы общей колонии. */
export function stepExperiment(experiment, sol, dtSols, resources) {
    let waterL = 0, energyKwh = 0, labourHours = 0, nutrientKg = 0;
    for (const arm of [experiment.a, experiment.b]) {
        // Корневая зона считается той же физикой, что и в основной теплице:
        // обильный полив холодной водой остужает корни. Без этого A/B-опыт по
        // поливу был бы нечестным — он менял бы только расход, но не среду.
        const rootC = relaxRootTemperatureC(arm.batch.rootTemperatureC, rootZoneTargetC(arm.regime.targetC, arm.regime.irrigation), dtSols);
        arm.batch.rootTemperatureC = rootC;
        const env = {
            temperatureC: arm.regime.targetC,
            rootTemperatureC: rootC,
            co2PartialKpa: 0.09,
            o2PartialKpa: 18,
            lightFraction: arm.regime.light * resources.energyFraction,
            waterFraction: clamp01(resources.waterFraction) / Math.max(0.2, arm.regime.irrigation),
            nutrients: {
                n: clamp01(resources.nutrientFraction),
                p: clamp01(resources.nutrientFraction),
                k: clamp01(resources.nutrientFraction),
            },
            waterlogRatio: Math.max(0, arm.regime.irrigation - 1.2),
            sol, dtSols,
        };
        stepBatch(arm.batch, env);
        const demand = DEEP_P.experimentAreaM2 * DEEP_P.cropWaterLPerM2PerSol * arm.regime.irrigation * dtSols;
        arm.waterL += demand;
        waterL += demand;
        const kwh = DEEP_P.experimentAreaM2 * DEEP_P.lampKwPerM2 * DEEP_P.photoperiodHours * arm.regime.light * dtSols;
        arm.energyKwh += kwh;
        energyKwh += kwh;
        const hours = DEEP_P.experimentLabourHoursPerSol * dtSols * resources.labourFraction;
        arm.labourHours += hours;
        labourHours += hours;
        const nutrient = DEEP_P.experimentAreaM2 * DEEP_P.cropKgPerM2PerSol * 0.01 * arm.regime.feedRate * dtSols;
        nutrientKg += nutrient;
        arm.batch.lastTendSol = sol;
    }
    return { waterL, energyKwh, labourHours, nutrientKg };
}
/** Завершение эксперимента: сравниваем режимы по реальным результатам. */
export function finishExperiment(experiment) {
    const yieldOf = (arm) => arm.batch.expectedKg * clamp01(arm.batch.development) * clamp01(arm.batch.health) * (1 - arm.batch.yieldPenalty);
    for (const arm of [experiment.a, experiment.b]) {
        arm.yieldKg = yieldOf(arm);
        arm.quality = clamp01(1 - arm.batch.yieldPenalty * 0.8 - Math.max(0, arm.batch.contamination - 0.2));
    }
    experiment.status = 'done';
    const diff = experiment.a.yieldKg - experiment.b.yieldKg;
    const winner = Math.abs(diff) < 0.05 ? 'tie' : diff > 0 ? 'a' : 'b';
    const risks = [];
    for (const arm of [experiment.a, experiment.b]) {
        if (arm.batch.stress > 0.3)
            risks.push(`${arm.label}: стресс ${(arm.batch.stress * 100).toFixed(0)} %`);
        if (arm.batch.saltIndex > 0.4)
            risks.push(`${arm.label}: соли ${(arm.batch.saltIndex * 100).toFixed(0)} %`);
        if (arm.regime.irrigation > 1.4)
            risks.push(`${arm.label}: риск заливания корней`);
        if (arm.regime.targetC > 26)
            risks.push(`${arm.label}: перегрев`);
    }
    experiment.risk = risks.length ? risks.join('; ') : null;
    return {
        id: experiment.id, sols: experiment.sols,
        a: { yieldKg: experiment.a.yieldKg, quality: experiment.a.quality, waterL: experiment.a.waterL, energyKwh: experiment.a.energyKwh, labourHours: experiment.a.labourHours },
        b: { yieldKg: experiment.b.yieldKg, quality: experiment.b.quality, waterL: experiment.b.waterL, energyKwh: experiment.b.energyKwh, labourHours: experiment.b.labourHours },
        winner, risk: experiment.risk,
    };
}
export function recipeFromExperiment(experiment, id, sol) {
    const winner = experiment.a.yieldKg >= experiment.b.yieldKg ? experiment.a : experiment.b;
    return {
        id,
        name: experiment.name,
        regime: { ...winner.regime },
        sourceExperimentId: experiment.id,
        solCreated: sol,
        evidence: {
            yieldKg: winner.yieldKg, quality: winner.quality,
            waterL: winner.waterL, energyKwh: winner.energyKwh,
        },
    };
}
/** Сводка лаборатории для интерфейса. */
