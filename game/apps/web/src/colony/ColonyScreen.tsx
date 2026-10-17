import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, ArrowRight, BatteryMedium, Box, Check, ChevronRight, CircleHelp, Droplets, ExternalLink, FlaskConical, Hammer, House, Leaf, Orbit, Package, Pause, Play, Plus, RotateCcw, Sun, Truck, Wrench } from 'lucide-react'
import { useI18n } from '../i18n'
import { colonyCopy, moduleCopy } from './copy'
import { COLONY_MANUAL_HARVEST_ENABLED } from '../utils/colonyFeature'
import { advanceDays, batteryCapacity, bedCycleKg, bedSummary, canHarvestBed, harvestBed, buildModule, buySupplies, CATALOG, canBuild, canRepair, countModules, dailyBudget, DEFAULT_SCENARIO, deliverFood, foodDemand, initialColony, MODULE_KINDS, PARAMETERS, repairColony, sellableKg, SLOTS } from './simulation'
import type { BedState, ColonyModule, ColonyState, DayBudget, ModuleKind, Scenario } from './simulation'
import provenance from '../../public/models/colony/manifest.json'
import ResourceIcon from '../fields/ResourceIcon'
import type { ResourceArt } from '../fields/visualAssets'
import './colony.css'

const ColonyViewport = lazy(() => import('./ColonyViewport'))
const ICONS: Record<ModuleKind, LucideIcon> = { solar: Sun, greenhouse: Leaf, habitat: House, recycler: Droplets, rover: Truck, workshop: Wrench, battery: BatteryMedium }
const number = (value: number, decimals = 0): string => value.toFixed(decimals)
type View = 'base' | 'economy' | 'assets'
// Same v2 painted art the ARES section screens use; text stays live DOM.
const HERO_ART: Record<View, string> = { base: '/ares/art/mars-sector.webp', economy: '/ares/art/journal-background.webp', assets: '/ares/art/cabin-background.webp' }

/** `embedded`: inside the ARES app tab (АГРО/КОЛОНИЯ shell owns header, language and nav). */
export default function ColonyScreen({ embedded = false }: { embedded?: boolean } = {}): JSX.Element {
  const { lang, setLang } = useI18n()
  const c = colonyCopy(lang)
  const descriptions = moduleCopy(lang)
  const [state, setState] = useState(initialColony)
  const [scenario, setScenario] = useState<Scenario>({ ...DEFAULT_SCENARIO })
  const [view, setView] = useState<View>('base')
  const [panel, setPanel] = useState<'build' | 'logistics'>('build')
  const [selectedId, setSelectedId] = useState<string | null>('greenhouse-5')
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const budget = useMemo(() => dailyBudget(state, scenario), [state, scenario])
  const selected = state.modules.find(m => m.id === selectedId)
  const end = state.day >= PARAMETERS.maxDays

  useEffect(() => {
    if (embedded) return undefined
    const previous = document.title
    document.title = `ARES-1 / ${c.base}`
    return () => { document.title = previous }
  }, [c.base, embedded])
  useEffect(() => {
    if (!running || end) return
    const timer = window.setInterval(() => setState(s => advanceDays(s, 1, scenario)), 1200)
    const pauseHidden = (): void => { if (document.hidden) setRunning(false) }
    document.addEventListener('visibilitychange', pauseHidden)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', pauseHidden) }
  }, [running, scenario, end])
  useEffect(() => { if (end) setRunning(false) }, [end])
  useEffect(() => { if (view !== 'base') setRunning(false) }, [view])

  const reset = (): void => {
    setRunning(false); setState(initialColony()); setScenario({ ...DEFAULT_SCENARIO })
    setSelectedId('greenhouse-5'); setMessage('')
  }
  const build = (kind: ModuleKind): void => {
    if (!canBuild(state, kind)) return
    setState(current => buildModule(current, kind))
    setSelectedId(`${kind}-${state.modules.length + 1}`)
    setMessage(`${descriptions[kind].name} · −${CATALOG[kind].credits} CR`)
  }
  const warning = end ? c.dayLimit : state.foodKg < foodDemand(state) ? c.foodWarning
    : budget.oxygenShortfallKg > 0.001 || budget.oxygenEndKg < budget.oxygenDemandKg * 3 ? c.oxygenWarning
    : budget.unmetKwh > 0.01 ? c.powerWarning : budget.waterShortfallLitres > 0.01 ? c.waterWarning
    : budget.growthFraction < 0.95 ? c.cropWarning : c.healthy
  const Main = embedded ? 'div' : 'main'
  const constrained = end || state.foodKg < foodDemand(state) || budget.oxygenShortfallKg > 0.001 || budget.unmetKwh > 0.01 || budget.waterShortfallLitres > 0.01 || budget.growthFraction < 0.95

  return (
    <div className={`colony-app${embedded ? ' colony-app--embedded' : ''}`}>
      {!embedded && <header className="colony-header">
        <a className="colony-brand" href="/" aria-label={c.back}><Orbit size={29} strokeWidth={1.3} /><span>ARES<span className="colony-brand-number"> / 01</span><small>{c.program}</small></span></a>
        <nav className="colony-tabs" aria-label="Colony">
          {(['base', 'economy', 'assets'] as const).map(tab => <button type="button" key={tab} onClick={() => setView(tab)} aria-current={view === tab ? 'page' : undefined} className={view === tab ? 'is-active' : ''}>{c[tab]}</button>)}
        </nav>
        <div className="colony-header-right"><span className="colony-local"><i />{c.local}</span><div className="colony-languages" aria-label="Language">
          <button type="button" aria-pressed={lang !== 'ru'} onClick={() => setLang('en')}>EN</button><span>/</span><button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>RU</button>
        </div></div>
      </header>}

      <Main className="colony-main" {...(embedded ? {} : { id: 'main' })}>
        <section className="colony-hero" data-view={view}>
          <img className="colony-hero-image" src={HERO_ART[view]} alt="" aria-hidden="true" draggable={false} />
          <div className="colony-hero-copy"><p className="colony-eyebrow">{c.eyebrow}</p><h1>{view === 'base' ? c.title : view === 'economy' ? c.economyTitle : c.assetsTitle}</h1><p className="colony-lead">{view === 'base' ? c.intro : view === 'economy' ? c.economyIntro : c.assetsIntro}</p></div>
          {!embedded && <a className="colony-back" href="/"><ArrowLeft size={14} />{c.back}</a>}
        </section>

        {view === 'base' && <>
          <div className="colony-resource-grid">
            <Resource art="solar" label={c.energy} value={`${number(budget.generationKwh)} / ${number(budget.demandKwh)}`} unit={c.kwh} detail={`${c.perDay} · ${number(budget.curtailedKwh)} ${c.kwh} ${c.surplus}`} tone={budget.unmetKwh > 0.01 ? 'danger' : 'gold'} />
            <Resource art="battery" label={c.battery} value={number(state.batteryKwh)} unit={c.kwh} detail={`${c.outOf} ${batteryCapacity(state)} ${c.kwh}`} progress={batteryCapacity(state) ? state.batteryKwh / batteryCapacity(state) : 0} />
            <Resource art="water" label={c.water} value={number(state.waterLitres)} unit={c.litres} detail={`−${number(budget.waterUsedLitres, 1)} ${c.litres} ${c.perDay} · ${c.netWater}`} tone={state.waterLitres < budget.waterNeededLitres * 7 ? 'danger' : undefined} />
            <Resource art="crop" label={c.food} value={number(state.foodKg, 1)} unit={c.kg} detail={`${number(state.foodKg / Math.max(foodDemand(state), 0.001))} ${c.foodDays}`} tone={state.foodKg < foodDemand(state) * 14 ? 'danger' : undefined} />
            <Resource art="budget" label={c.budget} value={number(state.credits)} unit="CR" detail={`${c.spares}: ${number(state.sparesKg, 1)} ${c.kg}`} />
            <Resource art="oxygen" label={c.oxygen} value={number(state.oxygenKg, 1)} unit={c.kg} detail={`+${number(budget.oxygenProducedKg, 1)} / −${number(budget.oxygenDemandKg, 1)} ${c.kg} ${c.perDay} · ${c.oxygenNote}`} tone={budget.oxygenShortfallKg > 0.001 || budget.oxygenEndKg < budget.oxygenDemandKg * 3 ? 'danger' : undefined} />
          </div>

          <div className="colony-command-bar">
            <div className="colony-day"><span>{c.day}</span><b data-testid="colony-day">{String(state.day).padStart(3, '0')}</b><small>/ 365</small></div>
            <label className="colony-sun-control"><Sun size={16} /><span>{c.sun} <b>{scenario.sunHours} h</b></span><input type="range" aria-label={c.sun} min={0} max={24} step={1} value={scenario.sunHours} onChange={event => setScenario(s => ({ ...s, sunHours: Number(event.target.value) }))} /></label>
            <div className="colony-time-buttons">
              <button className="colony-button colony-button--primary" type="button" disabled={end} onClick={() => setRunning(value => !value)}>{running ? <Pause size={14} /> : <Play size={14} />}{running ? c.pause : c.play}</button>
              <button className="colony-button" type="button" disabled={running || end} onClick={() => setState(s => advanceDays(s, 1, scenario))}>{c.next}</button>
              <button className="colony-button" type="button" disabled={running || end} onClick={() => setState(s => advanceDays(s, 7, scenario))}>{c.week}<ChevronRight size={13} /></button>
            </div>
          </div>

          <div className="colony-workspace">
            <section className="colony-world" aria-label={c.site}>
              <Suspense fallback={<div className="colony-viewport colony-viewport-placeholder" role="status">{c.loading}</div>}>
                <ColonyViewport state={state} selectedId={selectedId} sunHours={scenario.sunHours} language={lang} onSelect={setSelectedId} />
              </Suspense>
              <div className="colony-world-footer"><span><Box size={13} />{state.modules.length}/{SLOTS.length} {c.pads}</span><span><Leaf size={13} />{c.harvest}: <b>{number(state.harvestedKg)} {c.kg}</b></span><button type="button" onClick={reset}><RotateCcw size={12} />{c.reset}</button></div>
              <div className={`colony-status ${constrained ? 'colony-status--warning' : ''}`} role="status">{constrained ? <CircleHelp size={16} /> : <Check size={16} />}<span>{warning}</span></div>
              <div className="colony-module-selector" aria-label={c.moduleList}>
                {state.modules.map((m, index) => {
                  const Icon = ICONS[m.kind]
                  return <button type="button" key={m.id} onClick={() => setSelectedId(m.id)} aria-pressed={selectedId === m.id} aria-label={`${descriptions[m.kind].name} ${index + 1}`} title={descriptions[m.kind].name} style={{ '--module-color': CATALOG[m.kind].color } as CSSProperties}><Icon size={15} /><span>{String(index + 1).padStart(2, '0')}</span></button>
                })}
              </div>
            </section>

            <aside className="colony-sidebar">
              <div className="colony-panel-tabs"><button type="button" onClick={() => setPanel('build')} aria-pressed={panel === 'build'}><Plus size={14} />{c.build}</button><button type="button" onClick={() => setPanel('logistics')} aria-pressed={panel === 'logistics'}><Truck size={14} />{c.logistics}</button></div>
              {panel === 'build' ? <>
                <div className="colony-build-list">{MODULE_KINDS.map(kind => {
                  const Icon = ICONS[kind]
                  return <div className="colony-build-item" key={kind}>
                    <span className="colony-build-icon" style={{ color: CATALOG[kind].color }}><Icon size={20} strokeWidth={1.4} /></span>
                    <div><b>{descriptions[kind].name}</b><span>{descriptions[kind].code} · {countModules(state, kind)} ×</span></div>
                    <button type="button" onClick={() => build(kind)} disabled={!canBuild(state, kind)} aria-label={`${c.add}: ${descriptions[kind].name} · ${CATALOG[kind].credits} CR`} title={descriptions[kind].description}><span>{CATALOG[kind].credits}<small> CR</small></span><Plus size={13} /></button>
                  </div>
                })}</div>
                <p className="colony-fineprint colony-build-note">{c.constructionNote}</p>
              </> : <Logistics state={state} onChange={setState} language={lang} />}
              <div className="colony-inspector">
                <p className="colony-eyebrow">{c.selected}</p>
                {selected ? <>
                  <h2 style={{ color: CATALOG[selected.kind].color }}>{descriptions[selected.kind].name}<span>{selected.slot + 1 < 10 ? '0' : ''}{selected.slot + 1}</span></h2>
                  <p>{descriptions[selected.kind].description}</p>
                  <div className="colony-inspector-metric"><span>{c.condition}</span><b>{number(selected.condition)}%</b></div>
                  <div className="colony-meter"><span style={{ width: `${selected.condition}%`, background: CATALOG[selected.kind].color }} /></div>
                  {selected.kind === 'greenhouse' && <>
                    <div className="colony-inspector-metric"><span>{c.growth}</span><b data-testid="crop-days">{number(selected.growthDays, 1)} / 90</b></div>
                    <div className="colony-meter"><span style={{ width: `${selected.growthDays / 90 * 100}%`, background: '#91cba2' }} /></div>
                    <BedPanel mod={selected} language={lang} storageFull={state.ledger.storageCapKg - state.ledger.rawKg - state.ledger.processedKg < bedCycleKg()} manualHarvest={COLONY_MANUAL_HARVEST_ENABLED && selected ? {
                      canHarvest: i => canHarvestBed(state, selected.id, i),
                      onHarvest: i => setState(s => harvestBed(s, selected.id, i)),
                    } : undefined} />
                  </>}
                </> : <p>{c.select}</p>}
              </div>
            </aside>
          </div>

          <div className="colony-bottom-grid">
            <section className="colony-study-card"><p className="colony-eyebrow">{c.firstGoal}</p><h2>{c.harvest}: {number(state.harvestedKg)} {c.kg}</h2><p>{c.goalText}</p><p className="colony-fineprint">{c.harvestNote}</p></section>
            <section className="colony-study-card"><p className="colony-eyebrow">{c.forecast}</p><BudgetDetails budget={budget} language={lang} /></section>
          </div>
          <div className="colony-live-message" aria-live="polite">{message}</div>
        </>}

        {view === 'economy' && <Economy state={state} budget={budget} scenario={scenario} onScenario={setScenario} language={lang} />}
        {view === 'assets' && <AssetLibrary language={lang} />}

        <footer className="colony-footer"><span className="colony-footer-mark">ARES / FIELD NOTES — 001</span><p>{c.disclaimer}</p><button type="button" onClick={() => setView(view === 'assets' ? 'economy' : 'assets')}>{c.sources}<ArrowRight size={13} /></button></footer>
      </Main>
    </div>
  )
}

function BedPanel({ mod, language, storageFull, manualHarvest }: { mod: ColonyModule; language: string; storageFull: boolean; manualHarvest?: { canHarvest: (index: number) => boolean; onHarvest: (index: number) => void } }): JSX.Element {
  const c = colonyCopy(language)
  const summary = bedSummary(mod)
  const label: Record<BedState, string> = { waiting: c.bedWaiting, growing: c.bedGrowing, ripe: manualHarvest ? c.bedRipeManual : c.bedRipe }
  return <section className="colony-beds" aria-label={c.bedsTitle} data-testid="bed-summary">
    <p className="colony-eyebrow">{c.bedsTitle}</p>
    <dl className="colony-bed-totals">
      <div><dt>{c.bedsPlanted}</dt><dd data-testid="beds-planted">{summary.planted} / {summary.total}</dd></div>
      <div><dt>{c.bedsRipe}</dt><dd data-testid="beds-ripe">{summary.ripe} / {summary.total}</dd></div>
      <div><dt>{c.bedsCollected}</dt><dd data-testid="beds-collected">{number(summary.collectedKg)} {c.kg}</dd></div>
    </dl>
    <ol className="colony-bed-list">
      {summary.beds.map((bed, index) => <li key={index} data-state={bed.state}>
        <span>{index + 1}</span><small>{label[bed.state]}</small>
        <div className="colony-meter"><span style={{ width: `${bed.progress * 100}%`, background: '#91cba2' }} /></div>
        {manualHarvest && manualHarvest.canHarvest(index) && <button type="button" className="colony-button colony-bed-harvest" onClick={() => manualHarvest.onHarvest(index)}>{c.bedHarvest}</button>}
      </li>)}
    </ol>
    {storageFull && summary.ripe > 0 && <p className="colony-fineprint" data-testid="bed-storage-full">{c.bedStorageFull}</p>}
    <p className="colony-fineprint">{manualHarvest ? c.bedsNoteManual : c.bedsNote}</p>
  </section>
}

function Resource({ art, label, value, unit, detail, progress, tone }: {
  art: ResourceArt; label: string; value: string; unit: string; detail: string; progress?: number; tone?: string
}): JSX.Element {
  return <div className={`colony-resource ${tone ? `colony-resource--${tone}` : ''}`}><div className="colony-resource-label"><ResourceIcon kind={art} size={22} />{label}</div><div className="colony-resource-value">{value}<small>{unit}</small></div><p>{detail}</p>{progress !== undefined && <div className="colony-resource-progress"><span style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} /></div>}</div>
}

function Logistics({ state, onChange, language }: { state: ColonyState; onChange: (action: (s: ColonyState) => ColonyState) => void; language: string }): JSX.Element {
  const c = colonyCopy(language)
  const delivery = sellableKg(state)
  return <div className="colony-logistics">
    <div className="colony-stock-row"><FlaskConical size={15} /><span>{c.nutrients}</span><b>{number(state.nutrientsKg, 2)} {c.kg}</b></div>
    <div className="colony-stock-row"><Hammer size={15} /><span>{c.spares}</span><b>{number(state.sparesKg, 1)} {c.kg}</b></div>
    <button type="button" className="colony-button colony-button--wide" disabled={!canRepair(state)} onClick={() => onChange(repairColony)}><Wrench size={14} />{c.repair}<small>20 CR</small></button>
    <p className="colony-fineprint">{c.repairNote} · −2 {c.kg}</p>
    <button type="button" className="colony-button colony-button--wide" disabled={state.credits < PARAMETERS.supplyCredits} onClick={() => onChange(buySupplies)}><Package size={14} />{c.resupply}<small>80 CR</small></button>
    <p className="colony-fineprint">{c.resupplyNote}</p>
    <div className="colony-contract"><p className="colony-eyebrow">{c.contract}</p><h3>{number(PARAMETERS.contractKg - state.deliveredKg, 1)} <small>{c.kg} {c.remaining}</small></h3><p className="colony-fineprint">{c.contractNote}</p>
      <button type="button" className="colony-button colony-button--primary colony-button--wide" disabled={delivery <= 0} onClick={() => onChange(deliverFood)}><Truck size={14} />{c.deliver} {number(delivery, 1)} {c.kg}<small>+{number(delivery * PARAMETERS.contractCreditsKg)} CR</small></button>
    </div>
  </div>
}

function BudgetDetails({ budget, language }: { budget: DayBudget; language: string }): JSX.Element {
  const c = colonyCopy(language)
  return <dl className="colony-budget-details">
    <div><dt>{c.electricity}</dt><dd>{number(budget.servedKwh, 1)} / {number(budget.demandKwh, 1)} {c.kwh}</dd></div>
    <div><dt>{c.cropAvailability}</dt><dd>{number(budget.growthFraction * 100)}%</dd></div>
    <div><dt>{c.loop}</dt><dd>{number(budget.recovery * 100, 1)}%</dd></div>
    <div><dt>{c.crew}</dt><dd>{number(budget.workHours, 1)} / {number(budget.availableWorkHours)} h</dd></div>
  </dl>
}

function Economy({ state, budget, scenario, onScenario, language }: { state: ColonyState; budget: DayBudget; scenario: Scenario; onScenario: (s: Scenario) => void; language: string }): JSX.Element {
  const c = colonyCopy(language)
  const p = PARAMETERS
  const rows: Array<[string, string, boolean]> = [
    [c.solarFlux, '1.361 kW/m²', true], [c.solarBank, '40 m²', false], [c.panel, '28% / 0.80', false],
    [c.cropSize, '20 m²', false], [c.cropTarget, `0.12 ${c.kg}/m²/${c.dayUnit}`, false],
    [c.cropWater, `4.3 ${c.litres}/m²/${c.dayUnit} (3.4–5.2)`, true], [c.light, '0.20 kW/m² / 16 h', false],
    [c.cropCycle, `90 ${c.dayUnit}`, false], [c.foodRation, `0.5 ${c.kg}/${c.dayUnit}`, false],
  ]
  return <div className="colony-economy">
    <div className="colony-flow"><span><Sun size={20} />{c.flow}</span><span><Droplets size={20} />{c.waterFlow}</span></div>
    <div className="colony-economy-grid">
      <section className="colony-study-card"><p className="colony-eyebrow">{c.physics}</p><div className="colony-table-scroll"><table><thead><tr><th>{c.parameter}</th><th>{c.value}</th><th>{c.status}</th></tr></thead><tbody>{rows.map(([label, value, reference]) => <tr key={label}><td>{label}</td><td>{value}</td><td><span className={reference ? 'colony-reference-tag' : 'colony-assumption-tag'}>{reference ? c.measured : c.assumption}</span></td></tr>)}</tbody></table></div><p className="colony-fineprint">{c.referenceOnly}</p></section>
      <section className="colony-study-card colony-scenario"><p className="colony-eyebrow">SCENARIO / WHAT IF</p>
        <label><span>{c.sun}<b>{scenario.sunHours} h</b></span><input aria-label={c.sun} type="range" min={0} max={24} step={1} value={scenario.sunHours} onChange={event => onScenario({ ...scenario, sunHours: Number(event.target.value) })} /></label><p className="colony-fineprint">{c.sunNote}</p>
        <label><span>{c.recovery}<b>{number(scenario.waterRecovery * 100)}%</b></span><input aria-label={c.recovery} type="range" min={0} max={98} step={1} value={Math.round(scenario.waterRecovery * 100)} onChange={event => onScenario({ ...scenario, waterRecovery: Number(event.target.value) / 100 })} /></label><p className="colony-fineprint">{c.recoveryNote}</p>
        <BudgetDetails budget={budget} language={language} />
      </section>
      <section className="colony-study-card"><p className="colony-eyebrow">{c.accounting}</p><dl className="colony-budget-details">
        <div><dt>{c.initial}</dt><dd>{p.initialCredits} CR</dd></div><div><dt>{c.maxRevenue}</dt><dd>{p.contractKg * p.contractCreditsKg} CR</dd></div>
        <div><dt>{c.earned}</dt><dd>+{number(state.earnedCredits)} CR</dd></div><div><dt>{c.spent}</dt><dd>−{number(state.spentCredits)} CR</dd></div><div className="colony-account-total"><dt>{c.current}</dt><dd>{number(state.credits)} CR</dd></div>
      </dl><p>{c.accountsNote}</p></section>
      <section className="colony-study-card"><p className="colony-eyebrow">{c.scope}</p><p>{c.scopeText}</p><p className="colony-fineprint">{c.limitations}</p></section>
    </div>
    <section className="colony-study-card colony-reference-links"><p className="colony-eyebrow">{c.nasa}</p>
      <a href="https://link.springer.com/article/10.1007/s11540-006-9003-4" target="_blank" rel="noreferrer">Wheeler (2006) · Potato / controlled environment<ExternalLink size={13} /></a>
      <a href="https://www.nasa.gov/missions/station/iss-research/nasa-achieves-water-recovery-milestone-on-international-space-station/" target="_blank" rel="noreferrer">NASA · ISS water recovery: 93–94% → 98%<ExternalLink size={13} /></a>
      <a href="https://science.nasa.gov/science-research/earth-science/climate-science/four-decades-and-counting-new-nasa-instrument-continues-measuring-solar-energy-input-to-earth/" target="_blank" rel="noreferrer">NASA · Total solar irradiance: 1,361 W/m²<ExternalLink size={13} /></a>
    </section>
  </div>
}

function AssetLibrary({ language }: { language: string }): JSX.Element {
  const c = colonyCopy(language)
  const total = provenance.assets.reduce((sum, a) => sum + a.bytes, 0)
  return <div className="colony-assets">
    <div className="colony-asset-summary"><span><Box size={20} />14 <small>CC0 / GLB</small></span><span>{number(total / 1024)} KB <small>{c.total}</small></span><a href="/models/colony/manifest.json" target="_blank" rel="noreferrer">{c.manifest}<ExternalLink size={13} /></a></div>
    <div className="colony-asset-grid">{provenance.assets.map((asset, index) => <article className="colony-asset-card" key={asset.file}><div className="colony-asset-index">{String(index + 1).padStart(2, '0')}<Box size={18} /></div><h2>{asset.file}</h2><span className="colony-reference-tag">CC0-1.0</span><dl><div><dt>{c.author}</dt><dd>{asset.author}</dd></div><div><dt>PACK</dt><dd>{asset.pack}</dd></div><div><dt>GLB</dt><dd>{number(asset.bytes / 1024, 1)} KB</dd></div></dl><a href={asset.sourceUrl} target="_blank" rel="noreferrer">{c.source}<ExternalLink size={12} /></a></article>)}</div>
    <p className="colony-study-card colony-fineprint">{c.assetNotice}</p>
    <div className="colony-reference-links"><a href="https://quaternius.com/packs/ultimatespacekit.html" target="_blank" rel="noreferrer">Quaternius · Ultimate Space Kit / CC0<ExternalLink size={13} /></a><a href="https://kenney.nl/assets/space-kit" target="_blank" rel="noreferrer">Kenney · Space Kit / CC0<ExternalLink size={13} /></a><a href="https://kenney.nl/assets/survival-kit" target="_blank" rel="noreferrer">Kenney · Survival Kit / CC0<ExternalLink size={13} /></a></div>
  </div>
}
