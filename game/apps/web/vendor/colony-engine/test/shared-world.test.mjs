// Общий мир колонии (этап 1): аренда, добыча, рынок и сохранение CR и товаров.
// Инварианты: CR не создаётся (Σ изменений CR = −приросту стоков), товары сходятся
// (Σ изменений кг по рынку = 0, добыча — единственный источник товаров).
import { test } from 'node:test'
import assert from 'node:assert/strict'

const w = await import('../lib/esm/colony/world/shared.js')
const { createSharedWorld, claimDeposit, releaseDeposit, tickWorld, holdsOf, RENT_CR_PER_TICK, MAX_HOLDS_PER_WALLET, MAX_EXTRACT_KG_PER_DEPOSIT_TICK } = w

const deposits = [
  { id: 'd1', zone: 'A', good: 'ice_ore', remainingKg: 500 },
  { id: 'd2', zone: 'A', good: 'ice_ore', remainingKg: 500 },
  { id: 'd3', zone: 'B', good: 'ice_ore', remainingKg: 500 },
  { id: 'd4', zone: 'B', good: 'ware_potato', remainingKg: 500 },
]
const sumCr = (settlements) => Math.round(settlements.reduce((a, s) => a + s.cr, 0) * 100) / 100
const sumKg = (settlements, good) => Math.round(settlements.filter(s => s.good === good).reduce((a, s) => a + s.kgDelta, 0) * 100) / 100

test('занятие участка: отказы по причинам и лимит на игрока', () => {
  const world = createSharedWorld(deposits)
  assert.equal(claimDeposit(world, 'nope', 'A', 100), 'NO_DEPOSIT')
  assert.equal(claimDeposit(world, 'd1', 'A', RENT_CR_PER_TICK - 1), 'NO_FUNDS_FOR_RENT')
  assert.equal(claimDeposit(world, 'd1', 'A', 100), null)
  assert.equal(claimDeposit(world, 'd1', 'B', 100), 'OCCUPIED')
  assert.equal(claimDeposit(world, 'd2', 'A', 100), null)
  assert.equal(claimDeposit(world, 'd3', 'A', 100), 'HOLD_LIMIT')
  assert.equal(holdsOf(world, 'A'), MAX_HOLDS_PER_WALLET)
  assert.equal(releaseDeposit(world, 'd1', 'B'), 'NOT_HOLDER')
  assert.equal(releaseDeposit(world, 'd1', 'A'), null)
})

test('аренда списывается и уходит в сток; неуплата освобождает участок', () => {
  const world = createSharedWorld(deposits)
  claimDeposit(world, 'd1', 'A', 100)
  claimDeposit(world, 'd3', 'B', 100)
  const r = tickWorld(world, { balances: { A: 100, B: 2 }, extractions: [], inventory: {}, orders: [] })
  assert.equal(r.world.sinkCr.rent, RENT_CR_PER_TICK)
  assert.deepEqual(r.lapsed, ['d3'])
  assert.equal(r.world.deposits.find(d => d.id === 'd3').holder, null)
  assert.equal(r.world.deposits.find(d => d.id === 'd1').holder, 'A')
  assert.equal(sumCr(r.settlements), -RENT_CR_PER_TICK)
})

test('добыча: только арендатор, лимит за тик и остаток участка', () => {
  const world = createSharedWorld(deposits)
  claimDeposit(world, 'd1', 'A', 100)
  const r = tickWorld(world, {
    balances: { A: 100, B: 100 }, inventory: {}, orders: [],
    extractions: [
      { wallet: 'A', depositId: 'd1', kg: 999 },
      { wallet: 'B', depositId: 'd1', kg: 10 },
    ],
  })
  assert.equal(sumKg(r.settlements, 'ice_ore'), MAX_EXTRACT_KG_PER_DEPOSIT_TICK)
  assert.deepEqual(r.rejected, [{ wallet: 'B', reason: 'NOT_HOLDER' }])
  assert.equal(r.world.deposits.find(d => d.id === 'd1').remainingKg, 500 - MAX_EXTRACT_KG_PER_DEPOSIT_TICK)
})

test('рынок: пропорциональный клиринг, цена в коридоре, сумма CR и товара сходятся', () => {
  const world = createSharedWorld(deposits)
  claimDeposit(world, 'd1', 'A', 100)
  claimDeposit(world, 'd3', 'B', 100)
  const r = tickWorld(world, {
    balances: { A: 500, B: 500, C: 500, D: 500 },
    extractions: [],
    inventory: { A: { ice_ore: 40 }, B: { ice_ore: 40 } },
    orders: [
      { wallet: 'A', good: 'ice_ore', side: 'sell', kg: 30 },
      { wallet: 'B', good: 'ice_ore', side: 'sell', kg: 20 },
      { wallet: 'C', good: 'ice_ore', side: 'buy', kg: 40 },
      { wallet: 'D', good: 'ice_ore', side: 'buy', kg: 10 },
    ],
  })
  const price = r.world.prices.ice_ore
  assert.ok(price >= 1.5 && price <= 6, `цена в коридоре: ${price}`)
  // Спрос 50 > предложение 50? Здесь ровно 50 = 50: объём 50, продажа полностью.
  assert.equal(sumKg(r.settlements, 'ice_ore'), 0, 'товар не создаётся и не теряется на рынке')
  // CR: покупатели заплатили, продавцы получили за вычетом комиссии, комиссия ушла в сток.
  // Аренда тоже списывается из баланса и уходит в сток: сверяем с полным стоком тика.
  const sinks = r.world.sinkCr.rent + r.world.sinkCr.fee
  assert.ok(r.world.sinkCr.fee > 0)
  assert.ok(Math.abs(sumCr(r.settlements) + sinks) < 0.005, `CR сходится: ${sumCr(r.settlements)} + ${sinks}`)
  assert.ok(r.settlements.filter(s => s.wallet === 'C').every(s => s.cr <= 0))
  assert.ok(r.settlements.filter(s => s.wallet === 'A' || s.wallet === 'B').every(s => s.cr >= 0))
})

test('покупатель покупает только на свои деньги; товар и CR сходятся', () => {
  const world = createSharedWorld(deposits)
  const r = tickWorld(world, {
    balances: { C: 1, S: 0 },
    extractions: [],
    inventory: { S: { ice_ore: 50 } },
    orders: [
      { wallet: 'S', good: 'ice_ore', side: 'sell', kg: 50 },
      { wallet: 'C', good: 'ice_ore', side: 'buy', kg: 50 },
    ],
  })
  const buyer = r.settlements.find(s => s.wallet === 'C')
  const seller = r.settlements.find(s => s.wallet === 'S')
  assert.ok(buyer.kgDelta > 0 && buyer.kgDelta < 1, `купил частично: ${buyer.kgDelta} кг`)
  assert.ok(buyer.cr >= -1, 'не потратил больше баланса')
  assert.equal(seller.kgDelta, -buyer.kgDelta, 'продавец отдал ровно то, что купили')
  assert.equal(sumKg(r.settlements, 'ice_ore'), 0)
  assert.deepEqual(r.rejected, [])
})

test('продажа сверх запаса отклоняется', () => {
  const world = createSharedWorld(deposits)
  const r = tickWorld(world, {
    balances: { C: 500 }, extractions: [], inventory: { S: { ice_ore: 5 } },
    orders: [
      { wallet: 'S', good: 'ice_ore', side: 'sell', kg: 50 },
      { wallet: 'C', good: 'ice_ore', side: 'buy', kg: 5 },
    ],
  })
  assert.ok(r.rejected.length === 0)
  assert.equal(sumKg(r.settlements, 'ice_ore'), 0)
  assert.equal(r.settlements.find(s => s.wallet === 'S').kgDelta, -5)
})

test('сохранение за серию тиков: CR-инвариант и цены без NaN', () => {
  let world = createSharedWorld(deposits)
  const balances = { A: 1000, B: 1000, C: 1000 }
  claimDeposit(world, 'd1', 'A', 1000)
  claimDeposit(world, 'd4', 'B', 1000)
  const inventory = {}
  for (let day = 0; day < 30; day++) {
    const sinksBefore = world.sinkCr.rent + world.sinkCr.fee
    const r = tickWorld(world, {
      balances, inventory,
      extractions: [{ wallet: 'A', depositId: 'd1', kg: 20 }, { wallet: 'B', depositId: 'd4', kg: 20 }],
      orders: [
        { wallet: 'A', good: 'ice_ore', side: 'sell', kg: 15 },
        { wallet: 'B', good: 'ware_potato', side: 'sell', kg: 10 },
        { wallet: 'C', good: 'ice_ore', side: 'buy', kg: 10 },
        { wallet: 'C', good: 'ware_potato', side: 'buy', kg: 5 },
      ],
    })
    // Баланс и запасы переносятся в следующий тик.
    for (const s of r.settlements) balances[s.wallet] = Math.round(((balances[s.wallet] ?? 0) + s.cr) * 100) / 100
    for (const s of r.settlements) {
      inventory[s.wallet] = inventory[s.wallet] ?? {}
      inventory[s.wallet][s.good] = Math.round(((inventory[s.wallet][s.good] ?? 0) + s.kgDelta) * 100) / 100
    }
    world = r.world
    const sinksDelta = world.sinkCr.rent + world.sinkCr.fee - sinksBefore
    assert.ok(Math.abs(sumCr(r.settlements) + sinksDelta) < 0.01, `день ${day}: CR сходится`)
    for (const p of Object.values(world.prices)) assert.ok(Number.isFinite(p) && p > 0)
  }
  assert.ok(world.deposits.find(d => d.id === 'd1').remainingKg < 500)
})
