import * as THREE from 'three'
import type { ColonyModule } from './simulation'
import { COLONY_CELL_METRES, COLONY_GRID_SIZE, footprint, modulePlacement } from './layout'
import { NETWORK_COLORS, NETWORK_TYPES, validNetwork, type ColonyNetwork } from './networks'

/** Utility geometry is instanced per layer, including endpoint stubs into actual
 * module walls. A crossing has different vertical layers and is not a junction.
 */
export function createNetworkScene(): {
  root: THREE.Group
  update(modules: ColonyModule[], networks: ColonyNetwork[], preview: ColonyNetwork | null): void
  dispose(): void
} {
  const root = new THREE.Group()
  root.name = 'utility-networks'
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8)
  const corridor = new THREE.CylinderGeometry(0.6, 0.6, 1, 8)
  corridor.rotateX(Math.PI / 2)
  const materials = Object.fromEntries(NETWORK_TYPES.map(t => [t, new THREE.MeshStandardMaterial({
    color: t === 'tunnel' ? '#6d6654' : NETWORK_COLORS[t], metalness: 0.45, roughness: 0.55,
  })]))
  const ghost = new THREE.MeshBasicMaterial({ color: '#d6edac', transparent: true, opacity: 0.6, depthWrite: false })
  const broken = new THREE.MeshBasicMaterial({ color: '#e97355' })
  let stamp = ''
  const instances: THREE.InstancedMesh[] = []
  function clear(): void { instances.forEach(m => { m.removeFromParent(); m.dispose() }); instances.length = 0 }
  function toWorld(x: number, z: number, y: number): THREE.Vector3 {
    return new THREE.Vector3((x - COLONY_GRID_SIZE / 2) * COLONY_CELL_METRES, y, (z - COLONY_GRID_SIZE / 2) * COLONY_CELL_METRES)
  }
  function stub(m: ColonyModule | undefined, cell: { x: number; z: number }, y: number): THREE.Vector3 {
    if (!m) return toWorld(cell.x + 0.5, cell.z + 0.5, y)
    const at = modulePlacement(m), [w, d] = footprint(m.kind, at.rotation)
    return toWorld(cell.x < at.x ? at.x : cell.x >= at.x + w ? at.x + w : cell.x + 0.5,
      cell.z < at.z ? at.z : cell.z >= at.z + d ? at.z + d : cell.z + 0.5, y)
  }
  return {
    root,
    update: (modules, networks, preview) => {
      const next = JSON.stringify([modules.map(m => [m.id, m.kind, modulePlacement(m)]), networks, preview])
      if (next === stamp) return
      stamp = next; clear()
      const byId = new Map(modules.map(m => [m.id, m]))
      const groups = new Map<string, { type: ColonyNetwork['type']; material: THREE.Material; pairs: [THREE.Vector3, THREE.Vector3][] }>()
      for (const n of [...networks, ...(preview ? [preview] : [])]) {
        if (!n.cells.length) continue
        const isPreview = n === preview
        const valid = validNetwork(modules, n)
        const material = isPreview ? ghost : valid ? materials[n.type] : broken
        const id = `${n.type}:${isPreview}:${valid}`
        const group = groups.get(id) ?? { type: n.type, material, pairs: [] }
        const y = n.type === 'power' ? 0.09 : n.type === 'water' ? 0.24 : n.type === 'return' ? 0.4 : 0.65
        const points = [stub(byId.get(n.from), n.cells[0], y), ...n.cells.map(c => toWorld(c.x + 0.5, c.z + 0.5, y)), stub(byId.get(n.to), n.cells[n.cells.length - 1], y)]
        for (let i = 1; i < points.length; i++) if (points[i].distanceToSquared(points[i - 1]) > 1e-8) group.pairs.push([points[i - 1], points[i]])
        groups.set(id, group)
      }
      const pose = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0)
      for (const group of groups.values()) {
        const tunnel = group.type === 'tunnel'
        const mesh = new THREE.InstancedMesh(tunnel ? corridor : cylinder, group.material, group.pairs.length)
        group.pairs.forEach(([a, b], i) => {
          pose.position.copy(a).add(b).multiplyScalar(0.5)
          if (tunnel) {
            pose.quaternion.setFromAxisAngle(up, Math.atan2(b.x - a.x, b.z - a.z))
            pose.scale.set(0.85, 1.05, a.distanceTo(b) + 0.03)
          } else {
            pose.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize())
            pose.scale.set(group.type === 'power' ? 0.035 : 0.065, a.distanceTo(b), group.type === 'power' ? 0.035 : 0.065)
          }
          pose.updateMatrix(); mesh.setMatrixAt(i, pose.matrix)
        })
        mesh.castShadow = tunnel; mesh.receiveShadow = true
        mesh.computeBoundingSphere(); root.add(mesh); instances.push(mesh)
      }
    },
    dispose: () => { clear(); root.removeFromParent(); cylinder.dispose(); corridor.dispose(); Object.values(materials).forEach(m => m.dispose()); ghost.dispose(); broken.dispose() },
  }
}
