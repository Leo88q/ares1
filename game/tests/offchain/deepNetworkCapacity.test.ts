import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialColony } from '../../apps/web/src/colony/simulation'
import { linkCapacityKw, modulePowerCapacityKw, starterNetworks } from '../../apps/web/src/colony/networks'
import { dispatchPower } from '../../apps/web/src/colony/deep/power'
import { DEEP_P } from '../../apps/web/src/colony/deep/params'
import type { Device } from '../../apps/web/src/colony/deep/devices'

/**
 * Пропускная способность сети (§7).
 *
 * Генерация уже ограничивала колонию; здесь ограничивает КАНАЛ. Без этих
 * тестов легко получить «ёмкость», которая ни на что не влияет: стартовая
 * раскладка имеет запас, и не заметить, что ограничение не связывает
 * вообще нигде, — проще простого.
 */

const CAP = DEEP_P.powerLinkCapacityKw
const DERATE = DEEP_P.powerLinkDerateCells

test('a cable weakens with distance, and halves at the derate length', () => {
  assert.ok(Math.abs(linkCapacityKw(0, CAP, DERATE) - CAP) < 1e-9, 'zero length is the full cable')
  const half = linkCapacityKw(DERATE, CAP, DERATE)
  assert.ok(Math.abs(half - CAP / 2) < 1e-9, `at ${DERATE} cells a cable must carry half, got ${half}`)
  // Монотонно и никогда не растёт.
  let previous = Infinity
  for (let cells = 0; cells <= 400; cells += 10) {
    const kw = linkCapacityKw(cells, CAP, DERATE)
    assert.ok(kw <= previous + 1e-12, `capacity must not grow with length at ${cells}`)
    assert.ok(kw > 0, 'a very long cable is weak, not negative')
    previous = kw
  }
})

test('a second line really does double the throughput', () => {
  const base = initialColony()
  const before = modulePowerCapacityKw(base, CAP, DERATE)
  const doubled = {
    ...base,
    networks: [...starterNetworks(base.modules), ...starterNetworks(base.modules)],
  }
  const after = modulePowerCapacityKw(doubled, CAP, DERATE)
  let checked = 0
  for (const [id, kw] of before) {
    assert.ok(Math.abs((after.get(id) ?? 0) - kw * 2) < 1e-6,
      `${id}: two lines must carry twice as much (${kw} → ${after.get(id)})`)
    checked++
  }
  assert.ok(checked > 0, 'no module had a power line, so the test proves nothing')
})

test('the starter layout has headroom, so nothing is silently throttled today', () => {
  // Ограничение не должно душить стартовую колонию: самая тяжёлая теплица
  // (4.8 кВт) обязана проходить с запасом.
  const base = initialColony()
  const capacity = modulePowerCapacityKw(base, CAP, DERATE)
  const greenhouses = base.modules.filter(m => m.kind === 'greenhouse')
  assert.ok(greenhouses.length > 0, 'the starter colony must have a greenhouse')
  for (const gh of greenhouses) {
    const kw = capacity.get(gh.id) ?? 0
    assert.ok(kw > 4.8, `a starter greenhouse (4.8 kW) must fit its cable, got ${kw} kW`)
  }
})

test('a device cannot draw more than its cable can carry', () => {
  const device = (id: string, ratedKw: number, legacyModuleId?: string): Device => ({
    id, kind: 'greenhouse', name: id, ratedKw, peakKw: ratedKw, priority: 3, critical: false,
    condition: 1, wear: 0, hoursOperating: 0, hoursSinceService: 0, fault: null,
    enabled: true, safeMode: false, connected: true, duty: 1, powerFraction: 0,
    receivedKw: 0, dust: 0, heatFraction: 0, legacyModuleId,
  } as unknown as Device)
  // Мощности хватает с избытком: ограничить должен только кабель.
  const solar = {
    ...device('solar', 0), kind: 'solar', peakKw: 100, priority: 0,
  } as unknown as Device

  const run = (capacity: Record<string, number> | undefined) =>
    dispatchPower({
      devices: [solar, device('gh', 10, 'mod-gh')],
      hours: 1, solHour: 12, sunHours: 18, weatherFactor: 1,
      criticalReserveFraction: 0,
      networkCapacity: capacity,
    }).shed

  // Канала нет вовсе — агрегат берёт номинал.
  assert.deepEqual(run(undefined), [], 'without a cable limit the device must be served in full')
  // Канал узкий: агрегат не просит больше, чем довезти кабель, поэтому он не
  // попадает в «сброс нагрузки» (он допита́н), но работает на трёх десятках
  // процентов номинала. Именно так ограничение и должно выглядеть: не
  // авария, а тихий недобор мощности — причина будущего стресса культур.
  const throttled = dispatchPower({
    devices: [solar, device('gh', 10, 'mod-gh')],
    hours: 1, solHour: 12, sunHours: 18, weatherFactor: 1,
    criticalReserveFraction: 0,
    networkCapacity: { 'mod-gh': 3 },
  })
  assert.ok(Math.abs((throttled.fractions['gh'] ?? 1) - 0.3) < 1e-6,
    `a 3 kW cable must hold a 10 kW device at 30 %, got ${throttled.fractions['gh']}`)
  // Устройство без модуля (базовая инфраструктура на хабе) каналом не ограничено.
  const hub = dispatchPower({
    devices: [solar, device('purifier', 10)],
    hours: 1, solHour: 12, sunHours: 18, weatherFactor: 1,
    criticalReserveFraction: 0,
    networkCapacity: { 'mod-gh': 0.001 },
  })
  assert.ok((hub.fractions['purifier'] ?? 0) > 0.99,
    'base infrastructure sits on the hub and is not cabled')
})

test('the capacity map is part of the world config, not of the device state', () => {
  // Состояние колонии сравнивают между ходами; новое поле на устройстве
  // ломало бы проверку неизменяемости входа. Поэтому ёмкость живёт в
  // конфигурации, а устройство остаётся прежней формы.
  const base = initialColony()
  const devices = base.world?.devices ?? []
  assert.ok(devices.length > 0, 'the colony must have a deep world')
  for (const device of devices) {
    assert.ok(!('networkKw' in device), `${device.id} must not carry network capacity on itself`)
  }
})
