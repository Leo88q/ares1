// Общий мир колонии: месторождения с арендой и пакетный рынок (этап 1, docs/COLONY_SHARED_WORLD.md).
//
// Чистые функции. Вход — состояние мира, заявки и балансы игроков за тик. Выход — новое состояние
// и расчёты (settlements) по кошелькам. Бэкенд применяет расчёты к базам и пишет тик в журнал.
// Все числа ниже — ПРЕДВАРИТЕЛЬНЫЕ (для балансировки), не финальные.
export const SHARED_WORLD_VERSION = 1;
/** Аренда участка в CR за один тик. Сток CR (уходит из игры). */
export const RENT_CR_PER_TICK = 5;
/** Одновременно занятых участков на одного игрока. */
export const MAX_HOLDS_PER_WALLET = 2;
/** Лимит добычи с одного месторождения за тик, кг. */
export const MAX_EXTRACT_KG_PER_DEPOSIT_TICK = 50;
/** Комиссия рынка, доля от оборота. Сток CR. */
export const MARKET_FEE_RATE = 0.02;
/** Чувствительность цены к дисбалансу спроса и предложения. */
export const PRICE_ELASTICITY = 0.5;
/** Коридор цены: от базовой ×0.5 до ×2. */
export const PRICE_FLOOR = 0.5;
export const PRICE_CEIL = 2;
export const TRADABLE_GOODS = ['ice_ore', 'ware_potato'];
/** Базовая цена, CR за кг (предварительная). */
export const BASE_PRICE_CR = { ice_ore: 3, ware_potato: 4 };
export function createSharedWorld(deposits) {
    return {
        version: SHARED_WORLD_VERSION,
        day: 0,
        deposits: deposits.map(d => ({ ...d, holder: null })),
        prices: { ...BASE_PRICE_CR },
        sinkCr: { rent: 0, fee: 0 },
    };
}
export function holdsOf(world, wallet) {
    return world.deposits.filter(d => d.holder === wallet).length;
}
/** Занять свободный участок. Возвращает причину отказа или null при успехе. */
export function claimDeposit(world, depositId, wallet, balance) {
    const d = world.deposits.find(x => x.id === depositId);
    if (!d)
        return 'NO_DEPOSIT';
    if (d.holder !== null)
        return 'OCCUPIED';
    if (d.remainingKg <= 0)
        return 'DEPLETED';
    if (holdsOf(world, wallet) >= MAX_HOLDS_PER_WALLET)
        return 'HOLD_LIMIT';
    if (balance < RENT_CR_PER_TICK)
        return 'NO_FUNDS_FOR_RENT';
    d.holder = wallet;
    return null;
}
/** Отпустить участок (только арендатор). */
export function releaseDeposit(world, depositId, wallet) {
    const d = world.deposits.find(x => x.id === depositId);
    if (!d)
        return 'NO_DEPOSIT';
    if (d.holder !== wallet)
        return 'NOT_HOLDER';
    d.holder = null;
    return null;
}
/**
 * Один тик мира. Порядок фиксированный: аренда → добыча → рынок.
 * Порядок важен для детерминизма: одинаковые входы дают одинаковый результат на любом сервере.
 */
export function tickWorld(prev, input) {
    const world = JSON.parse(JSON.stringify(prev));
    const settlements = [];
    const rejected = [];
    const balance = { ...input.balances };
    const lapsed = [];
    world.day += 1;
    // 1. Аренда: арендатор платит за тик. Не смог — участок освобождается.
    for (const d of world.deposits) {
        if (d.holder === null)
            continue;
        const wallet = d.holder;
        if ((balance[wallet] ?? 0) < RENT_CR_PER_TICK) {
            lapsed.push(d.id);
            d.holder = null;
            continue;
        }
        balance[wallet] -= RENT_CR_PER_TICK;
        world.sinkCr.rent += RENT_CR_PER_TICK;
        settlements.push({ wallet, cr: -RENT_CR_PER_TICK, good: d.good, kgDelta: 0 });
    }
    // 2. Добыча: только свой участок, с учётом остатка и лимита за тик.
    const extractedNow = new Map();
    for (const e of input.extractions) {
        const d = world.deposits.find(x => x.id === e.depositId);
        if (!d || d.holder !== e.wallet) {
            rejected.push({ wallet: e.wallet, reason: 'NOT_HOLDER' });
            continue;
        }
        const done = extractedNow.get(d.id) ?? 0;
        const kg = Math.max(0, Math.min(e.kg, MAX_EXTRACT_KG_PER_DEPOSIT_TICK - done, d.remainingKg));
        if (kg <= 0) {
            rejected.push({ wallet: e.wallet, reason: 'NO_YIELD' });
            continue;
        }
        extractedNow.set(d.id, done + kg);
        d.remainingKg -= kg;
        settlements.push({ wallet: e.wallet, cr: 0, good: d.good, kgDelta: kg });
    }
    // Запас товаров после добычи: участок добывает в этом же тике.
    const stock = {};
    for (const [wallet, goods] of Object.entries(input.inventory))
        stock[wallet] = { ...goods };
    for (const st of settlements) {
        if (st.kgDelta > 0)
            stock[st.wallet] = { ...stock[st.wallet], [st.good]: (stock[st.wallet]?.[st.good] ?? 0) + st.kgDelta };
    }
    // 3. Рынок: пакетный клиринг по каждому товару.
    // Заявки режутся до доступного: покупатель — по деньгам, продавец — по запасу. Затем объём =
    // min(спрос, предложение), доли пропорциональны заявкам. Так товар и CR сходятся до копейки.
    for (const good of TRADABLE_GOODS) {
        const orders = input.orders.filter(o => o.good === good && o.kg > 0);
        const provisional = BASE_PRICE_CR[good];
        const buys = [];
        const sells = [];
        for (const o of orders) {
            if (o.side === 'buy') {
                const affordable = Math.max(0, Math.floor(((balance[o.wallet] ?? 0) / provisional) * 100 - 1) / 100);
                const kg = Math.min(o.kg, affordable);
                if (kg <= 0)
                    rejected.push({ wallet: o.wallet, reason: 'NO_FUNDS' });
                else
                    buys.push({ wallet: o.wallet, kg });
            }
            else {
                const have = stock[o.wallet]?.[good] ?? 0;
                const kg = Math.min(o.kg, have);
                if (kg <= 0)
                    rejected.push({ wallet: o.wallet, reason: 'NO_GOODS' });
                else
                    sells.push({ wallet: o.wallet, kg });
            }
        }
        const demand = buys.reduce((a, o) => a + o.kg, 0);
        const supply = sells.reduce((a, o) => a + o.kg, 0);
        const price = round2(clampPrice(provisional * (1 + PRICE_ELASTICITY * (demand - supply) / (demand + supply + 1)), good));
        world.prices[good] = price;
        const volume = round2(Math.min(demand, supply));
        if (volume <= 0)
            continue;
        // Покупатели: доля объёма пропорционально заявке. Стоимость округляется вниз до копейки.
        let turnover = 0;
        const buyLegs = buys.map(o => {
            const kg = round2(volume * o.kg / demand);
            const cost = Math.floor(kg * price * 100) / 100;
            turnover = round2(turnover + cost);
            balance[o.wallet] = round2((balance[o.wallet] ?? 0) - cost);
            return { wallet: o.wallet, kg, cost };
        });
        // Округление кг: отдаём остаток последнему покупателю, чтобы сумма кг = объёму.
        const buyKgSum = round2(buyLegs.reduce((a, l) => a + l.kg, 0));
        if (buyLegs.length && buyKgSum !== volume)
            buyLegs[buyLegs.length - 1].kg = round2(buyLegs[buyLegs.length - 1].kg + volume - buyKgSum);
        for (const leg of buyLegs) {
            if (leg.cost > 0 || leg.kg > 0)
                settlements.push({ wallet: leg.wallet, cr: -leg.cost, good, kgDelta: leg.kg });
            stock[leg.wallet] = { ...stock[leg.wallet], [good]: round2((stock[leg.wallet]?.[good] ?? 0) + leg.kg) };
        }
        // Комиссия — сток. Продавцы делят выплату пропорционально продаже, последний получает остаток.
        const fee = round2(turnover * MARKET_FEE_RATE);
        world.sinkCr.fee = round2(world.sinkCr.fee + fee);
        const payout = round2(turnover - fee);
        let paidOut = 0;
        sells.forEach((o, i) => {
            const kg = round2(volume * o.kg / supply);
            const cr = i === sells.length - 1 ? round2(payout - paidOut) : Math.floor(payout * o.kg / supply * 100) / 100;
            paidOut = round2(paidOut + cr);
            settlements.push({ wallet: o.wallet, cr, good, kgDelta: -kg });
            stock[o.wallet] = { ...stock[o.wallet], [good]: round2((stock[o.wallet]?.[good] ?? 0) - kg) };
        });
    }
    // Сохранение: сумма изменений CR плюс стоки = 0.
    return { world, settlements: mergeSettlements(settlements), rejected, lapsed };
}
function clampPrice(p, good) {
    return Math.min(BASE_PRICE_CR[good] * PRICE_CEIL, Math.max(BASE_PRICE_CR[good] * PRICE_FLOOR, p));
}
const round2 = (x) => Math.round(x * 100) / 100;
function mergeSettlements(list) {
    const map = new Map();
    for (const s of list) {
        const key = `${s.wallet}|${s.good}`;
        const cur = map.get(key);
        if (cur) {
            cur.cr = round2(cur.cr + s.cr);
            cur.kgDelta = round2(cur.kgDelta + s.kgDelta);
        }
        else
            map.set(key, { ...s, cr: round2(s.cr), kgDelta: round2(s.kgDelta) });
    }
    return [...map.values()].filter(s => s.cr !== 0 || s.kgDelta !== 0);
}
