import * as THREE from 'three'
import type { ModuleKind } from './simulation'

/** Readable low-poly archetypes for modules smaller than 32 screen pixels.
 * Not new buildings/assets/economics: full prefabs return when zoomed or selected.
 * Templates own shared geometries/materials; scene teardown deduplicates them
 * together with their clones. No textures, labels, or extra light sources.
 */
export function createOverviewTemplates(): Map<ModuleKind, THREE.Group> {
  const box = new THREE.BoxGeometry(1, 1, 1)
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8)
  const dome = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)
  const material = (color: string, metalness = 0.25): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness })
  const hull = material('#b0a388'), dark = material('#3e4039'), bronze = material('#7c694c'), blue = material('#344e65'), green = material('#70914e')
  const glass = material('#a4c7bc', 0.1); glass.transparent = true; glass.opacity = 0.35; glass.depthWrite = false
  const templates = new Map<ModuleKind, THREE.Group>()
  function mesh(root: THREE.Object3D, geometry: THREE.BufferGeometry, m: THREE.Material, size: [number, number, number], at: [number, number, number]): THREE.Mesh {
    const node = new THREE.Mesh(geometry, m); node.scale.set(...size); node.position.set(...at)
    node.castShadow = m !== glass; node.receiveShadow = true; root.add(node); return node
  }
  function type(kind: ModuleKind): THREE.Group { const root = new THREE.Group(); root.name = 'overview-proxy'; templates.set(kind, root); return root }
  const solar = type('solar'), panel = new THREE.Group(); panel.name = 'overview-solar-panel'; solar.add(panel); panel.position.y = 1.25
  const plate = mesh(panel, box, blue, [3.7, 0.1, 4.5], [0, 0, 0]); plate.rotation.x = -0.35
  for (const x of [-1.25, 1.25]) mesh(solar, box, bronze, [0.12, 1.2, 2.8], [x, 0.65, 0])
  const habitat = type('habitat')
  mesh(habitat, cylinder, bronze, [1.8, 0.3, 1.8], [0, 0.2, 0])
  mesh(habitat, dome, hull, [1.8, 2.7, 1.8], [0, 0.35, 0])
  mesh(habitat, box, dark, [0.8, 1.1, 0.3], [0, 0.7, 1.7])
  const greenhouse = type('greenhouse')
  mesh(greenhouse, cylinder, bronze, [1.8, 0.18, 1.8], [0, 0.15, 0])
  mesh(greenhouse, dome, glass, [1.8, 2.2, 1.8], [0, 0.25, 0])
  mesh(greenhouse, box, green, [2.5, 0.2, 2.4], [0, 0.35, 0])
  const recycler = type('recycler')
  for (const x of [-0.85, 0.85]) mesh(recycler, cylinder, hull, [0.65, 1.8, 0.65], [x, 1.0, 0])
  mesh(recycler, box, bronze, [2.9, 0.25, 2.3], [0, 0.2, 0])
  mesh(recycler, box, blue, [1, 1, 0.7], [0, 0.7, 1])
  const workshop = type('workshop')
  mesh(workshop, box, hull, [3.3, 2.2, 3.2], [0, 1.2, 0])
  mesh(workshop, box, bronze, [3.6, 0.2, 3.5], [0, 2.4, 0])
  mesh(workshop, box, dark, [1.6, 1.6, 0.1], [0, 0.9, 1.65])
  const battery = type('battery')
  mesh(battery, box, dark, [1.7, 1.6, 2.2], [0, 0.9, 0])
  mesh(battery, box, bronze, [1.9, 0.18, 2.4], [0, 1.8, 0])
  const rover = type('rover')
  mesh(rover, box, bronze, [2.4, 0.65, 3.1], [0, 0.9, 0])
  mesh(rover, box, hull, [1.8, 0.8, 1.1], [0, 1.5, -0.7])
  for (const x of [-1.35, 1.35]) for (const z of [-1.05, 1.05]) {
    const wheel = mesh(rover, cylinder, dark, [0.55, 0.35, 0.55], [x, 0.55, z]); wheel.rotation.z = Math.PI / 2
  }
  // Ледодобытчик: рама, буровая вышка и бункер для породы.
  const extractor = type('extractor')
  mesh(extractor, box, bronze, [3.2, 0.25, 3.0], [0, 0.2, 0])
  mesh(extractor, box, hull, [1.6, 1.4, 1.6], [0, 1.0, -0.4])
  for (const [x, z] of [[-1.1, -1.0], [1.1, -1.0], [-1.1, 1.0], [1.1, 1.0]] as const) {
    mesh(extractor, cylinder, dark, [0.18, 2.2, 0.18], [x, 1.3, z])
  }
  mesh(extractor, cylinder, dark, [0.22, 2.6, 0.22], [0, 1.7, 0.5]); 
  mesh(extractor, box, dark, [1.5, 0.9, 1.2], [0, 0.75, 1.5])
  // Складской блок: длинный низкий контейнер и пара баков.
  const depot = type('depot')
  mesh(depot, box, hull, [3.4, 1.8, 5.4], [0, 1.0, 0])
  mesh(depot, box, bronze, [3.6, 0.22, 5.6], [0, 2.0, 0])
  for (const z of [-1.6, 1.6]) mesh(depot, cylinder, blue, [0.6, 1.3, 0.6], [1.4, 0.85, z])
  // Водоочистка: баки и корпус фильтров.
  const purifier = type('purifier')
  mesh(purifier, box, bronze, [3.2, 0.25, 3.0], [0, 0.2, 0])
  for (const x of [-0.8, 0.8]) mesh(purifier, cylinder, blue, [0.7, 2.0, 0.7], [x, 1.2, -0.4])
  mesh(purifier, box, hull, [2.2, 1.1, 1.0], [0, 0.75, 1.2])
  mesh(purifier, cylinder, dark, [0.3, 1.4, 0.3], [0, 1.9, 1.2])
  // Лаборатория: гермоблок со смотровым окном и антенной.
  const lab = type('lab')
  mesh(lab, box, hull, [3.2, 2.0, 3.0], [0, 1.1, 0])
  mesh(lab, box, bronze, [3.4, 0.22, 3.2], [0, 2.2, 0])
  mesh(lab, box, glass, [1.7, 1.0, 0.1], [0, 1.3, 1.55])
  mesh(lab, cylinder, dark, [0.1, 1.5, 0.1], [1.3, 2.9, -1.0])
  return templates
}
