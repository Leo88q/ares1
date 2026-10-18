import * as THREE from 'three'
import type { DeepVisual, Vec2 } from './deepVisual'

/**
 * Визуальный слой глубокого мира в 3D-сцене: машины на маршруте, маркеры
 * отказов, состояние секций. Всё рисуется тремя инстансированными мешами, а не
 * отдельными объектами на каждый элемент, — это сохраняет число вызовов
 * отрисовки прежним при росте колонии.
 *
 * Никаких новых моделей и сетевых запросов: используются примитивы. Высота
 * маркеров небольшая, поэтому они не закрывают интерьер теплицы.
 */

const MAX_VEHICLES = 16
const MAX_FAULTS = 48
const MAX_SECTIONS = 48

const COLORS = {
  driving: new THREE.Color('#6fd3d6'),
  working: new THREE.Color('#d9bb62'),
  idle: new THREE.Color('#7f7256'),
  stalled: new THREE.Color('#e05f4a'),
  warning: new THREE.Color('#d9a24a'),
  critical: new THREE.Color('#e05f4a'),
  ok: new THREE.Color('#5f9e6a'),
} as const

export interface DeepOverlay {
  root: THREE.Group
  /** `moduleAt` даёт мировую точку модуля; без неё маркер просто не рисуется. */
  update: (visual: DeepVisual, moduleAt: (moduleId: string) => Vec2 | null) => void
  dispose: () => void
  /** Для диагностики: сколько экземпляров реально записано. */
  counts: () => { vehicles: number; faults: number; sections: number }
}

export function createDeepOverlay(): DeepOverlay {
  const root = new THREE.Group()
  root.name = 'deep-overlay'

  // Общая геометрия на все экземпляры: одна на тип, а не одна на объект.
  const vehicleGeometry = new THREE.BoxGeometry(0.9, 0.5, 1.5)
  const faultGeometry = new THREE.ConeGeometry(0.26, 0.7, 5)
  const sectionGeometry = new THREE.RingGeometry(1.5, 1.85, 24)

  const vehicleMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.15, vertexColors: true })
  const faultMaterial = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1, vertexColors: true, emissiveIntensity: 0.6 })
  const sectionMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, side: THREE.DoubleSide, vertexColors: true, depthWrite: false })

  const vehicles = new THREE.InstancedMesh(vehicleGeometry, vehicleMaterial, MAX_VEHICLES)
  const faults = new THREE.InstancedMesh(faultGeometry, faultMaterial, MAX_FAULTS)
  const sections = new THREE.InstancedMesh(sectionGeometry, sectionMaterial, MAX_SECTIONS)
  for (const mesh of [vehicles, faults, sections]) {
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    root.add(mesh)
  }

  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3(1, 1, 1)
  const position = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  let written = { vehicles: 0, faults: 0, sections: 0 }

  const reset = (mesh: THREE.InstancedMesh): void => { mesh.count = 0 }

  return {
    root,
    update(visual, moduleAt) {
      reset(vehicles); reset(faults); reset(sections)

      for (const vehicle of visual.vehicles) {
        if (vehicles.count >= MAX_VEHICLES) break
        position.set(vehicle.position.x, 0.35, vehicle.position.z)
        quaternion.setFromAxisAngle(up, vehicle.heading)
        matrix.compose(position, quaternion, scale)
        vehicles.setMatrixAt(vehicles.count, matrix)
        vehicles.setColorAt(vehicles.count, vehicle.state === 'stalled' ? COLORS.stalled
          : vehicle.state === 'driving' ? COLORS.driving
            : vehicle.state === 'idle' ? COLORS.idle : COLORS.working)
      }
      vehicles.count = Math.min(visual.vehicles.length, MAX_VEHICLES)
      vehicles.instanceMatrix.needsUpdate = true
      if (vehicles.instanceColor) vehicles.instanceColor.needsUpdate = true

      for (const fault of visual.faults) {
        if (!fault.moduleId) continue
        const at = moduleAt(fault.moduleId)
        if (!at || faults.count >= MAX_FAULTS) continue
        position.set(at.x, 1.85, at.z)
        quaternion.identity()
        matrix.compose(position, quaternion, scale)
        faults.setMatrixAt(faults.count, matrix)
        faults.setColorAt(faults.count, fault.severity === 'critical' ? COLORS.critical : COLORS.warning)
        faults.count++
      }
      faults.instanceMatrix.needsUpdate = true
      if (faults.instanceColor) faults.instanceColor.needsUpdate = true

      for (const section of visual.sections) {
        if (section.state === 'ok' || !section.moduleId) continue
        const at = moduleAt(section.moduleId)
        if (!at || sections.count >= MAX_SECTIONS) continue
        position.set(at.x, 0.06, at.z)
        quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
        matrix.compose(position, quaternion, scale)
        sections.setMatrixAt(sections.count, matrix)
        sections.setColorAt(sections.count, section.state === 'critical' ? COLORS.critical : COLORS.warning)
        sections.count++
      }
      sections.instanceMatrix.needsUpdate = true
      if (sections.instanceColor) sections.instanceColor.needsUpdate = true

      written = { vehicles: vehicles.count, faults: faults.count, sections: sections.count }
    },
    counts: () => ({ ...written }),
    dispose() {
      root.removeFromParent()
      root.clear()
      for (const mesh of [vehicles, faults, sections]) mesh.dispose()
      vehicleGeometry.dispose(); faultGeometry.dispose(); sectionGeometry.dispose()
      vehicleMaterial.dispose(); faultMaterial.dispose(); sectionMaterial.dispose()
      written = { vehicles: 0, faults: 0, sections: 0 }
    },
  }
}
