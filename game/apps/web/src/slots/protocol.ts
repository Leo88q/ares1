/**
 * Протокол выдачи слотов грядок на стороне браузера (S7, docs/S7_SLOT_AUTHORITY_SPEC.md).
 * Чистые функции без React и без сети. Формат строки подписи должен совпадать с
 * apps/backend/src/slots/requestAuth.ts — это проверяет tests/slots-protocol.test.mjs.
 */

export const SLOT_FREE_MAX = 6
export const SLOT_MAX = 12
/** Десятичные знаки SKR (SKR_DECIMALS = 6, см. anchorClient). */
export const SKR_DECIMALS = 6

export interface SlotRequestFields {
  field_id: string
  slot: number
  wallet: string
  payment_signature: string | null
}

/** Строка, которую подписывает кошелёк. Порядок и формат фиксированы. */
export function slotRequestMessage(fields: SlotRequestFields, timestampSeconds: number): string {
  return [
    'ares1-slot-request-v1',
    `field=${fields.field_id}`,
    `slot=${fields.slot}`,
    `wallet=${fields.wallet}`,
    `payment=${fields.payment_signature ?? '-'}`,
    `ts=${timestampSeconds}`,
  ].join('\n')
}

export function isPaidSlot(slot: number): boolean {
  return slot > SLOT_FREE_MAX
}

export function slotNumbers(): number[] {
  return Array.from({ length: SLOT_MAX }, (_, i) => i + 1)
}

/** Цена в базовых единицах: только положительное целое, как в backend SLOT_PRICE_UNITS. */
export function parseSlotPrice(raw: string | undefined): bigint | null {
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null
  return BigInt(raw)
}

/** Человекочитаемая сумма SKR из базовых единиц (без потери точности в строке). */
export function formatSkr(units: bigint): string {
  const base = 10n ** BigInt(SKR_DECIMALS)
  const whole = units / base
  const frac = (units % base).toString().padStart(SKR_DECIMALS, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

export function isBase58Address(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
}
