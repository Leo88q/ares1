/** Reproducible resource study. Shares the exact engine used by /colony. */
import { writeFileSync } from 'node:fs'
import { advanceDay, buildModule, buySupplies, canRepair, DEFAULT_SCENARIO, deliverFood, initialColony, PARAMETERS, repairColony } from '../apps/web/src/colony/simulation'
import type { ColonyState, Scenario } from '../apps/web/src/colony/simulation'

interface Experiment {
  name: string
  managed: boolean
  exportFood?: boolean
  initial?: (s: ColonyState) => ColonyState
  scenario?: (day: number) => Scenario
}
const experiments: Experiment[] = [
  { name: 'Стартовая база, без обслуживания', managed: false },
  { name: 'Стартовая база, обслуживание и снабжение', managed: true },
  { name: 'Без регенератора, обслуживание и снабжение', managed: true, initial: s => ({ ...s, modules: s.modules.filter(m => m.kind !== 'recycler') }) },
  { name: '15 суток темноты (дни 45–59), обслуживание', managed: true, scenario: day => ({ ...DEFAULT_SCENARIO, sunHours: day >= 45 && day <= 59 ? 0 : 18 }) },
  { name: 'Обслуживание, без продажи страхового запаса', managed: true, exportFood: false },
  { name: '+2 теплицы без расширения водооборота', managed: true, initial: s => buildModule(buildModule(s, 'greenhouse'), 'greenhouse') },
]

function run(experiment: Experiment) {
  let state = experiment.initial?.(initialColony()) ?? initialColony()
  let unmetEnergy = 0, waterConstrainedDays = 0, firstHarvest: number | null = null
  for (let day = 1; day <= 180; day++) {
    if (experiment.managed) {
      if ((state.waterLitres < 120 || state.nutrientsKg < 0.2 || state.sparesKg < 2) && state.credits >= PARAMETERS.supplyCredits) state = buySupplies(state)
      if (state.modules.some(m => m.condition < 85) && canRepair(state)) state = repairColony(state)
      if (state.harvestedKg > 0 && experiment.exportFood !== false) state = deliverFood(state)
    }
    state = advanceDay(state, experiment.scenario?.(day) ?? DEFAULT_SCENARIO)
    unmetEnergy += state.lastDay!.unmetKwh
    if (state.lastDay!.waterShortfallLitres > 0.01) waterConstrainedDays++
    if (firstHarvest === null && state.harvestedKg > 0) firstHarvest = day
  }
  return { state, firstHarvest, unmetEnergy, waterConstrainedDays }
}

const lines = [
  '# Ресурсная экономика лунной фермы — воспроизводимый эксперимент',
  '',
  'Дата спецификации: 2026-10-14. Горизонт: 180 земных суток. Команда: `cd game && yarn simulate:colony`.',
  '',
  '**Не бизнес-прогноз и не on-chain токеномика.** CR — условный игровой бюджет. Килограммы — свежая добавка к рациону, не полное питание. Реальные риски жизни экипажа здесь не рассчитываются.',
  '',
  'Все сценарии используют один TS-движок с браузером. Старт: 4 человека, 2 массива по 40 м², теплица 20 м², аккумулятор 100 кВт·ч (80 в запасе), регенератор, вездеход, мастерская и жилой модуль. Уже растущая культура имеет 60 продуктивных дней; строительство новой теплицы не даёт такого аванса. В запасе 80 кг свежих продуктов, 800 л воды, 4 кг смеси, 8 кг запчастей; строительный бюджет 1 400 CR.',
  '',
  'Политика управляемых сценариев: снабжение при воде <120 л, смеси <0,2 кг или запчастях <2 кг, пока хватает бюджета; ремонт при состоянии любого модуля <85%; отгрузка только после первого урожая, с сохранением 14-дневного запаса и общим пределом заказа 60 кг. Цены и мгновенная доставка — допущения. В сценарии без продажи страхового запаса отгрузок нет. Без регенератора стартовый актив удаляется без возврата бюджета.',
  '',
  '| Сценарий | Первый сбор, день | Собрано, кг | Нехватка свежих продуктов, кг | Вода, л | Недоотпуск энергии, кВт·ч | Дней нехватки воды | Остаток CR |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
]
for (const experiment of experiments) {
  const { state: s, firstHarvest, unmetEnergy, waterConstrainedDays } = run(experiment)
  lines.push(`| ${experiment.name} | ${firstHarvest ?? 'нет'} | ${s.harvestedKg.toFixed(1)} | ${s.foodShortfallKg.toFixed(1)} | ${s.waterLitres.toFixed(1)} | ${unmetEnergy.toFixed(1)} | ${waterConstrainedDays} | ${s.credits.toFixed(0)} |`)
}
lines.push('',
  '## Как читать результат', '',
  '- «Нехватка продуктов» — накопленная невыполненная норма свежей добавки 0,5 кг/чел/сутки, не голодание и не показатель смертности.',
  '- Нельзя покрыть долгую лунную ночь суточной средней генерацией: сценарий с темнотой обнуляет солнечную выработку. Почасовое хранение, пусковые нагрузки и реальный рельеф всё ещё не учтены.',
  '- Регулярный ремонт и вода имеют бюджетную цену; теплицы нельзя просто бесконечно добавлять к неизменному водообороту.',
  '- У заказа максимум 240 CR внешнего финансирования на весь эксперимент; остаток бюджета сверяется с начальными средствами, поступлениями и расходами. Нет цены SOL/POTATO, обещаний доходности или модели спроса от новых игроков.',
  '- Даже хороший результат управляемого сценария доказывает только внутреннюю согласованность этих допущений. Он не подтверждает экономическую или инженерную осуществимость реальной базы.',
  '', 'Источники, формулы, ограничения и привязка к существующему коду: [план фермы](../../docs/LUNAR_FARM_PLAN.md).', '',
)
const report = lines.join('\n')
const args = process.argv.slice(2)
if (args.length === 0) console.log(report)
else if (args.length === 2 && args[0] === '--report') { writeFileSync(args[1], report); console.log(`Wrote ${args[1]}`) }
else { console.error('Usage: yarn simulate:colony [--report path.md]'); process.exitCode = 1 }
