import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const root = new URL('../public/ares/art/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)))
test('warm-industrial artwork is small, local, individually generated and fingerprinted', () => {
  assert.equal(manifest.assets.length, 9)
  let total = 0
  for (const asset of manifest.assets) {
    const bytes = readFileSync(new URL(asset.file, root))
    assert.equal(bytes.length, asset.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256)
    assert.ok(asset.width > 0 && asset.height > 0)
    assert.match(asset.origin, /AI-generated|Derived crop/)
    total += bytes.length
  }
  assert.ok(total < 400_000, `Art payload ${total} bytes`)
  assert.match(manifest.notes, /not NASA imagery/)
})
test('field view composes actual art/prefabs, not procedural terrain, noise or custom hardware geometry', () => {
  const scene = readFileSync(new URL('../src/fields/scene.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(scene, /new THREE\.(BoxGeometry|CylinderGeometry|SphereGeometry)|Math\.random|createImageData|createLinearGradient|terrain\.setAttribute|positions\.setY/)
  assert.match(scene, /new THREE\.ShadowMaterial/)
  assert.match(scene, /model\('reservoir\.glb'/)
  assert.match(scene, /model\('battery\.glb'/)
  assert.match(scene, /model\('pump\.glb'/)
  assert.match(scene, /model\('climate-unit\.glb'/)
  const viewport = readFileSync(new URL('../src/fields/FieldsViewport.tsx', import.meta.url), 'utf8')
  assert.match(viewport, /className="mf-stage-art"/)
  assert.match(viewport, /FIELD_ART\.background/)
  const css = readFileSync(new URL('../src/fields/art-direction.css', import.meta.url), 'utf8')
  assert.match(css, /panel-bronze\.webp/)
  assert.match(css, /button-bronze\.webp/)
  assert.doesNotMatch(css, /kit\/fill\.webp|ares\/grain\.png/)
})
test('live engineering interface has presentation tabs and image icons without new rewards or APIs', () => {
  const source = readFileSync(new URL('../src/fields/engineering/EngineeringConsole.tsx', import.meta.url), 'utf8')
  assert.match(source, /ResourceIcon/)
  assert.match(source, /eg-console-tabs/)
  assert.match(source, /eg-deck-tabs/)
  assert.match(source, /view !== 'inventory'/)
  assert.doesNotMatch(source, /useWallet\(|sendTransaction\(|fetch\(|localStorage\.|sessionStorage\./)
})
