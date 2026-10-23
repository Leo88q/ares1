import { BASE_CAPACITY, RESOURCE_KEYS } from './rules.js'
import type { Resource } from './rules.js'

export type ColonySkuId =
  | 'STARTER_COLONY_V1'
  | 'RESEARCH_WING_V1'
  | 'FRONTIER_EXPANSION_V1'
  | 'INDUSTRIAL_NETWORK_V1'

export interface ColonyGrants {
  skuIds: readonly ColonySkuId[]
  /** Total eligible Fields attachable to the Colony; does not mint/create Fields. */
  fieldSlots: number
  labLevelCap: number
  buildQueues: number
  researchQueues: number
  storageMultipliers: Readonly<Record<Resource, number>>
  core: boolean
  lab: boolean
}

type PackageDraft = {
  id: ColonySkuId
  name: string
  priceSkr: string
  priceStatus: 'owner-proposed' | 'owner-approved'
  requires: ColonySkuId[]
  grants: {
    fields: number
    labLevelCap: number
    buildQueues: number
    researchQueues: number
    storageMultipliers: Readonly<Record<Resource, number>>
    core: boolean
    lab: boolean
  }
  randomized: false
}

const storage = (metal: number, water: number, power: number, science: number): Readonly<Record<Resource, number>> => ({ metal, water, power, science })

/**
 * Owner-approved expansion specification, deliberately NOT a sale configuration:
 * the API always reports purchasable=false until fulfillment and release gates exist.
 */
export const COLONY_PACKAGE_CATALOG: readonly PackageDraft[] = Object.freeze([
  {
    id: 'STARTER_COLONY_V1',
    name: 'Starter Colony',
    priceSkr: '1053',
    priceStatus: 'owner-proposed',
    requires: [],
    grants: {
      fields: 1,
      labLevelCap: 1,
      buildQueues: 1,
      researchQueues: 1,
      storageMultipliers: storage(1, 1, 1, 1),
      core: true,
      lab: true,
    },
    randomized: false,
  },
  {
    id: 'RESEARCH_WING_V1',
    name: 'Research Wing',
    priceSkr: '1053',
    priceStatus: 'owner-approved',
    requires: ['STARTER_COLONY_V1'],
    grants: {
      fields: 0,
      labLevelCap: 2,
      buildQueues: 0,
      researchQueues: 1,
      storageMultipliers: storage(1, 1, 1, 2),
      core: false,
      lab: false,
    },
    randomized: false,
  },
  {
    id: 'FRONTIER_EXPANSION_V1',
    name: 'Frontier Expansion',
    priceSkr: '2106',
    priceStatus: 'owner-approved',
    requires: ['STARTER_COLONY_V1'],
    grants: {
      fields: 2,
      labLevelCap: 0,
      buildQueues: 1,
      researchQueues: 0,
      storageMultipliers: storage(2, 2, 2, 2),
      core: false,
      lab: false,
    },
    randomized: false,
  },
  {
    id: 'INDUSTRIAL_NETWORK_V1',
    name: 'Industrial Network',
    priceSkr: '4212',
    priceStatus: 'owner-approved',
    requires: ['STARTER_COLONY_V1'],
    grants: {
      fields: 4,
      labLevelCap: 4,
      buildQueues: 1,
      researchQueues: 1,
      storageMultipliers: storage(4, 4, 4, 4),
      core: false,
      lab: false,
    },
    randomized: false,
  },
])

const catalogById = new Map(COLONY_PACKAGE_CATALOG.map(item => [item.id, item]))

/** Resolve additive slot grants and strongest caps across the wallet's owned SKUs. */
export function resolveColonyGrants(skuIds: readonly string[]): ColonyGrants {
  const unique = new Set<ColonySkuId>()
  for (const skuId of skuIds) {
    if (!catalogById.has(skuId as ColonySkuId)) throw new Error('UNKNOWN_COLONY_SKU')
    if (unique.has(skuId as ColonySkuId)) throw new Error('DUPLICATE_COLONY_SKU')
    unique.add(skuId as ColonySkuId)
  }
  if (!unique.has('STARTER_COLONY_V1')) throw new Error('STARTER_ENTITLEMENT_REQUIRED')

  let fieldSlots = 0
  let labLevelCap = 0
  let buildQueues = 0
  let researchQueues = 0
  let core = false
  let lab = false
  const storageMultipliers: Record<Resource, number> = { metal: 1, water: 1, power: 1, science: 1 }

  for (const skuId of unique) {
    const item = catalogById.get(skuId)!
    if (item.requires.some(required => !unique.has(required))) throw new Error('COLONY_SKU_PREREQUISITE_REQUIRED')
    fieldSlots += item.grants.fields
    labLevelCap = Math.max(labLevelCap, item.grants.labLevelCap)
    buildQueues += item.grants.buildQueues
    researchQueues += item.grants.researchQueues
    core ||= item.grants.core
    lab ||= item.grants.lab
    for (const resource of RESOURCE_KEYS) {
      storageMultipliers[resource] = Math.max(storageMultipliers[resource], item.grants.storageMultipliers[resource])
    }
  }

  return Object.freeze({
    skuIds: Object.freeze([...unique].sort()),
    fieldSlots,
    labLevelCap,
    buildQueues,
    researchQueues,
    storageMultipliers: Object.freeze(storageMultipliers),
    core,
    lab,
  })
}

export const STARTER_COLONY_GRANTS = resolveColonyGrants(['STARTER_COLONY_V1'])

export function colonyPackageCatalogResponse() {
  return {
    status: 'design-only' as const,
    saleOpen: false as const,
    purchasable: false as const,
    paymentAsset: 'SKR' as const,
    targetChain: 'mainnet-beta' as const,
    packages: COLONY_PACKAGE_CATALOG,
    notice:
      'Каталог — утверждённая спецификация расширений, не оферта. Покупки закрыты; SKR не отправлять. Starter 1053 SKR остаётся гипотезой. Старый маршрут 1053 SKR создавал одно поле и не является этим пакетом.',
  }
}

export function capacityForGrants(grants: ColonyGrants): Readonly<Record<Resource, number>> {
  return Object.freeze(Object.fromEntries(RESOURCE_KEYS.map(resource => [resource, BASE_CAPACITY[resource] * grants.storageMultipliers[resource]])) as Record<Resource, number>)
}
