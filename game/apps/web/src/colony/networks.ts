import type { ColonyModule, ColonyState, ModuleKind } from './simulation'
import { COLONY_GRID_SIZE, footprint, modulePlacement, type Placement } from './layout'

export const NETWORK_TYPES = ['power', 'water', 'return', 'tunnel'] as const
export type NetworkType = typeof NETWORK_TYPES[number]
export interface Cell { x: number; z: number }
export interface ColonyNetwork { id: string; type: NetworkType; from: string; to: string; cells: Cell[] }
export const NETWORK_CREDITS_PER_CELL: Record<NetworkType, number> = { power: 1, water: 2, return: 2, tunnel: 4 }
const NETWORK_LIMIT = 1024
export const NETWORK_COLORS: Record<NetworkType, string> = { power: '#e5ba55', water: '#67c3da', return: '#b38cbd', tunnel: '#b2baa6' }
const key = (p: Cell): number => p.z * COLONY_GRID_SIZE + p.x
const inside = (p: Cell): boolean => Number.isInteger(p.x) && Number.isInteger(p.z) && p.x >= 0 && p.z >= 0 && p.x < 48 && p.z < 48
const same = (a: Cell, b: Cell): boolean => a.x === b.x && a.z === b.z
export function supportsNetwork(kind: ModuleKind, type: NetworkType): boolean {
  // Водяная и возвратная сети — там, где вода реально проходит: жильё,
  // теплицы, регенерация, очистка и лаборатория. Добытчик стоит на
  // месторождении за пределами базы, поэтому в водяной контур не входит.
  if (type === 'power') return true
  if (type === 'tunnel') return !['solar', 'battery', 'rover', 'extractor'].includes(kind)
  return ['habitat', 'greenhouse', 'recycler', 'purifier', 'lab'].includes(kind)
}
export function ports(m: ColonyModule, type: NetworkType): Cell[] {
  if (!supportsNetwork(m.kind, type)) return []
  const p = modulePlacement(m), [w, d] = footprint(m.kind, p.rotation)
  return [{ x: p.x + Math.floor(w / 2), z: p.z - 1 }, { x: p.x + w, z: p.z + Math.floor(d / 2) },
    { x: p.x + Math.floor(w / 2), z: p.z + d }, { x: p.x - 1, z: p.z + Math.floor(d / 2) }].filter(inside)
}
function blockedCells(modules: readonly ColonyModule[]): Set<number> {
  const blocked = new Set<number>()
  for (const m of modules) {
    const p = modulePlacement(m), [w, d] = footprint(m.kind, p.rotation)
    for (let x = p.x; x < p.x + w; x++) for (let z = p.z; z < p.z + d; z++) blocked.add(key({ x, z }))
  }
  return blocked
}
/** Multi-source BFS chooses ports and shortest orthogonal route around buildings.
 * Crossings are separate utility layers, NOT implicit graph junctions.
 */
function route(starts: Cell[], ends: Cell[], blocked: Set<number>): Cell[] | null {
  const goals = new Set(ends.map(key)), previous = new Map<number, number>(), cells = new Map<number, Cell>(), queue: Cell[] = []
  for (const p of starts) if (!blocked.has(key(p))) { previous.set(key(p), -1); cells.set(key(p), p); queue.push(p) }
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head], k = key(p)
    if (goals.has(k)) {
      const path: Cell[] = []
      for (let at = k; at !== -1; at = previous.get(at)!) path.push({ ...cells.get(at)! })
      return path.reverse()
    }
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const next = { x: p.x + dx, z: p.z + dz }, nk = key(next)
      if (!inside(next) || blocked.has(nk) || previous.has(nk)) continue
      previous.set(nk, k); cells.set(nk, next); queue.push(next)
    }
  }
  return null
}
export function networkCost(network: Pick<ColonyNetwork, 'type' | 'cells'>): number {
  return Math.max(1, network.cells.length - 1) * NETWORK_CREDITS_PER_CELL[network.type]
}
export function planNetwork(state: { modules: readonly ColonyModule[] }, type: NetworkType, from: string, to: string, via?: Cell): ColonyNetwork | null {
  if (!NETWORK_TYPES.includes(type) || from === to) return null
  const a = state.modules.find(m => m.id === from), b = state.modules.find(m => m.id === to)
  if (!a || !b) return null
  const starts = ports(a, type), ends = ports(b, type), blocked = blockedCells(state.modules)
  if (!starts.length || !ends.length || (via && (!inside(via) || blocked.has(key(via))))) return null
  let cells: Cell[] | null
  if (via) {
    const first = route(starts, [via], blocked)
    const last = first ? route([via], ends, new Set([...blocked, ...first.slice(0, -1).map(key)])) : null
    cells = first && last ? [...first, ...last.slice(1)] : null
  } else cells = route(starts, ends, blocked)
  if (!cells || cells.length > 300 || new Set(cells.map(key)).size !== cells.length) return null
  return { id: '', type, from, to, cells }
}
function checkNetwork(modules: readonly ColonyModule[], n: ColonyNetwork, blocked: Set<number>, byId?: ReadonlyMap<string, ColonyModule>): boolean {
  if (!NETWORK_TYPES.includes(n.type) || n.from === n.to || !n.cells.length || n.cells.length > 300) return false
  const a = byId ? byId.get(n.from) : modules.find(m => m.id === n.from), b = byId ? byId.get(n.to) : modules.find(m => m.id === n.to)
  if (!a || !b || !ports(a, n.type).some(p => same(p, n.cells[0])) || !ports(b, n.type).some(p => same(p, n.cells[n.cells.length - 1]))) return false
  return new Set(n.cells.map(key)).size === n.cells.length && n.cells.every((p, i) => inside(p) && !blocked.has(key(p))
    && (i === 0 || Math.abs(p.x - n.cells[i - 1].x) + Math.abs(p.z - n.cells[i - 1].z) === 1))
}
export function validNetwork(modules: readonly ColonyModule[], n: ColonyNetwork): boolean {
  return checkNetwork(modules, n, blockedCells(modules))
}
export function addNetwork(state: ColonyState, n: ColonyNetwork): ColonyState {
  const networks = state.networks ?? starterNetworks(state.modules)
  if (!validNetwork(state.modules, n) || networks.length >= NETWORK_LIMIT || state.credits < networkCost(n)
    || networks.some(x => x.type === n.type && ((x.from === n.from && x.to === n.to) || (x.from === n.to && x.to === n.from)))) return state
  let suffix = 1
  while (networks.some(x => x.id === `net-${suffix}`)) suffix++
  const cost = networkCost(n)
  return { ...state, networks: [...networks, { ...n, id: `net-${suffix}`, cells: n.cells.map(p => ({ ...p })) }],
    credits: state.credits - cost, spentCredits: state.spentCredits + cost }
}
export function removeNetwork(state: ColonyState, id: string): ColonyState {
  const networks = state.networks ?? starterNetworks(state.modules)
  return networks.some(n => n.id === id) ? { ...state, networks: networks.filter(n => n.id !== id) } : state
}
/** Included starter infrastructure, not a gift of spendable CR. No demolition refunds. */
export function starterNetworks(modules: readonly ColonyModule[]): ColonyNetwork[] {
  const hub = modules.find(m => m.kind === 'habitat'), recycler = modules.find(m => m.kind === 'recycler')
  const networks: ColonyNetwork[] = []
  if (!hub) return networks
  for (const m of modules) for (const type of NETWORK_TYPES) {
    const source = type === 'water' || type === 'return' ? recycler : hub
    if (!source || source.id === m.id || !supportsNetwork(m.kind, type)) continue
    const n = planNetwork({ modules }, type, source.id, m.id)
    if (n) networks.push({ ...n, id: `starter-${networks.length + 1}` })
  }
  return networks
}
/** One migration view shared by the simulation, plan and 3D renderer. */
export function networksOf(state: Pick<ColonyState, 'modules' | 'networks'>): ColonyNetwork[] {
  return state.networks ?? starterNetworks(state.modules)
}
export function placementHitsNetwork(state: ColonyState, kind: ModuleKind, at: Placement, movingId?: string): boolean {
  const [w, d] = footprint(kind, at.rotation)
  return networksOf(state).some(n => n.from !== movingId && n.to !== movingId && n.cells.some(c => c.x >= at.x && c.x < at.x + w && c.z >= at.z && c.z < at.z + d))
}
/**
 * Пропускная способность одного канала, кВт.
 *
 * Кабель тем слабее, чем он длиннее: падение напряжения ограничивает
 * передаваемую мощность. Это не украшение — именно из-за этого далёкий модуль
 * получает меньше, даже когда на базе избыток генерации, и у игрока появляется
 * настоящий выбор: ставить компактно или тянуть вторую линию.
 *
 * Модель агрегированная (§7 «документировать агрегацию против гидравлики»),
 * не расчёт цепи: гиперболический спад, при `derateCells` канал теряет
 * половину ёмкости.
 */
export const linkCapacityKw = (cells: number, capacityKw: number, derateCells: number): number => {
  const d = Math.max(1e-6, derateCells)
  return capacityKw * d / (d + Math.max(0, cells))
}

/**
 * Сколько мощности может дойти до каждого модуля: сумма ёмкостей всех его
 * годных силовых линий. Две линии — вдвое больше, поэтому избыточная
 * прокладка кабеля действительно работает.
 */
export function modulePowerCapacityKw(
  state: Pick<ColonyState, 'modules' | 'networks'>,
  capacityKw: number,
  derateCells: number,
): Map<string, number> {
  const result = new Map<string, number>()
  const blocked = blockedCells(state.modules)
  const byId = new Map(state.modules.map(m => [m.id, m]))
  for (const n of networksOf(state)) {
    if (n.type !== 'power') continue
    if (!checkNetwork(state.modules, n, blocked, byId)) continue
    const kw = linkCapacityKw(n.cells.length, capacityKw, derateCells)
    for (const end of [n.from, n.to]) result.set(end, (result.get(end) ?? 0) + kw)
  }
  return result
}

export interface ModuleServices { power: boolean; water: boolean; return: boolean; access: boolean }
/** One base utility backbone, anchored at the first habitat. Separate autonomous
 * districts are not simulated. Reachability is by explicit, currently valid edges.
 */
export function networkServices(state: ColonyState): Map<string, ModuleServices> {
  const result = new Map<string, ModuleServices>()
  const blocked = blockedCells(state.modules)
  const byId = new Map(state.modules.map(m => [m.id, m]))
  const adjacency = new Map<NetworkType, Map<string, string[]>>(NETWORK_TYPES.map(t => [t, new Map()]))
  for (const n of networksOf(state)) {
    if (!checkNetwork(state.modules, n, blocked, byId)) continue
    const graph = adjacency.get(n.type)!
    for (const [from, to] of [[n.from, n.to], [n.to, n.from]]) {
      const neighbours = graph.get(from) ?? []; neighbours.push(to); graph.set(from, neighbours)
    }
  }
  function reach(type: NetworkType, seeds: string[]): Set<string> {
    const seen = new Set(seeds), queue = [...seeds]
    const graph = adjacency.get(type)!
    for (let i = 0; i < queue.length; i++) for (const next of graph.get(queue[i]) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next) }
    }
    return seen
  }
  const hub = state.modules.find(m => m.kind === 'habitat')
  const power = reach('power', hub ? [hub.id] : [])
  const sources = state.modules.filter(m => m.kind === 'recycler' && power.has(m.id)).map(m => m.id)
  const water = reach('water', sources), returned = reach('return', sources), access = reach('tunnel', hub ? [hub.id] : [])
  for (const m of state.modules) result.set(m.id, { power: power.has(m.id), water: water.has(m.id), return: returned.has(m.id), access: access.has(m.id) })
  return result
}


/** Per-consumer, single-entry topology cache. Crops/wear/stocks don't change
 * connectivity. Structural keys are recomputed so even in-place route edits
 * cannot reuse stale services. No global retention or persistence.
 */
export function createNetworkServiceReader(): {
  read(state: ColonyState): ReadonlyMap<string, ModuleServices>
  clear(): void
  rebuilds(): number
} {
  let stamp = '', services: ReadonlyMap<string, ModuleServices> = new Map(), rebuilds = 0
  return {
    read: state => {
      const next = JSON.stringify([state.modules.map(m => [m.id, m.kind, modulePlacement(m)]), state.networks ?? null])
      if (next !== stamp) { services = networkServices(state); stamp = next; rebuilds++ }
      return services
    },
    clear: () => { stamp = ''; services = new Map() },
    rebuilds: () => rebuilds,
  }
}
