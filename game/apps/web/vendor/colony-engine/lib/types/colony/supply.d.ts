import type { ColonyState } from './simulation.js';
export type LabSupplyResource = 'water' | 'nutrients' | 'spares';
/** Текущий сток колонии по ресурсу. */
export declare function colonyStock(state: ColonyState, resource: LabSupplyResource): number;
/** Списать со стока колонии. `granted === 0` означает отказ: объект возвращается тем же. */
export declare function drawFromColony(state: ColonyState, resource: LabSupplyResource, amount: number): {
    state: ColonyState;
    granted: number;
};
