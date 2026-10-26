/**
 * Server-owned prototype ruleset. Values are deliberately versioned and remain
 * release-blocked until product/economy review; no client-supplied costs/rates.
 */
export const COLONY_RULESET_VERSION = 4;
export const COLONY_RULESET_STATUS = 'internal-review' as const;
export const RESOURCE_KEYS = ['metal', 'water', 'power', 'science'] as const;
export type Resource = typeof RESOURCE_KEYS[number];
export type BuildingKind = 'solar_array' | 'water_recycler' | 'metal_extractor';
export type ResearchId = 'resource_efficiency' | 'hydrology' | 'metallurgy' | 'solar_grid';

export interface BuildingRule {
  cost: Readonly<Record<Resource, number>>;
  durationSeconds: number;
  production: Partial<Readonly<Record<Resource, number>>>;
}

/** Provisional internal-review costs; not a released or approved economy offer. */
export const LAB_UPGRADE_BASE = Object.freeze({
  cost: Object.freeze({ metal: 100, water: 50, power: 100, science: 75 }) as Readonly<Record<Resource, number>>,
  durationSeconds: 12 * 60 * 60,
})

export const BUILDINGS: Readonly<Record<BuildingKind, BuildingRule>> = Object.freeze({
  solar_array: {
    cost: { metal: 100, water: 20, power: 50, science: 0 },
    durationSeconds: 60 * 60,
    production: { power: 20 },
  },
  water_recycler: {
    cost: { metal: 150, water: 30, power: 100, science: 0 },
    durationSeconds: 2 * 60 * 60,
    production: { water: 10 },
  },
  metal_extractor: {
    cost: { metal: 200, water: 50, power: 100, science: 0 },
    durationSeconds: 3 * 60 * 60,
    production: { metal: 8 },
  },
});

export const RESEARCH: Readonly<Record<ResearchId, {
  cost: Readonly<Record<Resource, number>>;
  durationSeconds: number;
  productionBonusBps: number;
  productionBonusResource?: Resource;
  prerequisites: readonly ResearchId[];
}>> = Object.freeze({
  resource_efficiency: {
    cost: { metal: 50, water: 0, power: 50, science: 20 },
    durationSeconds: 4 * 60 * 60,
    productionBonusBps: 1_000,
    prerequisites: [],
  },
  hydrology: {
    cost: { metal: 40, water: 30, power: 20, science: 30 },
    durationSeconds: 6 * 60 * 60,
    productionBonusBps: 2_500,
    productionBonusResource: 'water',
    prerequisites: ['resource_efficiency'],
  },
  metallurgy: {
    cost: { metal: 60, water: 10, power: 30, science: 30 },
    durationSeconds: 8 * 60 * 60,
    productionBonusBps: 2_500,
    productionBonusResource: 'metal',
    prerequisites: ['resource_efficiency'],
  },
  solar_grid: {
    cost: { metal: 45, water: 10, power: 40, science: 25 },
    durationSeconds: 7 * 60 * 60,
    productionBonusBps: 2_500,
    productionBonusResource: 'power',
    prerequisites: ['resource_efficiency'],
  },
});

export const BASE_CAPACITY: Readonly<Record<Resource, number>> = Object.freeze({
  metal: 1_000, water: 1_000, power: 1_000, science: 500,
});

export const STARTER_INITIAL_RESOURCES: Readonly<Record<Resource, number>> = Object.freeze({
  metal: 500, water: 500, power: 500, science: 50,
});

export function validBuildingKind(value: unknown): value is BuildingKind {
  return typeof value === 'string' && Object.hasOwn(BUILDINGS, value);
}

export function validResearchId(value: unknown): value is ResearchId {
  return typeof value === 'string' && Object.hasOwn(RESEARCH, value);
}
