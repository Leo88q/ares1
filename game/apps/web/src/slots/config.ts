/**
 * Флаг и конфигурация покупки слотов (S7, шаг 5). По умолчанию выключено.
 * Значения публичные (как все VITE_*); секретов здесь нет.
 * Включение требует: VITE_SLOTS_ENABLED=true, VITE_BACKEND_URL, адрес казны и цена,
 * совпадающие с серверными SLOT_TREASURY_OWNER и SLOT_PRICE_UNITS. Не mainnet (NO-GO, §32.8).
 */
import { BACKEND_URL, CLUSTER } from '../contexts/SolanaContext'
import { isBase58Address, parseSlotPrice } from './protocol'

export const SLOTS_ENABLED = import.meta.env.VITE_SLOTS_ENABLED === 'true'
export const SLOT_TREASURY_OWNER = (import.meta.env.VITE_SLOT_TREASURY_OWNER as string | undefined) ?? ''
export const SLOT_PRICE_UNITS = parseSlotPrice(import.meta.env.VITE_SLOT_PRICE_UNITS as string | undefined)

/** Панель показывается только при полной и корректной конфигурации; иначе ничего не монтируется. */
export function slotsReady(): boolean {
  return SLOTS_ENABLED
    && CLUSTER !== 'mainnet-beta'
    && BACKEND_URL.length > 0
    && isBase58Address(SLOT_TREASURY_OWNER)
    && SLOT_PRICE_UNITS !== null
}
