import * as THREE from 'three'

/** A cutaway room in world space, not a backdrop or a rotating display plinth.
 * All repeated architecture shares geometry/materials within the room. No textures,
 * network requests, lights per plant, or continuously running animation loop.
 */
export interface GreenhouseInterior {
  root: THREE.Group
  glazing: THREE.Group
  setState(light: number, flow: number, pumpFault: boolean): void
  cutaway(camera: THREE.Camera): void
  dispose(): void
}

export function createGreenhouseInterior(rows: number, length: number): GreenhouseInterior {
  const root = new THREE.Group()
  root.name = 'greenhouse-interior'
  const ownedGeometries: THREE.BufferGeometry[] = []
  const ownedMaterials: THREE.Material[] = []
  const material = (color: string, metalness = 0.1, roughness = 0.7): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color, metalness, roughness })
    ownedMaterials.push(m); return m
  }
  const floor = material('#60645d', 0.2)
  const seam = material('#363f3a', 0.15)
  const frame = material('#b5b7a6', 0.65, 0.38)
  const bronze = material('#7a6444', 0.65, 0.42)
  const tray = material('#a3aaa0', 0.55, 0.43)
  const soil = material('#332a20', 0, 0.99)
  const water = material('#506f72', 0.4, 0.3)
  const amber = material('#d6ad5a', 0.3)
  const glass = material('#bad8d2', 0.08, 0.2)
  glass.transparent = true; glass.opacity = 0.14; glass.depthWrite = false
  const lamp = material('#fff0cc', 0, 0.35)
  lamp.emissive.set('#ffedb5'); lamp.emissiveIntensity = 0.7
  const status = material('#77bba3', 0.1)
  status.emissive.set('#3c8669'); status.emissiveIntensity = 0.5
  const box = new THREE.BoxGeometry(1, 1, 1); ownedGeometries.push(box)
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10); ownedGeometries.push(cylinder)
  function block(parent: THREE.Object3D, m: THREE.Material, size: [number, number, number], pos: [number, number, number]): THREE.Mesh {
    const mesh = new THREE.Mesh(box, m)
    mesh.scale.set(...size); mesh.position.set(...pos)
    mesh.castShadow = m !== glass && m !== lamp; mesh.receiveShadow = m !== glass
    parent.add(mesh); return mesh
  }
  function tube(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, m: THREE.Material): void {
    const mesh = new THREE.Mesh(cylinder, m)
    mesh.scale.set(radius, a.distanceTo(b), radius)
    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    parent.add(mesh)
  }
  const halfWidth = 6.7, halfLength = length / 2 + 1.5
  block(root, seam, [13.6, 0.24, halfLength * 2 + 0.2], [0, -0.18, 0])
  // Floor panels, with an unobstructed central aisle and service aisles.
  for (let x = -6; x <= 6; x += 2) for (let z = -halfLength + 1; z < halfLength; z += 2) {
    block(root, floor, [1.96, 0.08, Math.min(1.96, 2 * (halfLength - z))], [x, -0.02, z])
  }
  block(root, bronze, [1.15, 0.025, 2 * halfLength - 0.4], [0, 0.035, 0])
  for (const x of [-0.66, 0.66, -4.15, 4.15]) {
    block(root, amber, [0.045, 0.02, halfLength * 2 - 0.6], [x, 0.05, 0])
  }
  for (let row = 0; row < rows; row++) {
    const z = (row - (rows - 1) / 2) * 1.45
    for (const side of [-1, 1]) {
      const x = side * 2.22
      // Raised beds: metal base, real substrate recess, distinct rims and feet.
      block(root, tray, [2.85, 0.32, 1.08], [x, 0.56, z])
      block(root, soil, [2.69, 0.05, 0.9], [x, 0.735, z])
      for (const dz of [-0.52, 0.52]) block(root, frame, [2.94, 0.08, 0.045], [x, 0.75, z + dz])
      for (const dx of [-1.12, 1.12]) {
        block(root, bronze, [0.08, 0.45, 0.72], [x + dx, 0.23, z])
      }
      tube(root, new THREE.Vector3(x - 1.3, 0.79, z + 0.32), new THREE.Vector3(x + 1.3, 0.79, z + 0.32), 0.025, water)
      for (let n = 0; n < 6; n++) {
        const px = x + (n - 2.5) * 0.43
        tube(root, new THREE.Vector3(px, 0.79, z + 0.32), new THREE.Vector3(px, 0.77, z), 0.012, seam)
      }
      // Grow fixtures hung over each bed, not floating on the background.
      block(root, bronze, [2.85, 0.11, 0.36], [x, 3.45, z])
      block(root, lamp, [2.66, 0.035, 0.26], [x, 3.375, z])
      for (const dx of [-1, 1]) tube(root, new THREE.Vector3(x + dx, 3.51, z), new THREE.Vector3(x + dx, 4.1, z), 0.012, frame)
    }
    block(root, seam, [12.9, 0.075, 0.075], [0, 4.13, z])
  }
  // Supply/return trunks run beside beds, keeping walkways clear.
  for (const side of [-1, 1]) {
    tube(root, new THREE.Vector3(side * 3.88, 0.42, -halfLength + 0.6), new THREE.Vector3(side * 3.88, 0.42, halfLength - 0.6), 0.055, water)
    tube(root, new THREE.Vector3(side * 3.95, 0.14, -halfLength + 0.6), new THREE.Vector3(side * 3.95, 0.14, halfLength - 0.6), 0.07, seam)
  }
  const sides: Array<{ group: THREE.Group; normal: THREE.Vector3 }> = []
  for (const axis of ['x', 'z'] as const) for (const sign of [-1, 1]) {
    const wall = new THREE.Group(); wall.name = `wall-${axis}-${sign}`; root.add(wall)
    const isX = axis === 'x', span = isX ? halfLength * 2 : halfWidth * 2
    wall.position.set(isX ? sign * halfWidth : 0, 0, isX ? 0 : sign * halfLength)
    if (isX) wall.rotation.y = Math.PI / 2
    block(wall, bronze, [span, 0.65, 0.14], [0, 0.31, 0])
    block(wall, glass, [span - 0.15, 3.25, 0.035], [0, 2.28, 0])
    block(wall, frame, [span + 0.1, 0.14, 0.18], [0, 4.1, 0])
    const bays = Math.ceil(span / 2.8)
    for (let i = 0; i <= bays; i++) block(wall, frame, [0.09, 4.1, 0.14], [-span / 2 + i * span / bays, 2.05, 0])
    sides.push({ group: wall, normal: new THREE.Vector3(isX ? sign : 0, 0, isX ? 0 : sign) })
  }
  // Inspection roof is optional. Camera-facing walls are cut away independently.
  const glazing = new THREE.Group(); glazing.name = 'inspection-glazing'; root.add(glazing)
  block(glazing, glass, [halfWidth * 2, 0.04, halfLength * 2], [0, 4.25, 0])
  for (let z = -halfLength; z <= halfLength; z += 2.8) block(glazing, frame, [halfWidth * 2, 0.065, 0.06], [0, 4.3, z])
  // End-of-aisle access panel with recessed door and lit state strip.
  block(root, bronze, [1.45, 2.65, 0.17], [0, 1.32, -halfLength + 0.18])
  block(root, seam, [1.19, 2.38, 0.03], [0, 1.3, -halfLength + 0.29])
  block(root, status, [0.32, 0.12, 0.06], [0, 2.28, -halfLength + 0.32])
  // Batch architecture per cutaway group. Hundreds of trays/panels/drippers
  // cost one draw call per shared geometry/material, not one per small part.
  const batches: THREE.InstancedMesh[] = []
  function batch(parent: THREE.Group): void {
    const groups = new Map<string, THREE.Mesh[]>()
    for (const child of [...parent.children]) {
      if (!(child instanceof THREE.Mesh)) continue
      const key = `${child.geometry.uuid}:${(child.material as THREE.Material).uuid}`
      const list = groups.get(key) ?? []; list.push(child); groups.set(key, list)
    }
    for (const list of groups.values()) {
      const first = list[0]
      const instances = new THREE.InstancedMesh(first.geometry, first.material, list.length)
      list.forEach((mesh, i) => { mesh.updateMatrix(); instances.setMatrixAt(i, mesh.matrix); parent.remove(mesh) })
      instances.castShadow = first.castShadow; instances.receiveShadow = first.receiveShadow
      instances.computeBoundingBox(); instances.computeBoundingSphere()
      parent.add(instances); batches.push(instances)
    }
  }
  sides.forEach(({ group }) => batch(group)); batch(glazing); batch(root)
  const view = new THREE.Vector3()
  const center = new THREE.Vector3()
  return {
    root, glazing,
    setState: (light, flow, pumpFault) => {
      lamp.emissiveIntensity = 0.15 + THREE.MathUtils.clamp(light, 0, 1) * 1.7
      water.color.set(flow > 0 && !pumpFault ? '#557f86' : '#646c65')
      status.color.set(pumpFault ? '#cc7050' : '#77bba3')
      status.emissive.set(pumpFault ? '#8e3524' : '#3c8669')
    },
    cutaway: camera => {
      root.getWorldPosition(center)
      view.copy(camera.position).sub(center)
      sides.forEach(({ group, normal }) => { group.visible = view.dot(normal) <= 0 })
    },
    dispose: () => {
      batches.forEach(mesh => mesh.dispose())
      ownedGeometries.forEach(g => g.dispose())
      ownedMaterials.forEach(m => m.dispose())
      root.removeFromParent()
    },
  }
}
