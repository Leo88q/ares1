// Симуляция стенда (этап 1b): выбор цикла и площади по ограничениям колонии.
// Суточная модель (1 сол). Единицы и источники — docs/LAB_BENCH_PARAMS_MAPPING.md.
// Допущения: выход 0,12 кг/м²/сол (PARAMETERS.cropKgM2Day), срок сырья 3 сол (rawShelfSols),
// переработка 4,2 кг/сол без экипажа (processUnstaffedKgPerSol), склад стенда 45 кг (storageCapacityKg),
// сбор раз в цикл, полный выход партии. Горизонт 180 сол. Запуск: node scripts/lab-bench-sim.mjs
const KG_M2_SOL = 0.12
const RAW_SHELF = 3
const PROCESS_KG_SOL = 4.2
const STORAGE_KG = 45
const HORIZON = 180

export function simulate({ areaM2, cycleSols, horizon = HORIZON }) {
  const batch = areaM2 * KG_M2_SOL * cycleSols
  let raw = []          // партии сырья: {kg, age}
  let processed = 0     // переработанная еда, кг
  let delivered = 0, spoiled = 0, harvests = 0, peakStorage = 0, firstHarvest = null
  let rawSpoiledKg = 0
  for (let sol = 1; sol <= horizon; sol++) {
    // сбор раз в цикл
    if (sol % cycleSols === 0) {
      harvests++
      if (firstHarvest === null) firstHarvest = sol
      raw.push({ kg: batch, age: 0 })
    }
    // старение и порча сырья
    for (const lot of raw) lot.age++
    const expired = raw.filter(l => l.age > RAW_SHELF)
    for (const l of expired) { spoiled += l.kg; rawSpoiledKg += l.kg }
    raw = raw.filter(l => l.age <= RAW_SHELF)
    // переработка (FIFO) до лимита суток
    let cap = PROCESS_KG_SOL
    while (cap > 1e-9 && raw.length) {
      const lot = raw[0]
      const take = Math.min(cap, lot.kg)
      lot.kg -= take; cap -= take; processed += take
      if (lot.kg <= 1e-9) raw.shift()
    }
    // «еда»: переработанное уходит игроку (потребление не моделируем)
    delivered += processed; processed = 0
    const storage = raw.reduce((s, l) => s + l.kg, 0)
    peakStorage = Math.max(peakStorage, storage)
  }
  const total = harvests * batch
  return {
    batchKg: batch, harvests, firstHarvest,
    deliveredKg: delivered, spoiledKg: spoiled,
    wastePct: total ? (spoiled / total) * 100 : 0,
    peakStorageKg: peakStorage,
    fitsStorage: peakStorage <= STORAGE_KG + 1e-9,
    kgPerSol: areaM2 * KG_M2_SOL,
  }
}

// Таблица по сетке площадей и циклов
if (import.meta.url === `file://${process.argv[1]}`) {
  const areas = [2, 3, 3.5, 4, 5, 6]
  const cycles = [6, 10, 15, 20, 30, 45, 90]
  console.log('area_m2 cycle_sols batch_kg harvests first_sol waste_% peak_kg fits_storage kg_per_sol')
  for (const a of areas) for (const c of cycles) {
    const r = simulate({ areaM2: a, cycleSols: c })
    console.log([a, c, r.batchKg.toFixed(1), r.harvests, r.firstHarvest, r.wastePct.toFixed(1), r.peakStorageKg.toFixed(1), r.fitsStorage, r.kgPerSol.toFixed(2)].join('\t'))
  }
}
