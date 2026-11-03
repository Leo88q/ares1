import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

/**
 * P1-1: устаревшая рельса `grant_reward` не должна вернуться в продакшн-код.
 *
 * Что не так с инструкцией. `grant_reward` авторизуется только подписью
 * (`reward_signer` или `authority`) и не имеет ни nonce-маркера, ни дедлайна:
 * две подписи на одну и ту же логическую выплату (новый blockhash — новая
 * подпись) минтят дважды. Это класс ошибки «reward replay», ради которого
 * появился `grant_reward_once` с маркером `reward_claim` и `expires_at`.
 *
 * Почему недостаточно комментария `@deprecated`. Пока в бэкенде лежит готовый
 * сборщик `buildGrantRewardIx`, а в скриптах можно повторить шаблон
 * `disc("grant_reward")`, новая ветка кода подключается к replayable-рельсе
 * одной строкой и без предупреждения компилятора. Так и случилось: бутстрап
 * (`scripts/init-onchain.ts`) финансировал квест-пул именно `grant_reward` —
 * то есть повторный запуск после таймаута мог минтить пул ещё раз, и держала
 * это только квота эпохи. Теперь бутстрап идёт через `grant_reward_once`
 * с фиксированным nonce, а правила ниже держит CI, а не договорённость.
 *
 * Границы: проверяется только продакшн-код (backend, web, `scripts`).
 * Anchor-сьют (`tests/solana_potato.ts`) законно вызывает старую инструкцию —
 * он её и проверяет до удаления из программы.
 */

const ROOTS = ['apps/backend/src', 'apps/web/src', 'scripts']
const SOLANA_TS = 'apps/backend/src/solana.ts'
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      walk(path, out)
      continue
    }
    if (EXTENSIONS.includes(extname(entry))) out.push(path)
  }
  return out
}

const files = ROOTS.flatMap(root => walk(root))

/** Строки файла с координатой (символ и номер) — для сообщений «где именно». */
function lines(file: string): Array<{ file: string; line: number; offset: number; text: string }> {
  const out: Array<{ file: string; line: number; offset: number; text: string }> = []
  let offset = 0
  for (const [index, text] of readFileSync(file, 'utf8').split('\n').entries()) {
    out.push({ file, line: index + 1, offset, text })
    offset += text.length + 1
  }
  return out
}

test('сборщик buildGrantRewardIx не вызывается нигде, кроме собственного объявления', () => {
  const offenders: string[] = []
  for (const file of files) {
    for (const { line, text } of lines(file)) {
      if (!text.includes('buildGrantRewardIx')) continue
      // Единственное разрешённое вхождение — само объявление в solana.ts.
      const isDefinition =
        file === SOLANA_TS && /export function buildGrantRewardIx\s*\(/.test(text)
      if (!isDefinition) offenders.push(`${file}:${line}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Вызов buildGrantRewardIx запрещён (replayable: без nonce и дедлайна). ` +
      `Используйте buildGrantRewardOnceIx:\n${offenders.join('\n')}`,
  )
  // Исключение выше не должно «протухнуть»: если объявление переименуют,
  // правило обязано упасть, а не разрешать всё подряд.
  const definitions = readFileSync(SOLANA_TS, 'utf8').match(/export function buildGrantRewardIx\s*\(/g) ?? []
  assert.equal(
    definitions.length,
    1,
    'объявление buildGrantRewardIx должно быть ровно одно — на него опирается правило исключения',
  )
})

test('легаси-дискриминатор grant_reward не собирается вручную', () => {
  // Ловит и `disc("grant_reward")`, и `anchorDiscriminator('global', 'grant_reward')`:
  // именно так бутстрап обходил бы отсутствие готового сборщика.
  const legacyIx = /(?:disc|anchorDiscriminator)\s*\(\s*(?:["']global["']\s*,\s*)?["']grant_reward["']/
  const source = readFileSync(SOLANA_TS, 'utf8')
  const deprecatedStart = source.indexOf('export function buildGrantRewardIx')
  const deprecatedEnd = source.indexOf('export function ', deprecatedStart + 1)
  const offenders: string[] = []
  for (const file of files) {
    for (const { line, offset, text } of lines(file)) {
      if (!legacyIx.test(text)) continue
      const insideDeprecatedBuilder =
        file === SOLANA_TS &&
        offset > deprecatedStart &&
        offset < (deprecatedEnd === -1 ? source.length : deprecatedEnd)
      if (!insideDeprecatedBuilder) offenders.push(`${file}:${line}`)
    }
  }
  assert.ok(deprecatedStart !== -1, 'buildGrantRewardIx должен оставаться в solana.ts до удаления инструкции из программы')
  assert.deepEqual(
    offenders,
    [],
    `Инструкция grant_reward replayable — собирайте grant_reward_once:\n${offenders.join('\n')}`,
  )
})

test('устаревший сборщик сохраняет предупреждение и указывает замену', () => {
  const source = readFileSync(SOLANA_TS, 'utf8')
  const start = source.indexOf('export function buildGrantRewardIx')
  assert.ok(start !== -1, 'buildGrantRewardIx отсутствует — обновите этот тест вместе с удалением инструкции')
  // Докблок — ближайшие ~2 000 символов перед объявлением.
  const doc = source.slice(Math.max(0, start - 2_000), start)
  assert.match(doc, /@deprecated/, 'предупреждение @deprecated удалено, а инструкция ещё в программе')
  assert.match(doc, /buildGrantRewardOnceIx/, 'в предупреждении должна быть названа замена')
  assert.match(doc, /replay/i, 'в предупреждении должна быть названа причина: replay')
})
