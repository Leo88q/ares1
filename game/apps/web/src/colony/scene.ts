import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { CATALOG, PARAMETERS, SLOTS } from './simulation'
import type { ColonyModule, ColonyState } from './simulation'
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

export interface ColonyScene {
  update: (state: ColonyState, selectedId: string | null, sunHours: number) => void
  zoom: (factor: number) => void
  resetCamera: () => void
  dispose: () => void
}

/** Demand-rendered, bounded-pixel-ratio scene; all model requests are same-origin. */
export function createColonyScene(host: HTMLElement, callbacks: {
  onSelect: (id: string) => void
  onReady: () => void
  onModelError: () => void
  onContextLost: () => void
}): ColonyScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-hidden', 'true')
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#080e16')
  scene.fog = new THREE.Fog('#080e16', 65, 170)
  const camera = new THREE.OrthographicCamera(-22, 22, 17, -17, 0.1, 250)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  controls.minZoom = 0.65
  controls.maxZoom = 3
  controls.minPolarAngle = 0.3
  controls.maxPolarAngle = Math.PI / 2.15
  controls.enablePan = false
  const resetCamera = (): void => {
    camera.position.set(29, 32, 37)
    camera.zoom = 1.15
    camera.updateProjectionMatrix()
    controls.target.set(0, 0, 0)
    controls.update()
    requestRender()
  }

  let disposed = false
  let frame = 0
  function requestRender(): void {
    if (disposed || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!disposed) renderer.render(scene, camera)
    })
  }
  const sky = new THREE.HemisphereLight('#dbe7ff', '#45413d', 2.1)
  scene.add(sky)
  const sun = new THREE.DirectionalLight('#fff1d9', 3.5)
  sun.position.set(-25, 32, -17)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 24, bottom: -24, near: 1, far: 100 })
  sun.shadow.normalBias = 0.035
  scene.add(sun)
  const rim = new THREE.DirectionalLight('#6b9ccc', 1)
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
    if (Math.abs(x) < 17 && Math.abs(z) < 12) height = -0.18
    positions.setY(i, height)
    tone.set('#62666a').multiplyScalar(0.64 + rand(i + 7) * 0.08)
    colors.push(tone.r, tone.g, tone.b)
  }
  terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  terrain.computeVertexNormals()
  const ground = new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }))
  ground.receiveShadow = true
  scene.add(ground)

  const gridPoints: number[] = []
  for (let i = 0; i <= 6; i++) gridPoints.push((i - 3) * 4.8, -0.13, -9.6, (i - 3) * 4.8, -0.13, 9.6)
  for (let i = 0; i <= 4; i++) gridPoints.push(-14.4, -0.13, (i - 2) * 4.8, 14.4, -0.13, (i - 2) * 4.8)
  scene.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3)),
    new THREE.LineBasicMaterial({ color: '#9bafbc', transparent: true, opacity: 0.18 }),
  ))

  const starPositions: number[] = []
  for (let i = 0; i < 170; i++) {
    const theta = rand(i + 200) * Math.PI * 2, phi = rand(i + 600) * Math.PI * 0.45
    starPositions.push(Math.cos(theta) * Math.cos(phi) * 115, Math.sin(phi) * 115 + 10, Math.sin(theta) * Math.cos(phi) * 115)
  }
  scene.add(new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3)),
    new THREE.PointsMaterial({ color: '#b8c9df', size: 0.15, transparent: true, opacity: 0.6 }),
  ))

  const moduleRoot = new THREE.Group()
  const propsRoot = new THREE.Group()
  scene.add(moduleRoot, propsRoot)
  const selection = new THREE.Mesh(new THREE.RingGeometry(2.48, 2.55, 64), new THREE.MeshBasicMaterial({ color: '#a3e4e8', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }))
  selection.rotation.x = -Math.PI / 2
  selection.visible = false
  selection.position.y = 0.19
  scene.add(selection)

  const templates = new Map<string, THREE.Group>()
  const moduleObjects = new Map<string, THREE.Group>()
  // Removed objects can share geometry/materials with live clones; defer their
  // deduplicated GPU disposal until teardown rather than invalidating live meshes.
  const retired: THREE.Object3D[] = []
  let latest: { state: ColonyState; selectedId: string | null; sunHours: number } | null = null

  // ---- Whole-base organism: KayKit parts driven by colonyVisualState (visual only) ----
  let lander: THREE.Object3D | null = null
  const crateStages: THREE.Object3D[] = []
  const linkRoot = new THREE.Group()
  scene.add(linkRoot)
  let linkKey = ''
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
      lamp.visible = mv.lights !== 'off'
      if (mv.lights !== 'off' && lamp.userData.color !== LIGHT_COLORS[mv.lights]) {
        const color = LIGHT_COLORS[mv.lights]
        lamp.userData.color = color
        lamp.traverse(child => {
          if (child instanceof THREE.Mesh) child.material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 })
        })
      }
    }
    const edge = object.userData.edge as THREE.LineSegments | undefined
    if (edge) {
      const base = (CATALOG as Record<string, { color: string }>)[mv.kind]?.color ?? '#ffffff'
      (edge.material as THREE.LineBasicMaterial).color.set(mv.damaged ? '#ff6b4a' : base)
    }
    if (mv.kind === 'solar') {
      const body = object.getObjectByName('body')
      if (body) body.rotation.x = -0.35 + 0.45 * solarTilt
    }
  }
  function rebuildLinks(links: Array<[number, number]>): void {
    const key = links.map(link => link.join('-')).join(',')
    if (key === linkKey) return
    const template = templates.get(K.tunnel)
    if (!template) return
    linkKey = key
    for (const child of [...linkRoot.children]) { linkRoot.remove(child); retired.push(child) }
    const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3())
    const alongX = size.x >= size.z
    for (const [a, b] of links) {
      const pa = SLOTS[a], pb = SLOTS[b]
      const horizontal = pa.z === pb.z
      const tunnel = model(K.tunnel, 2.6, false)
      tunnel.position.set((pa.x + pb.x) / 2, 0.3, (pa.z + pb.z) / 2)
      tunnel.rotation.y = horizontal === alongX ? 0 : Math.PI / 2
      linkRoot.add(tunnel)
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
        object.material = new THREE.MeshStandardMaterial({ color: '#99dce1', roughness: 0.28, metalness: 0.15, transparent: true, opacity: 0.23, depthWrite: false, side: THREE.DoubleSide })
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
    const { x, z } = SLOTS[m.slot]
    root.position.set(x, 0, z)
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.32, 2.4, 0.12, 6), new THREE.MeshStandardMaterial({ color: '#323b42', roughness: 0.95, metalness: 0.15 }))
    pad.position.y = 0.02; pad.receiveShadow = true; root.add(pad)
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(pad.geometry), new THREE.LineBasicMaterial({ color: CATALOG[m.kind].color, transparent: true, opacity: 0.45 }))
    edge.position.copy(pad.position); root.add(edge); root.userData.edge = edge
    const width = m.kind === 'solar' ? 3.9 : m.kind === 'battery' ? 2.3 : m.kind === 'rover' ? 3.2 : 3.75
    const body = model(CATALOG[m.kind].file, width, m.kind === 'greenhouse')
    body.position.y = 0.1
    body.name = 'body'
    if (m.kind === 'solar') body.rotation.y = Math.PI / 5
    if (m.kind === 'habitat' || m.kind === 'workshop') body.rotation.y = Math.PI / 2
    root.add(body)
    if (m.kind === 'greenhouse') {
      const crops = new THREE.Group()
      crops.name = 'crops'
      for (let row = 0; row < 3; row++) {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 2.05), new THREE.MeshStandardMaterial({ color: '#38453b', roughness: 0.9 }))
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
    latest = { state, selectedId, sunHours }
    const activeIds = new Set(state.modules.map(m => m.id))
    for (const [id, object] of moduleObjects) {
      if (!activeIds.has(id)) { moduleRoot.remove(object); retired.push(object); moduleObjects.delete(id) }
    }
    state.modules.forEach((m, index) => {
      let object = moduleObjects.get(m.id)
      if (!object) { object = createModule(m, index); moduleObjects.set(m.id, object); moduleRoot.add(object) }
      const crops = object.getObjectByName('crops')
      if (crops) {
        const growth = 0.3 + m.growthDays / PARAMETERS.cropCycleDays * 0.7
        crops.scale.y = growth
      }
    })
    const selected = state.modules.find(m => m.id === selectedId)
    selection.visible = !!selected
    if (selected) {
      const { x, z } = SLOTS[selected.slot]; selection.position.set(x, 0.19, z)
    }
    const visual = colonyVisualState(state, sunHours)
    const byId = new Map(visual.modules.map(mv => [mv.id, mv] as const))
    for (const m of state.modules) {
      const object = moduleObjects.get(m.id), mv = byId.get(m.id)
      if (object && mv) applyModuleVisual(object, mv, visual.power.solarCoverage)
    }
    rebuildLinks(visual.links)
    crateStages.forEach((crate, index) => { crate.visible = index === visual.cargoStage })
    if (lander) lander.visible = visual.crewLanded
    const wind = visual.power.blackout ? 0 : 2.5 * visual.power.turbineSpin
    const drillSpeed = visual.power.blackout ? 0 : 0.8
    const truckSpeed = visual.truckActive ? 4 : 0
    for (const spinner of spinners) {
      spinner.speed = spinner.group === 'wind' ? wind : spinner.group === 'drill' ? drillSpeed : truckSpeed
    }
    ensureSpin()
    sun.intensity = sunHours > 0 ? 3.5 : 0.08
    sky.intensity = sunHours > 0 ? 2.1 : 0.55
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
  const disposeTrees = (roots: THREE.Object3D[]): void => {
    const resources = new Set<{ dispose: () => void }>()
    roots.forEach(root => root.traverse(object => {
      const renderable = object as THREE.Mesh
      if (renderable.geometry) resources.add(renderable.geometry)
      const materials = Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : []
      for (const material of materials) {
        resources.add(material)
        Object.values(material).forEach(value => { if (value instanceof THREE.Texture) resources.add(value) })
      }
    }))
    resources.forEach(resource => resource.dispose())
  }
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
    retired.push(...moduleObjects.values()); moduleObjects.clear(); moduleRoot.clear()
    decorate()
    if (latest) update(latest.state, latest.selectedId, latest.sunHours)
    if (modelFailed) callbacks.onModelError()
    callbacks.onReady()
  })

  const raycaster = new THREE.Raycaster()
  let down: { x: number; y: number } | null = null
  const onDown = (event: PointerEvent): void => { down = { x: event.clientX, y: event.clientY } }
  const onUp = (event: PointerEvent): void => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7) { down = null; return }
    down = null
    const rect = renderer.domElement.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
    for (const hit of raycaster.intersectObjects(moduleRoot.children, true)) {
      let object: THREE.Object3D | null = hit.object
      while (object && !object.userData.moduleId) object = object.parent
      if (object?.userData.moduleId) { callbacks.onSelect(object.userData.moduleId as string); break }
    }
  }
  const onContextLost = (event: Event): void => { event.preventDefault(); callbacks.onContextLost() }
  const resize = (): void => {
    const width = host.clientWidth, height = host.clientHeight
    if (!width || !height) return
    const aspect = width / height
    const halfWidth = aspect < 1.25 ? 22 : 18.5 * aspect
    const halfHeight = halfWidth / aspect
    camera.left = -halfWidth; camera.right = halfWidth; camera.top = halfHeight; camera.bottom = -halfHeight
    camera.updateProjectionMatrix(); renderer.setSize(width, height); requestRender()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  controls.addEventListener('change', requestRender)
  renderer.domElement.addEventListener('pointerdown', onDown)
  renderer.domElement.addEventListener('pointerup', onUp)
  renderer.domElement.addEventListener('webglcontextlost', onContextLost)
  resetCamera(); resize()

  return {
    update,
    resetCamera,
    zoom: factor => { camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, controls.minZoom, controls.maxZoom); camera.updateProjectionMatrix(); requestRender() },
    dispose: () => {
      disposed = true; abort.abort(); cancelAnimationFrame(frame); cancelAnimationFrame(spinFrame); observer.disconnect()
      controls.removeEventListener('change', requestRender); controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      disposeTrees([scene, ...templates.values(), ...retired])
      sun.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
    },
  }
}
