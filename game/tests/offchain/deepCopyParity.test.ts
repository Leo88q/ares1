import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deepCopy } from '../../apps/web/src/colony/deepCopy'

/**
 * RU/EN паритет панелей глубокого слоя. Расхождение ключей здесь — это не
 * «непереведённая строка», а падение сборки интерфейса: панель берёт подпись
 * по ключу и покажет `undefined` половине игроков.
 */
const en = deepCopy('en') as Record<string, string>
const ru = deepCopy('ru') as Record<string, string>

test('both locales expose the same key set', () => {
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort())
})

test('no key is empty in either locale', () => {
  for (const [locale, dict] of [['en', en], ['ru', ru]] as const) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', `${locale}.${key} is not a string`)
      assert.ok(value.length > 0, `${locale}.${key} is empty`)
    }
  }
})

test('an unknown language falls back to English, never to undefined', () => {
  const fallback = deepCopy('de') as Record<string, string>
  assert.equal(fallback.systems, en.systems)
  assert.deepEqual(Object.keys(fallback).sort(), Object.keys(en).sort())
})
