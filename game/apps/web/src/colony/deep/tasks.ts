/**
 * Единая очередь работ колонии.
 *
 * Одна система на всё: посадка, уход, уборка, отбор проб, анализ, чистка
 * панелей, осмотр, ремонт, добыча, перевозка, переработка/упаковка,
 * разведка и обслуживание.
 *
 * Инварианты (проверяются тестами):
 *  - один человек одновременно назначен не более чем на одну задачу;
 *  - материалы резервируются один раз: повторное бронирование невозможно;
 *  - при отмене/паузе возвращаются только НЕизрасходованные материалы;
 *  - задача без доступа к объекту или без материалов не «висит» молча —
 *    она переходит в `blocked` с явной причиной.
 */
import type { Specialty } from './crew'
import { crewSkill, isIdle, remainingHours, type CrewMember } from './crew'
import type { ResourceId } from './resources'
import { stockCommit, stockRelease, stockReserve } from './resources'
import type { Stock } from './resources'

export type TaskKind =
  | 'plant' | 'tend' | 'harvest' | 'sample' | 'analysis' | 'clean_panels'
  | 'inspect' | 'repair' | 'extract' | 'haul' | 'process' | 'survey' | 'maintain'

export interface TaskMeta {
  kind: TaskKind
  /** Приоритет по умолчанию: меньше = важнее. */
  priority: number
  requires: Specialty | null
  /** Работа снаружи: нужны скафандр, подготовка и расход воды на выход. */
  eva: boolean
  ru: string
  en: string
  /** Что работа производит/изменяет — для журнала причин и последствий. */
  effect: { ru: string; en: string }
}

export const TASK_META: Record<TaskKind, TaskMeta> = {
  plant: { kind: 'plant', priority: 2, requires: 'agronomist', eva: false, ru: 'Посадка', en: 'Planting', effect: { ru: 'грядка засажена семенным картофелем', en: 'bed planted with seed potato' } },
  tend: { kind: 'tend', priority: 4, requires: 'agronomist', eva: false, ru: 'Уход', en: 'Tending', effect: { ru: 'снижен риск запущенности грядок', en: 'neglect risk reduced' } },
  harvest: { kind: 'harvest', priority: 3, requires: 'agronomist', eva: false, ru: 'Сбор урожая', en: 'Harvest', effect: { ru: 'урожай передан на сортировку', en: 'harvest sent to sorting' } },
  sample: { kind: 'sample', priority: 5, requires: 'agronomist', eva: false, ru: 'Отбор пробы', en: 'Sampling', effect: { ru: 'проба доставлена в лабораторию', en: 'sample delivered to the lab' } },
  analysis: { kind: 'analysis', priority: 5, requires: 'agronomist', eva: false, ru: 'Лабораторный анализ', en: 'Lab analysis', effect: { ru: 'выявлено скрытое состояние среды', en: 'hidden condition revealed' } },
  clean_panels: { kind: 'clean_panels', priority: 6, requires: null, eva: true, ru: 'Очистка панелей', en: 'Panel cleaning', effect: { ru: 'восстановлена солнечная генерация', en: 'solar generation restored' } },
  inspect: { kind: 'inspect', priority: 5, requires: 'engineer', eva: false, ru: 'Осмотр', en: 'Inspection', effect: { ru: 'отказ диагностирован', en: 'fault diagnosed' } },
  repair: { kind: 'repair', priority: 1, requires: 'engineer', eva: false, ru: 'Ремонт', en: 'Repair', effect: { ru: 'оборудование возвращено в работу', en: 'equipment returned to service' } },
  extract: { kind: 'extract', priority: 4, requires: 'operator', eva: false, ru: 'Добыча', en: 'Extraction', effect: { ru: 'добыта льдосодержащая порода', en: 'icy regolith mined' } },
  haul: { kind: 'haul', priority: 3, requires: 'operator', eva: false, ru: 'Перевозка', en: 'Haulage', effect: { ru: 'груз доставлен на базу', en: 'cargo delivered to base' } },
  process: { kind: 'process', priority: 4, requires: null, eva: false, ru: 'Переработка и упаковка', en: 'Processing and packing', effect: { ru: 'партия подготовлена к контракту', en: 'batch prepared for contract' } },
  survey: { kind: 'survey', priority: 7, requires: 'operator', eva: true, ru: 'Разведка', en: 'Survey', effect: { ru: 'уточнена оценка месторождения', en: 'deposit estimate refined' } },
  maintain: { kind: 'maintain', priority: 5, requires: 'engineer', eva: false, ru: 'Обслуживание', en: 'Maintenance', effect: { ru: 'снижен риск отказа', en: 'failure risk reduced' } },
}

export type TaskStatus = 'queued' | 'active' | 'blocked' | 'paused' | 'done' | 'cancelled'

export interface TaskMaterial {
  resource: ResourceId
  required: number
  /** Сколько реально зарезервировано. */
  reserved: number
  /** Сколько уже списано работой. */
  consumed: number
}

export interface Task {
  id: string
  kind: TaskKind
  /** Объект работы: устройство, машина, месторождение, партия, секция. */
  targetId: string
  /** Приоритет по умолчанию для вида работ. */
  basePriority: number
  /** Ручной приоритет игрока (меньше = важнее). Перекрывает автоматический. */
  manualPriority: number | null
  status: TaskStatus
  requiredHours: number
  doneHours: number
  assignees: string[]
  /** Сколько человек нужно одновременно (например, погрузка). */
  crewNeeded: number
  requiredSpecialty: Specialty | null
  materials: TaskMaterial[]
  createdSol: number
  startedSol: number | null
  finishedSol: number | null
  /** Явная причина блокировки (показывается игроку). */
  blockReason: string | null
  /** Код причины для локализации/тестов. */
  blockCode: string | null
  /** Создана автоматикой (не игроком). */
  auto: boolean
  /** Регулярная работа: после завершения создаётся заново. */
  recurring: boolean
  /** Работа снаружи (костюм, подготовка, расходники). */
  eva: boolean
  /** Подготовка к выходу завершена. */
  evaReady: boolean
  /** Сколько полезных часов дала задача за всё время (для метрик труда). */
  spentHoursByKind?: Record<string, number>
}

export interface NewTask {
  kind: TaskKind
  targetId: string
  requiredHours: number
  materials?: Array<{ resource: ResourceId; amount: number }>
  crewNeeded?: number
  priority?: number
  manualPriority?: number | null
  auto?: boolean
  recurring?: boolean
  sol: number
}

export function createTask(id: string, spec: NewTask): Task {
  const meta = TASK_META[spec.kind]
  return {
    id, kind: spec.kind, targetId: spec.targetId,
    basePriority: spec.priority ?? meta.priority,
    manualPriority: spec.manualPriority ?? null,
    status: 'queued',
    requiredHours: Math.max(0.1, spec.requiredHours),
    doneHours: 0,
    assignees: [],
    crewNeeded: Math.max(1, spec.crewNeeded ?? 1),
    requiredSpecialty: meta.requires,
    materials: (spec.materials ?? []).map(m => ({ resource: m.resource, required: m.amount, reserved: 0, consumed: 0 })),
    createdSol: spec.sol, startedSol: null, finishedSol: null,
    blockReason: null, blockCode: null,
    auto: spec.auto ?? true, recurring: spec.recurring ?? false,
    eva: meta.eva, evaReady: !meta.eva,
  }
}

export const taskRemaining = (task: Task): number => Math.max(0, task.requiredHours - task.doneHours)
export const isOpen = (task: Task): boolean => task.status === 'queued' || task.status === 'active' || task.status === 'blocked'
export const isFinished = (task: Task): boolean => task.status === 'done' || task.status === 'cancelled'

/** Приоритет сортировки: ручной приоритет важнее автоматического. */
function effectivePriority(task: Task): number {
  return task.manualPriority ?? task.basePriority
}

/** Порядок очереди: приоритет, затем давность создания, затем id (стабильность). */
export function compareTasks(a: Task, b: Task): number {
  const pa = effectivePriority(a), pb = effectivePriority(b)
  if (pa !== pb) return pa - pb
  if (a.createdSol !== b.createdSol) return a.createdSol - b.createdSol
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Зарезервировать все материалы задачи. Возвращает незакрытые позиции. */
export function reserveMaterials(stock: Stock, task: Task): TaskMaterial[] {
  const missing: TaskMaterial[] = []
  for (const material of task.materials) {
    const need = material.required - material.reserved - material.consumed
    if (need <= 0) continue
    const got = stockReserve(stock, material.resource, need)
    material.reserved += got
    if (material.reserved + material.consumed < material.required - 1e-9) missing.push(material)
  }
  return missing
}

/** Списать материалы пропорционально выполненной доле. */
export function consumeMaterials(stock: Stock, task: Task, ratio: number): void {
  for (const material of task.materials) {
    const planned = material.required * ratio
    const already = material.consumed
    if (planned <= already + 1e-9) continue
    const want = Math.min(planned - already, material.reserved)
    if (want <= 0) continue
    const spent = stockCommit(stock, material.resource, want)
    material.reserved = Math.max(0, material.reserved - spent)
    material.consumed += spent
  }
}

/** Отмена: возвращаются только неиспользованные материалы. */
export function releaseMaterials(stock: Stock, task: Task): number {
  let released = 0
  for (const material of task.materials) {
    const back = stockRelease(stock, material.resource, material.reserved)
    material.reserved = Math.max(0, material.reserved - back)
    released += back
  }
  return released
}

/** Снять назначение: человек освобождается, задача теряет исполнителя. */

/** Пригодность человека: квалификация и свободное время. */
function crewFitness(member: CrewMember, task: Task): number {
  if (!isIdle(member) && !task.assignees.includes(member.id)) return -1
  if (remainingHours(member) <= 0) return -1
  const skill = crewSkill(member, task.kind)
  if (task.requiredSpecialty && member.specialty !== task.requiredSpecialty && skill < 0.5) return -1
  return skill
}

/**
 * Автораспределение: понятные правила, видимые игроку.
 * Сначала важные задачи, затем лучшая квалификация, затем наименее уставший.
 * Человек закрепляется за одной задачей до её завершения (без «микро-перескоков»).
 */
export function autoAssign(crew: CrewMember[], tasks: Task[]): number {
  const open = tasks.filter(isOpen).sort(compareTasks)
  let assigned = 0
  for (const task of open) {
    while (task.assignees.length < task.crewNeeded) {
      const taken = new Set(crew.filter(m => m.taskId !== null).map(m => m.id))
      const candidates = crew
        .filter(m => !taken.has(m.id) || task.assignees.includes(m.id))
        .filter(m => !task.assignees.includes(m.id))
        .filter(m => m.taskId === null)
        .map(member => ({ member, fitness: crewFitness(member, task) }))
        .filter(entry => entry.fitness > 0)
        .sort((a, b) => (b.fitness - a.fitness) || (a.member.fatigue - b.member.fatigue) || (a.member.id < b.member.id ? -1 : 1))
      if (!candidates.length) break
      const chosen = candidates[0].member
      chosen.taskId = task.id
      task.assignees.push(chosen.id)
      assigned++
    }
  }
  return assigned
}

/** Сводка очереди для интерфейса. */
export interface TaskQueueSummary {
  open: number
  active: number
  blocked: number
  done: number
  /** Суммарные требуемые часы по открытым задачам. */
  requiredHours: number
}


/** Причины блокировки: короткие коды для локализации и лога. */
export const BLOCK_CODES = {
  noMaterials: 'no-materials',
  noCrew: 'no-crew',
  noAccess: 'no-access',
  faulty: 'faulty',
  offline: 'offline',
  noPower: 'no-power',
  full: 'storage-full',
  noTarget: 'no-target',
} as const

export type BlockCode = typeof BLOCK_CODES[keyof typeof BLOCK_CODES]
