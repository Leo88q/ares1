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

test('колонии скрываются из маршрута и навигации при colonies:false', () => {
  assert.match(app, /const features = useFeatures\(\)/)
  assert.match(app, /features\.colonies \? <ColonyStatusScreen \/> : <Navigate to="\/" replace \/>/)
  assert.match(app, /features\.colonies \? '\/base' : '\/'/)
  assert.match(app, /hidden=\{hiddenTabs\}/)
  assert.match(nav, /hidden\?: readonly AresTab\[\]/)
  assert.match(nav, /hidden\.includes\(item\.id\)/)
})

test('флаг не подменяет серверные гейты', () => {
  // Никаких решений о покупках/грантах из UI-флага быть не должно.
  assert.doesNotMatch(app, /presalePayments\s*\?/) 
  assert.doesNotMatch(app, /rewardsRail\s*\?/)
})
