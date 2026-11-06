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
import { DEEP_P } from './params.js';
import { clamp01 } from './units.js';
export function createContract(seed) {
    const requiredKg = Math.max(0, seed.requiredKg);
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
    };
}
/**
 * Поставка: физический товар списывается, фонд уменьшается, каждая поставка
 * получает уникальный номер. Повторно оплатить одну и ту же поставку нельзя.
 */
export function deliverToContract(contract, request) {
    const fail = (reason) => ({ ok: false, kg: 0, rewardCR: 0, packaging: 0, reason, deliveryId: null });
    if (contract.status !== 'active')
        return fail('contract-closed');
    if (request.sol > contract.dueSol)
        return fail('contract-expired');
    const remainingKg = Math.max(0, contract.requiredKg - contract.deliveredKg);
    if (remainingKg <= 1e-9)
        return fail('contract-filled');
    const kg = Math.min(Math.max(0, request.kg), remainingKg);
    if (kg <= 1e-9)
        return fail('nothing-to-deliver');
    if (request.quality < contract.minQuality - 1e-9)
        return fail('quality-too-low');
    const packagingNeeded = contract.packingRequired ? Math.ceil(kg * DEEP_P.packagingUnitsPerKg) : 0;
    if (packagingNeeded > request.packaging)
        return fail('no-packaging');
    const rewardCR = Math.min(contract.rewardFundCR - contract.paidCR, kg * contract.creditsPerKg);
    contract.deliveries.push({
        id: `${contract.id}-d${contract.deliveries.length + 1}`,
        sol: request.sol, kg, quality: request.quality, rewardCR, packaging: packagingNeeded,
    });
    contract.deliveredKg += kg;
    contract.paidCR += rewardCR;
    contract.packagingUsed += packagingNeeded;
    if (contract.deliveredKg >= contract.requiredKg - 1e-9 || contract.paidCR >= contract.rewardFundCR - 1e-9) {
        contract.status = 'fulfilled';
    }
    return { ok: true, kg, rewardCR, packaging: packagingNeeded, reason: null, deliveryId: contract.deliveries[contract.deliveries.length - 1].id };
}
/** Просрочка: контракт закрывается без выплаты за непоставленный объём. */
export function expireContract(contract, sol) {
    if (contract.status !== 'active' || sol <= contract.dueSol)
        return false;
    contract.status = 'expired';
    return true;
}
export const POTATO_ESTIMATE_NOTE_RU = 'РАСЧЁТНЫЙ ПОКАЗАТЕЛЬ SIM: не токен, не баланс кошелька, не выплата.';
const POTATO_ESTIMATE_NOTE_EN = 'SIM ESTIMATE ONLY: not a token, not a wallet balance, not a payout.';
export function estimatePotato(kg, ratePerKg) {
    const value = Math.max(0, kg) * Math.max(0, ratePerKg);
    return { kg: Math.max(0, kg), ratePerKg, value, note: POTATO_ESTIMATE_NOTE_EN };
}
/** Проверка: одна поставка не оплачивается дважды (номера уникальны). */
