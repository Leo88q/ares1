/** Текущий сток колонии по ресурсу. */
export function colonyStock(state, resource) {
    return resource === 'water' ? state.waterLitres
        : resource === 'nutrients' ? state.nutrientsKg
            : state.sparesKg;
}
/** Списать со стока колонии. `granted === 0` означает отказ: объект возвращается тем же. */
export function drawFromColony(state, resource, amount) {
    if (!Number.isFinite(amount) || amount <= 0)
        return { state, granted: 0 };
    const stock = colonyStock(state, resource);
    const granted = resource === 'spares' ? Math.min(Math.floor(amount), Math.floor(stock)) : Math.min(amount, stock);
    if (!(granted > 0))
        return { state, granted: 0 };
    const next = resource === 'water' ? { ...state, waterLitres: state.waterLitres - granted }
        : resource === 'nutrients' ? { ...state, nutrientsKg: state.nutrientsKg - granted }
            : { ...state, sparesKg: state.sparesKg - granted };
    return { state: next, granted };
}
