/**
 * Мост ресурсов «колония ↔ полевая лаборатория» (продакт-версия FIELD LAB, 2026-10-17).
 *
 * Обе стороны — локальный учёт дизайна: литры, килограммы питания, запчасти и
 * килограммы еды. Ни одна функция не читает баланс кошелька, не минтит POTATO и не
 * отправляет транзакцию. Смысл моста в том, чтобы у секций был ОДИН запас:
 *  - лаборатория забирает воду/питание/запчасти из стока колонии (столько же убывает там);
 *  - партия еды с лабораторного стенда уходит в хранилище колонии (столько же прибывает там).
 *
 * Законы сохранения (проверяются tests/offchain/labColonyBridge.test.ts):
 *  вода:      colony.waterLitres + sim.supplyL(внешний запас) = const
 *  питание:   colony.nutrientsKg + sim.nutrientsKg            = const
 *  запчасти:  colony.sparesKg    + sim.spares                 = const
 *  еда:       sim.totals.shippedKg = прирост stock/harvestedKg колонии
 *
 * Передачи разрешены только на остановленных часах колонии: иначе дневной тик
 * может изменить сток между расчётом и записью. Это правило показывает UI.
 */
import { supplyRoom } from '../fields/engineering/engine'
import type { EngineeringState } from '../fields/engineering/engine'
import { syncView } from '@ares/colony-engine/colony/simulation'
import type { ColonyState } from '@ares/colony-engine/colony/simulation'
import { storedKg } from '@ares/colony-engine/organism/unified'

// Сам перенос (colonyStock, drawFromColony) живёт в движке: сервер применяет его тем же кодом.
import { colonyStock, drawFromColony } from '@ares/colony-engine/colony/supply'
import type { LabSupplyResource } from '@ares/colony-engine/colony/supply'
export { colonyStock, drawFromColony }
export type { LabSupplyResource }

/** Сколько переносит одно нажатие клавиши. Запчасти — целые детали.
 *  Вода — 40 л за раз: этого хватает на несколько поливов стенда, а сток базы
 *  (около 1.2 т) не превращается в ноль одним промахом по кнопке. */
export const SUPPLY_STEP: Record<LabSupplyResource, number> = { water: 40, nutrients: 0.2, spares: 1 }

/** Единицы для подписей (строки остаются за i18n экрана). */
export const SUPPLY_UNIT: Record<LabSupplyResource, 'L' | 'kg' | 'pcs'> = { water: 'L', nutrients: 'kg', spares: 'pcs' }

/** Сколько реально можно перенести сейчас: шаг, ограниченный стоком базы и свободным местом стенда. */
export function supplyGrant(state: ColonyState, sim: EngineeringState, resource: LabSupplyResource): number {
  const raw = Math.min(SUPPLY_STEP[resource], colonyStock(state, resource), supplyRoom(sim, resource))
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return resource === 'spares' ? Math.floor(raw) : raw
}

/** Свободное место хранилища базы (raw + processed против лимита). */
export function colonyFreeStorageKg(state: ColonyState): number {
  return Math.max(0, state.ledger.storageCapKg - storedKg(state.ledger))
}

/**
 * Принять партию со стенда в хранилище колонии. Единый реестр базы
 * (organism/unified.ts) требует, чтобы приток рос вместе с harvestedKg —
 * иначе нарушится баланс `start + harvested = stock + outflow`.
 */
export function receiveLabFood(state: ColonyState, kg: number, kind: 'raw' | 'processed'): { state: ColonyState; accepted: number } {
  if (!Number.isFinite(kg) || kg <= 0) return { state, accepted: 0 }
  const accepted = Math.min(kg, colonyFreeStorageKg(state))
  if (accepted <= 1e-9) return { state, accepted: 0 }
  const ledger = {
    ...state.ledger,
    harvestedKg: state.ledger.harvestedKg + accepted,
    rawKg: state.ledger.rawKg + (kind === 'raw' ? accepted : 0),
    processedKg: state.ledger.processedKg + (kind === 'processed' ? accepted : 0),
  }
  return { state: syncView({ ...state, ledger }), accepted }
}

/** Партии стенда, которые можно отправить на базу (кг > 0). */
export function shippableLots(sim: EngineeringState): EngineeringState['lots'] {
  return sim.lots.filter(lot => lot.kg > 1e-9)
}

/** Сколько кг конкретной партии поместится в хранилище базы. */
export function shippableKg(sim: EngineeringState, lotId: number, state: ColonyState): number {
  const lot = sim.lots.find(item => item.id === lotId)
  if (!lot) return 0
  return Math.max(0, Math.min(lot.kg, colonyFreeStorageKg(state)))
}
