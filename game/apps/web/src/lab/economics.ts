/**
 * Экономика и рынок для продуктовой FIELD LAB (2026-10-17).
 *
 * Все числа здесь — производные от уже существующих правил игры:
 *  - цены/стоимости обслуживания: `utils/constants` (зеркало программы Solana);
 *  - выход и налог в день, окупаемость, микро-поле и лимит связи с колонией:
 *    `organism/market` (зеркало on-chain конфигурации + принятые правила входа);
 *  - площадки колонии: `colony/simulation.SLOTS`.
 * Модуль ничего не считает «от себя», не читает кошелёк и не меняет цены.
 */
import { ECONOMY, MARKET } from '../organism/parameters'
import {
  canLinkFieldToColony, fieldTaxPerDayMicro, fieldYieldPerDayMicro,
  microFieldPriceMicro, microFieldTaxPerDayMicro, microFieldYieldPerDayMicro, paybackDays,
} from '../organism/market'
import { fieldPriceMicro } from '../utils/constants'
import { SLOTS } from '../colony/simulation'

export type TierIndex = 0 | 1 | 2

export interface TierEconomics {
  tier: TierIndex
  /** COMMON / RARE / EPIC — имена тиров из зеркала программы. */
  name: string
  priceMicro: number
  yieldPerDayMicro: number
  taxPerDayMicro: number
  /** Дней до возврата цены чистым выходом (Infinity, если налог съедает выход). */
  payback: number
  affordable: boolean
}

/** Три тира развертывания: реальная on-chain цена против выхода и налога того же тира. */
export function tierEconomics(balanceMicro: number): TierEconomics[] {
  return ([0, 1, 2] as const).map(tier => {
    const price = fieldPriceMicro(tier)
    const yieldPerDay = fieldYieldPerDayMicro(tier)
    const taxPerDay = fieldTaxPerDayMicro(tier)
    return {
      tier, name: ECONOMY.tiers[tier].name, priceMicro: price,
      yieldPerDayMicro: yieldPerDay, taxPerDayMicro: taxPerDay,
      payback: paybackDays(price, yieldPerDay, taxPerDay),
      affordable: balanceMicro >= price,
    }
  })
}

export interface MicroFieldEconomics {
  priceMicro: number
  yieldPerDayMicro: number
  taxPerDayMicro: number
  payback: number
  affordable: boolean
}

/** E-C: микро-поле как входной билет (25 POTATO × рост цены за каждое предыдущее поле). */
export function microFieldEconomics(ownedFields: number, balanceMicro: number): MicroFieldEconomics {
  const price = microFieldPriceMicro(ownedFields)
  const yieldPerDay = microFieldYieldPerDayMicro()
  const taxPerDay = microFieldTaxPerDayMicro()
  return { priceMicro: price, yieldPerDayMicro: yieldPerDay, taxPerDayMicro: taxPerDay, payback: paybackDays(price, yieldPerDay, taxPerDay), affordable: balanceMicro >= price }
}

export interface ColonyLink {
  /** Предел связи: минимум из правила K-C и числа площадок базы. */
  cap: number
  pads: number
  occupiedPads: number
  freePads: number
  linkedFields: number
  hasRoom: boolean
}

/** K-C: поле считается связанным с колонией, пока на базе есть свободная площадка. */
export function colonyLink(ownedFields: number, occupiedPads: number): ColonyLink {
  const pads = SLOTS.length
  const cap = Math.min(MARKET.colonyLinkedFieldCap, pads)
  const linkedFields = Math.min(Math.max(0, ownedFields), cap)
  return {
    cap, pads,
    occupiedPads: Math.min(Math.max(0, occupiedPads), pads),
    freePads: Math.max(0, pads - Math.min(Math.max(0, occupiedPads), pads)),
    linkedFields,
    hasRoom: canLinkFieldToColony(linkedFields),
  }
}
