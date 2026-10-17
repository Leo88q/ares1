/**
 * Single source of organism parameters (docs/ORGANISM_INTEGRATION.md, WP1).
 * Values are moved verbatim from the engines: no behaviour change in this step.
 * Off-chain game assumptions are NOT validated agriculture or lunar engineering data.
 */

// --- Farm: ARES-LAB/2 (hourly engine, off-chain) ---
export const LAB = Object.freeze({
  version: 'ARES-LAB/2', solHours: 24.66, tickHours: 0.25,
  maxAdvanceHours: 24.66 * 7, maxHours: 24.66 * 60,
  growthLightHours: 96, lightHoursPerSol: 16,
  batteryCapacityKwh: 12, batteryInitialKwh: 8,
  chargeEfficiency: 0.9, dischargeEfficiency: 0.9,
  solarPeakKw: 3.2, lampKw: 0.7, pumpKw: 0.08, coolerKw: 0.12, processorKw: 0.35,
  tankCapacityL: 120, tankInitialL: 100, supplyInitialL: 240,
  // T5 (approved, H): line buffer 6 → 2 L, so a pump outage bites within hours, not a day.
  lineCapacityL: 2, lineInitialL: 2, pumpRateLph: 3,
  // T4 (approved, H): nominal cycle from planting to ripeness at ideal conditions (measured 148 h).
  // Harvest after this loses yield linearly, reaching 0 at 2 × nominalCycleHours.
  nominalCycleHours: 148,
  nutrientsInitialKg: 0.65, nutrientsPerCycleKg: 0.16,
  seedsInitial: 3, sparesInitial: 3, harvestKg: 18, storageCapacityKg: 45,
  // Colony link (FIELD LAB product, 2026-10-17): ceilings for what the base may
  // hand to one greenhouse bench. They bound the transfers; nothing here creates
  // mass on its own — every litre/kg/part is deducted from the colony stock.
  supplyCapacityL: 480, nutrientCapacityKg: 2, sparesCapacity: 9,
  rawShelfHours: 72, processedShelfHours: 336, coldAgeFactor: 0.12,
  // T1/T3 (approved to proceed, H): heat stress above 22 °C and slower stress from pump/water loss
  heatStressAboveC: 22, heatStressPerCHour: 0.0004,
  irrigationStressPerHour: 0.014, // was 0.028 in ARES-LAB/2; halved (T3)
  overripeHours: 240, // H (WP11): 120 % window closes 48 h after maturity; not validated (raised from 120 after browser check: 7-sol wait missed the window)
  processorRateKgph: 0.7, processingYield: 0.85, processBatchKg: 5,
  maxLots: 12, maxHistory: 192, maxEvents: 40,
  initialTemperatureC: 20, targetTemperatureC: 20, minTargetC: 12, maxTargetC: 26,
  thermalCapacityKwhPerC: 0.9, envelopeKwPerC: 0.006,
  heaterKw: 0.9, climateCoolerKw: 0.45, climateCoolingCop: 2.4,
  thermostatResponseHours: 2, lampHeatFraction: 0.65,
  evapFraction: 0.55, latentKwhPerL: 0.68,
  outsideMinC: -52, outsideDayAmplitudeC: 28, coldEventDropC: 26,

})

// --- Colony: daily aggregate simulation (off-chain) ---
export const PARAMETERS = {
  solarFluxKwM2: 1.361, // NASA TSI at ~1 AU; not surface generation.
  panelAreaM2: 40,
  panelEfficiency: 0.28, // Design assumption, not a vendor specification.
  panelDerating: 0.8,
  cropAreaM2: 20,
  cropCycleDays: 90,
  cropKgM2Day: 0.12, // Design target: 10.8 kg/m²/90 days, not a lunar measurement.
  cropEvapLitresM2Day: 4.3, // Midpoint within Wheeler's terrestrial CEA range, 3.4–5.2.
  cropWaterBoundLitresKg: 0.8, // Water retained in growing edible biomass.
  cropNutrientKgPerKg: 0.01,
  ledKwM2: 0.2,
  photoperiodHours: 16,
  cropUtilitiesKwM2: 0.04, // Pumps + climate placeholder; no thermal/radiation model.
  habitatKwhDay: 24,
  crewPerHabitat: 4,
  crewWaterLitresDay: 3.8,
  freshFoodKgCrewDay: 0.5, // A fresh-food supplement, NOT a complete diet.
  crewO2KgDay: 0.84, // Typical resting-to-light-work metabolic O2 use per person; design value.
  cropO2KgPerKgFresh: 0.25, // Photosynthetic O2 per kg fresh biomass; design assumption, not a measurement.
  recyclerO2KgDay: 1.6, // Electrolysis output per recycler at full power; design target.
  electrolysisKwhKgO2: 15, // Practical electrolysis energy per kg O2; design assumption (theory is ~5).
  electrolysisWaterKgPerKgO2: 1.125, // Stoichiometry: 2 H2O -> 2 H2 + O2, 36 g water per 32 g O2.
  oxygenStartKg: 30, // About 9 days of full crew demand at the starting crew of 4.
  oxygenTankKg: 60, // Surplus above this is vented, not stored.
  leakLitresDay: 1,
  recyclerLitresDay: 120,
  recyclerKwhLitre: 0.03,
  roverKwhDay: 4,
  workshopKwhDay: 2,
  batteryKwh: 100,
  batteryChargeEfficiency: 0.9,
  batteryDischargeEfficiency: 0.9,
  workHoursCrewDay: 6,
  cropWorkHoursM2Day: 0.08,
  reserveDays: 14,
  initialCredits: 1400,
  contractKg: 60,
  contractCreditsKg: 4,
  repairCredits: 20,
  repairSparesKg: 2,
  supplyCredits: 80,
  supplyWaterLitres: 100,
  supplyNutrientKg: 1,
  supplySparesKg: 2,
  maxDays: 365,
} as const

// --- Economy mirror: values copied from programs/solana_potato/src/lib.rs (WP1) ---
// Parity is enforced by tests/organism-parameters.test.mjs against the Rust source.
// Prices stay as in the game (docs/ORGANISM_INTEGRATION.md §17).
export const ECONOMY = Object.freeze({
  baseFieldPriceMicro: 250_000_000,       // BASE_FIELD_PRICE_MICRO (250 POTATO)
  baseTaxMicro: 6_000_000,                // BASE_TAX_MICRO (6 POTATO / week)
  baseRepairMicro: 15_000_000,            // BASE_REPAIR_MICRO
  baseFertilizerMicro: 10_000_000,        // BASE_FERTILIZER_MICRO
  baseUpgradeMicro: 100_000_000,          // BASE_UPGRADE_MICRO (× level)
  baseYieldMicroPerDay: 6_000_000,        // DEFAULT_BASE_YIELD_MICRO_PER_DAY
  exportLicenseSkrAtoms: 500_000_000n,    // EXPORT_LICENSE_PRICE_SKR_ATOMS
  presaleSkrAtoms: 1_053_000_000n,        // PRESALE_PRICE_SKR_ATOMS
  feeBurnPercent: 60,                     // FEE_BURN_PERCENT
  tiers: [
    { name: 'Common', yieldBps: 3_500, costBps: 4_000 },
    { name: 'Rare', yieldBps: 10_000, costBps: 10_000 },
    { name: 'Epic', yieldBps: 21_000, costBps: 20_000 },
  ] as const,
})

// --- Slots and beds (docs/ORGANISM_INTEGRATION.md §14–19, decisions accepted) ---
export const SLOTS = Object.freeze({
  freePerField: 6,                        // first 6 slots free (S3)
  maxPerField: 12,                        // cap 12 slots per field (S3)
  priceSkrAtoms: 500_000_000n,            // 500 SKR per paid slot (§18)
  ownershipAuthority: 'server-signed-record', // S7 (§19)
})
export const BEDS = Object.freeze({
  perField: 6,                            // M1: K = 6 beds, staggered
  harvestWindowMinRatio: 0.8,             // M2: 80 %…
  harvestWindowMaxRatio: 1.2,             // …120 % of maturity age
  earlyHarvestMinRatio: 0.3,              // T2 (approved, H): early harvest from 30 % maturity…
  earlyHarvestFactorAt80: 0.5,            // …with factor 0.5 × r / 0.8, i.e. 0.5 at the 80 % window start
})

// --- Market as entry and whale growth (docs/ORGANISM_INTEGRATION.md §14.6, §15 M3–M4, WP13/WP14) ---
// Approved by the owner: E-A (market only) + E-C (micro-field), K-A (growing N-th field price) + K-C (colony pads).
// Numbers are hypotheses (H) from §14.6: they are checked by tests/offchain/marketEntry.test.ts, not validated.
export const MARKET = Object.freeze({
  microFieldPriceMicro: 25_000_000,       // E-C: micro-field costs 25 POTATO (H)
  microFieldScale: 0.25,                  // E-C: micro-field yield and tax scale with price (25 / 100), so payback matches Common (H)
  priceGrowthPerField: 0.05,              // K-A: field N costs base × (1 + α·N), N = fields the wallet already owns (α = 0.05, H)
  colonyLinkedFieldCap: 24,               // K-C: colony-linked fields ≤ colony pads (SLOTS.length in colony/simulation.ts)
})
