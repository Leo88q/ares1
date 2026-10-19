/** Machine-readable shape of the 180-sol experiment report (scripts/deepScenario.ts). */

export interface DailyRow {
  sol: number
  foodKg: number
  waterCleanL: number
  waterRawL: number
  waterGreyL: number
  oxygenKg: number
  nutrientsKg: number
  parts: number
  filters: number
  seedKg: number
  wareKg: number
  batteryKwh: number
  generationKwh: number
  servedKwh: number
  unmetKwh: number
  curtailedKwh: number
  labourHours: number
  labourRequiredHours: number
  bottleneck: string
  faults: number
  downtimeSols: number
  harvestedKg: number
  minedKg: number
  hauledKg: number
}

export interface ScenarioReport {
  name: string
  title: string
  sols: number
  scenario: { sunHours: number; waterRecovery: number }
  deep: Record<string, unknown>
  start: {
    crew: number
    waterLitres: number
    foodKg: number
    nutrientsKg: number
    sparesKg: number
    oxygenKg: number
    credits: number
  }
  daily: DailyRow[]
  totals: Record<string, number | Record<string, number>>
  end: {
    foodKg: number
    waterCleanL: number
    nutrientsKg: number
    parts: number
    oxygenKg: number
    seedKg: number
    wareKg: number
    batteryKwh: number
    credits: number
    harvestedKg: number
    deliveredKg: number
  }
  minimums: { waterCleanL: number; foodKg: number; oxygenKg: number }
  firstBottleneck: string | null
  firstShortfallSol: number | null
  bottleneckSols: Record<string, number>
  survived: boolean
}
