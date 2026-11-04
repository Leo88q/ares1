import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * `init_if_needed` — смысловой гейт, а не инвентаризация.
 *
 * Раньше SW016 проверялся только по номерам строк (`scripts/
 * audit-init-if-needed.mjs` + закоммиченный отчёт): такой гейт падает от
 * любого сдвига строк и ничего не говорит о безопасности контекста.
 * Опасность `init_if_needed` ровно одна — адрес аккаунта выбирает вызывающий,
 * и тогда «инициализация при необходимости» позволяет завести состояние там,
 * где его не ждут. Поэтому проверяется инвариант адресации:
 *
 *   1. каждый `init_if_needed` — это либо PDA (`seeds` + `bump` + `payer` +
 *      `space`), либо associated-token аккаунт (адрес выводится из минта и
 *      владельца, повторная инициализация невозможна по построению);
 *   2. вложенный токен-аккаунт не бывает «просто init_if_needed» без
 *      привязки к минту и владельцу.
 *
 * Число контекстов запинено: новый `init_if_needed` — осознанное решение, а не
 * побочный эффект правки.
 */

const RUST = 'programs/solana_potato/src/lib.rs'
/**
 * Комментарии заменяются пробелами той же длины: смещения сохраняются, а
 * `init_if_needed`, упомянутый в доке (`// см. init_if_needed`), больше не
 * считается кодом. Иначе тест ловит 27 «вхождений» вместо 20 реальных.
 */
function withoutComments(source: string): string {
  return source
    .split('\n')
    .map(line => {
      const quotes = (line.match(/"/g) ?? []).length
      const marker = quotes % 2 === 0 ? line.indexOf('//') : -1
      return marker < 0 ? line : line.slice(0, marker) + ' '.repeat(line.length - marker)
    })
    .join('\n')
}

const rust = withoutComments(readFileSync(RUST, 'utf8'))

interface InitIfNeeded {
  struct: string
  account: string
  attribute: string
}

/** Находит парную `)` для `(` в позиции `open`. */
function matchParen(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Ближайший `pub struct NAME` выше позиции. */
function enclosingStruct(src: string, at: number): string {
  const before = src.slice(0, at)
  const match = /pub struct (\w+)/g
  let last = ''
  for (const m of before.matchAll(match)) last = m[1]!
  return last
}

function collect(): InitIfNeeded[] {
  const found: InitIfNeeded[] = []
  for (const match of rust.matchAll(/init_if_needed/g)) {
    const at = match.index!
    const open = rust.lastIndexOf('#[account(', at)
    assert.ok(open >= 0, `init_if_needed без #[account(...)] на позиции ${at}`)
    const close = matchParen(rust, open + '#[account'.length)
    assert.ok(close > at, 'незакрытый атрибут #[account(...)]')
    const attribute = rust.slice(open, close + 1)
    const rest = rust.slice(close + 1, close + 400)
    const account = /pub (\w+):/.exec(rest)?.[1]
    assert.ok(account, `не найдено имя аккаунта рядом с init_if_needed (${at})`)
    found.push({ struct: enclosingStruct(rust, open), account: account!, attribute })
  }
  return found
}

const entries = collect()

test('init_if_needed всегда адресуется PDA или associated-token', () => {
  const violations: string[] = []
  for (const entry of entries) {
    const isPda = /\bseeds\s*=/.test(entry.attribute)
    const isAta = /associated_token::/.test(entry.attribute)
    if (!isPda && !isAta) {
      violations.push(`${entry.struct}.${entry.account}: ни seeds, ни associated_token::`)
    }
    if (isPda) {
      for (const required of ['bump', 'payer', 'space']) {
        if (!new RegExp(`\\b${required}\\b`).test(entry.attribute)) {
          violations.push(`${entry.struct}.${entry.account}: PDA без ${required}`)
        }
      }
    }
    if (isAta) {
      for (const required of ['associated_token::mint', 'associated_token::authority']) {
        if (!entry.attribute.includes(required)) {
          violations.push(`${entry.struct}.${entry.account}: ATA без ${required}`)
        }
      }
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'))
})

test('вложенный токен-аккаунт не инициализируется без привязки к владельцу', () => {
  // `init_if_needed` на TokenAccount без associated-token ограничений позволил
  // бы создать аккаунт с произвольным адресом и владельцем — и «казна» в
  // контексте оказалась бы чужой.
  const violations = entries
    .filter(e => /Account<'info, TokenAccount>/.test(rust.slice(rust.indexOf(`pub ${e.account}:`), rust.indexOf(`pub ${e.account}:`) + 80)))
    .filter(e => !/associated_token::/.test(e.attribute))
    .map(e => `${e.struct}.${e.account}`)
  assert.deepEqual(violations, [], `TokenAccount через init_if_needed без associated_token: ${violations.join(', ')}`)
})

test('число контекстов init_if_needed запинено', () => {
  // Пиним осознанно: каждая новая инициализация — повод перечитать этот тест.
  // Значение обновляется вместе с аудитом (см. reports/code-audit-2026-11-02.md).
  // 25 аккаунтов в 19 контекстах (2026-11-03). Счётчик в SW016-инвентаре
  // больше (включает упоминания в комментариях) — это ожидаемо, поэтому
  // источником правды для «сколько реально» служит этот тест.
  assert.equal(entries.length, 25, `найдено ${entries.length}: ${entries.map(e => `${e.struct}.${e.account}`).join(', ')}`)
  const contexts = [...new Set(entries.map(e => e.struct))].sort()
  assert.deepEqual(contexts, [
    'BatchHarvest',
    'BuyExportLicense',
    'BuyFieldSkr',
    'BuyFieldSol',
    'CancelOrder',
    'CancelOrderV2',
    'CancelWithdrawal',
    'ClaimAchievement',
    'CreateSellOrder',
    'CreateSellOrderV2',
    'FillOrder',
    'FillOrderV2Skr',
    'Harvest',
    'ProposeWithdrawal',
    'UpdatePresalePrice',
    'UpdateSkrMint',
    'WithdrawSkrTreasury',
    'WithdrawTreasury',
    'WithdrawTreasurySol',
  ])
})
