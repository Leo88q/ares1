/**
 * Локальные контракты SIM и граница с настоящим POTATO.
 *
 * Здесь реализованы только ЛОКАЛЬНЫЕ контракты сессии:
 *  - ограниченный объём и срок;
 *  - требования к качеству и упаковке;
 *  - заранее ограниченный фонд вознаграждения (CR — внутриигровые кредиты);
 *  - доставка списывает физический товар;
 *  - одну поставку нельзя оплатить дважды.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ:
 *  - автоматического минта токенов за килограмм урожая;
 *  - баланса кошелька, транзакций, обещаний доходности;
 *  - смешивания физического картофеля с настоящим POTATO.
 *
 * Разрешён только явно подписанный РАСЧЁТНЫЙ показатель «потенциального
 * вознаграждения» (`estimatedPotato`): это не баланс, не токен и не выплата.
 */
import { DEEP_P } from './params'
import { clamp01 } from './units'

export type ContractStatus = 'offered' | 'active' | 'fulfilled' | 'expired'

export interface Delivery {
  id: string
  sol: number
  kg: number
  quality: number
  /** Начислено внутриигровых кредитов, CR. */
  rewardCR: number
  packaging: number
}

export interface Contract {
  id: string
  title: string
  /** Требуемый объём товарной партии, кг. */
  requiredKg: number
  /** Минимальное качество 0…1. */
  minQuality: number
  /** Срок, сол. */
  dueSol: number
  /** Заранее ограниченный фонд вознаграждения, CR. */
  rewardFundCR: number
  /** Ставка за кг, CR. Производная от фонда, а не от рынка. */
  creditsPerKg: number
  deliveredKg: number
  paidCR: number
  packagingUsed: number
  status: ContractStatus
  deliveries: Delivery[]
  /** Нужна ли упаковка: без неё поставка не принимается. */
  packingRequired: boolean
  /** Покупатель — локальный, с конечным фондом (не оракул и не рынок). */
  buyer: string
}

export interface ContractSeed {
  id: string
  title: string
  requiredKg: number
  minQuality: number
  dueSol: number
  rewardFundCR: number
  packingRequired?: boolean
  buyer?: string
}

export function createContract(seed: ContractSeed): Contract {
  const requiredKg = Math.max(0, seed.requiredKg)
  return {
    id: seed.id, title: seed.title,
    requiredKg,
    minQuality: clamp01(seed.minQuality),
    dueSol: Math.max(0, seed.dueSol),
    rewardFundCR: Math.max(0, seed.rewardFundCR),
    creditsPerKg: requiredKg > 0 ? seed.rewardFundCR / requiredKg : 0,
    deliveredKg: 0, paidCR: 0, packagingUsed: 0,
    status: 'active', deliveries: [],
    packingRequired: seed.packingRequired ?? true,
    buyer: seed.buyer ?? 'ARES-1 local buyer',
  }
}

export interface DeliveryRequest {
  sol: number
  kg: number
  quality: number
  packaging: number
}

export interface DeliveryOutcome {
  ok: boolean
  kg: number
  rewardCR: number
  packaging: number
  reason: string | null
  deliveryId: string | null
}

/**
 * Поставка: физический товар списывается, фонд уменьшается, каждая поставка
 * получает уникальный номер. Повторно оплатить одну и ту же поставку нельзя.
 */
export function deliverToContract(contract: Contract, request: DeliveryRequest): DeliveryOutcome {
  const fail = (reason: string): DeliveryOutcome => ({ ok: false, kg: 0, rewardCR: 0, packaging: 0, reason, deliveryId: null })
  if (contract.status !== 'active') return fail('contract-closed')
  if (request.sol > contract.dueSol) return fail('contract-expired')
  const remainingKg = Math.max(0, contract.requiredKg - contract.deliveredKg)
  if (remainingKg <= 1e-9) return fail('contract-filled')
  const kg = Math.min(Math.max(0, request.kg), remainingKg)
  if (kg <= 1e-9) return fail('nothing-to-deliver')
  if (request.quality < contract.minQuality - 1e-9) return fail('quality-too-low')
  const packagingNeeded = contract.packingRequired ? Math.ceil(kg * DEEP_P.packagingUnitsPerKg) : 0
  if (packagingNeeded > request.packaging) return fail('no-packaging')
  const rewardCR = Math.min(contract.rewardFundCR - contract.paidCR, kg * contract.creditsPerKg)
  contract.deliveries.push({
    id: `${contract.id}-d${contract.deliveries.length + 1}`,
    sol: request.sol, kg, quality: request.quality, rewardCR, packaging: packagingNeeded,
  })
  contract.deliveredKg += kg
  contract.paidCR += rewardCR
  contract.packagingUsed += packagingNeeded
  if (contract.deliveredKg >= contract.requiredKg - 1e-9 || contract.paidCR >= contract.rewardFundCR - 1e-9) {
    contract.status = 'fulfilled'
  }
  return { ok: true, kg, rewardCR, packaging: packagingNeeded, reason: null, deliveryId: contract.deliveries[contract.deliveries.length - 1].id }
}

/** Просрочка: контракт закрывается без выплаты за непоставленный объём. */
export function expireContract(contract: Contract, sol: number): boolean {
  if (contract.status !== 'active' || sol <= contract.dueSol) return false
  contract.status = 'expired'
  return true
}

/**
 * РАСЧЁТНЫЙ показатель потенциального вознаграждения (SIM).
 * Это НЕ баланс кошелька, НЕ настоящий POTATO, НЕ транзакция и НЕ обещание выплаты.
 */
export interface PotatoEstimate {
  kg: number
  /** Расчётный коэффициент: игровое допущение, не курс. */
  ratePerKg: number
  value: number
  note: string
}

export const POTATO_ESTIMATE_NOTE_RU = 'РАСЧЁТНЫЙ ПОКАЗАТЕЛЬ SIM: не токен, не баланс кошелька, не выплата.'
const POTATO_ESTIMATE_NOTE_EN = 'SIM ESTIMATE ONLY: not a token, not a wallet balance, not a payout.'

export function estimatePotato(kg: number, ratePerKg: number): PotatoEstimate {
  const value = Math.max(0, kg) * Math.max(0, ratePerKg)
  return { kg: Math.max(0, kg), ratePerKg, value, note: POTATO_ESTIMATE_NOTE_EN }
}

/** Сводка по контрактам. */
export interface ContractSummary {
  active: number
  fulfilled: number
  expired: number
  requiredKg: number
  deliveredKg: number
  paidCR: number
  fundLeftCR: number
}


/** Проверка: одна поставка не оплачивается дважды (номера уникальны). */
