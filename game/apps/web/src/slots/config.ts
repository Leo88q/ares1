/** Paid SKR slot purchases are closed until a separately approved launch. */
export const SLOTS_BACKEND_URL = ''
export const SLOTS_ENABLED = false
export const SLOT_TREASURY_OWNER = ''
export const SLOT_PRICE_UNITS: bigint | null = null

/** No environment variable may re-enable this user-facing purchase path. */
export function slotsReady(): boolean {
  return false
}
