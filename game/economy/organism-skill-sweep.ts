/**
 * Skill-spread sweep for docs/ORGANISM_INTEGRATION.md §14. Runs the existing
 * ARES-LAB/2 engine unchanged over one growth cycle per setting combination.
 * Run: game/node_modules/.bin/tsx game/economy/organism-skill-sweep.ts
 */
import { initialEngineering, engineeringAction, advanceEngineering } from '../apps/web/src/fields/engineering/engine.ts'
type Row = { label: string; kg: number; hours: number; health: number; kwhServed: number; waterL: number; bottleneck: string }

function run(label: string, setup: (s: any) => any, refillBelow = 40, maxHours = 24.66 * 40): Row {
  let s: any = setup({ ...initialEngineering('sweep', 0), seeds: 9 })
  let hours = 0
  while (hours < maxHours) {
    if (s.tankL < refillBelow && s.supplyL > 0) s = engineeringAction(s, { type: 'refill' } as any)
    s = advanceEngineering(s, 1); hours += 1
    if (s.crop.progress >= 1 - 1e-9 || s.last.bottleneck === 'dead') break
  }
  const matured = s.crop.progress >= 1 - 1e-9
  const kg = matured && s.last.bottleneck !== 'dead' ? s.lots.reduce((a: number, l: any) => a + l.kg, 0) + (matured ? 0 : 0) : 0
  // harvest collected at maturity (what the player would sell): harvestMass uses health
  const harvestKg = matured ? 18 * s.crop.health : 0
  return { label, kg: +harvestKg.toFixed(2), hours: Math.round(hours), health: +s.crop.health.toFixed(2), kwhServed: +s.totals.servedKwh.toFixed(1), waterL: +s.totals.waterConsumedL.toFixed(1), bottleneck: s.last.bottleneck }
}

const rows: Row[] = []
// 1) setpoint × priority; lights and climate on
for (const t of [12, 16, 20, 24, 26]) for (const pr of ['crop', 'food'] as const) {
  rows.push(run(`target ${t}°C, priority ${pr}`, s => ({ ...s, controls: { ...s.controls, targetC: t, priority: pr } })))
}
// 2) mistakes (one error each, otherwise optimal)
rows.push(run('MISTAKE: lights off all the time', s => ({ ...s, controls: { ...s.controls, lights: false } })))
rows.push(run('MISTAKE: climate off (no thermostat)', s => ({ ...s, controls: { ...s.controls, climate: false } })))
rows.push(run('MISTAKE: pump fault not repaired', s => ({ ...s, controls: { ...s.controls, pumpFault: true } })))
rows.push(run('MISTAKE: no refill of tank (supply kept)', s => s, 0))
rows.push(run('OPTIMAL: 20°C, priority crop', s => ({ ...s, controls: { ...s.controls, targetC: 20, priority: 'crop' } })))

for (const r of rows) console.log(`${r.label.padEnd(40)} kg=${String(r.kg).padStart(5)} hours=${String(r.hours).padStart(4)} health=${r.health} served=${r.kwhServed}kWh water=${r.waterL}L bottleneck=${r.bottleneck}`)
