/**
 * Единый склад колонии: одна таблица запасов, одни единицы, один владелец записи.
 *
 * Правила:
 *  - запас never < 0 и never > cap; излишек при переполнении НЕ исчезает молча —
 *    он возвращается вызывающему как `overflow`, и вызывающий решает (остановка, потеря, отказ);
 *  - `reserved` — уже обещанные работам материалы. Повторно зарезервировать их нельзя;
 *  - взятие (`stockTake`) ограничено НЕЗАРЕЗЕРВИРОВАННЫМ остатком;
 *  - функции мутируют переданный склад: мир клонируется один раз за шаг,
 *    внутри шага допускается изменяемое состояние (это же делает код читаемым).
 */
import { clamp01 } from './units'

export type ResourceId =
  | 'water_raw' | 'water_clean' | 'water_grey' | 'brine' | 'solution'
  | 'o2' | 'co2'
  | 'ice_ore' | 'tailings'
  | 'sludge' | 'biomass' | 'food_waste' | 'compost'
  | 'nutrient_n' | 'nutrient_p' | 'nutrient_k'
  | 'filters' | 'parts' | 'packaging' | 'reagents'
  | 'seed_potato' | 'ware_potato' | 'cull_potato'

export type StorageKind = 'tank' | 'gas' | 'bin' | 'shelf' | 'rack'

export interface ResourceSpec {
  id: ResourceId
  unit: 'L' | 'kg' | 'pcs'
  group: 'water' | 'gas' | 'crop' | 'soil' | 'waste' | 'consumable'
  storage: StorageKind
  /** Целые единицы (детали, фильтры, упаковка): округление только вниз. */
  discrete?: boolean
  /** Требует холодного/вентилируемого хранилища, иначе быстрее портится. */
  cold?: boolean
  ru: string
  en: string
  /** Краткое описание для документации и подсказок. */
  note: string
}

export const RESOURCES: Record<ResourceId, ResourceSpec> = {
  water_raw: { id: 'water_raw', unit: 'L', group: 'water', storage: 'tank', ru: 'Неочищенная вода', en: 'Raw water', note: 'Извлечена из породы, не пригодна напрямую.' },
  water_clean: { id: 'water_clean', unit: 'L', group: 'water', storage: 'tank', ru: 'Очищенная вода', en: 'Clean water', note: 'Единый запас базы: питьё, техника, раствор.' },
  water_grey: { id: 'water_grey', unit: 'L', group: 'water', storage: 'tank', ru: 'Стоки', en: 'Grey water', note: 'Собрана после душа, мойки, выходов.' },
  brine: { id: 'brine', unit: 'L', group: 'water', storage: 'tank', ru: 'Концентрат', en: 'Brine', note: 'Остаток очистки; требует отдельной переработки.' },
  solution: { id: 'solution', unit: 'L', group: 'water', storage: 'tank', ru: 'Питательный раствор', en: 'Nutrient solution', note: 'Вода + N/P/K; подаётся в грядки.' },
  o2: { id: 'o2', unit: 'kg', group: 'gas', storage: 'gas', ru: 'Кислород', en: 'Oxygen', note: 'Запас дыхательной атмосферы.' },
  co2: { id: 'co2', unit: 'kg', group: 'gas', storage: 'gas', ru: 'CO₂', en: 'Carbon dioxide', note: 'Удалён скруббером; частично идёт в теплицы.' },
  ice_ore: { id: 'ice_ore', unit: 'kg', group: 'soil', storage: 'bin', ru: 'Льдосодержащая порода', en: 'Icy regolith', note: 'Добытое сырьё; вода ещё не извлечена.' },
  tailings: { id: 'tailings', unit: 'kg', group: 'waste', storage: 'bin', ru: 'Отвал', en: 'Tailings', note: 'Порода после извлечения воды.' },
  sludge: { id: 'sludge', unit: 'kg', group: 'waste', storage: 'bin', ru: 'Шлам', en: 'Sludge', note: 'Остаток регенерации стоков.' },
  biomass: { id: 'biomass', unit: 'kg', group: 'crop', storage: 'bin', ru: 'Растительные остатки', en: 'Plant residue', note: 'Ботва и отходы сортировки → компост.' },
  food_waste: { id: 'food_waste', unit: 'kg', group: 'waste', storage: 'bin', ru: 'Испорченная еда', en: 'Spoiled food', note: 'Потери хранения; частично компостируется.' },
  compost: { id: 'compost', unit: 'kg', group: 'soil', storage: 'bin', ru: 'Компост', en: 'Compost', note: 'Возвращает часть питательных элементов.' },
  nutrient_n: { id: 'nutrient_n', unit: 'kg', group: 'consumable', storage: 'rack', ru: 'Азот (N)', en: 'Nitrogen (N)', note: 'Привозное удобрение, частично из компоста.' },
  nutrient_p: { id: 'nutrient_p', unit: 'kg', group: 'consumable', storage: 'rack', ru: 'Фосфор (P)', en: 'Phosphorus (P)', note: 'Привозное удобрение, частично из компоста.' },
  nutrient_k: { id: 'nutrient_k', unit: 'kg', group: 'consumable', storage: 'rack', ru: 'Калий (K)', en: 'Potassium (K)', note: 'Привозное удобрение, частично из компоста.' },
  filters: { id: 'filters', unit: 'pcs', group: 'consumable', storage: 'shelf', discrete: true, ru: 'Фильтры', en: 'Filters', note: 'Расходник очистки и регенерации.' },
  parts: { id: 'parts', unit: 'pcs', group: 'consumable', storage: 'shelf', discrete: true, ru: 'Запчасти', en: 'Spare parts', note: 'Ремонт и стройка; 1 шт = 1 кг в учёте основной колонии.' },
  packaging: { id: 'packaging', unit: 'pcs', group: 'consumable', storage: 'shelf', discrete: true, ru: 'Упаковка', en: 'Packaging', note: 'Нужна для сдачи контракта.' },
  reagents: { id: 'reagents', unit: 'pcs', group: 'consumable', storage: 'shelf', discrete: true, ru: 'Реагенты', en: 'Reagents', note: 'Расходник лабораторных анализов.' },
  seed_potato: { id: 'seed_potato', unit: 'kg', group: 'crop', storage: 'bin', cold: true, ru: 'Семенной картофель', en: 'Seed potato', note: 'Физический ограниченный ресурс посадки.' },
  ware_potato: { id: 'ware_potato', unit: 'kg', group: 'crop', storage: 'bin', cold: true, ru: 'Товарная партия', en: 'Ware potato', note: 'Основная съедобная доля урожая: идёт в еду, излишек — в контракт.' },
  cull_potato: { id: 'cull_potato', unit: 'kg', group: 'crop', storage: 'bin', ru: 'Некондиция', en: 'Cull potato', note: 'Мелкие и битые клубни: в семена не годятся, но в еду идут вместе с товарной долей.' },
}

export const RESOURCE_IDS = Object.keys(RESOURCES) as ResourceId[]

export interface Stock {
  amount: Record<ResourceId, number>
  cap: Record<ResourceId, number>
  reserved: Record<ResourceId, number>
}

export interface FlowResult {
  /** Сколько реально поступило. */
  added: number
  /** Сколько реально взято. */
  taken: number
  /** Не поместилось в хранилище — вызывающий решает, потеря это или остановка. */
  overflow: number
  /** Запрошено больше, чем доступно. */
  shortage: number
}

const ZERO: FlowResult = { added: 0, taken: 0, overflow: 0, shortage: 0 }

export function emptyStock(cap: Partial<Record<ResourceId, number>> = {}): Stock {
  const amount = {} as Record<ResourceId, number>
  const caps = {} as Record<ResourceId, number>
  const reserved = {} as Record<ResourceId, number>
  for (const id of RESOURCE_IDS) {
    amount[id] = 0
    reserved[id] = 0
    caps[id] = Math.max(0, cap[id] ?? 0)
  }
  return { amount, cap: caps, reserved }
}

export const stockOf = (s: Stock, id: ResourceId): number => s.amount[id] ?? 0
export const reservedOf = (s: Stock, id: ResourceId): number => s.reserved[id] ?? 0
export const capOf = (s: Stock, id: ResourceId): number => s.cap[id] ?? 0
/** Доступно для новых работ: запас минус уже зарезервированное. */
export const availableOf = (s: Stock, id: ResourceId): number => Math.max(0, stockOf(s, id) - reservedOf(s, id))
export const roomOf = (s: Stock, id: ResourceId): number => Math.max(0, capOf(s, id) - stockOf(s, id))

const discrete = (id: ResourceId, value: number): number => (RESOURCES[id].discrete ? Math.floor(value) : value)

/** Положить на склад. Возвращает, сколько вошло и сколько не поместилось. */
export function stockAdd(s: Stock, id: ResourceId, amount: number): FlowResult {
  if (!Number.isFinite(amount) || amount <= 0) return { ...ZERO }
  const value = discrete(id, amount)
  if (value <= 0) return { ...ZERO }
  const room = roomOf(s, id)
  const added = Math.min(room, value)
  s.amount[id] = stockOf(s, id) + added
  return { ...ZERO, added, overflow: value - added }
}

/** Взять со склада. Не трогает зарезервированное. */
export function stockTake(s: Stock, id: ResourceId, amount: number): FlowResult {
  if (!Number.isFinite(amount) || amount <= 0) return { ...ZERO }
  const value = discrete(id, amount)
  if (value <= 0) return { ...ZERO }
  const free = availableOf(s, id)
  const taken = Math.min(free, value)
  s.amount[id] = stockOf(s, id) - taken
  return { ...ZERO, taken, shortage: value - taken }
}

/** Зарезервировать под работу. Повторное бронирование того же запаса невозможно. */
export function stockReserve(s: Stock, id: ResourceId, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const value = discrete(id, amount)
  const granted = Math.min(value, availableOf(s, id))
  if (granted <= 0) return 0
  s.reserved[id] = reservedOf(s, id) + granted
  return granted
}

/** Списать зарезервированное (материал реально израсходован работой). */
export function stockCommit(s: Stock, id: ResourceId, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const value = Math.min(discrete(id, amount), Math.min(reservedOf(s, id), stockOf(s, id)))
  if (value <= 0) return 0
  s.reserved[id] = reservedOf(s, id) - value
  s.amount[id] = stockOf(s, id) - value
  return value
}

/** Вернуть неиспользованный резерв (отмена/пауза работы). */
export function stockRelease(s: Stock, id: ResourceId, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const value = Math.min(discrete(id, amount), reservedOf(s, id))
  if (value <= 0) return 0
  s.reserved[id] = reservedOf(s, id) - value
  return value
}

/** Переместить между складами без потерь дублирования: берём, сколько вошло. */
export function stockMove(s: Stock, from: ResourceId, to: ResourceId, amount: number): FlowResult {
  const value = Math.min(discrete(from, amount), availableOf(s, from), roomOf(s, to))
  if (!(value > 0)) return { ...ZERO, shortage: Math.max(0, amount) }
  const take = stockTake(s, from, value)
  const add = stockAdd(s, to, take.taken)
  if (add.added < take.taken) stockAdd(s, from, take.taken - add.added)
  return { added: add.added, taken: take.taken, overflow: add.overflow, shortage: take.shortage }
}

/** Доля заполнения (0…1) по заданному ресурсу. */
export const fillRatio = (s: Stock, id: ResourceId): number => {
  const cap = capOf(s, id)
  return cap > 0 ? clamp01(stockOf(s, id) / cap) : 0
}

/** Суммарный запас питательных элементов N+P+K, kg (вид для существующего интерфейса). */
export const nutrientTotal = (s: Stock): number =>
  stockOf(s, 'nutrient_n') + stockOf(s, 'nutrient_p') + stockOf(s, 'nutrient_k')

/** Общий запас картофеля во всех категориях, kg (без учёта еды в хранилище базы). */
export const potatoTotal = (s: Stock): number =>
  stockOf(s, 'seed_potato') + stockOf(s, 'ware_potato') + stockOf(s, 'cull_potato')

/** Установить новую ёмкость; излишек не удаляется, но перестаёт пополняться. */
export function setCapacity(s: Stock, id: ResourceId, cap: number): void {
  s.cap[id] = Math.max(0, Number.isFinite(cap) ? cap : 0)
  s.amount[id] = Math.min(stockOf(s, id), s.cap[id])
}
