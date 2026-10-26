import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COLONY_V1_RELEASE_READY, USER_PRESALE_PAYMENTS_ENABLED, USER_SKR_SLOT_PURCHASES_ENABLED } from '../src/launchGates.js'
import { resolveSlotsConfig } from '../src/slots/config.js'

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
