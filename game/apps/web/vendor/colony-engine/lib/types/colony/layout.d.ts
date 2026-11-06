import type { ColonyModule, ModuleKind } from './simulation.js';
/** Coordinates refer to the top-left occupied cell, never to a visual-only slot.
 * Slot is retained only as a legacy identity/order hint. No persistence is added.
 */
export declare const COLONY_GRID_SIZE = 48;
export declare const COLONY_CELL_METRES = 2.4;
export declare const COLONY_MODULE_LIMIT = 256;
export type QuarterTurn = 0 | 1 | 2 | 3;
export interface Placement {
    x: number;
    z: number;
    rotation: QuarterTurn;
}
export declare const FOOTPRINTS: Record<ModuleKind, readonly [number, number]>;
export type PlacementError = 'coordinates' | 'bounds' | 'occupied' | null;
export declare function footprint(kind: ModuleKind, rotation: QuarterTurn): readonly [number, number];
export declare function modulePlacement(module: ColonyModule): Placement;
export declare function placementError(modules: readonly ColonyModule[], kind: ModuleKind, at: Placement, ignoreId?: string): PlacementError;
export declare function placementWorld(kind: ModuleKind, at: Placement): {
    x: number;
    z: number;
    width: number;
    depth: number;
};
export declare function worldCell(x: number, z: number): {
    x: number;
    z: number;
};
/** Deterministic fallback for offscreen callers. UI construction always confirms
 * an explicit position. Prefer the centre, not an expanding row from a corner.
 */
export declare function findPlacement(modules: readonly ColonyModule[], kind: ModuleKind, blocked?: (at: Placement) => boolean): Placement | null;
