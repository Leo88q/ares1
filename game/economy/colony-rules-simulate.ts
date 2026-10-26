import { writeFileSync } from 'node:fs'
import { applyColonyAction, createInitialColonyState, materializeColony } from '../apps/backend/src/colonies/engine.js'
import { COLONY_PACKAGE_CATALOG, resolveColonyGrants } from '../apps/backend/src/colonies/catalog.js'
import { BASE_CAPACITY, COLONY_RULESET_VERSION, RESEARCH, RESOURCE_KEYS } from '../apps/backend/src/colonies/rules.js'
import type { BuildingKind, ColonyState, ResearchId, Resource } from '../apps/backend/src/colonies/rules.js'
import type { ColonySkuId } from '../apps/backend/src/colonies/catalog.js'

const EPOCH = Date.parse('2026-01-01T00:00:00.000Z')
const HORIZONS = [30, 90, 180] as const
const MAX_HOURS = Math.max(...HORIZONS) * 24
const BUILD_ORDER: BuildingKind[] = ['solar_array', 'water_recycler', 'metal_extractor']
const RESEARCH_ORDER: ResearchId[] = ['resource_efficiency', 'hydrology', 'metallurgy', 'solar_grid']
const EXPANSIONS: ColonySkuId[] = ['RESEARCH_WING_V1', 'FRONTIER_EXPANSION_V1', 'INDUSTRIAL_NETWORK_V1']

interface ScenarioResult {
  skus: ColonySkuId[]
  fieldSlots: number
  buildQueues: number
  researchQueues: number
  capacities: Record<Resource, number>
  firstCap: Partial<Record<Resource, number>>
  checkpoints: Map<number, ColonyState>
  events: Array<{ hour: number; event: string }>
}

function packageScenarios(): ColonySkuId[][] {
  const scenarios: ColonySkuId[][] = [['STARTER_COLONY_V1']]
  for (let mask = 1; mask < 1 << EXPANSIONS.length; mask++) {
    scenarios.push([
      'STARTER_COLONY_V1',
      ...EXPANSIONS.filter((_, index) => mask & (1 << index)),
    ])
  }
  return scenarios
}

function runScenario(skus: ColonySkuId[]): ScenarioResult {
  const grants = resolveColonyGrants(skus)
  let state: ColonyState = createInitialColonyState(new Date(EPOCH), grants)
  const firstCap: Partial<Record<Resource, number>> = {}
  const events: Array<{ hour: number; event: string }> = []
  const checkpoints = new Map<number, ColonyState>()
  const checkpointHours = new Set(HORIZONS.map(days => days * 24))

  for (let hour = 0; hour <= MAX_HOURS; hour++) {
    const at = new Date(EPOCH + hour * 60 * 60 * 1000)
    state = materializeColony(state, at)

    for (const resource of RESOURCE_KEYS) {
      if (state.resources[resource] >= state.capacities[resource] && firstCap[resource] === undefined) firstCap[resource] = hour
    }
    if (checkpointHours.has(hour)) checkpoints.set(hour, structuredClone(state))
    if (hour === MAX_HOURS) break

    // Fill every available construction slot in a deterministic, published order.
    while (state.buildings.filter(job => job.status === 'constructing' || job.status === 'upgrading').length < grants.buildQueues) {
      const nextBuild = BUILD_ORDER.find(kind => !state.buildings.some(building => building.kind === kind))
      const nextUpgrade = nextBuild ? undefined : state.buildings.find(building => building.status === 'active' && building.level < 3)
      if (!nextBuild && !nextUpgrade) break
      try {
        if (nextBuild) {
          const result = applyColonyAction(state, { type: 'start_build', building: nextBuild }, at)
          state = result.state
          events.push({ hour, event: `build ${nextBuild}` })
        } else if (nextUpgrade) {
          const result = applyColonyAction(state, { type: 'start_upgrade', buildingId: nextUpgrade.id }, at)
          state = result.state
          events.push({ hour, event: `upgrade ${nextUpgrade.kind} to ${nextUpgrade.level + 1}` })
        }
      } catch {
        break // Re-evaluate affordability after the next materialization tick.
      }
    }

    // Independent prerequisites can use additional research queues concurrently.
    while (state.pendingResearch.length < grants.researchQueues) {
      const candidate = RESEARCH_ORDER.find(id => !state.completedResearch.includes(id)
        && !state.pendingResearch.some(job => job.id === id)
        && RESEARCH[id].prerequisites.every(prerequisite => state.completedResearch.includes(prerequisite)))
      if (!candidate) break
      try {
        const result = applyColonyAction(state, { type: 'start_research', research: candidate }, at)
        state = result.state
        events.push({ hour, event: `research ${candidate}` })
      } catch {
        break
      }
    }
  }

  return {
    skus,
    fieldSlots: grants.fieldSlots,
    buildQueues: grants.buildQueues,
    researchQueues: grants.researchQueues,
    capacities: { ...state.capacities },
    firstCap,
    checkpoints,
    events,
  }
}

function resourcesAt(state: ColonyState): string {
  return RESOURCE_KEYS.map(resource => `${state.resources[resource]}/${state.capacities[resource]}`).join(' · ')
}

function skuLabel(skus: readonly ColonySkuId[]): string {
  return skus.length === 1 ? 'Starter' : skus.filter(sku => sku !== 'STARTER_COLONY_V1').map(sku => sku.replace('_V1', '')).join(' + ')
}

function formatHours(hours: number | undefined): string {
  return hours === undefined ? '—' : `${hours}h (${(hours / 24).toFixed(1)}d)`
}

function run(): string {
  const results = packageScenarios().map(runScenario)
  const lines = [
    `# Colony ruleset v${COLONY_RULESET_VERSION} — approved package scenarios`,
    '',
    'Run: `cd game && yarn simulate:colony-rules`. The simulation runs the same backend engine and grant resolver for Starter and all seven expansion combinations over 30/90/180 days.',
    '',
    '**Not an offer, live economy forecast or mainnet test.** Resources are server-side game values. No payment, token yield, stochastic events, maintenance/sinks, independent Field colonies or user behavior are modeled. The Field grant is reported as eligible linked-Field capacity; current game simulation has no production/action yield per linked Field. Lab cap is an entitlement limit; no Lab upgrade action exists yet, so simulated Lab production stays at its current level.',
    '',
    '| Scenario | Field slots | Build / research queues | Capacity M/W/P/S | Resources at 30d (M/W/P/S) | 90d | 180d | First full storage M/W/P/S |',
    '|---|---:|---:|---|---|---|---|---|',
  ]

  for (const result of results) {
    const thirty = result.checkpoints.get(30 * 24)!
    const ninety = result.checkpoints.get(90 * 24)!
    const oneEighty = result.checkpoints.get(180 * 24)!
    const cap = RESOURCE_KEYS.map(resource => result.capacities[resource] / BASE_CAPACITY[resource]).join('/')
    const firstFull = RESOURCE_KEYS.map(resource => formatHours(result.firstCap[resource])).join(' / ')
    lines.push(`| ${skuLabel(result.skus)} | ${result.fieldSlots} | ${result.buildQueues} / ${result.researchQueues} | ×${cap} | ${resourcesAt(thirty)} | ${resourcesAt(ninety)} | ${resourcesAt(oneEighty)} | ${firstFull} |`)
  }

  lines.push('', '## Scheduled actions by scenario', '')
  for (const result of results) {
    lines.push(`### ${skuLabel(result.skus)}`, '')
    if (result.events.length === 0) lines.push('No actions started.', '')
    else for (const { hour, event } of result.events) lines.push(`- h${hour}: ${event}`)
    lines.push('')
  }
  lines.push(
    '## Interpretation',
    '',
    '- Queue grants are enforced by the same action engine used by Colony service. Building/research costs and production remain server-calculated; queue slots only permit more concurrent jobs.',
    '- Storage caps apply per resource: Research Wing doubles science storage; Frontier doubles all four; Industrial multiplies all four by four. Purchased storage is combined by the maximum applicable multiplier, not stacked multiplicatively.',
    '- Fields are additive slots, Lab cap is max-of-owned grants. Neither increases resource production in this model. Implementing multiple linked Field accounts and a Lab-upgrade action requires their separate service/data-flow implementation and approved mechanics; no value is invented here.',
    '- This is one deterministic greedy policy, not an optimizer. A resource reaching capacity means further production is discarded by the existing engine; it highlights the need to balance net production/sinks, not a case for punitive offline loss.',
    '- Change `BUILD_ORDER` / `RESEARCH_ORDER` to test a different strategy. Horizons are declared in `HORIZONS`; the upper limit must remain within the engine five-year materialization bound.',
    '',
  )
  return lines.join('\n')
}

const report = run()
const args = process.argv.slice(2)
if (args.length === 0) console.log(report)
else if (args.length === 1 && args[0] === '--check') {
  const required = ['Starter', 'RESEARCH_WING', 'FRONTIER_EXPANSION', 'INDUSTRIAL_NETWORK']
  if (!required.every(token => report.includes(token)) || !report.includes('180d')) throw new Error('Simulation output is missing package scenarios or horizons')
  console.log('Colony package scenario matrix completed.')
} else if (args.length === 2 && args[0] === '--report') {
  writeFileSync(args[1], `${report}\n`)
  console.log(`Wrote ${args[1]}`)
} else {
  console.error('Usage: yarn simulate:colony-rules [--check | --report <path>]')
  process.exitCode = 1
}
