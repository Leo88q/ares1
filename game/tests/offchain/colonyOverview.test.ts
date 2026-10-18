import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createOverviewTemplates } from '../../apps/web/src/colony/moduleOverview'
import { MODULE_KINDS } from '../../apps/web/src/colony/simulation'

test('all seven overview archetypes are small, bounded meshes without texture uploads', () => {
  const templates = createOverviewTemplates()
  assert.deepEqual([...templates.keys()].sort(), [...MODULE_KINDS].sort())
  for (const [kind, root] of templates) {
    let triangles = 0
    root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3
      assert.equal((node.material as THREE.MeshStandardMaterial).map, null)
    })
    assert.ok(triangles > 0 && triangles < 600, `${kind}: ${triangles} triangles`)
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
    assert.ok(size.x <= 4.8 && size.z <= 7.2 && size.y <= 4, `${kind} fits module footprint`)
  }
})

test('overview clones share geometry/material without sharing transforms or visibility', () => {
  const source = createOverviewTemplates().get('greenhouse')!
  const clone = source.clone(true)
  const a = source.children[0] as THREE.Mesh, b = clone.children[0] as THREE.Mesh
  assert.equal(a.geometry, b.geometry); assert.equal(a.material, b.material)
  clone.position.x = 10; clone.visible = false
  assert.equal(source.position.x, 0); assert.equal(source.visible, true)
})
