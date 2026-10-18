import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** Reusable potato foliage silhouette: branched stem and curved compound leaves.
 * One geometry is instanced for every plant, with no per-leaf objects or animation.
 * Appearance only: never changes the field's growth clock or harvest amount.
 */
export function createPotatoGeometry(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = []
  const stem = new THREE.CylinderGeometry(0.013, 0.021, 0.86, 6).toNonIndexed()
  stem.translate(0, 0.43, 0); pieces.push(stem)
  for (let branch = 0; branch < 7; branch++) {
    const angle = branch * 2.39996
    const base = new THREE.Vector3(0, 0.18 + branch * 0.09, 0)
    const length = 0.32 - branch * 0.013
    const tip = new THREE.Vector3(Math.cos(angle) * length, base.y + 0.07, Math.sin(angle) * length)
    const twig = new THREE.CylinderGeometry(0.006, 0.009, base.distanceTo(tip), 5).toNonIndexed()
    twig.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(base).normalize()))
    twig.translate(...base.clone().add(tip).multiplyScalar(0.5).toArray()); pieces.push(twig)
    // Three pairs of leaflets, plus a terminal leaflet on each branch.
    for (let leaflet = 0; leaflet < 5; leaflet++) {
      const t = leaflet === 4 ? 0.95 : 0.4 + Math.floor(leaflet / 2) * 0.27
      const a = angle + (leaflet === 4 ? 0 : (leaflet % 2 ? 1 : -1) * 1.02)
      const origin = base.clone().lerp(tip, t)
      const leafLength = leaflet === 4 ? 0.23 : 0.17
      const positions: number[] = []
      const point = (step: number, side: number): number[] => {
        const u = step / 8
        const halfWidth = Math.sin(Math.PI * u) * leafLength * 0.37
        const along = u * leafLength
        return [origin.x + Math.cos(a) * along - Math.sin(a) * side * halfWidth,
          origin.y + Math.sin(Math.PI * u) * 0.055 - side * side * halfWidth * 0.3,
          origin.z + Math.sin(a) * along + Math.cos(a) * side * halfWidth]
      }
      for (let step = 0; step < 8; step++) {
        for (const side of [-1, 1]) {
          positions.push(...point(step, 0), ...point(step, side), ...point(step + 1, side),
            ...point(step, 0), ...point(step + 1, side), ...point(step + 1, 0))
        }
      }
      const leaf = new THREE.BufferGeometry()
      leaf.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); leaf.computeVertexNormals()
      // Merge only positions/normals: cylinders have UVs, these leaves do not.
      pieces.push(leaf)
    }
  }
  pieces.forEach(g => g.deleteAttribute('uv'))
  const merged = mergeGeometries(pieces, false)!
  pieces.forEach(g => g.dispose())
  merged.computeBoundingBox(); merged.computeBoundingSphere()
  return merged
}
