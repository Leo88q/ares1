import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('V2 marketplace is the default screen and V1 no longer creates orders', () => {
  const feature = readFileSync(join(root, 'src/utils/marketFeature.ts'), 'utf8')
  const env = readFileSync(join(root, '.env.example'), 'utf8')
  const screen = readFileSync(join(root, 'src/components/MarketScreen.tsx'), 'utf8')

  // P2-2: легаси-рынок закрыт на запись в программе, поэтому V2 — основной
  // экран. Флаг остался только как аварийный откат UI (`false`), а не как
  // opt-in: выключить V2 нельзя «по умолчанию».
  assert.match(feature, /VITE_MARKET_V2_ENABLED\s*!==\s*'false'/)
  assert.match(env, /^VITE_MARKET_V2_ENABLED=true$/m)
  assert.match(env, /emergency UI rollback/)
  assert.match(screen, /if\s*\(MARKET_V2_ENABLED\)\s*return\s*<MarketV2Rollout\s*\/>/)
  assert.match(screen, /version\s*===\s*'v2'\s*\?\s*<MarketScreenV2\s*\/>\s*:\s*<MarketScreenInner\s*\/>/)
  assert.match(screen, /setVersion\('legacy'\)/)
  // V1-панель остаётся только для доигрывания книги: форма создания ордера
  // удалена, вместо неё предупреждение (иначе UI обещал бы отклонённую ix).
  assert.equal(screen.includes('CreateOrderModal'), false, 'V1 не должен монтировать форму создания ордера')
  assert.match(screen, /V1 закрыт на запись/)
})

test('pre-deploy window: unknown-instruction errors explain that the program is not deployed yet', () => {
  // UI открывает V2 по умолчанию, а бинарь на кластере может быть старым (P2-2:
  // деплой — отдельный шаг). Единственный симптом — ошибка Anchor 100/101/102
  // «такой инструкции нет». Без явного текста игрок видит «код 101» и жмёт
  // повторно: единственное верное действие — дождаться деплоя.
  const errors = readFileSync(join(root, 'src/utils/errors.ts'), 'utf8')
  for (const code of ['100', '101', '102']) {
    const line = errors.split('\n').find(entry => entry.trim().startsWith(`${code}: '`))
    assert.ok(line, `нет текста для ошибки Anchor ${code}`)
    assert.match(line, /депло/, `текст ошибки ${code} обязан называть деплой как решение`)
  }
  // Новые коды программы тоже обязаны иметь игровой текст, иначе отказ P2-2
  // выглядит как «Ошибка программы (код 6058)».
  assert.match(errors, /LegacyMarketClosed: '/)
  assert.match(errors, /ReferralProgramRetired: '/)
})

test('unverified SKR mint blocks new SKR trades without hiding escrow recovery actions', () => {
  const screen = readFileSync(join(root, 'src/components/MarketScreenV2.tsx'), 'utf8')
  const modal = readFileSync(join(root, 'src/components/CreateOrderV2Modal.tsx'), 'utf8')

  assert.match(screen, /order\.status === 'active' && order\.quoteAsset === 'skr' && !skrMintReady && !order\.isOwn/)
  assert.match(screen, /order\.status === 'expired' \? onCloseExpired : order\.isOwn \? onCancel : onFill/)
  assert.match(modal, /quoteAsset === 'skr' && !skrMintReady/)
  assert.match(screen, /ордера видны, свои можно отменить, истёкший escrow можно вернуть/)
})
