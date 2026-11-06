import type { Rng } from './rng.js';
import { type CropBatch } from './growth.js';
export type SampleKind = 'water' | 'solution' | 'substrate' | 'tissue';
export interface Sample {
    id: string;
    kind: SampleKind;
    /** Откуда проба: id резервуара/теплицы/грядки. */
    sourceId: string;
    sol: number;
    /** Проба доставлена в лабораторию (иначе анализ невозможен). */
    delivered: boolean;
}
export type AnalysisKind = 'water_quality' | 'solution_composition' | 'salt_index' | 'contamination' | 'root_zone';
export declare const ANALYSIS_KINDS: readonly AnalysisKind[];
export interface AnalysisMeta {
    kind: AnalysisKind;
    sample: SampleKind;
    hours: number;
    reagents: number;
    kwh: number;
    ru: string;
    en: string;
    /** Что именно измеряет: смысл результата. */
    measures: {
        ru: string;
        en: string;
    };
}
export declare const ANALYSIS_META: Record<AnalysisKind, AnalysisMeta>;
export interface AnalysisResult {
    sol: number;
    kind: AnalysisKind;
    /** Измеренное значение в долях 0…1. */
    value: number;
    /** Половина доверительного интервала. */
    ci: number;
    /** Короткий вывод: «норма», «внимание», «опасно». */
    band: 'ok' | 'watch' | 'critical';
}
export type AnalysisStatus = 'queued' | 'running' | 'done' | 'cancelled';
export interface Analysis {
    id: string;
    kind: AnalysisKind;
    sampleId: string;
    targetId: string;
    startedSol: number | null;
    finishSol: number | null;
    /** Выполнено человеко-часов специалиста. */
    doneHours: number;
    status: AnalysisStatus;
    reagents: number;
    kwh: number;
    result: AnalysisResult | null;
}
export declare function createAnalysis(id: string, kind: AnalysisKind, sampleId: string, targetId: string): Analysis;
/**
 * Результат анализа: измеренное значение = скрытое состояние + шум прибора.
 * Точность задана параметром; игрок видит интервал, а не «истину».
 */
export declare function finishAnalysis(analysis: Analysis, sol: number, hiddenValue: number, rng: Rng): AnalysisResult;
/** Какое скрытое состояние измеряет анализ на объекте (для движка). */
export interface Regime {
    /** Целевая температура, °C. */
    targetC: number;
    /** Норма питания 0…1.5. */
    feedRate: number;
    /** Доля светового режима 0…1. */
    light: number;
    /** Доля полива от базовой потребности 0…2. */
    irrigation: number;
}
export declare const DEFAULT_REGIME: Regime;
export interface ExperimentArm {
    label: string;
    regime: Regime;
    batch: CropBatch;
    waterL: number;
    energyKwh: number;
    labourHours: number;
    yieldKg: number;
    quality: number;
}
export type ExperimentStatus = 'planned' | 'running' | 'done' | 'cancelled';
export interface Experiment {
    id: string;
    name: string;
    status: ExperimentStatus;
    startSol: number;
    sols: number;
    a: ExperimentArm;
    b: ExperimentArm;
    /** Выявленный риск: что показал опыт. */
    risk: string | null;
    /** Сохранённый производственный рецепт. */
    savedRecipeId: string | null;
}
export interface ExperimentResult {
    id: string;
    sols: number;
    a: {
        yieldKg: number;
        quality: number;
        waterL: number;
        energyKwh: number;
        labourHours: number;
    };
    b: {
        yieldKg: number;
        quality: number;
        waterL: number;
        energyKwh: number;
        labourHours: number;
    };
    winner: 'a' | 'b' | 'tie';
    risk: string | null;
}
export declare function createExperiment(id: string, name: string, sol: number, sols: number, regimeA: Regime, regimeB: Regime): Experiment;
/** Шаг эксперимента: расходует реальные ресурсы общей колонии. */
export declare function stepExperiment(experiment: Experiment, sol: number, dtSols: number, resources: {
    waterFraction: number;
    nutrientFraction: number;
    energyFraction: number;
    labourFraction: number;
}): {
    waterL: number;
    energyKwh: number;
    labourHours: number;
    nutrientKg: number;
};
/** Завершение эксперимента: сравниваем режимы по реальным результатам. */
export declare function finishExperiment(experiment: Experiment): ExperimentResult;
export interface Recipe {
    id: string;
    name: string;
    regime: Regime;
    sourceExperimentId: string | null;
    solCreated: number;
    /** Подтверждённый результат: выход, качество, вода, энергия. */
    evidence: {
        yieldKg: number;
        quality: number;
        waterL: number;
        energyKwh: number;
    } | null;
}
export declare function recipeFromExperiment(experiment: Experiment, id: string, sol: number): Recipe;
/** Сводка лаборатории для интерфейса. */
