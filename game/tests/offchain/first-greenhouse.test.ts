import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGreenhouseMissionProgress,
  FIRST_GREENHOUSE_RATION_TARGET_MICRO,
  greenhouseChapterIndex,
  greenhouseCycleEpoch,
  greenhouseCycleNumber,
} from '../../apps/web/src/utils/firstGreenhouse'

const NOW = 1_800_000_000

const field = (overrides: Partial<{
  isActive: boolean
  level: number
  durability: number
  mutationType: number
  fertilizerUntil: number
}> = {}) => ({
  isActive: true,
  level: 1,
  durability: 100,
  mutationType: 0,
  fertilizerUntil: 0,
  ...overrides,
})

test('First Greenhouse journal derives only current wallet/account state', () => {
  const progress = buildGreenhouseMissionProgress({
    fields: [
      field({ level: 5, mutationType: 1, fertilizerUntil: NOW + 100 }),
      field({ isActive: false, level: 50, mutationType: 2, fertilizerUntil: NOW + 100 }),
      field(),
    ],
    potatoBalanceMicro: FIRST_GREENHOUSE_RATION_TARGET_MICRO,
    nowSec: NOW,
  })

  assert.equal(progress.length, 6)
  assert.equal(progress.find((item) => item.id === 'first-field')?.complete, true)
  assert.equal(progress.find((item) => item.id === 'three-fields')?.progress, 2)
  assert.equal(progress.find((item) => item.id === 'upgrade-level-five')?.complete, true)
  assert.equal(progress.find((item) => item.id === 'mutation')?.complete, true)
  assert.equal(progress.find((item) => item.id === 'ration-reserve')?.progress, FIRST_GREENHOUSE_RATION_TARGET_MICRO)
  assert.equal(progress.find((item) => item.id === 'active-fertilizer')?.complete, true)
})

test('expired fertilizer and inactive fields do not count toward the live snapshot', () => {
  const progress = buildGreenhouseMissionProgress({
    fields: [
      field({ isActive: false, level: 50, mutationType: 2, fertilizerUntil: NOW + 1 }),
      field({ fertilizerUntil: NOW }),
    ],
    potatoBalanceMicro: -1,
    nowSec: NOW,
  })

  assert.equal(progress.find((item) => item.id === 'first-field')?.progress, 1)
  assert.equal(progress.find((item) => item.id === 'three-fields')?.progress, 1)
  assert.equal(progress.find((item) => item.id === 'upgrade-level-five')?.complete, false)
  assert.equal(progress.find((item) => item.id === 'mutation')?.complete, false)
  assert.equal(progress.find((item) => item.id === 'ration-reserve')?.progress, 0)
  assert.equal(progress.find((item) => item.id === 'active-fertilizer')?.complete, false)
})

test('lunar cycle position is derived from 28 on-chain epochs', () => {
  assert.equal(greenhouseCycleEpoch(0n), 1)
  assert.equal(greenhouseCycleEpoch(27n), 28)
  assert.equal(greenhouseCycleEpoch(28n), 1)
  assert.equal(greenhouseCycleNumber(27n), 1)
  assert.equal(greenhouseCycleNumber(28n), 2)
  assert.equal(greenhouseChapterIndex(1), 0)
  assert.equal(greenhouseChapterIndex(7), 0)
  assert.equal(greenhouseChapterIndex(8), 1)
  assert.equal(greenhouseChapterIndex(28), 3)
  assert.equal(greenhouseChapterIndex(0), null)
  assert.equal(greenhouseCycleEpoch(null), null)
})
