export type ColonySkuId =
  | "STARTER_COLONY_V1"
  | "RESEARCH_WING_V1"
  | "FRONTIER_EXPANSION_V1"
  | "INDUSTRIAL_NETWORK_V1"

type PackageDraft = {
  id: ColonySkuId
  name: string
  priceSkr: string
  priceStatus: "owner-proposed" | "owner-approved"
  requires: ColonySkuId[]
  grants: {
    fields: number
    labLevelCap: number
    buildQueues: number
    researchQueues: number
    storageMultiplier: number
    core: boolean
    lab: boolean
  }
  randomized: false
}

/**
 * Owner-approved expansion specification, deliberately NOT a sale configuration:
 * the API always reports purchasable=false until the matching on-chain SKU
 * catalog, verified mainnet mint/treasury, and launch approvals exist.
 */
export const COLONY_PACKAGE_CATALOG: readonly PackageDraft[] = Object.freeze([
  {
    id: "STARTER_COLONY_V1",
    name: "Starter Colony",
    priceSkr: "1053",
    priceStatus: "owner-proposed",
    requires: [],
    grants: {
      fields: 1,
      labLevelCap: 1,
      buildQueues: 1,
      researchQueues: 1,
      storageMultiplier: 1,
      core: true,
      lab: true,
    },
    randomized: false,
  },
  {
    id: "RESEARCH_WING_V1",
    name: "Research Wing",
    priceSkr: "1053",
    priceStatus: "owner-approved",
    requires: ["STARTER_COLONY_V1"],
    grants: {
      fields: 0,
      labLevelCap: 2,
      buildQueues: 0,
      researchQueues: 1,
      storageMultiplier: 2,
      core: false,
      lab: false,
    },
    randomized: false,
  },
  {
    id: "FRONTIER_EXPANSION_V1",
    name: "Frontier Expansion",
    priceSkr: "2106",
    priceStatus: "owner-approved",
    requires: ["STARTER_COLONY_V1"],
    grants: {
      fields: 2,
      labLevelCap: 0,
      buildQueues: 1,
      researchQueues: 0,
      storageMultiplier: 2,
      core: false,
      lab: false,
    },
    randomized: false,
  },
  {
    id: "INDUSTRIAL_NETWORK_V1",
    name: "Industrial Network",
    priceSkr: "4212",
    priceStatus: "owner-approved",
    requires: ["STARTER_COLONY_V1"],
    grants: {
      fields: 4,
      labLevelCap: 4,
      buildQueues: 1,
      researchQueues: 1,
      storageMultiplier: 4,
      core: false,
      lab: false,
    },
    randomized: false,
  },
])

export function colonyPackageCatalogResponse() {
  return {
    status: "design-only" as const,
    saleOpen: false as const,
    purchasable: false as const,
    paymentAsset: "SKR" as const,
    targetChain: "mainnet-beta" as const,
    packages: COLONY_PACKAGE_CATALOG,
    notice:
      "Каталог — утверждённая спецификация расширений, не оферта. Покупки закрыты; SKR не отправлять. Starter 1053 SKR остаётся гипотезой. Старый маршрут 1053 SKR создавал одно поле и не является этим пакетом.",
  }
}
