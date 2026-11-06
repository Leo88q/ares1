export declare const SHARED_WORLD_VERSION = 1;
/** Аренда участка в CR за один тик. Сток CR (уходит из игры). */
export declare const RENT_CR_PER_TICK = 5;
/** Одновременно занятых участков на одного игрока. */
export declare const MAX_HOLDS_PER_WALLET = 2;
/** Лимит добычи с одного месторождения за тик, кг. */
export declare const MAX_EXTRACT_KG_PER_DEPOSIT_TICK = 50;
/** Комиссия рынка, доля от оборота. Сток CR. */
export declare const MARKET_FEE_RATE = 0.02;
/** Чувствительность цены к дисбалансу спроса и предложения. */
export declare const PRICE_ELASTICITY = 0.5;
/** Коридор цены: от базовой ×0.5 до ×2. */
export declare const PRICE_FLOOR = 0.5;
export declare const PRICE_CEIL = 2;
export declare const TRADABLE_GOODS: readonly ["ice_ore", "ware_potato"];
export type TradableGood = typeof TRADABLE_GOODS[number];
/** Базовая цена, CR за кг (предварительная). */
export declare const BASE_PRICE_CR: Record<TradableGood, number>;
export interface WorldDeposit {
    id: string;
    zone: string;
    good: TradableGood;
    remainingKg: number;
    /** Кошелёк арендатора или null, если участок свободен. */
    holder: string | null;
}
export interface SharedWorld {
    version: number;
    day: number;
    deposits: WorldDeposit[];
    prices: Record<TradableGood, number>;
    /** Накопленные суммы сжигания (сток): аренда и комиссия. Для мониторинга баланса. */
    sinkCr: {
        rent: number;
        fee: number;
    };
}
export interface MarketOrder {
    wallet: string;
    good: TradableGood;
    side: 'buy' | 'sell';
    kg: number;
}
export interface TickInput {
    /** Баланс CR каждого игрока на начало тика. */
    balances: Record<string, number>;
    /** Добыча за тик: кошелёк ведёт добычу только на свой участок. */
    extractions: {
        wallet: string;
        depositId: string;
        kg: number;
    }[];
    /** Товары на руках у игроков на начало тика (кг). Продажа не может превышать запас. */
    inventory: Record<string, Partial<Record<TradableGood, number>>>;
    /** Заявки на рынок за тик. */
    orders: MarketOrder[];
}
export interface Settlement {
    wallet: string;
    cr: number;
    good: TradableGood;
    kgDelta: number;
}
export interface TickResult {
    world: SharedWorld;
    /** Изменения баланса CR и товара по кошелькам. Сумма cr + sinks = 0 (нет создания CR). */
    settlements: Settlement[];
    /** Отклонённые действия с причиной (не списываются). */
    rejected: {
        wallet: string;
        reason: string;
    }[];
    /** Участки, которые освободились из-за неуплаты аренды. */
    lapsed: string[];
}
export declare function createSharedWorld(deposits: Omit<WorldDeposit, 'holder'>[]): SharedWorld;
export declare function holdsOf(world: SharedWorld, wallet: string): number;
/** Занять свободный участок. Возвращает причину отказа или null при успехе. */
export declare function claimDeposit(world: SharedWorld, depositId: string, wallet: string, balance: number): string | null;
/** Отпустить участок (только арендатор). */
export declare function releaseDeposit(world: SharedWorld, depositId: string, wallet: string): string | null;
/**
 * Один тик мира. Порядок фиксированный: аренда → добыча → рынок.
 * Порядок важен для детерминизма: одинаковые входы дают одинаковый результат на любом сервере.
 */
export declare function tickWorld(prev: SharedWorld, input: TickInput): TickResult;
