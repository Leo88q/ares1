/**
 * Probe for docs/ORGANISM_INTEGRATION.md §13: runs the existing farm (LAB) and
 * colony simulations unchanged and prints the numbers the chain analysis uses.
 * Run: game/node_modules/.bin/tsx game/economy/organism-chain-probe.ts
 * Read-only: imports the engines, changes no source files.
 */
import { initialEngineering, engineeringAction, advanceEngineering, LAB } from '../apps/web/src/fields/engineering/engine.ts'
import * as C from '../apps/web/src/colony/simulation.ts'

// ---- FARM (LAB/2), tier 0, hourly. Water tank refilled from supply; seeds not limiting.
{
  let s = { ...initialEngineering('probe', 0), seeds: 99 }
  let hours = 0, cycles = 0
  const log: string[] = []
  while (hours < 24.66 * 200 && cycles < 12) {
    if (s.tankL < 40 && s.supplyL > 0) s = engineeringAction(s, { type: 'refill' })
    s = advanceEngineering(s, 1); hours += 1
    if (s.last.bottleneck === 'dead') { log.push(`dead at ${hours}h`); break }
    if (s.last.bottleneck === 'storage' && s.crop.progress >= 1 - 1e-9) { log.push(`STALL at ${hours}h: mature but harvest blocked by storage (${s.lots.reduce((a, l) => a + l.kg, 0).toFixed(1)} kg stored, cap ${LAB.storageCapacityKg} kg)`); break }
    if (s.crop.progress >= 1 - 1e-9) {
      s = engineeringAction(s, { type: 'harvest' })
      s = engineeringAction(s, { type: 'plant' })
      cycles++
      log.push(`cycle ${cycles} done at ${hours}h; nutrients left ${s.nutrientsKg.toFixed(3)} kg; supply left ${s.supplyL.toFixed(0)} L`)
    }
  }
  console.log('FARM (tier 0, no processing/sale):'); log.forEach(l => console.log('  ' + l))
}

// ---- COLONY: day-0 budget, then 365 days with auto supply purchases (cost measured).
{
  const b = C.dailyBudget(C.initialColony())
  console.log('COLONY day-0 budget (1 greenhouse 20 m², 1 recycler, 2 solar, 1 habitat, 1 battery):')
  console.log(`  O2 produced ${b.oxygenProducedKg.toFixed(2)} kg/d vs demand ${b.oxygenDemandKg.toFixed(2)} kg/d`)
  console.log(`  water used ${b.waterUsedLitres.toFixed(1)} L/d, nutrients ${b.nutrientsUsedKg.toFixed(3)} kg/d, work ${b.workHours.toFixed(2)} h vs ${b.availableWorkHours.toFixed(1)} h`)
  let c = C.initialColony(), buys = 0, spent = 0
  for (let i = 0; i < 365; i++) {
    if ((c.waterLitres < 150 || c.nutrientsKg < 2 || c.sparesKg < 4) && c.credits >= C.PARAMETERS.supplyCredits) {
      const before = c.credits; c = C.buySupplies(c); buys++; spent += before - c.credits
    }
    c = C.advanceDay(c)
    c = C.deliverFood(c) // player delivers whenever the contract allows
  }
  console.log('COLONY 365 days, auto-supply, no new modules:')
  console.log(`  supply buys ${buys} = ${spent} CR; credits left ${c.credits}; contract income ${c.earnedCredits} CR (cap ${C.PARAMETERS.contractKg * C.PARAMETERS.contractCreditsKg} CR)`)
  console.log(`  water end ${c.waterLitres.toFixed(0)} L; O2 end ${c.oxygenKg.toFixed(1)} kg; O2 shortfall ${c.oxygenShortfallKg.toFixed(0)} kg`)
  console.log(`  harvested ${c.harvestedKg.toFixed(0)} kg; eaten ${c.consumedFoodKg.toFixed(0)} kg; food shortfall ${c.foodShortfallKg.toFixed(0)} kg`)
}
