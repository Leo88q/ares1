import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

/**
 * Ссылки на программу в off-chain коде не должны дрейфовать.
 *
 * Зачем отдельный тест. В `apps/backend/src` и `apps/web/src` десятки
 * комментариев вида «зеркало `MAX_REWARD_MICRO` из lib.rs»: по ним разработчик
 * сверяет клиентскую копию константы с программой. Пока ссылки писались как
 * `lib.rs:158`, каждая правка lib.rs (а их в этой ветке десятки) сдвигала
 * строки, и комментарии начинали указывать на посторонний код: проверено
 * вживую — `lib.rs:158` вёл на пустую строку, `lib.rs:76` — на абзац про
 * эмиссию, а не на окно клейма, `lib.rs:3265` — на `system_program`.
 * Комментарий, который врёт, хуже отсутствующего: он создаёт ложную опору при
 * сверке констант.
 *
 * Правила:
 *   1. никаких `lib.rs:<число>` — номера строк дрейфуют, ссылаться нужно на имя;
 *   2. каждый идентификатор в бэктиках рядом с упоминанием lib.rs обязан
 *      существовать в программе (имя функции, константы или аккаунта).
 */

const BACKEND = 'apps/backend/src'
const WEB = 'apps/web/src'
const RUST = 'programs/solana_potato/src/lib.rs'

const rust = readFileSync(RUST, 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      walk(path, out)
      continue
    }
    if (['.ts', '.tsx', '.mts', '.cts'].includes(extname(entry))) out.push(path)
  }
  return out
}

const files = [...walk(BACKEND), ...walk(WEB)]

/** Строки, где упоминается lib.rs, вместе с координатой для сообщения. */
function libMentions(): Array<{ file: string; line: number; text: string }> {
  const mentions: Array<{ file: string; line: number; text: string }> = []
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, index) => {
        if (text.includes('lib.rs')) mentions.push({ file, line: index + 1, text })
      })
  }
  return mentions
}

test('ссылки на lib.rs не используют номера строк (они дрейфуют вместе с программой)', () => {
  const offenders = libMentions()
    .filter(m => /lib\.rs:\d/.test(m.text))
    .map(m => `${m.file}:${m.line}`)
  assert.deepEqual(
    offenders,
    [],
    `Указывайте имя константы/функции вместо номера строки lib.rs:\n${offenders.join('\n')}`,
  )
})

test('каждое имя, названное рядом с lib.rs, существует в программе', () => {
  const missing: string[] = []
  for (const { file, line, text } of libMentions()) {
    for (const match of text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)) {
      const name = match[1]!
      // `lib.rs` в бэктиках и имена с точкой (`scaled_cost(base, ...)` ловятся
      // отдельно шаблоном ниже) — не идентификаторы программы.
      if (name === 'lib' || name === 'rs') continue
      const present = new RegExp(`\\b${name}\\b`).test(rust)
      if (!present) missing.push(`${file}:${line} → ${name}`)
    }
    // `scaled_cost(base, type)` — имя функции с аргументами в бэктиках.
    for (const match of text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)\(/g)) {
      const name = match[1]!
      const present = new RegExp(`\\bfn ${name}\\b`).test(rust)
      if (!present) missing.push(`${file}:${line} → ${name}()`)
    }
  }
  assert.deepEqual(missing, [], `В lib.rs нет названных сущностей:\n${missing.join('\n')}`)
})

test('размеры аккаунтов в docs/API.md совпадают с пинами lib.rs', () => {
  // Таблица размеров — вход для клиентских декодеров. Числа в ней обязаны
  // приходить из того же места, что и хостовый пин lib.rs, иначе документ
  // устаревает молча (так `Referral`/`ExportLicense` годами стояли с «—»).
  const doc = readFileSync('docs/API.md', 'utf8')
  const sizeOf = (name: string): string | null => {
    const match = new RegExp(`^\\| ${name} \\|[^|]*\\| (\\d+)`, 'm').exec(doc)
    return match ? match[1]! : null
  }
  const expected: Record<string, number> = {
    GameConfig: 260,
    Epoch: 49,
    Field: 78,
    SellerProfile: 49,
    PresaleState: 57,
    Achievements: 17,
    AdminState: 145,
    ExportLicense: 49,
    Referral: 73,
    RewardClaim: 65,
  }
  for (const [name, size] of Object.entries(expected)) {
    assert.equal(sizeOf(name), String(size), `${name}: docs/API.md должен содержать размер ${size}`)
  }
})

test('квота ручных грантов описана как 25 %, а не 10 %', () => {
  // P3-5: два комментария обещали 10 % при GRANT_QUOTA_SHARE_BPS = 2_500.
  const quota = /pub const GRANT_QUOTA_SHARE_BPS: u64 = (\d[\d_]*);/.exec(rust)
  assert.ok(quota, 'GRANT_QUOTA_SHARE_BPS не найдена в lib.rs')
  assert.equal(quota[1]!.replaceAll('_', ''), '2500')

  const stale: string[] = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    for (const pattern of [/10\s*%\s*(?:quota|капа|капы)/i, /квота\s*10\s*%/i]) {
      const m = pattern.exec(src)
      if (m) stale.push(`${file}: «${m[0]}»`)
    }
  }
  assert.deepEqual(stale, [], `Квота грантов — 25 % (GRANT_QUOTA_SHARE_BPS = 2_500):\n${stale.join('\n')}`)
})
