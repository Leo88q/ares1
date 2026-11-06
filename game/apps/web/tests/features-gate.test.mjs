// Скрытие разделов по фича-флагам бэкенда: колонии исчезают из навигации и
// маршрута, когда сервер отдаёт colonies:false. Флаг только управляет
// видимостью — серверные гейты остаются в силе.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8')
const hook = read('hooks/useFeatures.ts')
const app = read('App.tsx')
const nav = read('components/ares/AresBottomNav.tsx')

test('фича-флаги читаются с /api/features и не роняют приложение без бэкенда', () => {
  assert.match(hook, /\/api\/features/)
  assert.match(hook, /colonies: true/)
  assert.match(hook, /ENV\?\.VITE_BACKEND_URL/)
  assert.match(hook, /AbortController/)
  // Сетевой сбой не должен оставлять пустой интерфейс.
  assert.match(hook, /catch\(\(\) => \{ \/\* оставляем значения по умолчанию \*\/ \}\)/)
})

test('фиче-флаг не прячет рабочий раздел колонии из маршрута и навигации', () => {
  // Было: colonies:false убирало клавишу КОЛОНИЯ и уводило /base на главный
  // экран. Это выключало половину игры из-за закрытых on-chain операций:
  // строительство базы — локальная экспедиция, она не требует серверного
  // разрешения. Гейты остаются на сервере, раздел — в пульте.
  // /base монтирует обёртку с оплатой POTATO; она сама рендерит ColonyScreen embedded.
  assert.match(app, /<Route path="\/base" element=\{<ColonyBaseRoute \/>} \/>/)
  assert.match(readFileSync(new URL('../src/colony/ColonyBaseRoute.tsx', import.meta.url), 'utf8'), /<ColonyScreen embedded /)
  assert.match(app, /<Route path="\/colony" element=\{<Navigate to="\/base" replace \/>} \/>/)
  assert.match(app, /const hiddenTabs: readonly AresTab\[\] = \[\]/)
  assert.match(app, /hidden=\{hiddenTabs\}/)
  // Старая страница статуса колонии (/base/status) удалена: адрес не должен рендерить её.
  assert.doesNotMatch(app, /ColonyStatusScreen|\/base\/status/)
  // Флаг продолжает приходить с бэкенда (и используется сервером), но не
  // решает, существует ли раздел.
  assert.match(hook, /\/api\/features/)
  assert.match(nav, /hidden\?: readonly AresTab\[\]/)
  assert.match(nav, /hidden\.includes\(item\.id\)/)
})

test('флаг не подменяет серверные гейты', () => {
  // Никаких решений о покупках/грантах из UI-флага быть не должно.
  assert.doesNotMatch(app, /presalePayments\s*\?/) 
  assert.doesNotMatch(app, /rewardsRail\s*\?/)
})
