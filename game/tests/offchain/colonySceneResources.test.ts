import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { disposeSceneTrees } from '../../apps/web/src/colony/sceneResources'

test('demolition disposes unique labels/edges but preserves live/template/pool resources', () => {
  const sharedGeometry = new THREE.BoxGeometry(), sharedMaterial = new THREE.MeshStandardMaterial()
  const removed = new THREE.Group(), live = new THREE.Mesh(sharedGeometry, sharedMaterial)
  removed.add(live.clone())
  const texture = new THREE.Texture(), labelMaterial = new THREE.SpriteMaterial({ map: texture })
  removed.add(new THREE.Sprite(labelMaterial))
  const edgeGeometry = new THREE.EdgesGeometry(sharedGeometry), edgeMaterial = new THREE.LineBasicMaterial()
  removed.add(new THREE.LineSegments(edgeGeometry, edgeMaterial))
  const pooled = new THREE.MeshStandardMaterial(); removed.add(new THREE.Mesh(sharedGeometry, pooled))
  const counts = new Map<object, number>()
  for (const resource of [sharedGeometry, sharedMaterial, texture, labelMaterial, edgeGeometry, edgeMaterial, pooled]) resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1))
  disposeSceneTrees([removed], [], [live], [pooled])
  for (const resource of [texture, labelMaterial, edgeGeometry, edgeMaterial]) assert.equal(counts.get(resource), 1)
  for (const resource of [sharedGeometry, sharedMaterial, pooled]) assert.equal(counts.get(resource) ?? 0, 0)
  disposeSceneTrees([live], [pooled])
  for (const resource of [sharedGeometry, sharedMaterial, pooled]) assert.equal(counts.get(resource), 1)
})

test('final teardown deduplicates shared resources across detached trees and extra pools', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial(), root = new THREE.Mesh(geometry, material)
  let calls = 0; geometry.addEventListener('dispose', () => calls++); material.addEventListener('dispose', () => calls++)
  disposeSceneTrees([root, root.clone()], [geometry, material])
  assert.equal(calls, 2)
})
