// Витрина магазина: каталог берётся с бэкенда, оплата не имитируется.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8')
const store = read('components/StoreSection.tsx')
const main = read('components/MainScreen.tsx')

test('магазин отдаёт каталог с бэкенда, а не хардкодит цены', () => {
  assert.match(store, /data-testid="store-section"/)
  assert.match(store, /fetch\(`\$\{BACKEND\}\/api\/store`/)
  assert.match(store, /VITE_BACKEND_URL/)
  assert.match(store, /data-testid="store-state"/)
  assert.match(store, /data-testid={`store-pack-\$\{pack\.id\}`}/)
  // Цена приходит строкой POTATO и не пересчитывается в UI.
  assert.match(store, /\{pack\.potato\} POTATO/)
  assert.doesNotMatch(store, /\b1_000_000\b|\b1000 POTATO/)
})

test('бесплатный вход идёт через рельсу наград, без транзакций из браузера', () => {
  assert.match(store, /\/api\/rewards\/\$\{kind\}/)
  assert.match(store, /claim\('starter'\)/)
  assert.match(store, /claim\('daily'\)/)
  assert.match(store, /201/)
  assert.match(store, /409/)
  assert.match(store, /503/)
  assert.doesNotMatch(store, /sendTransaction|signTransaction|ixBuyFieldSkr|useWallet|useAnchorWallet/)
  // Пока продажи закрыты, платёжных кнопок быть не должно вообще.
  assert.match(store, /Покупка паков за POTATO ещё не включена/)
  assert.doesNotMatch(store, /<button[^>]*>\s*Купить/i)
})

test('MainScreen показывает магазин вместо закрытого пресейла, не теряя уведомление о SKR', () => {
  assert.match(main, /import StoreSection from '\.\/StoreSection'/)
  assert.match(main, /<StoreSection \/>/)
  assert.doesNotMatch(main, /<PresaleSection \/>/)
  assert.match(store, /import PresaleSection from '\.\/PresaleSection'/)
  assert.match(store, /<PresaleSection \/>/)
})
