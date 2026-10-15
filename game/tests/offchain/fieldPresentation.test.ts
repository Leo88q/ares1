import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fieldVisual, FIELD_PROFILES, FIELDS_PER_PAGE, selectedFieldId, visibleFields } from '../../apps/web/src/fields/model'
import type { FieldSnapshot, FieldVisual } from '../../apps/web/src/fields/model'

const source = (changes: Partial<FieldSnapshot> = {}): FieldSnapshot => ({
  publicKey: { toString: () => 'account-a' }, fieldType: 1, level: 8, durability: 82,
  isActive: true, accumulated: 100_000, fertilizerUntil: 2_000, taxPaidUntil: 2_000, mutationType: 0, ...changes,
})
const visual = (id: string): FieldVisual => ({ ...fieldVisual(source(), 1_000), id })

test('field view preserves account identity, amount, rarity, rank and does not mutate state', () => {
  const field = Object.freeze(source())
  const before = { ...field }, view = fieldVisual(field, 1_000)
  assert.equal(view.id, field.publicKey.toString())
  assert.equal(view.pendingMicro, field.accumulated)
  assert.equal(view.tier, field.fieldType)
  assert.equal(view.level, field.level)
  assert.deepEqual(field, before)
  assert.equal(view.condition, 0.82)
})
test('field readiness is the existing exact micro-POTATO threshold', () => {
  assert.equal(fieldVisual(source({ accumulated: 99_999 }), 0).ready, false)
  assert.equal(fieldVisual(source({ accumulated: 100_000 }), 0).ready, true)
  assert.equal(fieldVisual(source({ accumulated: 100_001 }), 0).ready, true)
})
test('fertilizer and tax expiry match existing card boundary comparisons', () => {
  const field = source({ fertilizerUntil: 1_000, taxPaidUntil: 1_000 })
  assert.equal(fieldVisual(field, 999).fertilized, true)
  assert.equal(fieldVisual(field, 1_000).fertilized, false)
  assert.equal(fieldVisual(field, 1_000).taxExpired, false)
  assert.equal(fieldVisual(field, 1_001).taxExpired, true)
})
test('inactive fields have no visual growth and no amount/yield is created', () => {
  const result = fieldVisual(source({ isActive: false, accumulated: 0 }), 1_000)
  assert.equal(result.growth, 0)
  assert.equal(result.pendingMicro, 0)
  assert.equal(result.ready, false)
})
test('presentation clamps malformed graphic inputs, not the source account', () => {
  const field = source({ fieldType: 19, level: 100, durability: -5, mutationType: 5, accumulated: NaN })
  const result = fieldVisual(field, 0)
  assert.equal(result.tier, 2); assert.equal(result.level, 50); assert.equal(result.condition, 0); assert.equal(result.mutation, 2)
  assert.equal(result.pendingMicro, 0)
  assert.equal(field.fieldType, 19); assert.equal(field.level, 100)
  assert.equal(fieldVisual(source({ fieldType: NaN, durability: Infinity, level: NaN }), 0).tier, 0)
})
test('rarity profiles are bounded graphic detail, never an economic multiplier', () => {
  assert.deepEqual(FIELD_PROFILES.map(profile => profile.name), ['COMMON', 'RARE', 'EPIC'])
  assert.deepEqual(FIELD_PROFILES.map(profile => profile.rows), [3, 4, 6])
  assert.ok(FIELD_PROFILES.every(profile => profile.rows <= 6 && profile.length <= 12))
  assert.equal(FIELD_PROFILES[2].solar, true)
  assert.ok(FIELD_PROFILES.every(profile => !('yieldBps' in profile)))
})
test('public-key selection survives reordered polling snapshots and deletion', () => {
  const a = visual('account-a'), b = visual('account-b')
  assert.equal(selectedFieldId([a, b], b.id), b.id)
  assert.equal(selectedFieldId([b, a], b.id), b.id)
  assert.equal(selectedFieldId([a], b.id), a.id)
  assert.equal(selectedFieldId([], b.id), null)
})
test('scene pagination covers all accounts, includes selection and bounds visible GPU farms', () => {
  const fields = Array.from({ length: 37 }, (_, index) => visual(`account-${index}`))
  for (const field of fields) {
    const page = visibleFields(fields, field.id)
    assert.ok(page.length <= FIELDS_PER_PAGE)
    assert.ok(page.some(item => item.id === field.id))
  }
  assert.deepEqual(visibleFields([], null), [])
  assert.equal(visibleFields(fields, null)[0].id, fields[0].id)
  assert.equal(fields.length, 37)
})
