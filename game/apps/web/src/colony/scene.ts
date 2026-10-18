import * as THREE from 'three'
import { createCameraRig } from '../three/cameraRig'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { CATALOG, PARAMETERS } from './simulation'
import type { ColonyModule, ColonyState } from './simulation'
import { COLONY_CELL_METRES, COLONY_GRID_SIZE, footprint, modulePlacement, placementWorld, placementError, worldCell } from './layout'
import type { ConstructionDraft } from './ConstructionPlan'
import { createModuleBatcher } from './moduleBatcher'
import { createOverviewTemplates } from './moduleOverview'
import { disposeSceneTrees as disposeTrees } from './sceneResources'
import { createNetworkScene } from './networkScene'
import { placementHitsNetwork, networksOf, createNetworkServiceReader, type ColonyNetwork } from './networks'
import { colonyVisualState, type ModuleVisual } from './organism'

// Entries with a '/' live in another same-origin model folder (KayKit Space Base Bits, CC0).
const KAYKIT = 'space-base-bits'
/** KayKit Space Base Bits (CC0). Fan and drill bit are named nodes inside their models. */
const K = {
  turbineLow: `${KAYKIT}/windturbine_low.gltf`,
  turbineTall: `${KAYKIT}/windturbine_tall.gltf`,
  lights: `${KAYKIT}/lights.gltf`,
  tunnel: `${KAYKIT}/tunnel_straight_A.gltf`,
  crate0: `${KAYKIT}/cargo_A.gltf`,
  crate1: `${KAYKIT}/cargo_A_packed.gltf`,
  crate2: `${KAYKIT}/cargo_A_stacked.gltf`,
  lander: `${KAYKIT}/lander_A.gltf`,
  pad: `${KAYKIT}/landingpad_small.gltf`,
  garage: `${KAYKIT}/basemodule_garage.gltf`,
  drill: `${KAYKIT}/drill_structure.gltf`,
  truck: `${KAYKIT}/spacetruck.gltf`,
} as const
const FILES = [...Object.values(CATALOG).map(m => m.file), 'plant.glb', 'rock.glb', 'connector.glb', 'astronaut.glb', 'cargo.glb', 'hammer.glb', 'shovel.glb', ...Object.values(K)]

/** URL and loader base for a model entry: same-origin only. */
function modelLocation(file: string): { url: string; base: string } {
  if (!file.includes('/')) return { url: `/models/colony/${file}`, base: '/models/colony/' }
  const dir = file.slice(0, file.lastIndexOf('/'))
  return { url: `/models/${file}`, base: `/models/${dir}/` }
}

export interface ColonySceneStats {
  contextLost: boolean
  drawCalls: number; triangles: number; geometries: number; textures: number; programs: number
  modules: number; updates: number; patches: number; writtenInstances: number; batches: number; instances: number; capacity: number
  culledModules: number; lowDetail: boolean; serviceRebuilds: number
  updateMs: number; renderCpuMs: number
}
export interface ColonyScene {
  diagnostics: () => ColonySceneStats
  update: (state: ColonyState, selectedId: string | null, sunHours: number) => void
  setDraft: (draft: ConstructionDraft | null) => void
  setNetworkPreview: (network: ColonyNetwork | null) => void
  zoom: (factor: number) => void
  rotate: (direction: 1 | -1) => void
  resetCamera: () => void
  dispose: () => void
}

/** Demand-rendered, bounded-pixel-ratio scene; all model requests are same-origin. */
export function createColonyScene(host: HTMLElement, callbacks: {
  onSelect: (id: string) => void
  onSite: (at: { x: number; z: number }) => void
  onReady: () => void
  onModelError: () => void
  onContextLost: () => void
}, options: { batching?: boolean; incremental?: boolean } = {}): ColonyScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-hidden', 'true')
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  // Terrain and modules share one perspective. No illustrated horizon underneath.
  scene.background = new THREE.Color('#8a654c')
  const utilities = createNetworkScene(); scene.add(utilities.root)
  let networkPreview: ColonyNetwork | null = null
  scene.fog = new THREE.Fog('#b7855a', 65, 170)
  const camera = new THREE.OrthographicCamera(-22, 22, 17, -17, 0.1, 250)
  const rig = createCameraRig({
    camera, dom: renderer.domElement, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, offset: [29, 32, 37],
    bounds: { x: 58, z: 58 }, minZoom: 0.3, maxZoom: 4,
    initialZoom: 1.15, onRender: requestRender,
  })
  const resetCamera = (): void => rig.reset()

  let disposed = false
  let frame = 0
  let lastUpdateMs = 0, lastRenderCpuMs = 0
  function requestRender(): void {
    if (disposed || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!disposed) {
        updateModuleBatches()
        const started = performance.now(); renderer.render(scene, camera); lastRenderCpuMs = performance.now() - started
      }
    })
  }
  const sky = new THREE.HemisphereLight('#ffe0b5', '#4a2c1c', 2.1)
  scene.add(sky)
  const sun = new THREE.DirectionalLight('#fff1d9', 3.5)
  sun.position.set(-25, 32, -17)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 24, bottom: -24, near: 1, far: 100 })
  sun.shadow.normalBias = 0.035
  scene.add(sun)
  const rim = new THREE.DirectionalLight('#c99a6c', 1)
  rim.position.set(10, 10, 22)
  scene.add(rim)

  const terrain = new THREE.PlaneGeometry(200, 200, 90, 90)
  terrain.rotateX(-Math.PI / 2)
  const positions = terrain.attributes.position
  const colors: number[] = []
  const tone = new THREE.Color()
  const rand = (i: number): number => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i)
    let height = rand(i + 4) * 0.9 - 0.65
    for (const [cx, cz, radius] of [[-25, 13, 7], [25, 0, 8], [-6, -26, 9]]) {
      const d = Math.hypot(x - cx, z - cz) / radius
      height += -2.4 * Math.exp(-d * d * 3) + 0.65 * Math.exp(-Math.pow((d - 1) * 4, 2))
    }
    if (Math.abs(x) < 60 && Math.abs(z) < 60) height = -0.18
    positions.setY(i, height)
    tone.set('#8a5a3e').multiplyScalar(0.64 + rand(i + 7) * 0.08)
    colors.push(tone.r, tone.g, tone.b)
  }
  terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  terrain.computeVertexNormals()
  const ground = new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }))
  ground.receiveShadow = true
  scene.add(ground)

  const gridPoints: number[] = []
  const mapHalf = COLONY_GRID_SIZE * COLONY_CELL_METRES / 2
  for (let i = 0; i <= COLONY_GRID_SIZE; i++) {
    const v = -mapHalf + i * COLONY_CELL_METRES
    gridPoints.push(v, -0.13, -mapHalf, v, -0.13, mapHalf, -mapHalf, -0.13, v, mapHalf, -0.13, v)
  }
  scene.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3)),
    new THREE.LineBasicMaterial({ color: '#d9a46a', transparent: true, opacity: 0.13 }),
  ))
  let draft: ConstructionDraft | null = null
  const ghostMaterial = new THREE.MeshBasicMaterial({ color: '#b9e48a', transparent: true, opacity: 0.36, depthWrite: false })
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMaterial)
  ghost.visible = false; scene.add(ghost)
  function setDraft(next: ConstructionDraft | null): void {
    draft = next
    ghost.visible = !!next
    if (next) {
      const p = placementWorld(next.kind, next.at)
      ghost.position.set(p.x, 0.8, p.z); ghost.scale.set(p.width - 0.1, 1.6, p.depth - 0.1)
      ghostMaterial.color.set(latest && (placementError(latest.state.modules, next.kind, next.at, next.moveId) || placementHitsNetwork(latest.state, next.kind, next.at, next.moveId)) ? '#ee805e' : '#b9e48a')
    }
    requestRender()
  }

  const overviewTemplates = createOverviewTemplates()
  const moduleBatches = createModuleBatcher(); scene.add(moduleBatches.root)
  const detailRoot = new THREE.Group(); scene.add(detailRoot)
  const moduleRoot = new THREE.Group()
  moduleRoot.visible = false // retained exact geometry for raycasting, not drawn twice
  const propsRoot = new THREE.Group()
  // Off-render sources must not participate in scene.updateMatrixWorld, which
  // otherwise traverses even invisible descendants on every render.
  scene.add(propsRoot)
  const selection = new THREE.Mesh(new THREE.RingGeometry(2.48, 2.55, 64), new THREE.MeshBasicMaterial({ color: '#f0cf8a', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }))
  selection.rotation.x = -Math.PI / 2
  selection.visible = false
  selection.position.y = 0.19
  scene.add(selection)

  const templates = new Map<string, THREE.Group>()
  const serviceReader = createNetworkServiceReader()
  const moduleObjects = new Map<string, THREE.Group>()
  let poseVersion = 0, visualVersion = 0, materialVersion = 0, batchStamp = ''
  const dirtyBranches = new Set<THREE.Object3D>()
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), bounds = new THREE.Box3()
  let culledModules = 0, lowDetail = false
  function updateModuleBatches(): void {
    if (!latest || options.batching === false) { dirtyBranches.clear(); return }
    camera.updateMatrixWorld(true)
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    lowDetail = 4 * host.clientWidth * camera.zoom / (camera.right - camera.left) < 32
    const sources: THREE.Object3D[] = [], visible: string[] = []
    culledModules = 0
    for (const m of latest.state.modules) {
      const object = moduleObjects.get(m.id)
      if (!object) continue
      const detailed = m.id === latest.selectedId || !lowDetail
      for (const child of object.children) {
        if (child.userData.overviewProxy) { child.visible = !detailed; continue }
        if (child.userData.overviewKeep) continue
        const sourceVisible = child.name === 'lamp' ? !!child.userData.signalVisible : child.userData.overviewSourceVisible ?? child.visible
        child.userData.overviewSourceVisible = sourceVisible
        child.userData.overviewHidden = sourceVisible && !detailed
        child.visible = sourceVisible && detailed
      }
      if (m.id === latest.selectedId) continue
      const p = placementWorld(m.kind, modulePlacement(m))
      // Conservative module + shadow reach. Never cull by its centre alone.
      bounds.min.set(p.x - p.width / 2 - 6, -0.3, p.z - p.depth / 2 - 6)
      bounds.max.set(p.x + p.width / 2 + 6, 6, p.z + p.depth / 2 + 6)
      if (!frustum.intersectsBox(bounds)) { culledModules++; continue }
      sources.push(object); visible.push(m.id)
    }
    const stamp = `${poseVersion}:${lowDetail ? 0 : options.incremental === false ? visualVersion : materialVersion}:${lowDetail}:${visible.join(',')}`
    if (stamp !== batchStamp) { batchStamp = stamp; moduleBatches.update(sources) }
    else if (!lowDetail && dirtyBranches.size) moduleBatches.refresh([...dirtyBranches])
    dirtyBranches.clear()
  }

  const padGeometries = new Map<string, THREE.BoxGeometry>()
  const padMaterial = new THREE.MeshStandardMaterial({ color: '#4a3a2e', roughness: 0.95, metalness: 0.15 })
  const bedGeometry = new THREE.BoxGeometry(0.7, 0.22, 2.05)
  const bedMaterial = new THREE.MeshStandardMaterial({ color: '#38453b', roughness: 0.9 })
  const glassMaterial = new THREE.MeshStandardMaterial({ color: '#99dce1', roughness: 0.28, metalness: 0.15, transparent: true, opacity: 0.23, depthWrite: false, side: THREE.DoubleSide })
  const lampMaterials = new Map<string, THREE.MeshStandardMaterial>()

  const pooledResources = () => [...padGeometries.values(), padMaterial, bedGeometry, bedMaterial, glassMaterial, ...lampMaterials.values()]
  let modelsSettled = false
  let latest: { state: ColonyState; selectedId: string | null; sunHours: number } | null = null

  // ---- Whole-base organism: KayKit parts driven by colonyVisualState (visual only) ----
  let lander: THREE.Object3D | null = null
  const crateStages: THREE.Object3D[] = []
  const LIGHT_COLORS: Record<'green' | 'amber' | 'red', string> = { green: '#7fe0a0', amber: '#ffb347', red: '#ff4d4d' }
  const spinners: Array<{ pivot: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number; group: 'wind' | 'drill' | 'truck' }> = []
  let spinFrame = 0
  let lastSpin = 0
  function spinStep(now: number): void {
    spinFrame = 0
    const dt = lastSpin ? Math.min(0.1, (now - lastSpin) / 1000) : 0
    lastSpin = now
    let moving = false
    for (const spinner of spinners) {
      if (spinner.speed <= 0) continue
      spinner.pivot.rotation[spinner.axis] += spinner.speed * dt
      moving = true
    }
    requestRender()
    if (moving) spinFrame = requestAnimationFrame(spinStep)
    else lastSpin = 0
  }
  /** Keeps animation running only while something turns; otherwise the scene stays demand-rendered. */
  function ensureSpin(): void {
    if (!disposed && !spinFrame && spinners.some(spinner => spinner.speed > 0)) {
      lastSpin = 0
      spinFrame = requestAnimationFrame(spinStep)
    }
  }
  type Rig = { scale: number; offset: THREE.Vector3 }
  function rigFor(reference: THREE.Object3D, width: number): Rig {
    const box = new THREE.Box3().setFromObject(reference)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    return { scale: width / Math.max(size.x, size.z, 0.001), offset: new THREE.Vector3(-center.x, -box.min.y, -center.z) }
  }
  /** Places a KayKit model without re-centring per file; each named part (fan, drill bit, wheel) gets its own pivot. */
  function spinningRig(file: string, partNames: string[], width: number, axis: 'x' | 'y' | 'z', group: 'wind' | 'drill' | 'truck'): THREE.Group | null {
    const template = templates.get(file)
    if (!template) return null
    const rig = rigFor(template, width)
    const root = new THREE.Group()
    const copy = template.clone(true)
    copy.position.copy(rig.offset)
    root.add(copy)
    root.scale.setScalar(rig.scale)
    root.updateMatrixWorld(true)
    for (const partName of partNames) {
      const part = copy.getObjectByName(partName)
      if (!part) continue
      const centre = root.worldToLocal(new THREE.Box3().setFromObject(part).getCenter(new THREE.Vector3()))
      const pivot = new THREE.Group()
      pivot.position.copy(centre)
      root.add(pivot)
      pivot.attach(part)
      spinners.push({ pivot, axis, speed: 0, group })
    }
    return root
  }
  function ensureLamp(object: THREE.Group): THREE.Object3D | null {
    const existing = object.getObjectByName('lamp')
    if (existing || !templates.has(K.lights)) return existing ?? null
    const lamp = model(K.lights, 0.6)
    lamp.name = 'lamp'
    lamp.position.set(1.9, 0.5, 1.9)
    object.add(lamp)
    return lamp
  }
  function applyModuleVisual(object: THREE.Group, mv: ModuleVisual, solarTilt: number): void {
    const lamp = ensureLamp(object)
    if (lamp) {
      if (lamp.userData.signalVisible !== (mv.lights !== 'off')) materialVersion++
      lamp.visible = mv.lights !== 'off'
      lamp.userData.signalVisible = lamp.visible
      if (mv.lights !== 'off' && lamp.userData.color !== LIGHT_COLORS[mv.lights]) {
        materialVersion++
        const color = LIGHT_COLORS[mv.lights]
        lamp.userData.color = color
        lamp.traverse(child => {
          if (child instanceof THREE.Mesh) {
            let material = lampMaterials.get(color)
            if (!material) { material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 }); lampMaterials.set(color, material) }
            child.material = material
          }
        })
      }
    }
    const edge = object.userData.edge as THREE.LineSegments | undefined
    if (edge) {
      const base = (CATALOG as Record<string, { color: string }>)[mv.kind]?.color ?? '#ffffff'
      ;(edge.material as THREE.LineBasicMaterial).color.set(mv.damaged ? '#ff6b4a' : base)
    }
    if (mv.kind === 'solar') {
      const body = object.getObjectByName('body')
      const angle = -0.35 + 0.45 * solarTilt
      if (body && body.rotation.x !== angle) { body.rotation.x = angle; dirtyBranches.add(body) }
    }
  }
  function model(file: string, width: number, glass = false): THREE.Group {
    const group = new THREE.Group()
    const template = templates.get(file)
    if (!template) {
      const standIn = new THREE.Mesh(new THREE.BoxGeometry(width, 0.8, width * 0.7), new THREE.MeshStandardMaterial({ color: '#aa7962', wireframe: true }))
      standIn.position.y = 0.4
      group.add(standIn)
      return group
    }
    const clone = template.clone(true)
    const box = new THREE.Box3().setFromObject(clone)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const scale = width / Math.max(size.x, size.z, 0.001)
    clone.scale.multiplyScalar(scale)
    clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
    clone.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = !glass
      object.receiveShadow = true
      if (file === 'rock.glb') object.material = new THREE.MeshStandardMaterial({ color: '#787c81', roughness: 1 })
      if (glass) {
        object.material = glassMaterial
        object.add(new THREE.LineSegments(new THREE.EdgesGeometry(object.geometry, 24), new THREE.LineBasicMaterial({ color: '#d3eff1', transparent: true, opacity: 0.56 })))
      }
    })
    group.add(clone)
    return group
  }

  function label(text: string, color: string): THREE.Sprite | null {
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = '#0a1119dd'; context.fillRect(0, 0, 256, 64)
    context.fillStyle = color; context.font = '500 27px monospace'; context.textAlign = 'center'
    context.fillText(text, 128, 42)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
    sprite.scale.set(2.4, 0.6, 1)
    return sprite
  }

  function createModule(m: ColonyModule, index: number): THREE.Group {
    const root = new THREE.Group()
    root.userData.moduleId = m.id
    const at = modulePlacement(m), { x, z } = placementWorld(m.kind, at)
    root.position.set(x, 0, z)
    root.rotation.y = -at.rotation * Math.PI / 2
    const [fw, fd] = footprint(m.kind, 0)
    const padKey = `${fw}:${fd}`
    let padGeometry = padGeometries.get(padKey)
    if (!padGeometry) { padGeometry = new THREE.BoxGeometry(fw * COLONY_CELL_METRES - 0.16, 0.12, fd * COLONY_CELL_METRES - 0.16); padGeometries.set(padKey, padGeometry) }
    const pad = new THREE.Mesh(padGeometry, padMaterial)
    pad.userData.overviewKeep = true
    pad.position.y = 0.02; pad.receiveShadow = true; root.add(pad)
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(pad.geometry), new THREE.LineBasicMaterial({ color: CATALOG[m.kind].color, transparent: true, opacity: 0.45 }))
    edge.position.copy(pad.position); root.add(edge); root.userData.edge = edge
    const width = m.kind === 'solar' ? 3.9 : m.kind === 'battery' ? 2.3 : m.kind === 'rover' ? 3.2 : 3.75
    const body = model(CATALOG[m.kind].file, width, m.kind === 'greenhouse')
    body.position.y = 0.1
    body.name = 'body'
    if (m.kind === 'habitat' || m.kind === 'workshop') body.rotation.y = Math.PI / 2
    body.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3())
    const fit = Math.min(1, (fw * COLONY_CELL_METRES - 0.5) / bounds.x, (fd * COLONY_CELL_METRES - 0.5) / bounds.z)
    body.scale.multiplyScalar(fit)
    root.add(body)
    if (m.kind === 'greenhouse') {
      const crops = new THREE.Group()
      crops.name = 'crops'
      for (let row = 0; row < 3; row++) {
        const bed = new THREE.Mesh(bedGeometry, bedMaterial)
        bed.position.set((row - 1) * 0.85, 0.3, 0); root.add(bed)
        for (let j = 0; j < 4; j++) {
          const plant = model('plant.glb', 0.43)
          plant.position.set((row - 1) * 0.85, 0.4, (j - 1.5) * 0.5)
          crops.add(plant)
        }
      }
      root.add(crops)
    }
    if (m.kind === 'workshop') {
      const tools = model('hammer.glb', 0.68); tools.position.set(-1.5, 0.3, 1.1); tools.rotation.z = -0.7; root.add(tools)
      const shovel = model('shovel.glb', 0.52); shovel.position.set(-1, 0.1, 1.45); shovel.rotation.z = 0.35; root.add(shovel)
    }
    const caption = label(`${m.kind.toUpperCase().slice(0, 3)} / ${String(index + 1).padStart(2, '0')}`, CATALOG[m.kind].color)
    if (caption) { caption.position.set(0, 0.32, 2); root.add(caption) }
    const overview = overviewTemplates.get(m.kind)!.clone(true)
    overview.userData.overviewProxy = true; overview.visible = false; root.add(overview)
    return root
  }

  function decorate(): void {
    propsRoot.clear()
    for (let i = 0; i < 26; i++) {
      const rock = model('rock.glb', 0.4 + rand(i + 9) * 1.7)
      const angle = rand(i + 500) * Math.PI * 2, radius = 20 + rand(i + 700) * 22
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius
      ground.updateMatrixWorld(true)
      const surface = new THREE.Raycaster(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0)).intersectObject(ground)[0]
      rock.position.set(x, surface?.point.y ?? -0.2, z)
      rock.rotation.y = i; propsRoot.add(rock)
    }
    const astronaut = model('astronaut.glb', 0.55)
    astronaut.position.set(6, 0.05, 1.3); astronaut.rotation.y = -0.7; propsRoot.add(astronaut)
    const cargo = model('cargo.glb', 1.5)
    cargo.position.set(-2, 0.05, 8); propsRoot.add(cargo)
    const connector = model('connector.glb', 2.5)
    connector.position.set(5, 0.02, -4.7); connector.rotation.y = Math.PI / 2; propsRoot.add(connector)
    // KayKit props. Decor only: none of these change credits, rewards or simulation values.
    spinners.length = 0
    crateStages.length = 0
    const turbineLow = spinningRig(K.turbineLow, ['windturbine_low_fan'], 3.2, 'z', 'wind')
    if (turbineLow) { turbineLow.position.set(-17, 0.02, -10); turbineLow.rotation.y = 0.6; propsRoot.add(turbineLow) }
    const turbineTall = spinningRig(K.turbineTall, ['windturbine_tall_fan'], 2.6, 'z', 'wind')
    if (turbineTall) { turbineTall.position.set(17, 0.02, 10); turbineTall.rotation.y = -0.9; propsRoot.add(turbineTall) }
    const drill = spinningRig(K.drill, ['drill_module'], 2.4, 'y', 'drill')
    if (drill) { drill.position.set(22, 0.02, -8); propsRoot.add(drill) }
    const truck = spinningRig(K.truck, ['spacetruck_wheel_front_left', 'spacetruck_wheel_front_right', 'spacetruck_wheel_rear_left', 'spacetruck_wheel_rear_right'], 2.4, 'x', 'truck')
    if (truck) { truck.position.set(9, 0.02, 15); truck.rotation.y = -0.4; propsRoot.add(truck) }
    if (templates.has(K.garage)) {
      const garage = model(K.garage, 3.2)
      garage.position.set(-12, 0.02, -15); garage.rotation.y = 0.2; propsRoot.add(garage)
    }
    if (templates.has(K.pad)) {
      const pad = model(K.pad, 3.6)
      pad.position.set(-22, 0.02, 4); propsRoot.add(pad)
    }
    if (templates.has(K.lander)) {
      lander = model(K.lander, 2.2)
      lander.position.set(-22, 0.1, 4); lander.visible = false; propsRoot.add(lander)
    }
    // Crate stages share one reference scale, so empty, packed and stacked crates line up.
    const crateReference = templates.get(K.crate0)
    if (crateReference) {
      const crateRig = rigFor(crateReference, 2.2)
      for (const file of [K.crate0, K.crate1, K.crate2]) {
        const template = templates.get(file)
        if (!template) continue
        const crate = new THREE.Group()
        const copy = template.clone(true)
        copy.position.copy(crateRig.offset)
        crate.add(copy)
        crate.scale.setScalar(crateRig.scale)
        crate.position.set(-5, 0.05, 8); crate.visible = false
        propsRoot.add(crate); crateStages.push(crate)
      }
    }
  }

  function update(state: ColonyState, selectedId: string | null, sunHours: number): void {
    if (disposed) return
    const started = performance.now()
    if (latest?.selectedId !== selectedId) poseVersion++
    latest = { state, selectedId, sunHours }
    if (!modelsSettled) return
    // New colonies contain only player-owned modules inside the buildable area.
    // Legacy-only decorative rigs stay available for old visual fixtures.
    propsRoot.visible = state.modules.some(m => !m.placement)
    const activeIds = new Set(state.modules.map(m => m.id))
    for (const [id, object] of moduleObjects) {
      if (!activeIds.has(id)) {
        object.removeFromParent(); object.traverse(child => dirtyBranches.delete(child)); moduleObjects.delete(id); poseVersion++
        disposeTrees([object], [], [scene, moduleRoot, ...templates.values(), ...overviewTemplates.values()], pooledResources())
      }
    }
    state.modules.forEach((m, index) => {
      let object = moduleObjects.get(m.id)
      if (!object) { object = createModule(m, index); moduleObjects.set(m.id, object); moduleRoot.add(object); poseVersion++ }
      const at = modulePlacement(m), p = placementWorld(m.kind, at)
      const angle = -at.rotation * Math.PI / 2
      if (object.position.x !== p.x || object.position.z !== p.z || object.rotation.y !== angle) poseVersion++
      object.position.set(p.x, 0, p.z); object.rotation.y = angle
      const crops = object.getObjectByName('crops')
      if (crops) {
        const growth = 0.3 + m.growthDays / PARAMETERS.cropCycleDays * 0.7
        if (crops.scale.y !== growth) { crops.scale.y = growth; dirtyBranches.add(crops) }
      }
    })
    const selected = state.modules.find(m => m.id === selectedId)
    selection.visible = !!selected
    if (selected) {
      const { x, z } = placementWorld(selected.kind, modulePlacement(selected)); selection.position.set(x, 0.19, z)
    }
    const services = serviceReader.read(state)
    const visual = colonyVisualState(state, sunHours, services)
    const byId = new Map(visual.modules.map(mv => [mv.id, mv] as const))
    for (const m of state.modules) {
      const object = moduleObjects.get(m.id), mv = byId.get(m.id)
      if (object && mv) applyModuleVisual(object, services.get(m.id)?.power ? mv : { ...mv, lights: 'red' }, visual.power.solarCoverage)
    }
    for (const [id, object] of moduleObjects) {
      const parent = options.batching === false || id === selectedId ? detailRoot : moduleRoot
      if (object.parent !== parent) parent.add(object)
    }
    visualVersion++; updateModuleBatches()
    utilities.update(state.modules, networksOf(state), networkPreview)
    // Connectivity is explicit state, never inferred from visual crossings.
    setDraft(draft)
    crateStages.forEach((crate, index) => { crate.visible = index === visual.cargoStage })
    if (lander) lander.visible = visual.crewLanded
    const wind = visual.power.blackout ? 0 : 2.5 * visual.power.turbineSpin
    const drillSpeed = visual.power.blackout ? 0 : 0.8
    const truckSpeed = visual.truckActive ? 4 : 0
    for (const spinner of spinners) {
      spinner.speed = !propsRoot.visible ? 0 : spinner.group === 'wind' ? wind : spinner.group === 'drill' ? drillSpeed : truckSpeed
    }
    ensureSpin()
    sun.intensity = sunHours > 0 ? 3.5 : 0.08
    sky.intensity = sunHours > 0 ? 2.1 : 0.55
    lastUpdateMs = performance.now() - started
    requestRender()
  }

  // Local byte fetches can be aborted on route changes and StrictMode remounts.
  const abort = new AbortController()
  const manager = new THREE.LoadingManager()
  manager.onError = () => { if (!disposed) callbacks.onModelError() }
  const loader = new GLTFLoader(manager)
  loader.register(parser => {
    // ImageBitmapLoader fetches embedded images via blob: URLs, which the app's
    // strict connect-src intentionally forbids. Use the image loader instead:
    // img-src already allows blob:, so no global CSP relaxation is necessary.
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager)
      .setCrossOrigin(parser.options.crossOrigin)
      .setRequestHeader(parser.options.requestHeader)
    return { name: 'ARES_csp_image_loader' }
  })
  let modelFailed = false
  void Promise.all(FILES.map(async file => {
    try {
      const { url, base } = modelLocation(file)
      const response = await fetch(url, { signal: abort.signal })
      if (!response.ok) throw new Error(`Model HTTP ${response.status}`)
      const bytes = await response.arrayBuffer()
      if (disposed) return
      const gltf = await loader.parseAsync(bytes, base)
      if (disposed) { disposeTrees([gltf.scene]); return }
      templates.set(file, gltf.scene)
    } catch {
      if (!disposed && !abort.signal.aborted) modelFailed = true
    }
  })).then(() => {
    if (disposed) return
    modelsSettled = true
    decorate()
    if (latest) update(latest.state, latest.selectedId, latest.sunHours)
    if (modelFailed) callbacks.onModelError()
    callbacks.onReady()
  })

  const raycaster = new THREE.Raycaster()
  let down: { x: number; y: number } | null = null
  const onDown = (event: PointerEvent): void => { down = event.isPrimary ? { x: event.clientX, y: event.clientY } : null }
  const onUp = (event: PointerEvent): void => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7) { down = null; return }
    down = null
    const rect = renderer.domElement.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
    if (draft) {
      const point = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point)) callbacks.onSite(worldCell(point.x, point.z))
      return
    }
    // Full sources may have stayed dormant through many overview updates.
    // Refresh exact transforms once on interaction, including hidden LOD branches.
    for (const object of moduleObjects.values()) object.updateWorldMatrix(true, true)
    for (const hit of raycaster.intersectObjects([...moduleObjects.values()], true)) {
      if (!(hit.object instanceof THREE.Mesh)) continue
      let object: THREE.Object3D | null = hit.object
      let hidden = false
      while (object && !object.userData.moduleId) { if (object.userData.overviewProxy || (!object.visible && !object.userData.overviewHidden)) hidden = true; object = object.parent }
      if (hidden) continue
      if (object?.userData.moduleId) { callbacks.onSelect(object.userData.moduleId as string); break }
    }
  }
  const onContextLost = (event: Event): void => { event.preventDefault(); callbacks.onContextLost() }
  const resize = (): void => {
    const width = host.clientWidth, height = host.clientHeight
    if (!width || !height) return
    const aspect = width / height
    // Keep all starter pads inside a narrow mobile frame; users may then pan/zoom.
    const halfWidth = Math.max(28, 18.5 * aspect)
    const halfHeight = halfWidth / aspect
    camera.left = -halfWidth; camera.right = halfWidth; camera.top = halfHeight; camera.bottom = -halfHeight
    camera.updateProjectionMatrix(); renderer.setSize(width, height); requestRender()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  renderer.domElement.addEventListener('pointerdown', onDown)
  renderer.domElement.addEventListener('pointerup', onUp)
  renderer.domElement.addEventListener('webglcontextlost', onContextLost)
  resetCamera(); resize()

  return {
    diagnostics: () => ({ contextLost: renderer.getContext().isContextLost(), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0,
      modules: moduleObjects.size, ...moduleBatches.stats(), culledModules, lowDetail, serviceRebuilds: serviceReader.rebuilds(), updateMs: lastUpdateMs, renderCpuMs: lastRenderCpuMs }),
    update, setDraft,
    setNetworkPreview: n => { networkPreview = n; if (latest) utilities.update(latest.state.modules, networksOf(latest.state), n); requestRender() },
    resetCamera,
    zoom: factor => rig.zoomBy(factor),
    rotate: direction => rig.rotateStep(direction),
    dispose: () => {
      disposed = true; abort.abort(); cancelAnimationFrame(frame); cancelAnimationFrame(spinFrame); observer.disconnect()
      rig.dispose()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      moduleBatches.dispose()
      utilities.dispose()
      disposeTrees([scene, moduleRoot, ...templates.values(), ...overviewTemplates.values()], pooledResources())
      serviceReader.clear(); dirtyBranches.clear(); scene.clear(); moduleRoot.clear(); moduleObjects.clear(); templates.clear(); overviewTemplates.clear(); padGeometries.clear(); lampMaterials.clear()
      spinners.length = 0; crateStages.length = 0; latest = null; draft = null; networkPreview = null
      sun.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
    },
  }
}
