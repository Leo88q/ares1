import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../public/models/colony/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'))

test('colony models: small, pinned, CC0 or NASA 3D Resources assets and unmodified notices verify offline', () => {
  assert.equal(manifest.assets.length, 14)
  assert.equal(new Set(manifest.assets.map(a => a.file)).size, 14)
  assert.equal(manifest.notices.length, 4)
  let total = 0
  for (const asset of [...manifest.assets, ...manifest.notices]) {
    assert.ok(['CC0-1.0', 'NASA-3D-Resources'].includes(asset.license), asset.file)
    assert.match(asset.sourceBlob, /^[a-f0-9]{40}$/)
    assert.match(asset.commit, /^[a-f0-9]{40}$/)
    assert.match(asset.sourceUrl, /^https:\/\/github\.com\//)
    assert.ok(asset.sourceUrl.includes(asset.commit))
    assert.match(asset.officialSource, /^https:\/\/(kenney\.nl|quaternius\.com|nasa3d\.arc\.nasa\.gov)\//)
    assert.notEqual(asset.sourceBlob, '0'.repeat(40), asset.file)
    assert.ok(!asset.file.includes('..'))
    const bytes = readFileSync(new URL(asset.file, root))
    assert.equal(bytes.length, asset.bytes, asset.file)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.file)
    total += bytes.length
  }
  // Raised from 1 MiB for the two NASA models (~2.2 MB); still single-digit MB and fully local.
  assert.ok(total < 3 * 1024 * 1024, `Model payload must stay below 3 MiB, got ${total}`)
})

test('colony models: valid GLB envelopes with embedded buffers and textures only', () => {
  for (const asset of manifest.assets) {
    const bytes = readFileSync(new URL(asset.file, root))
    assert.equal(bytes.readUInt32LE(0), 0x46546c67, asset.file)
    assert.equal(bytes.readUInt32LE(4), 2, asset.file)
    assert.equal(bytes.readUInt32LE(8), bytes.length, asset.file)
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, asset.file)
    const jsonLength = bytes.readUInt32LE(12)
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString())
    assert.equal(gltf.asset.version, '2.0')
    assert.ok(gltf.meshes.length > 0)
    for (const buffer of gltf.buffers ?? []) assert.equal(buffer.uri, undefined)
    for (const image of gltf.images ?? []) { assert.equal(image.uri, undefined); assert.ok(Number.isInteger(image.bufferView)) }
    assert.equal(bytes.readUInt32LE(24 + jsonLength), 0x004e4942)
  }
})

test('colony route branches before on-chain providers and uses no wallet/game hooks', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  assert.ok(main.indexOf("=== '/colony'") < main.indexOf("import('./contexts/SolanaContext')"))
  const screen = readFileSync(new URL('../src/colony/ColonyScreen.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(screen, /useGame\(|useSolana\(|useWallet\(|sendTransaction\(|localStorage\.|sessionStorage\./)
  const scene = readFileSync(new URL('../src/colony/scene.ts', import.meta.url), 'utf8')
  assert.match(scene, /fetch\(`\/models\/colony\//)
  assert.doesNotMatch(scene, /https?:\/\//)
  assert.match(scene, /abort\.abort\(\)/)
  assert.match(scene, /renderer\.dispose\(\)/)
  assert.match(scene, /renderer\.forceContextLoss\(\)/)
  assert.match(scene, /new ResizeObserver/)
  assert.match(scene, /parser\.textureLoader = new THREE\.TextureLoader/, 'embedded textures must use img-src, not a blob fetch blocked by connect-src')
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
  assert.doesNotMatch(headers.match(/connect-src [^;]+/)?.[0] ?? '', /blob:/, 'do not weaken global wallet CSP for colony textures')
  // Keep the restoration path independent of the app's optional on-chain config.
  assert.ok(fileURLToPath(root).includes('/public/models/colony/'))
})
