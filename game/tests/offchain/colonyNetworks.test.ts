import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialColony, dailyBudget, advanceDay, buildModule, buildModuleAt, moveModule, canRepair, sellableKg, batteryStocks } from '../../apps/web/src/colony/simulation'
import type { ColonyState } from '../../apps/web/src/colony/simulation'
import { planNetwork, validNetwork, networkCost, addNetwork, removeNetwork, networkServices, ports, placementHitsNetwork, NETWORK_TYPES } from '../../apps/web/src/colony/networks'
import { modulePlacement, placementError } from '../../apps/web/src/colony/layout'

const idOf = (s: ColonyState, kind: string): string => s.modules.find(m => m.kind === kind)!.id
const close = (a: number, b: number): void => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
function disconnect(s: ColonyState, type: string, id: string): ColonyState {
  return { ...s, networks: s.networks!.filter(n => n.type !== type || (n.from !== id && n.to !== id)) }
}
function connect(s: ColonyState, type: typeof NETWORK_TYPES[number], from: string, to: string): ColonyState {
  const n = planNetwork(s, type, from, to)
  assert.ok(n, `${type} has a route`)
  const next = addNetwork(s, n)
  assert.notEqual(next, s)
  return next
}

test('starter utilities are explicit, valid, deterministic and included in expedition package', () => {
  const s = initialColony(), services = networkServices(s)
  assert.ok(s.networks!.length > 10)
  assert.deepEqual(s.networks, initialColony().networks)
  assert.equal(s.spentCredits, 0)
  for (const n of s.networks!) assert.ok(validNetwork(s.modules, n))
  for (const m of s.modules) assert.equal(services.get(m.id)?.power, true)
  assert.deepEqual(services.get(idOf(s, 'greenhouse')), { power: true, water: true, return: true, access: true })
  close(dailyBudget(s).recovery, 0.94)
  close(dailyBudget(s).waterUsedLitres, 9.1)
})

test('routing chooses compatible external ports and avoids buildings; malformed paths spend nothing', () => {
  const s = initialColony(), from = idOf(s, 'habitat'), to = idOf(s, 'greenhouse')
  const route = planNetwork(s, 'power', from, to)!
  assert.ok(validNetwork(s.modules, route))
  assert.ok(ports(s.modules.find(m => m.id === from)!, 'power').some(p => p.x === route.cells[0].x && p.z === route.cells[0].z))
  assert.equal(planNetwork(s, 'water', from, idOf(s, 'solar')), null)
  assert.equal(planNetwork(s, 'power', from, from), null)
  assert.equal(planNetwork(s, 'power', 'missing', to), null)
  assert.equal(planNetwork(s, 'power', from, to, { x: -1, z: 0 }), null)
  assert.equal(planNetwork(s, 'power', from, to, modulePlacement(s.modules.find(m => m.id === to)!)), null)
  const broken = { ...route, cells: [route.cells[0], { x: 47, z: 47 }, route.cells.at(-1)!] }
  assert.equal(validNetwork(s.modules, broken), false)
  assert.equal(addNetwork(s, broken), s)
  assert.equal(addNetwork(s, { ...route, cells: [] }), s)
  assert.equal(addNetwork(s, route), s, 'included starter edges are not purchased again')
})

test('new buildings require connections; fees debit only once and caller cannot mutate stored route', () => {
  let s = buildModule(initialColony(), 'greenhouse')
  const greenhouse = s.modules.at(-1)!.id, hub = idOf(s, 'habitat'), recycler = idOf(s, 'recycler')
  assert.equal(dailyBudget(s).growthByModule![greenhouse], 0)
  const route = planNetwork(s, 'power', hub, greenhouse)!, before = s
  const cost = networkCost(route)
  s = addNetwork(s, route)
  close(s.credits, before.credits - cost); close(s.spentCredits, before.spentCredits + cost)
  assert.equal(s.waterLitres, before.waterLitres)
  assert.equal(s.ledger, before.ledger)
  assert.equal(addNetwork(s, route), s)
  route.cells[0].x = -1
  assert.ok(s.networks!.at(-1)!.cells[0].x >= 0)
  assert.equal(dailyBudget(s).growthByModule![greenhouse], 0, 'power alone cannot water or service crops')
  s = connect(s, 'water', recycler, greenhouse)
  assert.equal(dailyBudget(s).growthByModule![greenhouse], 0, 'crew access is also required')
  s = connect(s, 'tunnel', hub, greenhouse)
  assert.ok(dailyBudget(s).growthByModule![greenhouse] > 0)
  const openLoop = dailyBudget(s)
  s = connect(s, 'return', recycler, greenhouse)
  assert.ok(dailyBudget(s).recovery > openLoop.recovery)
  assert.ok(dailyBudget(s).waterUsedLitres < openLoop.waterUsedLitres)
  const grown = advanceDay(s)
  assert.ok(grown.modules.find(m => m.id === greenhouse)!.growthDays > 0)
  close(grown.credits, 1400 + grown.earnedCredits - grown.spentCredits)
})

test('cutting power/water/access stops the affected crop, cutting return increases make-up water', () => {
  const s = initialColony(), id = idOf(s, 'greenhouse')
  for (const type of ['power', 'water', 'tunnel']) {
    const isolated = disconnect(s, type, id)
    assert.equal(dailyBudget(isolated).growthByModule![id], 0)
    assert.equal(advanceDay(isolated).modules.find(m => m.id === id)!.growthDays, 60)
  }
  const open = disconnect(s, 'return', id)
  assert.ok(dailyBudget(open).waterUsedLitres > dailyBudget(s).waterUsedLitres)
  assert.ok(dailyBudget(open).growthByModule![id] > 0)
  const shop = idOf(s, 'workshop')
  assert.equal(canRepair(disconnect(advanceDay(s), 'tunnel', shop)), false)
  assert.equal(sellableKg(disconnect(s, 'power', idOf(s, 'rover'))), 0)
})

test('removal has no refund; relocation removes attached lines and cannot build over other routes', () => {
  const s = initialColony(), id = idOf(s, 'greenhouse'), edge = s.networks!.find(n => n.to === id)!
  const removed = removeNetwork(s, edge.id)
  assert.equal(removed.credits, s.credits); assert.equal(removed.spentCredits, s.spentCredits)
  assert.equal(removeNetwork(removed, edge.id), removed)
  const moved = moveModule(s, id, { x: 40, z: 40, rotation: 1 })
  assert.notEqual(moved, s)
  assert.ok(moved.networks!.every(n => n.from !== id && n.to !== id))
  assert.equal(moved.ledger, s.ledger)
  assert.equal(networkServices(moved).get(id)!.power, false)
  assert.equal(moveModule(s, id, modulePlacement(s.modules.find(m => m.id === id)!)), s, 'unchanged placement preserves wires')
  const at = s.networks!.flatMap(n => n.cells).map(p => ({ ...p, rotation: 0 as const }))
    .find(p => !placementError(s.modules, 'battery', p) && placementHitsNetwork(s, 'battery', p))!
  assert.ok(at)
  assert.equal(buildModuleAt(s, 'battery', at), s)
  assert.equal(moveModule(s, id, at), s)
})

test('disconnected batteries retain their own stock and cannot charge/discharge remotely', () => {
  const s = initialColony(), battery = idOf(s, 'battery')
  const isolated = disconnect(s, 'power', battery)
  const dark = dailyBudget(isolated, { sunHours: 0, waterRecovery: 0.94 })
  assert.equal(dark.batteryDischargeOutputKwh, 0)
  assert.equal(dark.batteryEndKwh, 80)
  assert.equal(dailyBudget(isolated).batteryChargeInputKwh, 0)
  const next = buildModule(s, 'battery'), newId = next.modules.at(-1)!.id
  assert.equal(batteryStocks(next)[newId], 0, 'building a battery cannot teleport existing charge')
  const stepped = advanceDay(next)
  assert.equal(stepped.batteryCharge![newId], 0)
  assert.ok(stepped.batteryCharge![battery] > 80)
  close(Object.values(stepped.batteryCharge!).reduce((a, b) => a + b, 0), stepped.batteryKwh)
})

test('waypoints affect routing but cannot go off-map or through a building', () => {
  const s = initialColony(), a = idOf(s, 'habitat'), b = idOf(s, 'greenhouse')
  const via = { x: 35, z: 21 }
  const path = planNetwork(s, 'power', a, b, via)!
  assert.ok(path)
  assert.ok(path.cells.some(p => p.x === via.x && p.z === via.z))
  assert.ok(validNetwork(s.modules, path))
  assert.ok(networkCost(path) > networkCost(planNetwork(s, 'power', a, b)!))
})

test('an isolated solar array produces no usable power until its cable reaches the base bus', () => {
  const base = initialColony(), added = buildModule(base, 'solar'), solar = added.modules.at(-1)!.id
  close(dailyBudget(added).generationKwh, dailyBudget(base).generationKwh)
  const wired = connect(added, 'power', solar, idOf(added, 'habitat'))
  close(dailyBudget(wired).generationKwh, dailyBudget(base).generationKwh * 1.5)
  const isolated = disconnect(wired, 'power', solar)
  close(dailyBudget(isolated).generationKwh, dailyBudget(base).generationKwh)
})

test('one disconnected greenhouse does not freeze another fully connected greenhouse', () => {
  let s = buildModule(initialColony(), 'greenhouse')
  const fresh = s.modules.at(-1)!.id, old = idOf(s, 'greenhouse')
  for (const type of NETWORK_TYPES) s = connect(s, type, idOf(s, type === 'water' || type === 'return' ? 'recycler' : 'habitat'), fresh)
  const isolated = disconnect(s, 'water', old), next = advanceDay(isolated)
  assert.equal(next.modules.find(m => m.id === old)!.growthDays, 60)
  assert.ok(next.modules.find(m => m.id === fresh)!.growthDays > 0)
  assert.equal(dailyBudget(isolated).growthByModule![old], 0)
  assert.ok(dailyBudget(isolated).growthByModule![fresh] > 0)
})

test('legacy migration cannot create duplicate paid edges or let construction cover migrated utility paths', () => {
  const legacy = { ...initialColony(), networks: undefined }
  const n = planNetwork(legacy, 'power', idOf(legacy, 'habitat'), idOf(legacy, 'greenhouse'))!
  assert.equal(addNetwork(legacy, n), legacy)
  const newer = buildModule(legacy, 'greenhouse')
  assert.ok(newer.networks)
  assert.equal(networkServices(newer).get(newer.modules.at(-1)!.id)!.power, false)
  assert.ok(newer.networks!.every(n => validNetwork(newer.modules, n)))
})
