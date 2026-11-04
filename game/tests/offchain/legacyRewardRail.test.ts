import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

/**
 * P1-1: устаревшая рельса `grant_reward` удалена и не должна вернуться.
 *
 * Что было не так с инструкцией. `grant_reward` авторизуется только подписью
 * (`reward_signer` или `authority`) и не имеет ни nonce-маркера, ни дедлайна:
 * две подписи на одну и ту же логическую выплату (новый blockhash — новая
 * подпись) минтили дважды. Это класс ошибки «reward replay», ради которого
 * появился `grant_reward_once` с маркером `reward_claim` и `expires_at`.
 *
 * Почему удаление, а не `@deprecated`. Пока в бэкенде лежал готовый сборщик
 * `buildGrantRewardIx`, а в скриптах можно было повторить шаблон
 * `disc("grant_reward")`, новая ветка кода подключалась к replayable-рельсе
 * одной строкой без предупреждения компилятора. Так и случилось: бутстрап
 * (`scripts/init-onchain.ts`) финансировал квест-пул именно `grant_reward`, и
 * повторный запуск после таймаута мог минтить пул ещё раз — держала это только
 * квота эпохи.
 *
 * Состояние после апгрейда 2026-11-03: инструкция и её accounts-структура
 * удалены из программы, IDL и всех клиентов; минтить награды можно только
 * через `grant_reward_once`. Тесты ниже превращают это в инвариант CI: рельса
 * не может вернуться ни в Rust, ни в IDL, ни в продакшн-код (backend, web,
 * `scripts`).
 */

const ROOTS = ['apps/backend/src', 'apps/web/src', 'scripts']
const SOLANA_TS = 'apps/backend/src/solana.ts'
const LIB_RS = 'programs/solana_potato/src/lib.rs'
const IDL = 'apps/web/src/idl.json'
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

test('P1-1: инструкция grant_reward удалена из программы', () => {
  const rust = readFileSync(LIB_RS, 'utf8')
  // Сигнатура инструкции и её accounts-структура не должны существовать: пока
  // они есть, replayable-рельса возвращается одной строкой в `#[program]`.
  assert.doesNotMatch(rust, /pub fn grant_reward\s*\(/, 'grant_reward must stay removed (P1-1)')
  assert.doesNotMatch(rust, /pub struct GrantReward<\{?/, 'GrantReward accounts struct must stay removed')
  // Единственный рельс наград — replay-proof.
  assert.match(rust, /pub fn grant_reward_once\s*\(/)
})

test('P1-1: IDL не содержит легаси-инструкцию (клиент не сможет её собрать)', () => {
  const idl = JSON.parse(readFileSync(IDL, 'utf8')) as { instructions: Array<{ name: string }> }
  const names = idl.instructions.map(ix => ix.name)
  assert.ok(!names.includes('grant_reward'), 'grant_reward must not be in the committed IDL')
  assert.ok(names.includes('grant_reward_once'), 'grant_reward_once must stay in the IDL')
})

test('сборщик buildGrantRewardIx удалён из бэкенда', () => {
  const offenders: string[] = []
  for (const file of files) {
    for (const { line, text } of lines(file)) {
      if (text.includes('buildGrantRewardIx')) offenders.push(`${file}:${line}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `buildGrantRewardIx удалён вместе с инструкцией; используйте buildGrantRewardOnceIx:\n${offenders.join('\n')}`,
  )
})

test('легаси-дискриминатор grant_reward не собирается вручную в продакшн-коде', () => {
  // Ловит и `disc("grant_reward")`, и `anchorDiscriminator('global', 'grant_reward')`:
  // именно так новая ветка обошла бы отсутствие готового сборщика.
  // Регулярка не должна совпадать с `grant_reward_once` (там другой дискриминатор).
  const legacyIx = /(?:disc|anchorDiscriminator)\s*\(\s*(?:["']global["']\s*,\s*)?["']grant_reward["']/
  const offenders: string[] = []
  for (const file of files) {
    for (const { line, text } of lines(file)) {
      if (!legacyIx.test(text)) continue
      offenders.push(`${file}:${line}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Инструкции grant_reward больше нет на цепи — собирайте grant_reward_once:\n${offenders.join('\n')}`,
  )
  // И положительный контроль: сборщик новой рельсы на месте и использует её
  // дискриминатор, иначе правило выше «проходит» на пустом файле.
  const source = readFileSync(SOLANA_TS, 'utf8')
  assert.match(source, /anchorDiscriminator\("global", "grant_reward_once"\)/)
  assert.match(source, /export function buildGrantRewardOnceIx/)
})
