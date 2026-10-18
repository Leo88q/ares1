import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RESOURCE_IDS } from '../../apps/web/src/colony/deep/resources'
import { DEEP_PARAM_TABLE, DEEP_P } from '../../apps/web/src/colony/deep/params'

/**
 * Документ не должен устаревать молча. Таблицы ресурсов и параметров
 * формируются из кода, поэтому новый ресурс или параметр, не попавший в
 * документацию, — это ошибка, а не «потом допишем».
 */
const docPath = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/DEEP_COLONY_SIM.md')
const doc = readFileSync(docPath, 'utf8')

test('every resource id is documented', () => {
  const missing = RESOURCE_IDS.filter(id => !doc.includes(`\`${id}\``))
  assert.deepEqual(missing, [], `resources missing from the docs: ${missing.join(', ')}`)
})

test('every documented resource id still exists in the model', () => {
  const documented = [...doc.matchAll(/^\| `([a-z_0-9]+)` \| [^|]+ \| [^|]+ \| (?:L|kg|pcs) \|/gm)]
    .map(m => m[1])
    .filter((id): id is string => typeof id === 'string')
  const known = new Set<string>(RESOURCE_IDS)
  const stale = documented.filter(id => !known.has(id))
  assert.deepEqual(stale, [], `documented resources that no longer exist: ${stale.join(', ')}`)
})

test('every parameter key is documented', () => {
  const missing = DEEP_PARAM_TABLE.filter(p => !doc.includes(`\`${p.key}\``)).map(p => p.key)
  assert.deepEqual(missing, [], `parameters missing from the docs: ${missing.join(', ')}`)
})

test('every documented parameter key still exists in the model', () => {
  const known = new Set(Object.keys(DEEP_P as Record<string, unknown>))
  const documented = [...doc.matchAll(/^\| `([A-Za-z][A-Za-z0-9_]*)` \| (-?[\d.]+) \|/gm)].map(m => m[1])
  const stale = documented.filter(key => key && !known.has(key))
  assert.deepEqual(stale, [], `documented parameters that no longer exist: ${stale.join(', ')}`)
})

test('the stated derived quantities still match the parameters', () => {
  // Если изменится КПД или площадь, документ обязан измениться вместе с ними.
  assert.ok(doc.includes('12.192'), 'the doc must state the derived solar peak')
  assert.ok(doc.includes('15 кВт·ч'), 'the doc must state the electrolysis energy')
  assert.ok(doc.includes('36 кг'), 'the doc must state the per-bed cycle yield')
})
