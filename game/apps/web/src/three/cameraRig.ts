import * as THREE from 'three'

/**
 * Изо-камера с панорамированием (2026-10-18, решение пользователя «iso90»).
 *
 * Прежний OrbitControls умел только вращаться вокруг центра при перетаскивании,
 * из-за чего сцена читалась как «крутящийся стол». Здесь:
 *  - перетаскивание (мышь или один палец) двигает камеру ПО карте, контент
 *    следует за пальцем, цель ограничена границами площадки;
 *  - колесо и щипок двух пальцев — зум ортографической проекции;
 *  - вращение только шагами по 90° (кнопки), с короткой анимацией: кадр всегда
 *    остаётся аккуратным изометрическим, четыре фиксированных ракурса.
 * Рендер по требованию: риг дёргает onRender(), сцены остаются demand-rendered.
 */
export interface CameraRigOptions {
  camera: THREE.OrthographicCamera
  dom: HTMLElement
  /** Смещение камеры от цели при нулевом рыскании — задаёт изо-ракурс. */
  offset: [number, number, number]
  /** Границы панорамирования цели по земле, ± по X/Z. */
  bounds: { x: number; z: number }
  minZoom: number
  maxZoom: number
  target?: [number, number, number]
  initialZoom?: number
  onRender: () => void
  reducedMotion?: boolean
}

export interface CameraRig {
  /** Пересчитать позицию/ориентацию камеры из текущей цели и рыскания. */
  apply: () => void
  /** Домой: начальная цель, нулевой рыск, начальный зум. */
  reset: () => void
  zoomBy: (factor: number) => void
  rotateStep: (direction: 1 | -1) => void
  setOffset: (offset: [number, number, number]) => void
  setBounds: (bounds: { x: number; z: number }) => void
  dispose: () => void
}

const EASE = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export function createCameraRig(options: CameraRigOptions): CameraRig {
  const { camera, dom, onRender } = options
  const previousTouchAction = dom.style.touchAction
  const offset = new THREE.Vector3(...options.offset)
  const home = new THREE.Vector3(...(options.target ?? [0, 0, 0]))
  const target = home.clone()
  const bounds = { ...options.bounds }
  const homeZoom = options.initialZoom ?? 1
  let yaw = 0
  let yawAngle = 0
  let spin = 0
  let yawDestination = 0
  const ground = new THREE.Vector3()
  const right = new THREE.Vector3()
  const pointers = new Map<number, { x: number; y: number }>()
  let pinch = 0

  function apply(): void {
    const cos = Math.cos(yawAngle), sin = Math.sin(yawAngle)
    camera.position.set(
      target.x + offset.x * cos + offset.z * sin,
      target.y + offset.y,
      target.z - offset.x * sin + offset.z * cos,
    )
    camera.lookAt(target)
    camera.updateMatrixWorld(true)
    dom.dataset.yaw = String(yaw)
  }

  function zoomBy(factor: number): void {
    const next = THREE.MathUtils.clamp(camera.zoom * factor, options.minZoom, options.maxZoom)
    if (Math.abs(next - camera.zoom) < 1e-4) return
    camera.zoom = next
    camera.updateProjectionMatrix()
    onRender()
  }

  /** Панорама: контент следует за пальцем, цель не выходит за границы площадки. */
  function pan(dx: number, dy: number): void {
    const rect = dom.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const worldPerPx = (camera.right - camera.left) / camera.zoom / rect.width
    ground.set(target.x - camera.position.x, 0, target.z - camera.position.z)
    if (ground.lengthSq() < 1e-8) ground.set(0, 0, -1)
    ground.normalize()
    right.set(-ground.z, 0, ground.x)
    target.addScaledVector(right, -dx * worldPerPx).addScaledVector(ground, dy * worldPerPx)
    target.x = THREE.MathUtils.clamp(target.x, -bounds.x, bounds.x)
    target.z = THREE.MathUtils.clamp(target.z, -bounds.z, bounds.z)
    apply()
    onRender()
  }

  function pinchDistance(): number {
    const [a, b] = [...pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 2) pinch = pinchDistance()
    try { dom.setPointerCapture(event.pointerId) } catch { /* pointer already gone */ }
  }
  const onMove = (event: PointerEvent): void => {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    const current = { x: event.clientX, y: event.clientY }
    if (pointers.size === 1) {
      pointers.set(event.pointerId, current)
      pan(current.x - previous.x, current.y - previous.y)
      return
    }
    pointers.set(event.pointerId, current)
    if (pointers.size === 2) {
      const next = pinchDistance()
      if (pinch > 4 && next > 4) zoomBy(next / pinch)
      pinch = next
    }
  }
  const onUp = (event: PointerEvent): void => {
    pointers.delete(event.pointerId)
    pinch = 0
    if (dom.hasPointerCapture(event.pointerId)) dom.releasePointerCapture(event.pointerId)
  }
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    zoomBy(Math.exp(-event.deltaY * 0.0013))
  }

  function rotateStep(direction: 1 | -1): void {
    cancelAnimationFrame(spin)
    const from = yawAngle
    yawDestination += direction * Math.PI / 2
    const to = yawDestination
    yaw = ((yaw + direction) % 4 + 4) % 4
    if (options.reducedMotion) {
      yawAngle = to
      apply()
      onRender()
      spin = 0
      return
    }
    const started = performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / 240)
      yawAngle = from + (to - from) * EASE(t)
      apply()
      onRender()
      spin = t < 1 ? requestAnimationFrame(step) : 0
    }
    spin = requestAnimationFrame(step)
  }

  function reset(): void {
    cancelAnimationFrame(spin)
    spin = 0
    target.copy(home)
    yaw = 0
    yawAngle = 0
    yawDestination = 0
    camera.zoom = homeZoom
    camera.updateProjectionMatrix()
    apply()
    onRender()
  }

  dom.style.touchAction = 'none'
  dom.addEventListener('pointerdown', onDown)
  dom.addEventListener('pointermove', onMove)
  dom.addEventListener('pointerup', onUp)
  dom.addEventListener('pointercancel', onUp)
  dom.addEventListener('lostpointercapture', onUp)
  dom.addEventListener('wheel', onWheel, { passive: false })
  apply()

  return {
    apply,
    reset,
    zoomBy,
    rotateStep,
    setOffset: next => { offset.set(...next); apply(); onRender() },
    setBounds: next => { bounds.x = next.x; bounds.z = next.z },
    dispose: () => {
      cancelAnimationFrame(spin)
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointermove', onMove)
      dom.removeEventListener('pointerup', onUp)
      dom.removeEventListener('pointercancel', onUp)
      dom.removeEventListener('lostpointercapture', onUp)
      for (const key of pointers.keys()) if (dom.hasPointerCapture(key)) dom.releasePointerCapture(key)
      pointers.clear()
      dom.style.touchAction = previousTouchAction
      dom.removeEventListener('wheel', onWheel)
    },
  }
}
