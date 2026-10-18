import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, initialColony, type ColonyState } from '../../apps/web/src/colony/simulation'
import { RESOURCE_IDS } from '../../apps/web/src/colony/deep/resources'
import type { ColonyWorld } from '../../apps/web/src/colony/deep/world'
import { buildStartColony, SCENARIOS } from '../../scripts/deepScenario'
import { outsideTemperatureC } from '../../apps/web/src/colony/deep/sections'

/**
 * Инварианты цепочек. Это не проверки конкретных чисел, а проверки того, что
 * модель вообще не умеет делать: создавать массу из ничего, выдавать один и тот
 * же груз дважды, отменять уже потерянный урожай или платить по контракту
 * дважды. Каждый тест здесь соответствует отдельному пункту требований.
 */

const SCENARIO = SCENARIOS[0].scenario

function run(sols: number, start = buildStartColony()): { state: ColonyState; worlds: ColonyWorld[] } {
  let state = start
  const worlds: ColonyWorld[] = []
  for (let sol = 1; sol <= sols; sol++) {
    if (SCENARIOS[0].deep && state.world) {
      state.world.scenario = { ...state.world.scenario, ...SCENARIOS[0].deep }
    }
    state = advanceDay(state, SCENARIO)
    worlds.push(state.world!)
  }
  return { state, worlds }
}

test('no stock ever goes negative or above its capacity', () => {
  const { worlds } = run(120)
  for (const world of worlds) {
    for (const id of RESOURCE_IDS) {
      const amount = world.stock.amount[id] ?? 0
      const cap = world.stock.cap[id] ?? 0
      assert.ok(amount >= -1e-9, `${id} went negative: ${amount}`)
      assert.ok(amount <= cap + 1e-6, `${id} exceeds its capacity: ${amount} > ${cap}`)
    }
  }
})

test('a crew member is never on two tasks at once', () => {
  const { worlds } = run(120)
  for (const world of worlds) {
    const open = world.tasks.filter(t => t.status === 'active' || t.status === 'queued')
    const seat = new Map<string, string>()
    for (const task of open) {
      const seen = new Set<string>()
      for (const crewId of task.assignees) {
        assert.ok(!seen.has(crewId), `${crewId} listed twice on task ${task.id}`)
        seen.add(crewId)
        assert.ok(!seat.has(crewId), `${crewId} is on ${seat.get(crewId)} and ${task.id}`)
        seat.set(crewId, task.id)
      }
    }
    for (const member of world.crew) {
      if (member.taskId === null) continue
      assert.equal(seat.get(member.id), member.taskId,
        `${member.id} thinks it is on ${member.taskId}, the queue says ${seat.get(member.id)}`)
    }
  }
})

test('a machine carries one job and never duplicates cargo', () => {
  const { worlds } = run(120)
  for (const world of worlds) {
    const jobs = new Map<string, number>()
    for (const job of world.haulJobs) {
      // Запрошено = погружено + доставлено + оставлено в пути. Груз не множится.
      assert.ok(job.loadedKg <= job.requestedKg + 1e-6,
        `${job.id} carries ${job.loadedKg} of ${job.requestedKg} requested`)
      assert.ok(job.deliveredKg <= job.requestedKg + 1e-6,
        `${job.id} delivered ${job.deliveredKg} of ${job.requestedKg} requested`)
      assert.ok(job.loadedKg >= -1e-9 && job.deliveredKg >= -1e-9, `${job.id} has negative cargo`)
    }
    for (const vehicle of world.vehicles) {
      if (!vehicle.jobId) continue
      jobs.set(vehicle.jobId, (jobs.get(vehicle.jobId) ?? 0) + 1)
    }
    for (const [jobId, count] of jobs) {
      assert.equal(count, 1, `job ${jobId} is assigned to ${count} machines`)
    }
  }
})

test('planting really consumes seed potato, and only what it records', () => {
  const { state, worlds } = run(120)
  const last = worlds[worlds.length - 1]
  // Складываем по итоговому миру: запас один, а не по снупку на каждый сол.
  const seeded = last.batches.reduce((sum, b) => sum + (b.plantedSol !== null ? b.seedKg : 0), 0)
  const left = state.world!.stock.amount.seed_potato
  const START_SEED_KG = 40
  assert.ok(seeded + left <= START_SEED_KG + 1e-6,
    `planted ${seeded} kg plus ${left} kg left cannot exceed the starting ${START_SEED_KG} kg`)
  assert.ok(seeded >= 0 && left >= 0, `negative seed: planted ${seeded}, left ${left}`)
  const everPlanted = worlds.some(w => w.batches.some(b => b.plantedSol !== null && b.seedKg > 0))
  assert.ok(everPlanted, 'nothing was ever planted, so the test proves nothing')
})

test('lost yield is never given back', () => {
  const { worlds } = run(120)
  const worst = new Map<string, number>()
  for (const world of worlds) {
    for (const batch of world.batches) {
      const previous = worst.get(batch.id) ?? 0
      // Грядку могли пересеять — тогда штраф обнуляется вместе с партией.
      const replanted = batch.plantedSol !== null && previous > batch.yieldPenalty + 1e-9 && batch.development < 0.05
      assert.ok(batch.yieldPenalty >= previous - 1e-9 || replanted,
        `${batch.id}: penalty fell from ${previous} to ${batch.yieldPenalty} without replanting`)
      worst.set(batch.id, Math.max(previous, batch.yieldPenalty))
    }
  }
})

test('the same seed reproduces the same run', () => {
  const a = run(60)
  const b = run(60)
  assert.deepEqual(a.state.world!.totals, b.state.world!.totals)
  assert.equal(a.state.foodKg, b.state.foodKg)
  assert.equal(a.state.waterLitres, b.state.waterLitres)
})

test('reordering beds does not change the harvest', () => {
  const base = run(70)
  let state = buildStartColony()
  for (let sol = 1; sol <= 70; sol++) {
    if (state.world) state.world.batches.reverse()
    if (SCENARIOS[0].deep && state.world) {
      state.world.scenario = { ...state.world.scenario, ...SCENARIOS[0].deep }
    }
    state = advanceDay(state, SCENARIO)
  }
  // Порядок грядок не должен менять урожай: CO₂ делится по доле спроса,
  // иначе первая в списке грядка выигрывает всегда.
  assert.ok(Math.abs(state.world!.totals.harvestedKg - base.state.world!.totals.harvestedKg) < 1e-6,
    `harvest depends on bed order: ${state.world!.totals.harvestedKg} vs ${base.state.world!.totals.harvestedKg}`)
})

test('water is conserved: stock change equals produced minus used', () => {
  let state = buildStartColony()
  for (let sol = 1; sol <= 60; sol++) {
    const before = state.world?.stock.amount.water_clean ?? 0
    if (SCENARIOS[0].deep && state.world) {
      state.world.scenario = { ...state.world.scenario, ...SCENARIOS[0].deep }
    }
    state = advanceDay(state, SCENARIO)
    const world = state.world!
    const step = world.lastStep
    if (!step) continue
    const after = world.stock.amount.water_clean
    // Тождество «было + добыча + регенерация − расход = стало» сходится с
    // точностью до округления: вся вода проходит через один якорь — бак.
    const produced = step.waterProducedL + step.condensateL
    const used = step.waterAggregateUsedL + step.waterIndustrialL
    assert.ok(Math.abs(before + produced - used - after) < Math.max(1, used * 0.02),
      `sol ${state.day}: ${before} + ${produced} − ${used} ≠ ${after}`)
  }
})

test('a contract cannot be filled twice or paid beyond its pool', () => {
  const { state, worlds } = run(120)
  for (const world of worlds) {
    for (const contract of world.contracts) {
      assert.ok(contract.deliveredKg <= contract.requiredKg + 1e-6,
        `${contract.id}: delivered ${contract.deliveredKg} of ${contract.requiredKg}`)
      assert.ok(contract.paidCR <= contract.rewardFundCR + 1e-6,
        `${contract.id}: paid ${contract.paidCR} of a ${contract.rewardFundCR} pool`)
      assert.ok(contract.paidCR >= -1e-9, `${contract.id}: negative payment`)
    }
  }
  const ledger = state.ledger
  assert.ok(ledger.exportedKg <= 60 + 1e-6, `exported ${ledger.exportedKg} kg past the 60 kg bound`)
  assert.ok(Math.abs(state.earnedCredits - ledger.exportedKg * 4) < 1e-6,
    'receipts must match the exported mass times the agreed rate')
})

test('a cold scenario makes the outside colder, not warmer', () => {
  // Знак сдвига однажды был инвертирован, и «пылевой сезон» с coldDropC = −6
  // получался теплее номинала: сценарий не проверял то, что обещал.
  const nominal = outsideTemperatureC(6, 0)
  const dusty = outsideTemperatureC(6, -6)
  assert.ok(dusty < nominal - 5.9,
    `a −6 °C drop must cool the outside by 6 °C, got ${nominal} → ${dusty}`)
  assert.ok(outsideTemperatureC(6, 4) > nominal + 3.9, 'a positive shift must warm it')
  // Суточная кривая остаётся в марсианских пределах.
  for (let hour = 0; hour < 24.6229; hour += 1) {
    const t = outsideTemperatureC(hour, 0)
    assert.ok(t >= -60 && t <= -20, `outside ${t} °C at hour ${hour} is not Mars-like`)
  }
})
