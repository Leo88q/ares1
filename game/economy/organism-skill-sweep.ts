/**
 * Skill-spread sweep for docs/ORGANISM_INTEGRATION.md §14.7 (WP11 + T1/T3 version).
 * Runs the ARES-LAB/2 engine hour by hour. Mistakes are TIMED (as in §14.7): each one
 * starts at 24 h and is removed after its duration. The record is the best harvest the
 * player could take during the run (window 80–120 %), relative to the 20 °C optimum.
 * Run: game/node_modules/.bin/tsx game/economy/organism-skill-sweep.ts
 */
import { initialEngineering, engineeringAction, advanceEngineering, harvestMass, canHarvest, maturityRatio } from '../apps/web/src/fields/engineering/engine.ts'

type Mistake = { start: number; end: number; apply: (s: any) => any; undo: (s: any) => any }
type Row = { label: string; best: number; atHour: number; bottleneck: string }

function run(label: string, mistake: Mistake | null, base: (s: any) => any = s => s): Row {
  let s: any = base({ ...initialEngineering('sweep', 0), seeds: 99 })
  let best = 0, atHour = 0
  const maxHours = 24.66 * 40
  for (let h = 0; h < maxHours; h++) {
    if (mistake && h === mistake.start) s = mistake.apply(s)
    if (mistake && h === mistake.end) s = mistake.undo(s)
    if (s.tankL < 40 && s.supplyL > 0) s = engineeringAction(s, { type: 'refill' } as any)
    s = advanceEngineering(s, 1)
    if (canHarvest(s)) {
      const kg = harvestMass(s)
      if (kg > best) { best = kg; atHour = Math.round(s.hour) }
    }
    if (s.last.bottleneck === 'dead') break
    if (maturityRatio(s) > 1.2) break
  }
  return { label, best: +best.toFixed(2), atHour, bottleneck: s.last.bottleneck }
}

const pump: Mistake = { start: 24, end: 72, apply: s => ({ ...s, controls: { ...s.controls, pumpFault: true } }), undo: s => ({ ...s, controls: { ...s.controls, pumpFault: false } }) }
const climate: Mistake = { start: 24, end: 72, apply: s => ({ ...s, controls: { ...s.controls, climate: false } }), undo: s => ({ ...s, controls: { ...s.controls, climate: true } }) }
const lights: Mistake = { start: 24, end: 72, apply: s => ({ ...s, controls: { ...s.controls, lights: false } }), undo: s => ({ ...s, controls: { ...s.controls, lights: true } }) }
const setT = (t: number) => (s: any) => ({ ...s, controls: { ...s.controls, targetC: t, priority: 'crop' } })

const rows: Row[] = []
rows.push(run('optimum 20 °C', null, setT(20)))
for (const t of [12, 16, 24, 26]) rows.push(run(`target ${t} °C`, null, setT(t)))
rows.push(run('MISTAKE: pump off 2 days (24–72 h)', pump, setT(20)))
rows.push(run('MISTAKE: climate off 2 days (24–72 h)', climate, setT(20)))
rows.push(run('MISTAKE: lights off 2 days (24–72 h)', lights, setT(20)))

const ref = rows[0].best
for (const r of rows) console.log(`${r.label.padEnd(38)} best=${String(r.best).padStart(6)} kg  ×${(r.best / ref).toFixed(2)}  at ${String(r.atHour).padStart(4)} h  bottleneck=${r.bottleneck}`)
