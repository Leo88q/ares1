import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { FIELD_PROFILES } from './model'
import { FIELD_MODEL_FILES } from './visualAssets'
import type { FieldVisual } from './model'

export interface FieldScene {
  update(fields: readonly FieldVisual[], selectedId: string | null, overview: boolean, roof: boolean): void
  zoom(factor: number): void
  resetCamera(): void
  dispose(): void
}
interface FarmObject {
  root: THREE.Group
  sprouts: THREE.InstancedMesh
  plants: THREE.InstancedMesh
  foliage: THREE.MeshStandardMaterial
  glass: THREE.Object3D[]
  materials: THREE.Material[]
  energy: THREE.MeshStandardMaterial[]
  water: THREE.MeshStandardMaterial[]
  pump: THREE.MeshStandardMaterial[]
  climate: THREE.MeshStandardMaterial[]
  stamp: string
  tier: number
  lab: boolean
}

/** Asset-driven art: original GLB prefabs over an illustrated environment plate.
 * No generated terrain, noise textures or bespoke hardware meshes. The only
 * primitive is an invisible shadow catcher, not a visual game object.
 */
export function createFieldScene(host: HTMLElement, callbacks: {
  onSelect(id: string): void; onReady(): void; onFailure(reason: 'models' | 'context'): void
}): FieldScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 600 ? 1.35 : 1.65))
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.18; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-hidden', 'true'); host.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-13, 13, 10, -10, 0.1, 180)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false; controls.enablePan = false
  controls.minZoom = 0.75; controls.maxZoom = 2.6
  controls.minPolarAngle = 0.45; controls.maxPolarAngle = Math.PI / 2.6
  let disposed = false, loaded = false, frame = 0, cameraKey = ''
  let latest: { fields: readonly FieldVisual[]; selectedId: string | null; overview: boolean; roof: boolean } | null = null
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>()
  const templates = new Map<string, THREE.Group>(), farms = new Map<string, FarmObject>()
  const leafGeometries = new Map<string, THREE.BufferGeometry>()
  const ownMaterial = <T extends THREE.Material>(m: T): T => { materials.add(m); return m }
  const plotRoot = new THREE.Group(); scene.add(plotRoot)
  const hemisphere = new THREE.HemisphereLight('#ffe4b7', '#5b422f', 2.6); scene.add(hemisphere)
  const sun = new THREE.DirectionalLight('#ffe2b5', 3.5); sun.position.set(-14, 25, -10); sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.normalBias = 0.045
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 25, bottom: -25, near: 1, far: 90 }); scene.add(sun)
  const fill = new THREE.DirectionalLight('#c2c5b1', 1.1); fill.position.set(12, 9, 14); scene.add(fill)
  const shadowGeometry = new THREE.PlaneGeometry(120, 120); geometries.add(shadowGeometry)
  shadowGeometry.rotateX(-Math.PI / 2)
  const shadow = new THREE.Mesh(shadowGeometry, ownMaterial(new THREE.ShadowMaterial({ opacity: 0.22 })))
  shadow.position.y = -0.13; shadow.receiveShadow = true; scene.add(shadow)

  function requestRender(): void {
    if (disposed || frame || document.hidden) return
    frame = requestAnimationFrame(() => { frame = 0; if (!disposed) renderer.render(scene, camera) })
  }
  function recolorTemplate(root: THREE.Group, file: string): void {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      geometries.add(object.geometry)
      const originals = Array.isArray(object.material) ? object.material : [object.material]
      const painted = originals.map(original => {
        materials.add(original)
        Object.values(original).forEach(value => { if (value instanceof THREE.Texture) textures.add(value) })
        const material = ownMaterial((original as THREE.MeshStandardMaterial).clone())
        const name = material.name.toLowerCase()
        if (['row.glb', 'double-row.glb', 'soil.glb'].includes(file)) {
          material.color.set(name.includes('dark') ? '#44311d' : '#69462c'); material.metalness = 0; material.roughness = 0.95
        } else if (['sprout.glb', 'plant.glb'].includes(file)) {
          material.color.set('#63863c'); material.metalness = 0; material.roughness = 0.9
        } else if (file === 'canopy.glb' && (name === 'dark' || name.includes('default'))) {
          material.color.set('#e4ceb0'); material.transparent = true; material.opacity = 0.13
          material.metalness = 0.06; material.roughness = 0.24; material.depthWrite = false; material.side = THREE.DoubleSide
          object.userData.glazing = true
        } else if (file === 'platform.glb' || file === 'rail.glb') {
          material.color.set(name.includes('dark') ? '#382f25' : '#776244'); material.metalness = 0.48; material.roughness = 0.8
        } else if (file !== 'solar.glb') {
          material.color.set(name.includes('red') ? '#ae7844' : name.includes('dark') ? '#655846' : '#b7a080')
          material.metalness = 0.4; material.roughness = 0.63
          if (file === 'support.glb') { material.vertexColors = false; material.color.set('#7b6547') }
          if (file === 'canopy.glb' && name === 'metalred') object.scale.y = 0.45
        }
        return material
      })
      object.material = Array.isArray(object.material) ? painted : painted[0]
      object.castShadow = !object.userData.glazing; object.receiveShadow = true
    })
  }
  function model(file: string, size: [number, number, number], parent: THREE.Object3D, at: [number, number, number] = [0, 0, 0]): THREE.Group {
    const clone = templates.get(file)!.clone(true)
    const bounds = new THREE.Box3().setFromObject(clone), dimensions = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3())
    const offset = new THREE.Group(); offset.add(clone); offset.position.set(-center.x, -bounds.min.y, -center.z)
    const group = new THREE.Group(); group.add(offset)
    group.scale.set(size[0] / Math.max(dimensions.x, 0.001), size[1] / Math.max(dimensions.y, 0.001), size[2] / Math.max(dimensions.z, 0.001))
    group.position.set(...at); parent.add(group); return group
  }
  function feedback(root: THREE.Group, owned: THREE.Material[]): THREE.MeshStandardMaterial[] {
    const list: THREE.MeshStandardMaterial[] = []
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      const source = Array.isArray(object.material) ? object.material : [object.material]
      const result = source.map(original => { const clone = ownMaterial((original as THREE.MeshStandardMaterial).clone()); owned.push(clone); list.push(clone); return clone })
      object.material = Array.isArray(object.material) ? result : result[0]
    })
    return list
  }
  function foliageGeometry(file: string, height: number): THREE.BufferGeometry {
    const cached = leafGeometries.get(file); if (cached) return cached
    const template = templates.get(file)!; template.updateMatrixWorld(true)
    const pieces: THREE.BufferGeometry[] = []
    template.traverse(object => { if (object instanceof THREE.Mesh) pieces.push(object.geometry.clone().applyMatrix4(object.matrixWorld)) })
    const geometry = mergeGeometries(pieces, false)!
    pieces.forEach(piece => piece.dispose()); geometry.computeBoundingBox()
    const bounds = geometry.boundingBox!, center = bounds.getCenter(new THREE.Vector3()), scale = height / Math.max(bounds.max.y - bounds.min.y, 0.001)
    geometry.translate(-center.x, -bounds.min.y, -center.z); geometry.scale(scale, scale, scale)
    geometries.add(geometry); leafGeometries.set(file, geometry); return geometry
  }
  function buildFarm(field: FieldVisual): FarmObject {
    const profile = FIELD_PROFILES[field.tier], root = new THREE.Group(); root.userData.fieldId = field.id
    const foliage = ownMaterial(new THREE.MeshStandardMaterial({ color: '#668842', metalness: 0, roughness: 0.9 }))
    const owned: THREE.Material[] = [foliage]
    model('platform.glb', [10.7, 0.22, profile.length + 1.3], root, [0, -0.08, 0])
    const canopy = model('canopy.glb', [profile.width, 3.75, profile.length], root, [0, 0.11, 0])
    const glass: THREE.Object3D[] = []
    canopy.traverse(object => { if (object.userData.glazing) glass.push(object) })
    for (let row = 0; row < profile.rows; row++) {
      const z = (row - (profile.rows - 1) / 2) * 1.45
      model(field.tier === 0 ? 'row.glb' : 'double-row.glb', [6.35, 0.14, 1.05], root, [0, 0.59, z])
      const pipe = model('pipe.glb', [0.09, 0.1, 6.6], root, [0, 0.77, z + 0.44]); pipe.rotation.y = Math.PI / 2
    }
    const count = profile.rows * 12
    const sprouts = new THREE.InstancedMesh(foliageGeometry('sprout.glb', 0.6), foliage, count)
    const plants = new THREE.InstancedMesh(foliageGeometry('plant.glb', 1.06), foliage, count)
    const pose = new THREE.Object3D()
    for (let row = 0; row < profile.rows; row++) for (let column = 0; column < 12; column++) {
      const index = row * 12 + column
      pose.position.set((column - 5.5) * 0.49, 0, (row - (profile.rows - 1) / 2) * 1.45 + (column % 2 ? 0.18 : -0.18))
      pose.rotation.y = index * 2.4; pose.scale.setScalar(0.88 + (index % 3) * 0.05); pose.updateMatrix()
      sprouts.setMatrixAt(index, pose.matrix); plants.setMatrixAt(index, pose.matrix)
    }
    for (const mesh of [sprouts, plants]) { mesh.position.y = 0.74; mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh) }
    for (const side of [-1, 1]) {
      model('support.glb', [0.19, 2.6, profile.length * 0.91], root, [side * 3.78, 0.12, 0])
      model('rail.glb', [0.12, 0.42, profile.length], root, [side * 4.48, 0.18, 0])
      model('soil.glb', [0.6, 0.12, 0.6], root, [side * 3.55, 0.66, profile.length / 2 - 0.55])
    }
    const energy: THREE.MeshStandardMaterial[] = [], water: THREE.MeshStandardMaterial[] = [], pump: THREE.MeshStandardMaterial[] = [], climate: THREE.MeshStandardMaterial[] = []
    if (field.engineering) {
      model('platform.glb', [2.2, 0.2, 4.5], root, [5.65, -0.02, profile.length / 2 - 1.8])
      water.push(...feedback(model('reservoir.glb', [1.3, 1.9, 1.3], root, [5.6, 0.12, profile.length / 2 - 0.45]), owned))
      energy.push(...feedback(model('battery.glb', [1.25, 1.35, 1.1], root, [5.6, 0.12, profile.length / 2 - 2.0]), owned))
      pump.push(...feedback(model('pump.glb', [0.95, 0.9, 0.95], root, [4.95, 0.13, -profile.length / 2 + 0.7]), owned))
      const valve = model('valve.glb', [0.4, 0.5, 1.0], root, [4.12, 0.36, -profile.length / 2 + 0.7]); valve.rotation.y = Math.PI / 2
      climate.push(...feedback(model('climate-unit.glb', [1.2, 1.25, 1.1], root, [5.6, 0.12, profile.length / 2 - 3.5]), owned))
      model('control-panel.glb', [0.7, 0.7, 0.25], root, [4.3, 0.9, profile.length / 2 - 0.7])
    } else {
      model('reservoir.glb', [0.7, 1.0, 0.7], root, [4.65, 0.12, 0])
    }
    if (profile.solar || field.engineering) model('solar.glb', [2.5, 1.15, 1.9], root, [-4.1, 0.17, -profile.length / 2 - 1.9])
    plotRoot.add(root)
    return { root, sprouts, plants, foliage, glass, materials: owned, energy, water, pump, climate, stamp: '', tier: field.tier, lab: !!field.engineering }
  }
  function removeFarm(id: string): void {
    const farm = farms.get(id); if (!farm) return
    plotRoot.remove(farm.root); farm.sprouts.dispose(); farm.plants.dispose()
    farm.materials.forEach(material => { material.dispose(); materials.delete(material) }); farms.delete(id)
  }
  function resetCamera(): void {
    const overview = latest?.overview ?? false
    camera.position.set(overview ? 30 : 14, overview ? 30 : 16, overview ? 34 : 18); controls.target.set(0, 0.6, 0)
    camera.zoom = 1; controls.update(); camera.updateMatrixWorld(true)
    const aspect = Math.max(0.4, host.clientWidth / Math.max(host.clientHeight, 1))
    const bounds = new THREE.Box3().setFromObject(plotRoot)
    let span = overview ? 25 : 7.3
    if (!bounds.isEmpty()) for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const point = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse)
      span = Math.max(span, Math.abs(point.x) / aspect * 1.1, Math.abs(point.y) * 1.1)
    }
    camera.left = -span * aspect; camera.right = span * aspect; camera.top = span; camera.bottom = -span
    camera.updateProjectionMatrix(); requestRender()
  }
  function update(fields: readonly FieldVisual[], selectedId: string | null, overview: boolean, roof: boolean): void {
    latest = { fields, selectedId, overview, roof }; if (!loaded || disposed) return
    const displayed = overview ? fields : fields.filter(field => field.id === selectedId)
    const ids = new Set(displayed.map(field => field.id)); for (const id of farms.keys()) if (!ids.has(id)) removeFarm(id)
    let changed = false
    displayed.forEach((field, index) => {
      let farm = farms.get(field.id)
      if (farm && (farm.tier !== field.tier || farm.lab !== !!field.engineering)) { removeFarm(field.id); farm = undefined }
      if (!farm) { farm = buildFarm(field); farms.set(field.id, farm); changed = true }
      const stamp = [field.condition, field.active, field.ready, field.fertilized, field.taxExpired, field.mutation, field.growth, field.level, JSON.stringify(field.engineering), selectedId === field.id, overview, roof, index].join(':')
      if (stamp === farm.stamp) return
      farm.stamp = stamp; changed = true
      const columns = displayed.length <= 2 ? displayed.length : 3, rows = Math.ceil(displayed.length / Math.max(columns, 1))
      farm.root.position.set(overview ? (index % columns - (columns - 1) / 2) * 13 : 0, 0, overview ? (Math.floor(index / columns) - (rows - 1) / 2) * 17 : 0)
      farm.plants.visible = field.active && field.growth >= 0.75; farm.sprouts.visible = field.active && field.growth > 0 && field.growth < 0.75
      farm.sprouts.scale.y = farm.plants.scale.y = 0.55 + field.growth * 0.45
      farm.foliage.color.set(field.fertilized ? '#7b9845' : '#688f40').lerp(new THREE.Color('#997446'), (1 - field.condition) * 0.65)
      if (field.mutation === 1) farm.foliage.color.lerp(new THREE.Color('#c8a24f'), 0.25)
      farm.glass.forEach(object => { object.visible = roof })
      const status = field.engineering
      if (status) {
        for (const material of farm.energy) { material.color.set('#b19b6a'); material.emissive.set('#624b28'); material.emissiveIntensity = 0.05 + status.battery * 0.1 }
        for (const material of farm.water) material.color.set('#8bafa0').lerp(new THREE.Color('#ac8358'), 1 - status.water)
        for (const material of farm.pump) { material.color.set(status.pumpFault ? '#b27953' : '#aaa180'); material.emissive.set(status.pumpFault ? '#6b2117' : '#1b2418'); material.emissiveIntensity = 0.12 }
        for (const material of farm.climate) { material.emissive.set(status.climateCooling ? '#365764' : '#673415'); material.emissiveIntensity = status.climate * 0.12 }
      }
    })
    const input = fields.find(field => field.id === selectedId)?.engineering
    sun.intensity = input ? 1.0 + input.solar * 2.5 : 3.5; hemisphere.intensity = input ? 1.6 + input.solar : 2.6
    const nextKey = `${overview}:${!!input}:${overview ? fields.map(f => f.id).join(',') : selectedId}`
    if (nextKey !== cameraKey) { cameraKey = nextKey; resetCamera(); changed = true }
    if (changed) requestRender()
  }
  const abort = new AbortController(), manager = new THREE.LoadingManager()
  manager.onError = () => { if (!disposed) callbacks.onFailure('models') }
  const loader = new GLTFLoader(manager)
  loader.register(parser => {
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager).setCrossOrigin(parser.options.crossOrigin).setRequestHeader(parser.options.requestHeader)
    return { name: 'ARES_field_csp_images' }
  })
  function disposeForeign(root: THREE.Object3D): void {
    const resources = new Set<{ dispose(): void }>()
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      resources.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) { resources.add(material); Object.values(material).forEach(value => { if (value instanceof THREE.Texture) resources.add(value) }) }
    }); resources.forEach(resource => resource.dispose())
  }
  void Promise.all(FIELD_MODEL_FILES.map(async file => {
    const response = await fetch(`/models/fields/${file}`, { signal: abort.signal })
    if (!response.ok) throw new Error(`Field model HTTP ${response.status}`)
    const bytes = await response.arrayBuffer(); if (disposed) return
    const gltf = await loader.parseAsync(bytes, '/models/fields/')
    if (disposed) { disposeForeign(gltf.scene); return }
    recolorTemplate(gltf.scene, file); templates.set(file, gltf.scene)
  })).then(() => { if (!disposed) { loaded = true; if (latest) update(latest.fields, latest.selectedId, latest.overview, latest.roof); callbacks.onReady(); requestRender() } }).catch(() => { if (!disposed) callbacks.onFailure('models') })
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2()
  let pointerStart: { x: number; y: number } | null = null
  const pointerDown = (event: PointerEvent): void => { pointerStart = { x: event.clientX, y: event.clientY } }
  const pointerUp = (event: PointerEvent): void => {
    if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 7) { pointerStart = null; return }
    pointerStart = null; if (!latest?.overview) return
    const rect = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    for (const hit of raycaster.intersectObject(plotRoot, true)) { let node: THREE.Object3D | null = hit.object; while (node && !node.userData.fieldId) node = node.parent; if (node?.userData.fieldId) { callbacks.onSelect(String(node.userData.fieldId)); return } }
  }
  const resize = (): void => { if (!disposed) { renderer.setSize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1), false); resetCamera() } }
  const observer = new ResizeObserver(resize); observer.observe(host)
  const visible = (): void => { if (!document.hidden) requestRender() }
  const contextLost = (event: Event): void => { event.preventDefault(); if (!disposed) callbacks.onFailure('context') }
  renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp); renderer.domElement.addEventListener('webglcontextlost', contextLost)
  document.addEventListener('visibilitychange', visible); controls.addEventListener('change', requestRender); resize()
  return {
    update, resetCamera,
    zoom: factor => { camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, controls.minZoom, controls.maxZoom); camera.updateProjectionMatrix(); requestRender() },
    dispose: () => {
      disposed = true; abort.abort(); observer.disconnect(); cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', visible); renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp); renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      controls.removeEventListener('change', requestRender); controls.dispose(); for (const id of farms.keys()) removeFarm(id)
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose())
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); templates.clear(); scene.clear()
    },
  }
}
