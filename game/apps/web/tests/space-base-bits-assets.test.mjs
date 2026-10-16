import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// KayKit Space Base Bits 1.0 (CC0 1.0). Offline integrity checks only; no network.
const root = new URL('../public/models/space-base-bits/', import.meta.url)
const dir = fileURLToPath(root)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'))
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

test('space-base-bits: manifest pins every shipped file with matching sha256 and size', () => {
  const entries = [...manifest.assets, ...manifest.files, ...manifest.notices]
  for (const e of entries) {
    const path = new URL(e.file, root)
    assert.ok(existsSync(path), `missing ${e.file}`)
    assert.equal(sha256(path), e.sha256, `sha256 mismatch ${e.file}`)
    assert.equal(statSync(path).size, e.bytes, `size mismatch ${e.file}`)
  }
})

test('space-base-bits: every shipped file is accounted for in the manifest', () => {
  const listed = new Set([...manifest.assets, ...manifest.files].map((e) => e.file))
  listed.add('manifest.json')
  for (const f of readdirSync(dir)) {
    if (f === 'licenses') continue
    assert.ok(listed.has(f), `unlisted file ${f}`)
  }
})

test('space-base-bits: CC0 provenance is pinned to the official repository commit', () => {
  assert.match(manifest.notices[0].license, /CC0-1\.0/)
  assert.match(manifest.notices[0].sourceUrl, /KayKit-Space-Base-Bits-1\.0\/blob\/[0-9a-f]{40}\//)
  assert.equal(manifest.commit ?? manifest.assets[0].commit, '6dfbcac9927d06283752c4defd4882cfe0d29666')
  for (const a of manifest.assets) {
    assert.equal(a.license, 'CC0-1.0')
    assert.equal(a.commit, '6dfbcac9927d06283752c4defd4882cfe0d29666')
    assert.match(a.sourceBlob, /^[0-9a-f]{40}$/)
  }
  const license = readFileSync(new URL('licenses/kaykit-space-base-bits-LICENSE.txt', root), 'utf8')
  assert.match(license, /Creative Commons Zero|CC0/)
})

test('space-base-bits: every glTF is valid 2.0 and its buffers and images resolve locally', () => {
  const gltfs = readdirSync(dir).filter((f) => f.endsWith('.gltf'))
  assert.equal(gltfs.length, manifest.assets.length)
  for (const f of gltfs) {
    const doc = JSON.parse(readFileSync(new URL(f, root), 'utf8'))
    assert.equal(doc.asset?.version, '2.0', `${f} is not glTF 2.0`)
    assert.ok((doc.meshes ?? []).length > 0, `${f} has no meshes`)
    for (const b of doc.buffers ?? []) {
      assert.ok(!b.uri?.startsWith('http'), `${f} references an external URL`)
      assert.ok(existsSync(new URL(b.uri, root)), `${f} missing buffer ${b.uri}`)
    }
    for (const im of doc.images ?? []) {
      if (!im.uri) continue
      assert.ok(!im.uri.startsWith('http'), `${f} references an external URL`)
      assert.ok(existsSync(new URL(im.uri, root)), `${f} missing image ${im.uri}`)
    }
  }
})

test('space-base-bits: payload stays small and does not count against colony/fields budgets', () => {
  let total = 0
  for (const f of readdirSync(dir)) {
    if (statSync(new URL(f, root)).isFile()) total += statSync(new URL(f, root)).size
  }
  assert.ok(total < 3 * 1024 * 1024, `space-base-bits payload must stay below 3 MiB, got ${total}`)
})

test('space-base-bits: colony scene loads only KayKit files that are shipped, same-origin', () => {
  const scene = readFileSync(new URL('../src/colony/scene.ts', import.meta.url), 'utf8')
  const used = [...scene.matchAll(/(windturbine_[a-z]+\.gltf)/g)].map(m => m[1])
  assert.ok(used.length >= 2, 'colony scene should reference the KayKit turbines')
  for (const f of used) assert.ok(existsSync(new URL(f, root)), `scene references missing ${f}`)
  assert.doesNotMatch(scene, /https?:\/\//)
})
