export type TierIndex = 0 | 1 | 2;
/** SKR atoms needed to occupy slot `index` (0-based). */
export declare function slotPriceSkrAtoms(index: number): bigint;
/** Total SKR atoms to fill `occupied` slots on one field (0…maxPerField). */
export declare function totalSlotCostSkrAtoms(occupied: number): bigint;
/** POTATO micro price of a bed = field price of the same tier (§18). */
export declare function bedPriceMicro(tier: TierIndex): number;
/** Start offset of bed `i` (0-based) inside one crop cycle, in the same units as cycleDays. */
export declare function bedOffsetDays(i: number, cycleDays: number, beds?: number): number;
/** Kilograms harvested from one bed per cycle at full quality: an equal share of the field cycle. */
export declare function bedCycleKg(fieldCycleKg: number, beds?: number): number;
/**
 * Harvest factor by maturity ratio r = age / maturityAge.
 *  r < 0.3            → 0 (not allowed yet)
 *  0.3 ≤ r < 0.8      → early harvest, 0.5 × r / 0.8 (T2, H: a small harvest for an early pick)
 *  0.8 ≤ r < 1.0      → ramp 0.5 → 1.0 (H)
 *  1.0 ≤ r ≤ 1.2      → ramp 1.0 → 0.5 (H, late harvest loses quality)
 *  r > 1.2            → 0 (window closed; spoiled)
 */
export declare function harvestFactor(ratio: number): number;
/**
 * WP10 flow (§14.3). K beds are planted at t = 0 with offsets i × cycle / K. Bed i reaches
 * maturity at offset_i + cycle; the player harvests it there (ratio 1, full window factor).
 * Returns one event per bed in the first cycle after the first maturity.
 * Sum over one cycle = field cycle kg; one bed is ready every cycle / K days.
 */
export interface BedHarvestEvent {
    bed: number;
    day: number;
    kg: number;
}
export declare function bedHarvestSchedule(fieldCycleKg: number, cycleDays: number, beds?: number, ratio?: number): BedHarvestEvent[];
/** Kilograms in the half-open day interval [from, to) for a list of harvest events. */
export declare function kgInInterval(events: readonly BedHarvestEvent[], from: number, to: number): number;
