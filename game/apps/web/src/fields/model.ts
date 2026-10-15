import { HARVEST_THRESHOLD_MICRO, MAX_DURABILITY } from '../utils/constants'

/** Read-only presentation data. No new accounts, yields, prices or crop clock. */
export interface FieldVisual {
  id: string
  tier: 0 | 1 | 2
  level: number
  condition: number
  active: boolean
  ready: boolean
  fertilized: boolean
  taxExpired: boolean
  mutation: number
  growth: number
  pendingMicro: number
  engineering?: { battery: number; water: number; light: number; solar: number; pumpFault: boolean; dust: boolean; flow: number; temperature: number; climate: number; climateCooling: boolean }
}

export interface FieldSnapshot {
  publicKey: { toString(): string }
  fieldType: number
  level: number
  durability: number
  isActive: boolean
  accumulated: number
  fertilizerUntil: number
  taxPaidUntil: number
  mutationType: number
}

const bounded = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? n : min))

export function fieldVisual(field: FieldSnapshot, nowSec: number): FieldVisual {
  const ready = field.accumulated >= HARVEST_THRESHOLD_MICRO
  return {
    id: field.publicKey.toString(),
    tier: Math.floor(bounded(field.fieldType, 0, 2)) as 0 | 1 | 2,
    level: Math.floor(bounded(field.level, 1, 50)),
    condition: bounded(field.durability, 0, MAX_DURABILITY) / MAX_DURABILITY,
    active: field.isActive,
    ready,
    fertilized: field.fertilizerUntil > nowSec,
    taxExpired: nowSec > field.taxPaidUntil,
    mutation: Math.floor(bounded(field.mutationType, 0, 2)),
    // Artistic interpretation of harvest readiness, NOT biological growth.
    growth: field.isActive ? ready ? 1 : 0.4 : 0,
    pendingMicro: Math.max(0, Number.isFinite(field.accumulated) ? field.accumulated : 0),
  }
}

export const FIELD_PROFILES = [
  { name: 'COMMON', rows: 3, length: 7, width: 9, accent: '#bd936d', solar: false },
  { name: 'RARE', rows: 4, length: 9, width: 9, accent: '#e59a57', solar: false },
  { name: 'EPIC', rows: 6, length: 12, width: 9, accent: '#edc16c', solar: true },
] as const

export const FIELDS_PER_PAGE = 6

/** Keep public-key selection stable across polling/reorder/removal. */
export function selectedFieldId(fields: readonly FieldVisual[], requested: string | null): string | null {
  return fields.some(field => field.id === requested) ? requested : fields[0]?.id ?? null
}

export function visibleFields(fields: readonly FieldVisual[], selectedId: string | null): readonly FieldVisual[] {
  const index = Math.max(0, fields.findIndex(field => field.id === selectedId))
  const start = Math.floor(index / FIELDS_PER_PAGE) * FIELDS_PER_PAGE
  return fields.slice(start, start + FIELDS_PER_PAGE)
}
