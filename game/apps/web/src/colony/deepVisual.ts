import type { ColonyWorld } from './deep/world'
import type { CropStage } from './deep/growth'
import { batchStage } from './deep/growth'
import { o2PartialKpa, co2PartialKpa, totalPressureKpa } from './deep/sections'
import { DEEP_P } from './deep/params'
import { COLONY_CELL_METRES, COLONY_GRID_SIZE } from './layout'

/**
 * Перевод состояния глубокого мира в то, что можно нарисовать. Здесь нет ni
 * three.js, ни DOM: функция чистая, поэтому её можно проверить тестом без
 * WebGL, а сцена только потребляет готовый результат.
 *
 * Ничего не выдумывается: положение машины берётся из её собственного плеча
 * (`travelledKm / legKm`), состояние секции — из масс газов, стадия грядки —
 * из накопленного развития.
 */

/** Узел «база»: то, к чему привязаны рейсы. */
export const BASE_NODE = 'base'

export interface Vec2 { x: number; z: number }

export type VehicleState = 'driving' | 'loading' | 'unloading' | 'idle' | 'stalled'

export interface VehicleVisual {
  id: string
  position: Vec2
  /** Направление движения, радианы. Для стоящей машины — прежний курс. */
  heading: number
  state: VehicleState
  cargoKg: number
  capacityKg: number
  /** Заполненность кузова 0…1: сколько везём относительно вместимости. */
  fill: number
}

export interface FaultVisual {
  deviceId: string
  moduleId: string | null
  severity: 'warning' | 'critical'
  condition: number
  code: string
}

export interface SectionVisual {
  id: string
  moduleId: string | null
  state: 'ok' | 'watch' | 'critical'
  o2Kpa: number
  co2Kpa: number
  pressureKpa: number
}

export interface BedVisual {
  moduleId: string
  bedIndex: number
  stage: CropStage
  /** Накопленное развитие 0…1. */
  development: number
  /** Состояние растений 0…1. */
  health: number
  /** Невозвратимая потеря урожая 0…1. */
  penalty: number
}

export interface DeepVisual {
  vehicles: VehicleVisual[]
  faults: FaultVisual[]
  sections: SectionVisual[]
  beds: BedVisual[]
}

export const EMPTY_VISUAL: DeepVisual = { vehicles: [], faults: [], sections: [], beds: [] }

/** Клетка сетки колонии → мировая точка центра клетки. */
export const cellWorld = (x: number, z: number): Vec2 => ({
  x: (x + 0.5 - COLONY_GRID_SIZE / 2) * COLONY_CELL_METRES,
  z: (z + 0.5 - COLONY_GRID_SIZE / 2) * COLONY_CELL_METRES,
})

/**
 * Точка узла рейса. Месторождения лежат на той же сетке, что и модули,
 * поэтому масштаб один — машина не телепортируется между двумя системами
 * координат.
 */
export function nodePosition(world: ColonyWorld, node: string, base: Vec2): Vec2 {
  if (node === BASE_NODE) return base
  const deposit = world.deposits.find(d => d.id === node)
  return deposit ? cellWorld(deposit.x, deposit.z) : base
}

const headingOf = (from: Vec2, to: Vec2, fallback: number): number => {
  const dx = to.x - from.x, dz = to.z - from.z
  return Math.hypot(dx, dz) < 1e-6 ? fallback : Math.atan2(dx, dz)
}

function vehicleVisuals(world: ColonyWorld, base: Vec2): VehicleVisual[] {
  return world.vehicles.map(vehicle => {
    const from = nodePosition(world, vehicle.at, base)
    const job = world.haulJobs.find(j => j.vehicleId === vehicle.id) ?? null
    const moving = vehicle.destination !== null && vehicle.legKm > 0

    let position = from
    let heading = 0
    if (moving && vehicle.destination) {
      const to = nodePosition(world, vehicle.destination, base)
      const share = Math.max(0, Math.min(1, vehicle.travelledKm / vehicle.legKm))
      position = { x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share }
      heading = headingOf(from, to, 0)
    }

    const state: VehicleState = vehicle.fault ? 'stalled'
      : moving ? 'driving'
        : job?.phase === 'loading' ? 'loading'
          : job?.phase === 'unloading' ? 'unloading'
            : 'idle'

    return {
      id: vehicle.id, position, heading, state,
      cargoKg: vehicle.payloadKg, capacityKg: vehicle.capacityKg,
      fill: vehicle.capacityKg > 0 ? Math.max(0, Math.min(1, vehicle.payloadKg / vehicle.capacityKg)) : 0,
    }
  })
}

function faultVisuals(world: ColonyWorld): FaultVisual[] {
  const out: FaultVisual[] = []
  for (const device of world.devices) {
    const critical = device.fault !== null || device.condition < 0.35
    if (!critical && device.condition >= 0.6) continue
    out.push({
      deviceId: device.id,
      moduleId: device.legacyModuleId ?? null,
      severity: critical ? 'critical' : 'warning',
      condition: device.condition,
      code: device.fault?.code ?? 'wear',
    })
  }
  return out
}

function sectionVisuals(world: ColonyWorld): SectionVisual[] {
  return world.sections.map(section => {
    const o2 = o2PartialKpa(section)
    const co2 = co2PartialKpa(section)
    // Порог «внимание» — halfway между минимумом и нормой: секция должна
    // показать проблему до того, как станет критично.
    const watchO2 = (DEEP_P.minO2PartialKpa + DEEP_P.nominalPressureKpa * 0.3) / 2
    const critical = o2 < DEEP_P.minO2PartialKpa || co2 > DEEP_P.maxCo2PartialKpa
    const watch = !critical && (o2 < watchO2 || co2 > DEEP_P.maxCo2PartialKpa * 0.7)
    return {
      id: section.id,
      moduleId: world.devices.find(d => d.id === section.deviceId)?.legacyModuleId ?? null,
      state: critical ? 'critical' : watch ? 'watch' : 'ok',
      o2Kpa: o2, co2Kpa: co2, pressureKpa: totalPressureKpa(section),
    }
  })
}

function bedVisuals(world: ColonyWorld): BedVisual[] {
  return world.batches.map(batch => ({
    moduleId: batch.greenhouseId,
    bedIndex: batch.bedIndex,
    stage: batchStage(batch),
    development: Math.max(0, Math.min(1, batch.development)),
    health: Math.max(0, Math.min(1, batch.health)),
    penalty: Math.max(0, Math.min(1, batch.yieldPenalty)),
  }))
}

/** Базовый узел: геометрический центр модулей, чтобы рейсы шли к постройкам. */
export function basePosition(placements: readonly Vec2[]): Vec2 {
  if (placements.length === 0) return { x: 0, z: 0 }
  const sum = placements.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 })
  return { x: sum.x / placements.length, z: sum.z / placements.length }
}

export function deepVisualState(world: ColonyWorld | null | undefined, base: Vec2 = { x: 0, z: 0 }): DeepVisual {
  if (!world) return EMPTY_VISUAL
  return {
    vehicles: vehicleVisuals(world, base),
    faults: faultVisuals(world),
    sections: sectionVisuals(world),
    beds: bedVisuals(world),
  }
}
