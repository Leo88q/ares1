export interface CompostBatch {
    id: string;
    /** Входная масса, кг (растительные остатки + испорченная еда). */
    inputKg: number;
    startSol: number;
    readySol: number;
    /** Прогресс 0…1. */
    progress: number;
    /** Затрачено энергии, kWh. */
    kwh: number;
    /** Затрачено труда, человеко-часов. */
    hours: number;
    done: boolean;
}
export declare function createCompostBatch(id: string, inputKg: number, sol: number): CompostBatch;
/** Шаг компостирования. Возвращает затраты за шаг и готовый компост. */
export declare function stepComposting(batches: CompostBatch[], dtSols: number, budget: {
    energyFraction: number;
    labourFraction: number;
    inputLimitKg: number;
}): {
    compostKg: number;
    kwh: number;
    hours: number;
};
/** Компост → питательные элементы. Доля возврата меньше 100 %. */
export declare function compostToNutrients(compostKg: number): {
    n: number;
    p: number;
    k: number;
};
/** Сколько килограммов отходов можно принять сейчас (ёмкость переработки). */
/** Потери: что уходит безвозвратно при переработке (CO2, испарение). */
/** Изношенные расходники: в этой итерации не перерабатываются (явное ограничение). */
/** Оценка замкнутости: доля питательных элементов, возвращённая из отходов. */
export declare function nutrientClosureRatio(returnedKg: number, appliedKg: number): number;
