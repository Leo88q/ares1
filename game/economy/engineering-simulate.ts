import { writeFileSync } from 'node:fs'
import { advanceEngineering, cropStage, engineeringAction, initialEngineering, LAB, lotQuality, storageKg } from '../apps/web/src/fields/engineering/engine'
import type { EngineeringState } from '../apps/web/src/fields/engineering/engine'

const run = (s: EngineeringState, sols = 7): EngineeringState => advanceEngineering(s, sols * LAB.solHours)
const harvest = (s: EngineeringState): EngineeringState => engineeringAction(s, { type: 'harvest' })
const start = (): EngineeringState => initialEngineering('report-section', 0)
const grown = run(start())
const normal = harvest(grown)
const noClimate = run(engineeringAction(start(), { type: 'toggle', control: 'climate' }))
const lowerTarget = run(engineeringAction(start(), { type: 'setpoint', value: 16 }))
const hotTarget = run(engineeringAction(start(), { type: 'setpoint', value: 26 }))
const coldEvent = run(engineeringAction(start(), { type: 'cold' }))
const storm = run(engineeringAction(start(), { type: 'dust' }))
const cropPriority = run(engineeringAction(engineeringAction(normal, { type: 'plant' }), { type: 'dust' }), 2)
const foodPriority = run(engineeringAction(engineeringAction(engineeringAction(normal, { type: 'plant' }), { type: 'dust' }), { type: 'priority', value: 'food' }), 2)
const warm = advanceEngineering(engineeringAction(normal, { type: 'toggle', control: 'cooling' }), 100)
let processed = engineeringAction(normal, { type: 'process', lotId: normal.lots[0].id })
processed = advanceEngineering(processed, 12)
processed = advanceEngineering(engineeringAction(processed, { type: 'toggle', control: 'cooling' }), 100)
const cases: [string, EngineeringState][] = [
  ['Auto climate, target 20 C, mature cycle', grown], ['Climate disabled', noClimate],
  ['Auto climate, target 16 C', lowerTarget], ['Auto climate, target 26 C', hotTarget],
  ['Cold event, 2 sols', coldEvent], ['Dust event, 2 sols', storm],
  ['Food + new planting + dust, crop priority', cropPriority], ['Same, food-storage priority', foodPriority],
  ['Harvest, uncooled storage 100 h', warm], ['Process 5 kg, then uncooled storage 100 h', processed],
]
const f = (n: number): string => n.toFixed(2)
const rows = cases.map(([name, s]) => {
  const stored = storageKg(s)
  const weightedQuality = stored > 0 ? s.lots.reduce((sum, lot) => sum + lot.kg * lotQuality(lot), 0) / stored * 100 : 0
  return `| ${name} | ${f(s.hour)} | ${cropStage(s.crop)} | ${f(s.crop.health * 100)} | ${f(s.temperatureC)} | ${f(s.controls.targetC)} | ${f(s.crop.progress * 100)} | ${f(stored)} | ${f(weightedQuality)} | ${f(s.totals.heaterHeatKwh)} | ${f(s.totals.unservedKwh)} |`
})
const text = `# Field climate engineering study — 2026-10-15\n\nProfile **${LAB.version}**, Common tier. All coefficients and response curves are explicit game assumptions, not NASA/Mars agronomic validation or food-safety guidance. No RPC, wallet, token balances, orders or rewards. The old LAB/1 report remains historical; this command now runs LAB/2. One sol = ${LAB.solHours} SIM h; growth requires ${LAB.growthLightHours} light-equivalent h adjusted by water, nutrients, health and temperature response.\n\n| Scenario | SIM h | Crop | Health % | Greenhouse C | Target C | Development % | Stored kg | Quality % | Heater heat kWh | Unserved kWh |\n|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\nPriority comparison uses the same harvested lot + new planting + two-sol dust event, with only the declared allocation order changed. Water is always first; crop priority allocates climate/light before refrigeration, food priority allocates refrigeration before climate/light. No energy is created by switching modes.\n\nThermal accounting: final temperature = initial + (heater heat + lamp heat + signed envelope exchange - climate heat removal - evaporative loss) / effective thermal capacity. All terms arise from simulated weather, allocated electrical loads and consumed water; no temperature clamp manufactures heat. Material accounting still preserves water, nutrients and harvested food mass, including processing feed/losses and spoilage. POTATO cannot spoil and is not affected.\n`
console.log(text)
const index = process.argv.indexOf('--report')
if (index >= 0) {
  const file = process.argv[index + 1]
  if (!file) throw new Error('Missing --report path')
  writeFileSync(file, text)
}
