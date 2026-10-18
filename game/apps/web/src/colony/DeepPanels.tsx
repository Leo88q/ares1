import { useRef, useState, type KeyboardEvent } from 'react'
import { deepCopy } from './deepCopy'
import type { ColonyWorld } from './deep/world'
import { RESOURCES, RESOURCE_IDS } from './deep/resources'
import { SPECIALTY_LABEL } from './deep/crew'
import { TASK_META } from './deep/tasks'
import { ANALYSIS_META } from './deep/lab'
import { setTaskPaused, setTaskPriority } from './deep/world'
import { batchStage, batchSummary, projectedYieldKg, STAGE_LABEL, FACTOR_LABEL } from './deep/growth'
import { totalPressureKpa, o2PartialKpa, co2PartialKpa } from './deep/sections'
import { attentionList } from './deep/reliability'
import { depositBlockReason, depositWorkable } from './deep/extraction'
import type { Device } from './deep/devices'

export const DEEP_TABS = ['crew', 'tasks', 'stores', 'extraction', 'life', 'greenhouse', 'lab', 'repair', 'contracts', 'journal'] as const
export type DeepTab = typeof DEEP_TABS[number]

/**
 * Следующая вкладка по нажатию. Вынесено отдельно от компонента, потому что
 * jsdom в проекте нет, а правило «стрелка вправо с последней — на первую»
 * обязано проверяться тестом, а не надписью «должно работать».
 * Возвращает null, если клавиша не про вкладки.
 */
export function nextTab(current: DeepTab, key: string): DeepTab | null {
  const index = DEEP_TABS.indexOf(current)
  const last = DEEP_TABS.length - 1
  switch (key) {
    case 'ArrowRight': return DEEP_TABS[index === last ? 0 : index + 1]
    case 'ArrowLeft': return DEEP_TABS[index === 0 ? last : index - 1]
    case 'Home': return DEEP_TABS[0]
    case 'End': return DEEP_TABS[last]
    default: return null
  }
}

const pct = (value: number): string => `${Math.round(Math.max(0, Math.min(1, value)) * 100)} %`
const num = (value: number, digits = 1): string =>
  Number.isFinite(value) ? value.toFixed(digits).replace(/\.0$/, '') : '—'

/** Полотно панелей глубокого слоя: всё из одного мира, без вторых моделей. */
export function DeepPanels({ world, language, onChange, initialTab = 'crew' }: {
  world: ColonyWorld | null
  language: string
  /** Мир правится на месте; колбэк только просит перерисовать. */
  onChange: () => void
  /** Открытая вкладка. Нужна и для ссылок на конкретную панель, и для тестов. */
  initialTab?: DeepTab
}) {
  const [tab, setTab] = useState<DeepTab>(initialTab)
  const c = deepCopy(language)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Вкладки — это ARIA-табы, а не просто ряд кнопок: со клавиатуры они
  // переключаются стрелками, Home/End идут по краям, а фокус следует за
  // выбором. Иначе Tab приходится перебирать все десять подряд.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = nextTab(tab, event.key)
    if (!target) return
    event.preventDefault()
    setTab(target)
    tabRefs.current[DEEP_TABS.indexOf(target)]?.focus()
  }

  return (
    <div className="colony-deep" data-testid="deep-panels">
      <div className="colony-deep-tabs" role="tablist" aria-label={c.systems} onKeyDown={onTabKey}>
        {DEEP_TABS.map((key, index) => (
          <button type="button" key={key} role="tab" id={`deep-tab-${key}`}
            aria-controls="deep-panel" aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            data-testid={`deep-tab-${key}`}
            ref={element => { tabRefs.current[index] = element }}
            onClick={() => setTab(key)}>{c[key]}</button>
        ))}
      </div>

      {!world
        ? <p className="colony-fineprint" data-testid="deep-empty">{c.noWorld}</p>
        : <div className="colony-deep-body" role="tabpanel" id="deep-panel"
          aria-labelledby={`deep-tab-${tab}`} tabIndex={0}>
          {tab === 'crew' && <CrewPanel world={world} language={language} />}
          {tab === 'tasks' && <TaskPanel world={world} language={language} onChange={onChange} />}
          {tab === 'stores' && <StorePanel world={world} language={language} />}
          {tab === 'extraction' && <ExtractionPanel world={world} language={language} />}
          {tab === 'life' && <LifePanel world={world} language={language} />}
          {tab === 'greenhouse' && <GreenhousePanel world={world} language={language} />}
          {tab === 'lab' && <LabPanel world={world} language={language} />}
          {tab === 'repair' && <RepairPanel world={world} language={language} />}
          {tab === 'contracts' && <ContractPanel world={world} language={language} />}
          {tab === 'journal' && <JournalPanel world={world} language={language} />}
        </div>}
    </div>
  )
}

/** Полоска 0…1 — общий индикатор для усталости, износа, развития. */
function Bar({ value, tone }: { value: number; tone?: 'danger' | 'gold' }) {
  return <span className={`colony-deep-bar${tone ? ` colony-deep-bar--${tone}` : ''}`} aria-hidden="true">
    <i style={{ width: pct(value) }} />
  </span>
}

function CrewPanel({ world, language }: { world: ColonyWorld; language: string }) {
  const c = deepCopy(language)
  const tasks = new Map(world.tasks.map(t => [t.id, t]))
  return <section className="colony-study-card">
    <p className="colony-eyebrow">{c.crewTitle}</p>
    <div className="colony-table-scroll"><table>
      <thead><tr><th>{c.specialty}</th><th>{c.fatigue}</th><th>{c.health}</th><th>{c.task}</th><th>{c.hours}</th></tr></thead>
      <tbody>{world.crew.map(m => {
        const task = m.taskId ? tasks.get(m.taskId) : null
        return <tr key={m.id} data-testid={`deep-crew-${m.id}`}>
          <td>{SPECIALTY_LABEL[m.specialty][language === 'ru' ? 'ru' : 'en']}</td>
          <td><Bar value={m.fatigue} tone={m.fatigue > 0.8 ? 'danger' : undefined} /> {pct(m.fatigue)}</td>
          <td><Bar value={m.health} tone={m.health < 0.6 ? 'danger' : undefined} /> {pct(m.health)}</td>
          <td>{task ? TASK_META[task.kind][language === 'ru' ? 'ru' : 'en'] : c.idle}
            {m.foodDebtSols > 0.01 && <> · {c.foodDebt} {num(m.foodDebtSols)} {c.sols}</>}</td>
          <td>{num(m.hoursAvailable)}</td>
        </tr>
      })}</tbody>
    </table></div>
  </section>
}

function TaskPanel({ world, language, onChange }: { world: ColonyWorld; language: string; onChange: () => void }) {
  const c = deepCopy(language)
  const open = world.tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
  const statusLabel: Record<string, string> = {
    queued: c.statusQueued, active: c.statusActive, blocked: c.statusBlocked, paused: c.statusPaused,
  }
  return <section className="colony-study-card">
    <p className="colony-eyebrow">{c.queueTitle}</p>
    <p className="colony-fineprint">{c.queueNote}</p>
    <div className="colony-table-scroll"><table>
      <thead><tr><th>{c.task}</th><th>{c.target}</th><th>{c.progress}</th><th>{c.status}</th><th>{c.priority}</th><th /></tr></thead>
      <tbody>{open.map(t => {
        const meta = TASK_META[t.kind]
        const shown = (language === 'ru' ? meta.ru : meta.en)
        return <tr key={t.id} data-testid={`deep-task-${t.id}`}>
          <td>{shown}{t.eva ? ' · EVA' : ''}</td>
          <td>{t.targetId}</td>
          <td><Bar value={t.requiredHours > 0 ? t.doneHours / t.requiredHours : 0} /> {num(t.doneHours)}/{num(t.requiredHours)}</td>
          <td>{statusLabel[t.status] ?? t.status}
            {t.blockReason && <> · <b>{c.blockedBy}</b>: {t.blockReason}</>}</td>
          <td>{t.manualPriority ?? t.basePriority} ({t.manualPriority === null ? c.auto : c.manual})</td>
          <td className="colony-deep-actions">
            <button type="button" onClick={() => { setTaskPaused(world, t.id, t.status !== 'paused'); onChange() }}>
              {t.status === 'paused' ? c.resume : c.pause}</button>
            <button type="button" aria-label={c.raise} onClick={() => { setTaskPriority(world, t.id, (t.manualPriority ?? t.basePriority) - 1); onChange() }}>↑</button>
            <button type="button" aria-label={c.lower} onClick={() => { setTaskPriority(world, t.id, (t.manualPriority ?? t.basePriority) + 1); onChange() }}>↓</button>
            <button type="button" onClick={() => { setTaskPriority(world, t.id, null); onChange() }}>{c.resetPrio}</button>
          </td>
        </tr>
      })}</tbody>
    </table></div>
    {open.length === 0 && <p className="colony-fineprint">{c.empty}</p>}
  </section>
}

function StorePanel({ world, language }: { world: ColonyWorld; language: string }) {
  const c = deepCopy(language)
  const lang = language === 'ru' ? 'ru' : 'en'
  const rows = RESOURCE_IDS
    .map(id => ({ id, spec: RESOURCES[id], amount: world.stock.amount[id] ?? 0, cap: world.stock.cap[id] ?? 0, reserved: world.stock.reserved[id] ?? 0 }))
    .filter(r => r.cap > 0 || r.amount > 0)
  return <section className="colony-study-card">
    <p className="colony-eyebrow">{c.storesTitle}</p>
    <p className="colony-fineprint">{c.storesNote}</p>
    <div className="colony-table-scroll"><table>
      <thead><tr><th>{c.resource}</th><th>{c.amount}</th><th>{c.cap}</th><th>{c.reserved}</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id} data-testid={`deep-store-${r.id}`}>
        <td>{r.spec[lang]}</td>
        <td>{num(r.amount, r.spec.unit === 'pcs' ? 0 : 1)} {r.spec.unit}</td>
        <td>{num(r.cap, 0)} {r.spec.unit}</td>
        <td>{num(r.reserved, r.spec.unit === 'pcs' ? 0 : 1)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>
}

function ExtractionPanel({ world, language }: { world: ColonyWorld; language: string }) {
  const c = deepCopy(language)
  return <>
    <section className="colony-study-card">
      <p className="colony-eyebrow">{c.extractionTitle}</p>
      <div className="colony-table-scroll"><table>
        <thead><tr><th>{c.deposit}</th><th>{c.distance}</th><th>{c.estimate}</th><th>{c.confidence}</th><th>{c.workable}</th><th>{c.reason}</th></tr></thead>
        <tbody>{world.deposits.map(d => {
          const workable = depositWorkable(d)
          return <tr key={d.id} data-testid={`deep-deposit-${d.id}`}>
            <td>{d.name}</td>
            <td>{num(d.distanceKm)} {c.km}</td>
            <td>{num(d.estimateKg, 0)} kg</td>
            <td><Bar value={d.confidence} /> {pct(d.confidence)}</td>
            <td>{workable ? c.yes : c.no}</td>
            <td>{workable ? '—' : depositBlockReason(d)}</td>
          </tr>
        })}</tbody>
      </table></div>
    </section>
    <section className="colony-study-card">
      <p className="colony-eyebrow">{c.haulJobs}</p>
      <div className="colony-table-scroll"><table>
        <thead><tr><th>{c.vehicle}</th><th>{c.phase}</th><th>{c.cargo}</th></tr></thead>
        <tbody>{world.haulJobs.map(j => <tr key={j.id} data-testid={`deep-haul-${j.id}`}>
          <td>{j.vehicleId}</td>
          <td>{j.phase === 'to_pickup' ? c.phaseToPickup : j.phase === 'loading' ? c.phaseLoading
            : j.phase === 'to_drop' ? c.phaseToDrop : j.phase === 'unloading' ? c.phaseUnloading : c.phaseDone}</td>
          <td>{num(j.loadedKg)} / {num(j.requestedKg, 0)} kg</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </>
}

function LifePanel({ world, language }: { world: ColonyWorld; language: string }) {
  const c = deepCopy(language)
  return <section className="colony-study-card">
    <p className="colony-eyebrow">{c.lifeTitle}</p>
    <div className="colony-table-scroll"><table>
      <thead><tr><th>{c.section}</th><th>{c.volume}</th><th>{c.pressure}</th><th>{c.o2}</th><th>{c.co2}</th><th>{c.temp}</th><th>{c.humidity}</th><th>{c.tightness}</th></tr></thead>
      <tbody>{world.sections.map(s => <tr key={s.id} data-testid={`deep-section-${s.id}`}>
        <td>{s.name}</td>
        <td>{num(s.volumeM3, 0)} {c.m3}</td>
        <td>{num(totalPressureKpa(s))} {c.kpa}</td>
        <td>{num(o2PartialKpa(s))} {c.kpa}</td>
        <td>{num(co2PartialKpa(s), 2)} {c.kpa}</td>
        <td>{num(s.temperatureC)} {c.celsius}</td>
        <td>{pct(s.humidity)}</td>
        <td><Bar value={s.condition} tone={s.condition < 0.7 ? 'danger' : undefined} /> {pct(s.condition)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>
}

function GreenhousePanel({ world, language }: { world: ColonyWorld; language: string }) {
  const c = deepCopy(language)
  const lang = language === 'ru' ? 'ru' : 'en'
  return <section className="colony-study-card">
    <p className="colony-eyebrow">{c.greenhouseTitle}</p>
    <div className="colony-table-scroll"><table>
      <thead><tr><th>{c.bed}</th><th>{c.stage}</th><th>{c.development}</th><th>{c.expected}</th><th>{c.limiting}</th><th>{c.factors}</th></tr></thead>
      <tbody>{world.batches.map(b => {
        const stage = batchStage(b)
        const summary = batchSummary(b)
        const limiting = summary.limiting
        return <tr key={b.id} data-testid={`deep-batch-${b.id}`}>
          <td>{b.greenhouseId} / {b.bedIndex + 1}</td>
          <td>{STAGE_LABEL[stage][lang]}</td>
          <td><Bar value={b.development} /> {pct(b.development)}</td>
          <td>{num(projectedYieldKg(b))} kg{b.yieldPenalty > 0.001 && <> · −{pct(b.yieldPenalty)}</>}</td>
          <td>{limiting ? FACTOR_LABEL[limiting][lang] : c.none}</td>
          <td>{(Object.keys(b.factors) as Array<keyof typeof b.factors>)
            .filter(k => b.factors[k] < 0.999)
            .map(k => `${FACTOR_LABEL[k][lang]} ${pct(b.factors[k])}`).join(' · ') || c.none}</td>
        </tr>
      })}</tbody>
    </table></div>
  </section>
}

function LabPanel({ world, language }: { world: ColonyWorld; language: string }) {
  const c = deepCopy(language)
  const lang = language === 'ru' ? 'ru' : 'en'
  return <section className="colony-study-card">
    <p className="colony-eyebrow">{c.labTitle}</p>
    <div className="colony-table-scroll"><table>
      <thead><tr><th>{c.sample}</th><th>{c.result}</th><th>{c.precision}</th></tr></thead>
      <tbody>{world.analyses.map(a => <tr key={a.id} data-testid={`deep-analysis-${a.id}`}>
        <td>{ANALYSIS_META[a.kind][lang]}</td>
        <td>{a.result ? `${num(a.result.value, 3)} (${a.result.band})` : a.status}</td>
        <td>{a.result ? `± ${num(a.result.ci, 3)}` : '—'}</td>
      </tr>)}</tbody>
    </table></div>
    {world.analyses.length === 0 && <p className="colony-fineprint">{c.noAnalyses}</p>}
    <p className="colony-fineprint">{c.recipes}: {world.recipes.length} · {c.experiments}: {world.experiments.length}</p>
  </section>
}

function RepairPanel({ world, language }: { world: ColonyWorld; language: string }) {
  const c = deepCopy(language)
  const attention = attentionList(world)
  const byId = new Map(attention.map(a => [a.id, a]))
  return <section className="colony-study-card">
    <p className="colony-eyebrow">{c.repairTitle}</p>
    <div className="colony-table-scroll"><table>
      <thead><tr><th>{c.device}</th><th>{c.condition}</th><th>{c.connected}</th><th>{c.fault}</th><th>{c.attention}</th></tr></thead>
      <tbody>{world.devices.map((d: Device) => {
        const note = byId.get(d.id)
        return <tr key={d.id} data-testid={`deep-device-${d.id}`}>
          <td>{d.kind}</td>
          <td><Bar value={d.condition} tone={d.condition < 0.6 ? 'danger' : undefined} /> {pct(d.condition)}</td>
          <td>{d.connected ? c.yes : c.no}</td>
          <td>{d.fault ? d.fault.code : '—'}</td>
          <td>{note ? `${note.reason} · ${c[note.severity === 'critical' ? 'severityCritical' : note.severity === 'warning' ? 'severityWarning' : 'severityInfo']}` : '—'}</td>
        </tr>
      })}</tbody>
    </table></div>
    {attention.length === 0 && <p className="colony-fineprint">{c.noFaults}</p>}
  </section>
}

function ContractPanel({ world, language }: { world: ColonyWorld; language: string }) {
  const c = deepCopy(language)
  return <section className="colony-study-card">
    <p className="colony-eyebrow">{c.contractsTitle}</p>
    <p className="colony-fineprint">{c.contractsNote}</p>
    <div className="colony-table-scroll"><table>
      <thead><tr><th>{c.contracts}</th><th>{c.required}</th><th>{c.delivered}</th><th>{c.due}</th><th>{c.rate}</th><th>{c.reward}</th></tr></thead>
      <tbody>{world.contracts.map(ct => <tr key={ct.id} data-testid={`deep-contract-${ct.id}`}>
        <td>{ct.title}</td>
        <td>{num(ct.requiredKg)} kg</td>
        <td><Bar value={ct.requiredKg > 0 ? ct.deliveredKg / ct.requiredKg : 0} /> {num(ct.deliveredKg)} kg</td>
        <td>{ct.dueSol}</td>
        <td>{num(ct.creditsPerKg, 2)} CR/kg</td>
        <td>{num(ct.rewardFundCR, 0)} CR</td>
      </tr>)}</tbody>
    </table></div>
    {world.contracts.length === 0 && <p className="colony-fineprint">{c.empty}</p>}
  </section>
}

function JournalPanel({ world, language }: { world: ColonyWorld; language: string }) {
  const c = deepCopy(language)
  const lang = language === 'ru' ? 'ru' : 'en'
  const events = [...world.events].reverse().slice(0, 60)
  return <section className="colony-study-card">
    <p className="colony-eyebrow">{c.journalTitle}</p>
    <p className="colony-fineprint">{c.journalNote}</p>
    <ol className="colony-deep-journal">
      {events.map((e, index) => <li key={`${e.sol}-${e.code}-${index}`} data-severity={e.severity}>
        <b>{c.sol} {e.sol}</b> <span>{e[lang]}</span>
      </li>)}
    </ol>
    {events.length === 0 && <p className="colony-fineprint">{c.empty}</p>}
  </section>
}
