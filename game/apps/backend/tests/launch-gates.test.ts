import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROVAL_TOKEN,
  LAUNCH_GATES,
  LAUNCH_GATE_DEFINITIONS,
  REWARDS_RAIL_ENABLED,
  USER_PRESALE_PAYMENTS_ENABLED,
  USER_SKR_SLOT_PURCHASES_ENABLED,
  launchGateLogLines,
  resolveLaunchGate,
  resolveLaunchGates,
} from '../src/launchGates.js'
import { resolveSlotsConfig } from '../src/slots/config.js'
import { colonyPackageCatalogResponse } from '../src/colonies/catalog.js'
import { COLONY_RULESET_STATUS } from '../src/colonies/rules.js'

/**
 * Гейты запуска — не константы в коде (тогда запуск невозможен без правки
 * исходников), а пара «флаг + подпись» в окружении. Тесты фиксируют главное:
 * без переменных окружения всё закрыто, одного флага недостаточно, и открытие
 * всегда объяснено причиной.
 */
test('без переменных окружения все гейты запуска закрыты', () => {
  const gates = resolveLaunchGates({})
  for (const id of Object.keys(LAUNCH_GATE_DEFINITIONS) as (keyof typeof LAUNCH_GATES)[]) {
    assert.equal(gates[id].enabled, false, `${id} должен быть закрыт по умолчанию`)
    assert.match(gates[id].reason, /^closed: .+\(missing /)
  }
  // Модульные значения повторяют окружение процесса: в тестовом окружении
  // переменных нет, значит и здесь false.
  assert.equal(REWARDS_RAIL_ENABLED, false)
  assert.equal(USER_PRESALE_PAYMENTS_ENABLED, false)
  assert.equal(USER_SKR_SLOT_PURCHASES_ENABLED, false)
})

test('одного флага мало: без отдельной подписи гейт остаётся закрытым', () => {
  const flagOnly = resolveLaunchGate('rewardsRail', { REWARDS_RAIL_ENABLED: 'true' })
  assert.equal(flagOnly.enabled, false)
  assert.match(flagOnly.reason, /REWARDS_RAIL_APPROVED=YES/)

  const approvalOnly = resolveLaunchGate('rewardsRail', { REWARDS_RAIL_APPROVED: APPROVAL_TOKEN })
  assert.equal(approvalOnly.enabled, false)
  assert.match(approvalOnly.reason, /REWARDS_RAIL_ENABLED=true/)
})

test('гейт открывается только парой «флаг + YES» и называет себя в причине', () => {
  const open = resolveLaunchGate('rewardsRail', {
    REWARDS_RAIL_ENABLED: 'true',
    REWARDS_RAIL_APPROVED: 'YES',
  })
  assert.equal(open.enabled, true)
  assert.match(open.reason, /^open: REWARDS_RAIL_ENABLED=true and REWARDS_RAIL_APPROVED=YES$/)
})

test('похожие на true значения не открывают гейт', () => {
  for (const value of ['1', 'TRUE', 'True', 'yes', 'on', '']) {
    assert.equal(
      resolveLaunchGate('userPresalePayments', {
        USER_PRESALE_PAYMENTS_ENABLED: value,
        USER_PRESALE_PAYMENTS_APPROVED: value,
      }).enabled,
      false,
      `значение ${JSON.stringify(value)} не должно открывать денежный путь`,
    )
  }
})

test('лог старта перечисляет каждый гейт и безопасен (без секретов)', () => {
  const lines = launchGateLogLines(resolveLaunchGates({ REWARDS_RAIL_ENABLED: 'true', REWARDS_RAIL_APPROVED: 'YES' }))
  assert.equal(lines.length, Object.keys(LAUNCH_GATE_DEFINITIONS).length)
  assert.ok(lines.some(line => line.startsWith('[launch-gate] rewardsRail: OPEN')))
  assert.ok(lines.some(line => line.startsWith('[launch-gate] colonyV1Release: closed')))
  for (const line of lines) assert.doesNotMatch(line, /KEYPAIR|SECRET|https?:\/\//)
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
  for (const pack of response.packages) {
    assert.equal('purchasable' in pack, false, `SKU ${pack.id} не должен нести признак продажи`)
    assert.equal('saleOpen' in pack, false, `SKU ${pack.id} не должен нести флаг открытия продаж`)
    assert.match(pack.priceStatus, /^(owner-proposed|owner-approved)$/)
  }
  assert.equal(COLONY_RULESET_STATUS, 'internal-review')
})

test('платные SKR-слоты закрыты даже при полной конфигурации окружения', () => {
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

test('в колониях нет маршрута покупки: живые маршруты только аутентификация, закрытые пути отвечают 410', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const source = readFileSync(fileURLToPath(new URL('../src/colonies/routes.ts', import.meta.url)), 'utf8')
  const live = [...source.matchAll(/router\.(get|post)\('([^']+)'/g)].map(match => match[2])
  assert.deepEqual(live.sort(), ['/auth/challenge', '/auth/session', '/auth/verify'], 'новый живой маршрут колоний требует отдельного решения о продаже и выдачи')
  const retiredMatch = /const RETIRED_COLONY_PATHS = \[([^\]]*)\]/.exec(source)
  assert.ok(retiredMatch, 'список закрытых путей колонии должен быть явным')
  const retired = [...retiredMatch[1]!.matchAll(/'([^']+)'/g)].map(match => match[1]).sort()
  assert.deepEqual(retired, ['/actions', '/field/verify', '/fields/link', '/fields/unlink', '/initialize', '/rules', '/state'])
  assert.equal([...source.matchAll(/router\.all\(/g)].length, 1, 'кроме закрытых путей других router.all быть не должно')
})
