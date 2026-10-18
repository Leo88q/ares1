import * as THREE from 'three'

/** Batch distant/unselected prefab meshes. Source trees remain available for
 * exact raycasting and dynamic poses, but are not drawn. The selected tree is
 * rendered separately at full detail, including captions and glazing outlines.
 * Geometry/material ownership stays with the source scene; only instance buffers
 * belong to this layer. No scene-state, crop, resource or account data is changed.
 */
export function createModuleBatcher(): {
  root: THREE.Group
  update(sources: readonly THREE.Object3D[]): void
  /** Pose-only patch. Membership/material/visibility changes require update(). */
  refresh(branches: readonly THREE.Object3D[]): void
  dispose(): void
  stats(): { batches: number; instances: number; capacity: number; updates: number; patches: number; writtenInstances: number }
} {
  const root = new THREE.Group(); root.name = 'colony-module-batches'
  interface Batch { mesh: THREE.InstancedMesh; capacity: number; fullUploadPending: boolean }
  const batches = new Map<string, Batch>()
  let updates = 0, patches = 0, writtenInstances = 0
  let slots = new WeakMap<THREE.Object3D, { batch: Batch; index: number }>()
  return {
    root,
    update: sources => {
      updates++; slots = new WeakMap()
      const groups = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; objects: THREE.Mesh[]; cast: boolean; receive: boolean }>()
      function visit(object: THREE.Object3D): void {
        if (!object.visible) return
        // Only visible branches need matrices. Hidden full prefabs are updated
        // separately on a pick, never once per overview frame.
        object.updateWorldMatrix(false, false)
        if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh) && !(object instanceof THREE.InstancedMesh)) {
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          const key = `${object.geometry.uuid}:${materials.map(m => m.uuid).join('|')}:${object.castShadow}:${object.receiveShadow}`
          const group: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; objects: THREE.Mesh[]; cast: boolean; receive: boolean } = groups.get(key) ?? { geometry: object.geometry, material: object.material, objects: [], cast: object.castShadow, receive: object.receiveShadow }
          group.objects.push(object); groups.set(key, group)
        }
        for (const child of object.children) visit(child)
      }
      sources.forEach(source => { source.parent?.updateWorldMatrix(true, false); visit(source) })
      for (const [key, batch] of batches) if (!groups.has(key)) { batch.mesh.removeFromParent(); batch.mesh.dispose(); batches.delete(key) }
      for (const [key, group] of groups) {
        let batch = batches.get(key)
        if (!batch || batch.capacity < group.objects.length) {
          if (batch) { batch.mesh.removeFromParent(); batch.mesh.dispose() }
          const capacity = 2 ** Math.ceil(Math.log2(Math.max(1, group.objects.length)))
          const mesh = new THREE.InstancedMesh(group.geometry, group.material, capacity)
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
          const created: Batch = { mesh, capacity, fullUploadPending: true }
          mesh.instanceMatrix.onUpload(() => { created.fullUploadPending = false })
          batch = created; root.add(mesh); batches.set(key, batch)
        }
        const mesh = batch.mesh
        mesh.material = group.material
        mesh.count = group.objects.length
        batch.fullUploadPending = true
        mesh.instanceMatrix.clearUpdateRanges()
        group.objects.forEach((object, i) => {
          mesh.setMatrixAt(i, object.matrixWorld); slots.set(object, { batch: batch!, index: i })
        })
        writtenInstances += group.objects.length
        mesh.instanceMatrix.needsUpdate = true
        mesh.castShadow = group.cast; mesh.receiveShadow = group.receive
        mesh.computeBoundingBox(); mesh.computeBoundingSphere()
      }
    },
    refresh: branches => {
      const dirty = new Set<Batch>(), visited = new Set<THREE.Object3D>()
      function visit(object: THREE.Object3D): void {
        if (!object.visible || visited.has(object)) return
        visited.add(object); object.updateWorldMatrix(false, false)
        const slot = slots.get(object)
        if (slot) {
          slot.batch.mesh.setMatrixAt(slot.index, object.matrixWorld)
          // A structural update may still await GPU upload. Never narrow its
          // pending full transfer to a subsequent pose-only patch range.
          if (!slot.batch.fullUploadPending) slot.batch.mesh.instanceMatrix.addUpdateRange(slot.index * 16, 16)
          writtenInstances++; dirty.add(slot.batch)
        }
        for (const child of object.children) visit(child)
      }
      for (const branch of branches) { branch.parent?.updateWorldMatrix(true, false); visit(branch) }
      if (dirty.size) patches++
      for (const { mesh } of dirty) {
        mesh.instanceMatrix.needsUpdate = true
        mesh.computeBoundingBox(); mesh.computeBoundingSphere()
      }
    },
    stats: () => ({ updates, patches, writtenInstances, batches: batches.size, instances: [...batches.values()].reduce((n, b) => n + b.mesh.count, 0), capacity: [...batches.values()].reduce((n, b) => n + b.capacity, 0) }),
    dispose: () => { batches.forEach(b => { b.mesh.removeFromParent(); b.mesh.dispose() }); batches.clear(); slots = new WeakMap(); root.removeFromParent() },
  }
}
