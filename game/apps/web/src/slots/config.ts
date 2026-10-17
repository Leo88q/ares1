/**
 * Флаг и конфигурация покупки слотов (S7, шаг 5). По умолчанию выключено.
 * Значения публичные (как все VITE_*); секретов здесь нет.
 * Включение требует: VITE_SLOTS_ENABLED=true, VITE_BACKEND_URL, адрес казны и цена,
 * совпадающие с серверными SLOT_TREASURY_OWNER и SLOT_PRICE_UNITS. Не mainnet (NO-GO, §32.8).
 */
import { isBase58Address, parseSlotPrice } from './protocol'

// Не импортируем SolanaContext: модуль полей (FieldsPanel) грузится в smoke-фикстуре, где контекст
// подменён заглушкой. Значения те же, что в SolanaContext (BACKEND_URL, CLUSTER).
// import.meta.env может отсутствовать в esbuild-фикстуре тестов: тогда фолбэк — пустой объект,
// и модуль не падает при загрузке (иначе падает весь FieldsPanel).
const env: Partial<Record<string, string>> = (import.meta as unknown as { env?: Partial<Record<string, string>> }).env ?? {}

export const SLOTS_BACKEND_URL = (env.VITE_BACKEND_URL || '').replace(/\/$/, '')
const SLOTS_CLUSTER = env.VITE_SOLANA_CLUSTER || 'devnet'

export const SLOTS_ENABLED = env.VITE_SLOTS_ENABLED === 'true'
export const SLOT_TREASURY_OWNER = env.VITE_SLOT_TREASURY_OWNER ?? ''
export const SLOT_PRICE_UNITS = parseSlotPrice(env.VITE_SLOT_PRICE_UNITS)

/** Панель показывается только при полной и корректной конфигурации; иначе ничего не монтируется. */
export function slotsReady(): boolean {
  return SLOTS_ENABLED
    && SLOTS_CLUSTER !== 'mainnet-beta'
    && SLOTS_BACKEND_URL.length > 0
    && isBase58Address(SLOT_TREASURY_OWNER)
    && SLOT_PRICE_UNITS !== null
}
