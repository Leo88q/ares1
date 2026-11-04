import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COLONY_V1_RELEASE_READY, USER_PRESALE_PAYMENTS_ENABLED, USER_SKR_SLOT_PURCHASES_ENABLED } from '../src/launchGates.js'
import { resolveSlotsConfig } from '../src/slots/config.js'
import { colonyPackageCatalogResponse } from '../src/colonies/catalog.js'
import { COLONY_RULESET_STATUS } from '../src/colonies/rules.js'

test('user-facing presale and paid SKR-slot purchases stay closed regardless of environment flags', () => {
  assert.equal(USER_PRESALE_PAYMENTS_ENABLED, false)
  assert.equal(USER_SKR_SLOT_PURCHASES_ENABLED, false)
  assert.equal(COLONY_V1_RELEASE_READY, false)
  const slots = resolveSlotsConfig({
    SLOTS_ENABLED: 'true',
    SLOT_SIGNING_KEY_PEM: 'would-be-enabled',
    SLOT_KEY_ID: 'would-be-enabled',
    SKR_MINT: '11111111111111111111111111111111',
    SLOT_TREASURY_OWNER: '11111111111111111111111111111111',
    SLOT_PRICE_UNITS: '500000000',
  } as NodeJS.ProcessEnv, 'devnet')
  assert.deepEqual(slots, { enabled: false, reason: 'flag-off' })
})

/**
 * Колонии в запуске не продаются — это осознанное состояние продукта, а не
 * забытый флаг. Тест фиксирует его так, чтобы покупка не могла «появиться»
 * случайно: включение потребует правки и этого теста, то есть явного решения.
 */
test('каталог колоний не продаётся: ни SKU, ни ответ API не открывают покупку', () => {
  const response = colonyPackageCatalogResponse()
  assert.equal(response.saleOpen, false)
  assert.equal(response.purchasable, false)
  assert.equal(response.status, 'design-only')
  // Пакеты — спецификация (цена и состав), а не оферта: флага «можно купить»
  // у SKU нет вовсе, покупку закрывает только ответ в целом.
  for (const pack of response.packages) {
    assert.equal('purchasable' in pack, false, `SKU ${pack.id} не должен нести признак продажи`)
    assert.equal('saleOpen' in pack, false, `SKU ${pack.id} не должен нести флаг открытия продаж`)
    assert.match(pack.priceStatus, /^(owner-proposed|owner-approved)$/)
  }
  assert.equal(COLONY_RULESET_STATUS, 'internal-review')
})

test('в колониях нет маршрута покупки: только аутентификация, поля и действия', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const source = readFileSync(fileURLToPath(new URL('../src/colonies/routes.ts', import.meta.url)), 'utf8')
  const routes = [...source.matchAll(/router\.(get|post)\('([^']+)'/g)].map(match => match[2])
  assert.deepEqual(routes.sort(), [
    '/actions', '/auth/challenge', '/auth/session', '/auth/verify',
    '/field/verify', '/fields/link', '/fields/unlink', '/initialize', '/rules', '/state',
  ].sort(), 'новый маршрут колоний требует отдельного решения о продаже и выдачи')
})
