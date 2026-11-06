import type { ColonyModule, ColonyState, ModuleKind } from './simulation.js';
import { type Placement } from './layout.js';
export declare const NETWORK_TYPES: readonly ["power", "water", "return", "tunnel"];
export type NetworkType = typeof NETWORK_TYPES[number];
export interface Cell {
    x: number;
    z: number;
}
export interface ColonyNetwork {
    id: string;
    type: NetworkType;
    from: string;
    to: string;
    cells: Cell[];
}
export declare const NETWORK_CREDITS_PER_CELL: Record<NetworkType, number>;
export declare const NETWORK_COLORS: Record<NetworkType, string>;
export declare function supportsNetwork(kind: ModuleKind, type: NetworkType): boolean;
export declare function ports(m: ColonyModule, type: NetworkType): Cell[];
export declare function networkCost(network: Pick<ColonyNetwork, 'type' | 'cells'>): number;
export declare function planNetwork(state: {
    modules: readonly ColonyModule[];
}, type: NetworkType, from: string, to: string, via?: Cell): ColonyNetwork | null;
export declare function validNetwork(modules: readonly ColonyModule[], n: ColonyNetwork): boolean;
export declare function addNetwork(state: ColonyState, n: ColonyNetwork): ColonyState;
export declare function removeNetwork(state: ColonyState, id: string): ColonyState;
/** Included starter infrastructure, not a gift of spendable CR. No demolition refunds. */
export declare function starterNetworks(modules: readonly ColonyModule[]): ColonyNetwork[];
/** One migration view shared by the simulation, plan and 3D renderer. */
export declare function networksOf(state: Pick<ColonyState, 'modules' | 'networks'>): ColonyNetwork[];
export declare function placementHitsNetwork(state: ColonyState, kind: ModuleKind, at: Placement, movingId?: string): boolean;
/**
 * Пропускная способность одного канала, кВт.
 *
 * Кабель тем слабее, чем он длиннее: падение напряжения ограничивает
 * передаваемую мощность. Это не украшение — именно из-за этого далёкий модуль
 * получает меньше, даже когда на базе избыток генерации, и у игрока появляется
 * настоящий выбор: ставить компактно или тянуть вторую линию.
 *
 * Модель агрегированная (§7 «документировать агрегацию против гидравлики»),
 * не расчёт цепи: гиперболический спад, при `derateCells` канал теряет
 * половину ёмкости.
 */
export declare const linkCapacityKw: (cells: number, capacityKw: number, derateCells: number) => number;
/**
 * Сколько мощности может дойти до каждого модуля: сумма ёмкостей всех его
 * годных силовых линий. Две линии — вдвое больше, поэтому избыточная
 * прокладка кабеля действительно работает.
 */
export declare function modulePowerCapacityKw(state: Pick<ColonyState, 'modules' | 'networks'>, capacityKw: number, derateCells: number): Map<string, number>;
export interface ModuleServices {
    power: boolean;
    water: boolean;
    return: boolean;
    access: boolean;
}
/** One base utility backbone, anchored at the first habitat. Separate autonomous
 * districts are not simulated. Reachability is by explicit, currently valid edges.
 */
export declare function networkServices(state: ColonyState): Map<string, ModuleServices>;
/** Per-consumer, single-entry topology cache. Crops/wear/stocks don't change
 * connectivity. Structural keys are recomputed so even in-place route edits
 * cannot reuse stale services. No global retention or persistence.
 */
export declare function createNetworkServiceReader(): {
    read(state: ColonyState): ReadonlyMap<string, ModuleServices>;
    clear(): void;
    rebuilds(): number;
};
