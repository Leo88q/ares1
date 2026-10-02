import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

test('Solana web3 browser RPC client is compatible with patched Jayson 5', async () => {
  const packageJson = require('jayson/package.json')
  assert.equal(packageJson.version, '5.0.0')
  assert.equal(packageJson.dependencies['stream-json'], undefined)
  assert.equal(packageJson.dependencies.uuid, undefined)

  const BrowserClient = require('jayson/lib/client/browser')
  let request
  const client = new BrowserClient((body, callback) => {
    request = JSON.parse(body)
    callback(null, JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { 'solana-core': 'test' } }))
  })

  const response = await new Promise((resolve, reject) => {
    client.request('getVersion', [], (error, value) => (error ? reject(error) : resolve(value)))
  })

  assert.equal(request.method, 'getVersion')
  assert.match(request.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
  assert.deepEqual(response.result, { 'solana-core': 'test' })
})
