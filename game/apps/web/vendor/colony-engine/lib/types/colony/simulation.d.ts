/**
 * A deterministic, LOCAL design sandbox, not the Solana economy or flight software.
 * Units: Earth days, kWh, litres, kg, crew-hours and non-convertible game credits.
 * Evidence, assumptions and deliberately omitted physics: docs/LUNAR_FARM_PLAN.md.
 * No wallet, RPC, token mint, random reward, price oracle or background accrual.
 */
export type ModuleKind = 'solar' | 'greenhouse' | 'habitat' | 'recycler' | 'rover' | 'workshop' | 'battery' | 'extractor' | 'depot' | 'purifier' | 'lab';
import { type ColonyNetwork, type ModuleServices } from './networks.js';
import { type Placement } from './layout.js';
import { PARAMETERS } from '../organism/parameters.js';
import { type UnifiedBase } from '../organism/unified.js';
import type { ColonyWorld } from './deep/world.js';
export { PARAMETERS };
export declare const CATALOG: Record<ModuleKind, {
    credits: number;
    wearDay: number;
    file: string;
    color: string;
}>;
export declare const MODULE_KINDS: ModuleKind[];
export declare const SLOTS: {
    x: number;
    z: number;
}[];
export interface ColonyModule {
    id: string;
    kind: ModuleKind;
    slot: number;
    placement?: Placement;
    condition: number;
    growthDays: number;
    /**
     * WP10 (§14.3): greenhouse beds, one value per bed (K = BEDS.perField). Value = days of growth,
     * 0 ≤ v < cycle while growing; negative = not yet planted (staggered by cycle / K). growthDays mirrors
     * beds[0]. Missing (legacy saves) → derived from growthDays.
     */
    beds?: number[];
    /** Cumulative kg collected from this greenhouse's beds (each completed bed cycle, 36 kg by default). */
    bedsHarvestedKg?: number;
}
export interface Scenario {
    sunHours: number;
    waterRecovery: number;
}
export declare const DEFAULT_SCENARIO: Scenario;
export interface ColonyState {
    day: number;
    networks?: ColonyNetwork[];
    batteryCharge?: Record<string, number>;
    modules: ColonyModule[];
    crew: number;
    credits: number;
    spentCredits: number;
    earnedCredits: number;
    waterLitres: number;
    nutrientsKg: number;
    sparesKg: number;
    foodKg: number;
    oxygenKg: number;
    oxygenShortfallKg: number;
    batteryKwh: number;
    harvestedKg: number;
    consumedFoodKg: number;
    foodShortfallKg: number;
    deliveredKg: number;
    lastDay: DayBudget | null;
    /**
     * Deep colony world: physical stocks, equipment, deposits, haulage, lab, faults.
     * Owns water / nutrients / spares / oxygen / batteries; `ledger` owns food mass.
     * Absent in states restored from an older session — created on the first day.
     */
    world?: ColonyWorld;
    /** Single source of truth for food, beds and harvest (organism/unified.ts). The fields above are views of it. */
    ledger: UnifiedBase;
}
export interface DayBudget {
    growthByModule?: Record<string, number>;
    batteryByModule?: Record<string, number>;
    generationKwh: number;
    demandKwh: number;
    servedKwh: number;
    unmetKwh: number;
    curtailedKwh: number;
    batteryChargeInputKwh: number;
    batteryDischargeOutputKwh: number;
    batteryEndKwh: number;
    essentialPowerFraction: number;
    cropPowerFraction: number;
    cropAreaM2: number;
    recovery: number;
    waterUsedLitres: number;
    waterNeededLitres: number;
    /** Makeup water for crew + leaks only; crop and electrolysis water are charged by the deep world. */
    waterCrewMakeupL: number;
    waterShortfallLitres: number;
    nutrientsUsedKg: number;
    growthFraction: number;
    workHours: number;
    availableWorkHours: number;
    oxygenProducedKg: number;
    oxygenDemandKg: number;
    oxygenShortfallKg: number;
    oxygenVentedKg: number;
    oxygenEndKg: number;
    /** Filled in by the deep layer; absent for a pure aggregate projection. */
    deep?: import('./deep/bridge.js').DeepDayExtras;
}
/** Starting food (kg). 120 kg lets a colony with no repairs get through the first full crop cycle plus 30 days
 *  without shortfall (80 kg ran out on day 112). Owner balance decision — see docs/ORGANISM_INTEGRATION.md §29. */
export declare const INITIAL_FOOD_KG = 120;
export declare function initialColony(): ColonyState;
/** Recompute every view field from the ledger, so the UI and old tests read the same numbers as the ledger. */
export declare function syncView(state: ColonyState): ColonyState;
export declare function greenhouseBeds(leadDays: number): number[];
/** Grow every bed by `growth` days; a bed that completes one cycle is harvested and restarts from the excess. */
export declare function stepBeds(beds: readonly number[], growth: number): {
    beds: number[];
    completed: number;
};
/**
 * Per-bed summary for the colony screen. Planted = bed value ≥ 0 (values never go negative again once planted).
 * Ripe = inside the maturity window (≥ 80 % of the cycle, M2) but not yet collected. The colony model collects a
 * bed automatically at 100 % of the cycle, so "ripe" is the pre-harvest window, not a separate manual action.
 */
export type BedState = 'waiting' | 'growing' | 'ripe';
export interface BedSummary {
    beds: Array<{
        state: BedState;
        progress: number;
    }>;
    planted: number;
    ripe: number;
    total: number;
    collectedKg: number;
}
export declare function bedSummary(m: ColonyModule): BedSummary;
/** kg of one bed at full cycle: area × yield × cycle ÷ K (216 kg / 6 = 36 kg for the default greenhouse). */
export declare const bedCycleKg: () => number;
/**
 * Manual harvest of one greenhouse bed (§31.12, flag VITE_COLONY_MANUAL_HARVEST). One rule for the whole base
 * (organism/unified.ts): factor from harvestFactor (T2 30–80 %, window to 120 %), refused when storage is full.
 */
export declare function canHarvestBed(state: ColonyState, moduleId: string, index: number): boolean;
export declare function harvestBed(state: ColonyState, moduleId: string, index: number): ColonyState;
export declare const countModules: (s: ColonyState, kind: ModuleKind) => number;
export declare const batteryCapacity: (s: ColonyState) => number;
export declare const foodDemand: (s: ColonyState) => number;
export declare const foodReserve: (s: ColonyState) => number;
export declare function batteryStocks(state: ColonyState): Record<string, number>;
/** Daily aggregate energy dispatch. It does NOT resolve within-day blackouts. */
export declare function dailyBudget(state: ColonyState, scenario?: Scenario): DayBudget;
/**
 * Advance one sol.
 *
 * Division of labour (see colony/deep/bridge.ts): `dailyBudget` is the power and
 * labour projection, the deep world is the single writer of physical stocks, and
 * the unified ledger is the single writer of food mass. The deep layer converts
 * the aggregate growth potential into real bed-days, so a shortage of power,
 * water, CO2, labour or equipment is felt as slower growth or lost yield — not
 * as a second, disconnected counter.
 */
export declare function advanceDay(state: ColonyState, scenario?: Scenario): ColonyState;
export declare function advanceDays(state: ColonyState, days: number, scenario?: Scenario): ColonyState;
export declare function canBuild(state: ColonyState, kind: ModuleKind): boolean;
/** Atomic: invalid geometry or insufficient resources returns the SAME state.
 * No preview spends resources; confirm validates the newest session snapshot.
 */
export declare function buildModuleAt(state: ColonyState, kind: ModuleKind, at: Placement): ColonyState;
export declare function buildModule(state: ColonyState, kind: ModuleKind): ColonyState;
/** Repositioning doesn't mint credits, reset wear, replant beds or alter the ledger. */
export declare function moveModule(state: ColonyState, id: string, at: Placement): ColonyState;
export declare function canRepair(state: ColonyState): boolean;
export declare function repairColony(state: ColonyState): ColonyState;
export declare function buySupplies(state: ColonyState): ColonyState;
export declare function sellableKg(state: ColonyState, services?: ReadonlyMap<string, ModuleServices>): number;
export declare function deliverFood(state: ColonyState): ColonyState;
