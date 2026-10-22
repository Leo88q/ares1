import { applyColonyAction, createInitialColonyState, materializeColony } from '../apps/backend/src/colonies/engine.js'
import { BASE_CAPACITY, RESEARCH, RESOURCE_KEYS } from '../apps/backend/src/colonies/rules.js'
import type { BuildingKind, ColonyState, ResearchId, Resource } from '../apps/backend/src/colonies/rules.js'

const epoch = Date.parse('2026-01-01T00:00:00.000Z')
const HOURS = 24 * 30
const BUILD_ORDER: BuildingKind[] = ['solar_array', 'water_recycler', 'metal_extractor']
const RESEARCH_ORDER: ResearchId[] = ['resource_efficiency', 'hydrology', 'metallurgy', 'solar_grid']

function run(): string {
  let state: ColonyState = createInitialColonyState(new Date(epoch))
  const firstCap: Partial<Record<Resource, number>> = {}
  const events: string[] = []

  for (let hour = 0; hour <= HOURS; hour++) {
    const at = new Date(epoch + hour * 60 * 60 * 1000)
    state = materializeColony(state, at)

    for (const resource of RESOURCE_KEYS) {
      if (state.resources[resource] >= BASE_CAPACITY[resource] && firstCap[resource] === undefined) firstCap[resource] = hour
    }

    if (hour === HOURS) break

    const buildBusy = state.buildings.some(building => building.status === 'constructing' || building.status === 'upgrading')
    if (!buildBusy) {
      const nextBuild = BUILD_ORDER.find(kind => !state.buildings.some(building => building.kind === kind))
      const nextUpgrade = state.buildings.find(building => building.level < 3 && building.status === 'active')
      try {
        if (nextBuild) {
          const result = applyColonyAction(state, { type: 'start_build', building: nextBuild }, at)
          state = result.state
          events.push(`day ${hour / 24}: start ${nextBuild}`)
        } else if (nextUpgrade) {
          const result = applyColonyAction(state, { type: 'start_upgrade', buildingId: nextUpgrade.id }, at)
          state = result.state
          events.push(`day ${hour / 24}: upgrade ${nextUpgrade.kind} to ${nextUpgrade.level + 1}`)
        }
      } catch {
        // Leave the queue free and retry on the next hourly tick if resources are short.
      }
    }

    if (!state.pendingResearch) {
      const candidate = RESEARCH_ORDER.find(id => !state.completedResearch.includes(id)
        && RESEARCH[id].prerequisites.every(prerequisite => state.completedResearch.includes(prerequisite)))
      if (candidate) {
        try {
          const result = applyColonyAction(state, { type: 'start_research', research: candidate }, at)
          state = result.state
          events.push(`day ${hour / 24}: start research ${candidate}`)
        } catch {
          // Research remains available; retry after production on the next hourly tick.
        }
      }
    }
  }

  const rows = RESOURCE_KEYS.map(resource => `| ${resource} | ${state.resources[resource]} / ${BASE_CAPACITY[resource]} | ${firstCap[resource] === undefined ? 'не достигнут за 30 суток' : `${firstCap[resource]} ч (${(firstCap[resource]! / 24).toFixed(1)} суток)`} |`).join('\n')
  return [
    '# Colony ruleset v2 — reproducible baseline scenario',
    '',
    'Команда: `cd game && yarn simulate:colony-rules`.',
    '',
    '**Это прогон текущего backend engine, не утверждённая экономика и не симуляция платных расширений.** Starter: начальные серверные запасы; политика строит Solar Array → Water Recycler → Metal Extractor, затем доводит каждое здание до уровня 3; параллельно исследует доступные технологии в объявленном порядке. Один шаг планирования в час. Нет обслуживания, случайных событий, новых Field, дополнительных SKU-очередей, сетевых платежей или токен-доходности.',
    '',
    '| Ресурс | На 30-е сутки | Первый полный склад |',
    '|---|---:|---:|',
    rows,
    '',
    '## Очередь действий',
    '',
    ...events.map(event => `- ${event}`),
    '',
    '## Ограничения интерпретации',
    '',
    '- Это один детерминированный policy, а не поиск оптимума и не измерение retention/денежной ценности.',
    '- Полные склады означают, что в v2 нет достаточных постоянных sink-ов либо выбранная стратегия перепроизводит; это аргумент для балансировки, не сам по себе требование добавлять штрафы.',
    '- Время фиксировано сервером. Чтобы сравнить новые цены/права, сначала надо утвердить их точный эффект (поля, очереди, лимиты) и подключить к движку; текущая Colony state модель не применяет catalog grants.',
    '',
  ].join('\n')
}

const report = run()
const args = process.argv.slice(2)
if (args.length === 0) console.log(report)
else if (args.length === 1 && args[0] === '--check') {
  if (!report.includes('| metal |') || !report.includes('| water |') || !report.includes('| power |') || !report.includes('| science |')) {
    throw new Error('Simulation output is missing resource rows')
  }
  console.log('Colony ruleset baseline simulation completed.')
} else {
  console.error('Usage: yarn simulate:colony-rules [--check]')
  process.exitCode = 1
}
