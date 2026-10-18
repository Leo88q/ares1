import type { ColonyModule, ModuleKind } from './simulation'

/** Coordinates refer to the top-left occupied cell, never to a visual-only slot.
 * Slot is retained only as a legacy identity/order hint. No persistence is added.
 */
export const COLONY_GRID_SIZE = 48
export const COLONY_CELL_METRES = 2.4
export const COLONY_MODULE_LIMIT = 256
export type QuarterTurn = 0 | 1 | 2 | 3
export interface Placement { x: number; z: number; rotation: QuarterTurn }
export const FOOTPRINTS: Record<ModuleKind, readonly [number, number]> = {
  solar: [2, 3], greenhouse: [2, 3], habitat: [2, 2], recycler: [2, 2],
  battery: [1, 2], rover: [2, 2], workshop: [2, 2],
}
export type PlacementError = 'coordinates' | 'bounds' | 'occupied' | null

export function footprint(kind: ModuleKind, rotation: QuarterTurn): readonly [number, number] {
  const [w, d] = FOOTPRINTS[kind]
  return rotation % 2 ? [d, w] : [w, d]
}
export function modulePlacement(module: ColonyModule): Placement {
  // Read old session fixtures without changing their accounts or resource ledger.
  return module.placement ?? { x: 12 + module.slot % 6 * 4, z: 14 + Math.floor(module.slot / 6) * 4, rotation: 0 }
}
export function placementError(modules: readonly ColonyModule[], kind: ModuleKind, at: Placement, ignoreId?: string): PlacementError {
  if (![at.x, at.z, at.rotation].every(Number.isInteger) || at.rotation < 0 || at.rotation > 3) return 'coordinates'
  const [w, d] = footprint(kind, at.rotation)
  if (at.x < 0 || at.z < 0 || at.x + w > COLONY_GRID_SIZE || at.z + d > COLONY_GRID_SIZE) return 'bounds'
  for (const m of modules) {
    if (m.id === ignoreId) continue
    const p = modulePlacement(m), [mw, md] = footprint(m.kind, p.rotation)
    if (at.x < p.x + mw && at.x + w > p.x && at.z < p.z + md && at.z + d > p.z) return 'occupied'
  }
  return null
}
export function placementWorld(kind: ModuleKind, at: Placement): { x: number; z: number; width: number; depth: number } {
  const [w, d] = footprint(kind, at.rotation)
  return { x: (at.x + w / 2 - COLONY_GRID_SIZE / 2) * COLONY_CELL_METRES,
    z: (at.z + d / 2 - COLONY_GRID_SIZE / 2) * COLONY_CELL_METRES,
    width: w * COLONY_CELL_METRES, depth: d * COLONY_CELL_METRES }
}
export function worldCell(x: number, z: number): { x: number; z: number } {
  return { x: Math.floor(x / COLONY_CELL_METRES + COLONY_GRID_SIZE / 2), z: Math.floor(z / COLONY_CELL_METRES + COLONY_GRID_SIZE / 2) }
}
/** Deterministic fallback for offscreen callers. UI construction always confirms
 * an explicit position. Prefer the centre, not an expanding row from a corner.
 */
export function findPlacement(modules: readonly ColonyModule[], kind: ModuleKind, blocked?: (at: Placement) => boolean): Placement | null {
  for (const rotation of [0, 1] as const) {
    for (let radius = 0; radius < COLONY_GRID_SIZE; radius++) {
      for (let z = Math.max(0, 23 - radius); z <= Math.min(47, 23 + radius); z++) {
        for (let x = Math.max(0, 23 - radius); x <= Math.min(47, 23 + radius); x++) {
          if (Math.max(Math.abs(x - 23), Math.abs(z - 23)) !== radius) continue
          const at: Placement = { x, z, rotation }
          if (!placementError(modules, kind, at) && !blocked?.(at)) return at
        }
      }
    }
  }
  return null
}
