// Детерминизм движка колонии. Один журнал действий должен давать один хеш состояния
// в браузере и на сервере. Золотой хеш — сигнал: если правила движка меняются, его нужно
// обновить осознанно и поднять ENGINE_VERSION (журнал на сервере записывает версию).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const sim = await import('../lib/esm/colony/simulation.js')
const layout = await import('../lib/esm/colony/layout.js')
const { initialColony, advanceDays, buildModuleAt, repairColony, buySupplies, deliverFood, canBuild } = sim
const { findPlacement } = layout

const hash = (s) => createHash('sha256').update(JSON.stringify(s)).digest('hex')

function scriptedRun() {
  let s = initialColony()
  s = advanceDays(s, 30)
  for (const kind of ['solar', 'greenhouse', 'habitat', 'recycler']) {
    if (!canBuild(s, kind)) continue
    const at = findPlacement(s.modules, kind, () => true)
    if (at) s = buildModuleAt(s, kind, at)
  }
  s = advanceDays(s, 45)
  s = repairColony(s)
  s = buySupplies(s)
  s = deliverFood(s)
  return advanceDays(s, 90)
}

// Версия правил движка. Менять вместе с золотым хешем.
const ENGINE_VERSION = 1
const GOLDEN_SHA256 = '8be061031036d7235425398b58578a4ccace2b4bb85f77d039e681979e05f516'

test('один журнал дважды даёт одинаковое состояние', () => {
  assert.equal(hash(scriptedRun()), hash(scriptedRun()))
})

test('золотой хеш: правила движка не менялись без обновления ENGINE_VERSION', () => {
  assert.equal(ENGINE_VERSION, 1)
  assert.equal(hash(scriptedRun()), GOLDEN_SHA256)
})

test('закоммиченный lib совпадает с пересборкой из src', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const out = mkdtempSync(join(tmpdir(), 'colony-engine-'))
  const root = new URL('..', import.meta.url).pathname
  const tsc = join(root, '../../../../node_modules/typescript/bin/tsc')
  execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json'), '--outDir', join(out, 'esm'), '--declarationDir', join(out, 'types')], { stdio: 'pipe' })
  const { readdirSync, statSync } = await import('node:fs')
  const walk = (d) => readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])
  for (const f of walk(join(out, 'esm'))) {
    const rel = f.slice(join(out, 'esm').length)
    assert.equal(readFileSync(f, 'utf8'), readFileSync(join(root, 'lib/esm', rel), 'utf8'), `lib устарел: ${rel}. Запустите: yarn build в vendor/colony-engine`)
  }
})
