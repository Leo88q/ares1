export type ContractStatus = 'offered' | 'active' | 'fulfilled' | 'expired';
export interface Delivery {
    id: string;
    sol: number;
    kg: number;
    quality: number;
    /** Начислено внутриигровых кредитов, CR. */
    rewardCR: number;
    packaging: number;
}
export interface Contract {
    id: string;
    title: string;
    /** Требуемый объём товарной партии, кг. */
    requiredKg: number;
    /** Минимальное качество 0…1. */
    minQuality: number;
    /** Срок, сол. */
    dueSol: number;
    /** Заранее ограниченный фонд вознаграждения, CR. */
    rewardFundCR: number;
    /** Ставка за кг, CR. Производная от фонда, а не от рынка. */
    creditsPerKg: number;
    deliveredKg: number;
    paidCR: number;
    packagingUsed: number;
    status: ContractStatus;
    deliveries: Delivery[];
    /** Нужна ли упаковка: без неё поставка не принимается. */
    packingRequired: boolean;
    /** Покупатель — локальный, с конечным фондом (не оракул и не рынок). */
    buyer: string;
}
export interface ContractSeed {
    id: string;
    title: string;
    requiredKg: number;
    minQuality: number;
    dueSol: number;
    rewardFundCR: number;
    packingRequired?: boolean;
    buyer?: string;
}
export declare function createContract(seed: ContractSeed): Contract;
export interface DeliveryRequest {
    sol: number;
    kg: number;
    quality: number;
    packaging: number;
}
export interface DeliveryOutcome {
    ok: boolean;
    kg: number;
    rewardCR: number;
    packaging: number;
    reason: string | null;
    deliveryId: string | null;
}
/**
 * Поставка: физический товар списывается, фонд уменьшается, каждая поставка
 * получает уникальный номер. Повторно оплатить одну и ту же поставку нельзя.
 */
export declare function deliverToContract(contract: Contract, request: DeliveryRequest): DeliveryOutcome;
/** Просрочка: контракт закрывается без выплаты за непоставленный объём. */
export declare function expireContract(contract: Contract, sol: number): boolean;
/**
 * РАСЧЁТНЫЙ показатель потенциального вознаграждения (SIM).
 * Это НЕ баланс кошелька, НЕ настоящий POTATO, НЕ транзакция и НЕ обещание выплаты.
 */
export interface PotatoEstimate {
    kg: number;
    /** Расчётный коэффициент: игровое допущение, не курс. */
    ratePerKg: number;
    value: number;
    note: string;
}
export declare const POTATO_ESTIMATE_NOTE_RU = "\u0420\u0410\u0421\u0427\u0401\u0422\u041D\u042B\u0419 \u041F\u041E\u041A\u0410\u0417\u0410\u0422\u0415\u041B\u042C SIM: \u043D\u0435 \u0442\u043E\u043A\u0435\u043D, \u043D\u0435 \u0431\u0430\u043B\u0430\u043D\u0441 \u043A\u043E\u0448\u0435\u043B\u044C\u043A\u0430, \u043D\u0435 \u0432\u044B\u043F\u043B\u0430\u0442\u0430.";
export declare function estimatePotato(kg: number, ratePerKg: number): PotatoEstimate;
/** Сводка по контрактам. */
export interface ContractSummary {
    active: number;
    fulfilled: number;
    expired: number;
    requiredKg: number;
    deliveredKg: number;
    paidCR: number;
    fundLeftCR: number;
}
/** Проверка: одна поставка не оплачивается дважды (номера уникальны). */
