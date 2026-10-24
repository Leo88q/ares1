import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const root = new URL('../public/models/fields/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'))

test('field models: small CC0 assets with pinned provenance and verbatim notices', () => {
  assert.equal(manifest.assets.length, 18)
  assert.equal(manifest.notices.length, 4)
  assert.equal(new Set(manifest.assets.map(asset => asset.file)).size, 18)
  let total = 0
  for (const asset of [...manifest.assets, ...manifest.notices]) {
    assert.equal(asset.license, 'CC0-1.0')
    assert.match(asset.commit, /^[a-f0-9]{40}$/)
    assert.match(asset.sourceBlob, /^[a-f0-9]{40}$/)
    assert.ok(asset.sourceUrl.includes(asset.commit))
    assert.match(asset.officialSource, /^https:\/\/(kenney\.nl|quaternius\.com)\//)
    assert.ok(!asset.file.includes('..'))
    const bytes = readFileSync(new URL(asset.file, root))
    assert.equal(bytes.length, asset.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256)
    if (asset.file.startsWith('licenses/')) assert.match(bytes.toString(), /CC0/)
    total += bytes.length
  }
  assert.ok(total < 400_000, `Keep this reusable field kit tiny, got ${total} bytes`)
})
test('field models: self-contained GLB 2.0, no external buffer/image requests', () => {
  for (const asset of manifest.assets) {
    const bytes = readFileSync(new URL(asset.file, root))
    assert.equal(bytes.readUInt32LE(0), 0x46546c67)
    assert.equal(bytes.readUInt32LE(4), 2)
    assert.equal(bytes.readUInt32LE(8), bytes.length)
    const length = bytes.readUInt32LE(12)
    const gltf = JSON.parse(bytes.subarray(20, 20 + length))
    assert.equal(gltf.asset.version, '2.0')
    assert.ok(gltf.meshes.length > 0)
    for (const buffer of gltf.buffers ?? []) assert.equal(buffer.uri, undefined)
    for (const image of gltf.images ?? []) { assert.equal(image.uri, undefined); assert.ok(Number.isInteger(image.bufferView)) }
  }
})
test('real fields use current public-key accounts and existing action callbacks, not colony simulation', () => {
  const main = readFileSync(new URL('../src/components/MainScreen.tsx', import.meta.url), 'utf8')
  assert.match(main, /fields\.map\(field => fieldVisual\(field,/)
  assert.match(main, /field\.publicKey\.toString\(\) === selected\.id/)
  for (const [prop, handler] of [['onHarvest', 'harvest'], ['onUpgrade', 'upgradeField'], ['onRepair', 'repairField'], ['onPayTax', 'payTax'], ['onApplyFertilizer', 'applyFertilizer']]) {
    assert.match(main, new RegExp(`${prop}=\\{${handler}\\}`))
  }
  assert.match(main, /renderCards=/)
  assert.doesNotMatch(main, /colony\/simulation|initialColony|deliverFood|advanceDays/)
  const scene = readFileSync(new URL('../src/fields/scene.ts', import.meta.url), 'utf8')
  assert.match(scene, /fetch\(`\/models\/fields\//)
  assert.doesNotMatch(scene, /useGame\(|useSolana\(|useWallet\(|sendTransaction\(|https?:\/\//)
  assert.match(scene, /new THREE\.InstancedMesh/)
  assert.match(scene, /parser\.textureLoader = new THREE\.TextureLoader/)
  for (const cleanup of [/abort\.abort\(\)/, /observer\.disconnect\(\)/, /rig\.dispose\(\)/, /renderer\.dispose\(\)/, /renderer\.forceContextLoss\(\)/, /geometries\.forEach/, /materials\.forEach/, /textures\.forEach/]) assert.match(scene, cleanup)
})
test('the field lab is a product section: real contexts only, never invents Field accounts', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  // Песочница /demo удалена вместе со своим bootstrap без провайдеров.
  assert.doesNotMatch(main, /=== '\/demo'/)
  assert.ok(main.indexOf("=== '/colony'") < main.indexOf("import('./contexts/SolanaContext')"))
  const lab = readFileSync(new URL('../src/lab/FieldLabScreen.tsx', import.meta.url), 'utf8')
  assert.match(lab, /useGame\(\)/)
  assert.match(lab, /useSolana\(\)/)
  assert.match(lab, /FieldVisual\[\]/)
  // Учебные стенды — локальные визуалы: ни ключей, ни аккаунтов, ни хранилищ.
  assert.doesNotMatch(lab, /new PublicKey|new Keypair|useWallet\(|sendTransaction\(|localStorage\.|sessionStorage\./)
  assert.match(lab, /href="\/market"/)
  const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
  assert.doesNotMatch(csp.match(/connect-src [^;]+/)?.[0] ?? '', /blob:/)
})
