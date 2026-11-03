import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const main = readFileSync(fileURLToPath(new URL('../src/components/MainScreen.tsx', import.meta.url)), 'utf8')
const presale = readFileSync(fileURLToPath(new URL('../src/components/PresaleSection.tsx', import.meta.url)), 'utf8')
const rust = readFileSync(fileURLToPath(new URL('../../../programs/solana_potato/src/lib.rs', import.meta.url)), 'utf8')

test('displayed Field rent size stays in parity with the Rust account layout', () => {
  const body = rust.match(/pub struct Field\s*\{([\s\S]*?)\n\}/)?.[1]
  assert.ok(body, 'Rust Field account definition must exist')
  // u64 — field_id (P1-3, layout v3).
  const sizes = { Pubkey: 32, u8: 1, i64: 8, bool: 1, u64: 8 }
  const fields = [...body.matchAll(/pub \w+: (\w+)/g)]
  assert.ok(fields.length > 0)
  const bytes = 8 + fields.reduce((sum, [, type]) => sum + (sizes[type] ?? Number.NaN), 0)
  assert.equal(bytes, 78)
  assert.match(rust, /space\s*=\s*8\s*\+\s*Field::INIT_SPACE/)
})

test('first-field onboarding is transparent about the operator-issued starter and stays on real routes', () => {
  assert.match(main, /function FreeStartNotice\(\)/)
  assert.match(main, /import StoreSection from '.\/StoreSection'/)
  assert.match(main, /fieldPriceMicro\(0\)/)
  // P1-3: rent-оценка обязана идти по текущему layout, иначе она занижена.
  assert.match(main, /FIELD_ACCOUNT_DATA_BYTES = 78/)
  assert.match(main, /getMinimumBalanceForRentExemption\(FIELD_ACCOUNT_DATA_BYTES/)
  assert.match(main, /Текущий rent для Field account/)
  assert.match(main, /Стартовый набор 250 POTATO выдаётся бесплатно один раз на кошелёк кнопкой в магазине выше/)
  assert.doesNotMatch(main, /requestAirdrop|sendTransaction|signTransaction/)
  assert.match(main, /не отправляй деньги и не используй mainnet ради теста/)
  assert.match(main, /to="\/lab"/)
  assert.match(main, /to="\/base"/)
  assert.match(main, /connected && !IS_MAINNET/)
  assert.match(main, /Стартовый набор 250 POTATO выдаёт подписант оператора devnet-беты по адресу кошелька/)
  assert.match(presale, /ПОКУПКА ЗА SKR ОТКЛЮЧЕНА/)
  assert.doesNotMatch(main, /тренировочный режим|пауза игры|pauseGame/i)
})
