import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Бесплатный стартер колонии выключен по умолчанию на всех сетях (гейты default-closed).
// Модуль env читаем в дочернем процессе, чтобы не зависеть от окружения тестов.
function freeStarterFor(extraEnv: Record<string, string>): string {
  const code = "import('./src/env.ts').then(m => process.stdout.write(String(m.env.colonyFreeStarterEnabled)))"
  return execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    cwd: new URL('..', import.meta.url),
    env: {
      PATH: process.env.PATH ?? '',
      RPC_URL: 'http://127.0.0.1:8899',
      SOLANA_CLUSTER: 'devnet',
      PROGRAM_ID: '11111111111111111111111111111111',
      PAYER_KEYPAIR_JSON: '[1]',
      ...extraEnv,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

test('free colony starter is off by default on devnet', () => {
  assert.equal(freeStarterFor({}), 'false')
})

test('free colony starter stays off when explicitly set to false', () => {
  assert.equal(freeStarterFor({ COLONY_FREE_STARTER_ENABLED: 'false' }), 'false')
})

test('boot gate for free starter is scoped to enabled colonies', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(index, /env\.coloniesEnabled && env\.colonyFreeStarterEnabled && !COLONY_V1_RELEASE_READY/)
})
