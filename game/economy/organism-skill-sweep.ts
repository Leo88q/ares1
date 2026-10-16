/**
 * Skill-spread sweep for docs/ORGANISM_INTEGRATION.md §14.7 (WP11 version).
 * Runs the ARES-LAB/2 engine (with the continuous harvest window) hour by hour and
 * records the best harvest the player could take during the run, plus the harvest
 * when the crop first reaches 80 % maturity (early) and at maturity (ideal).
 * Run: game/node_modules/.bin/tsx game/economy/organism-skill-sweep.ts
 */
import { initialEngineering, engineeringAction, advanceEngineering, harvestMass, canHarvest, maturityRatio } from '../apps/web/src/fields/engineering/engine.ts'

type Row = { label: string; best: number; atHour: number; early: number; ideal: number; bottleneck: string }

function run(label: string, setup: (s: any) => any, refillBelow = 40): Row {
  let s: any = setup({ ...initialEngineering('sweep', 0), seeds: 99 })
  const maxHours = 24.66 * 40
  let best = 0, atHour = 0, early: number | null = null, ideal: number | null = null
  for (let h = 0; h < maxHours; h++) {
    if (s.tankL < refillBelow && s.supplyL > 0) s = engineeringAction(s, { type: 'refill' } as any)
    s = advanceEngineering(s, 1)
    const r = maturityRatio(s)
    if (canHarvest(s)) {
      const kg = harvestMass(s)
      if (kg > best) { best = kg; atHour = Math.round(s.hour) }
      if (early === null && r >= 0.8) early = kg
      if (ideal === null && r >= 1) ideal = kg
    }
    if (s.last.bottleneck === 'dead') break
    if (r > 1.2) break // window closed
  }
  const f = (x: number | null) => (x === null ? 0 : +x.toFixed(2))
  return { label, best: +best.toFixed(2), atHour, early: f(early), ideal: f(ideal), bottleneck: s.last.bottleneck }
}

const rows: Row[] = []
for (const t of [12, 16, 20, 24, 26]) rows.push(run(`target ${t}°C, priority crop`, s => ({ ...s, controls: { ...s.controls, targetC: t, priority: 'crop' } })))
rows.push(run('MISTAKE: lights off all the time', s => ({ ...s, controls: { ...s.controls, lights: false } })))
rows.push(run('MISTAKE: climate off (no thermostat)', s => ({ ...s, controls: { ...s.controls, climate: false } })))
rows.push(run('MISTAKE: pump fault not repaired', s => ({ ...s, controls: { ...s.controls, pumpFault: true } })))
rows.push(run('MISTAKE: tank never refilled', s => s, 0))

const ref = rows.find(r => r.label.includes('20°C'))!.best
for (const r of rows) {
  console.log(`${r.label.padEnd(38)} best=${String(r.best).padStart(6)} kg (×${(r.best / ref).toFixed(2)})  at ${String(r.atHour).padStart(4)}h  early(80%)=${r.early}  ideal(100%)=${r.ideal}  bottleneck=${r.bottleneck}`)
}
