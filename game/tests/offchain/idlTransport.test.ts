import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

test('public IDL recovery is checksummed and chunked below GitHub annotation truncation', () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idl-transport-test-'))
 try {
  fs.mkdirSync(path.join(dir, 'target/idl'), { recursive: true })
  // Transport-only fixture, never written to the application ABI.
  const data = Buffer.from(JSON.stringify({ address: 'test-only', instructions: [], fixture: randomBytes(8000).toString('hex') }))
  fs.writeFileSync(path.join(dir, 'target/idl/solana_potato.json'), data)
  const result = spawnSync('python3', [path.resolve('scripts/publish-idl-annotation.py')], { cwd: dir, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.trim().split('\n')
  assert(lines.length <= 10)
  const notices = new Map(lines.map(line => {
   const match = /^::notice title=([^:]+)::(.+)$/.exec(line)!
   assert(match[2].length < 4096)
   return [match[1], match[2]]
  }))
  const count = Number(notices.get('ares-public-idl-parts')); assert(count > 1)
  const encoded = Array.from({ length: count }, (_, i) => notices.get(`ares-public-idl-part-${String(i).padStart(3, '0')}`)).join('')
  const restored = gunzipSync(Buffer.from(encoded, 'base64'))
  assert.deepEqual(restored, data)
  assert.equal(createHash('sha256').update(restored).digest('hex'), notices.get('ares-public-idl-sha256'))
 } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
