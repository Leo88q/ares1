import { useState } from 'react'
import ResourceIcon from '../ResourceIcon'
import { engineeringCopy } from './copy'
import { LAB, canHarvest, cropStage, labScale, lotQuality, storageKg } from './engine'
import type { EngineeringAction, EngineeringState, LabEventCode } from './engine'
import './engineering.css'

export default function EngineeringConsole({ state, language, onAction, onReset }: {
  state: EngineeringState
  language: string
  onAction(action: EngineeringAction): void
  onReset(): void
}): JSX.Element {
  const [panel, setPanel] = useState<'controls' | 'climate' | 'service'>('controls')
  const c = engineeringCopy(language), scale = labScale(state.tier), stage = cropStage(state.crop)
  const fmt = (value: number, places = 1): string => value.toFixed(places)
  const alert = !state.controls.lights && state.crop.planted ? c.lightOffAlert : {
    none: c.stable, pump: c.pumpAlert, water: c.waterAlert, power: c.powerAlert,
    nutrients: c.nutrientAlert, storage: c.storageAlert, temperature: c.temperatureAlert, dead: c.deadAlert,
  }[state.last.bottleneck]
  const eventNames: Record<LabEventCode, string> = { seed: c.eventSeed, harvest: c.eventHarvest, refill: c.eventRefill, fault: c.eventFault, repair: c.eventRepair, dust: c.eventDust, process: c.eventProcess, processed: c.eventProcessed, spoiled: c.eventSpoiled, dead: c.eventDead, cold: c.eventCold, supply: c.eventSupply, ship: c.eventShip }
  const metrics = [
    { label: c.energy, value: fmt(state.batteryKwh), limit: fmt(LAB.batteryCapacityKwh * scale), unit: 'kWh', fraction: state.batteryKwh / (LAB.batteryCapacityKwh * scale), kind: 'battery' as const },
    { label: c.water, value: fmt(state.tankL), limit: fmt(LAB.tankCapacityL * scale), unit: 'L', fraction: state.tankL / (LAB.tankCapacityL * scale), kind: 'water' as const },
  ]
  return <section className="eg-console" data-testid="engineering-console" data-field-id={state.fieldId}>
    <div className="eg-eyebrow">{c.eyebrow}</div>
    <h3>{c.title}<span>SIM</span></h3>
    <p className="eg-boundary">{c.boundary}</p>
    <div className="eg-clock"><span>{c.clock}</span><b data-testid="lab-hour">{fmt(state.hour)} {c.hour}</b><small>{c.sol} {Math.floor(state.hour / LAB.solHours) + 1}</small></div>
    <div className="eg-steps">
      {[{ label: c.addHour, hours: 1 }, { label: c.addSol, hours: LAB.solHours }, { label: c.addWeek, hours: 7 * LAB.solHours }].map(step => <button type="button" key={step.hours} disabled={state.hour >= LAB.maxHours - 1e-9} onClick={() => onAction({ type: 'advance', hours: step.hours })}>{step.label}</button>)}
    </div>
    {state.hour >= LAB.maxHours - 1e-9 && <p role="status" className="eg-warning">{c.end}</p>}
    <div className="eg-meters">
      {metrics.map(metric => <div className="eg-meter" key={metric.label}>
        <label><ResourceIcon kind={metric.kind} size={38} />{metric.label}</label><b>{metric.value}<small> / {metric.limit} {metric.unit}</small></b>
        <div><i style={{ width: `${metric.fraction * 100}%` }} /></div>
      </div>)}
    </div>
    <nav className="eg-console-tabs" aria-label={c.title}>
      {(['controls', 'climate', 'service'] as const).map(tab => <button type="button" key={tab} aria-pressed={panel === tab} onClick={() => setPanel(tab)}>{tab === 'controls' ? c.controlsTab : tab === 'climate' ? c.climateTab : c.serviceTab}</button>)}
    </nav>
    <div className="eg-console-page" data-console-panel={panel}>
    <div hidden={panel !== 'climate'} className="eg-console-section">
    <div className="eg-climate" data-testid="lab-climate">
      <div className="eg-climate-heading"><ResourceIcon kind="temperature" size={30} /><span>{c.temperature}</span><b data-testid="lab-temperature">{fmt(state.temperatureC)} °C</b></div>
      <div className="eg-climate-details"><span>{c.outside} <b data-testid="lab-outside">{fmt(state.last.outsideC)} °C</b></span><span>{c.growthFactor} <b data-testid="lab-temperature-factor">{fmt(state.last.temperatureFactor * 100, 0)}%</b></span></div>
      <label className="eg-thermostat"><span>{c.target} <b>{fmt(state.controls.targetC, 0)} °C</b></span>
        <input type="range" min={LAB.minTargetC} max={LAB.maxTargetC} step={1} value={state.controls.targetC} aria-label={c.target} onChange={event => onAction({ type: 'setpoint', value: Number(event.target.value) })} />
      </label>
      <small>{state.last.climateMode === 'heating' ? c.heating : state.last.climateMode === 'cooling' ? c.coolingClimate : c.climateIdle} · {fmt(state.last.climateKw, 2)} kW</small>
    </div>
    </div>
    <div hidden={panel !== 'controls'} className="eg-console-section">
    <div className="eg-flows">
      <span><ResourceIcon kind="solar" size={22} />{c.solar}<b>{fmt(state.last.solarKw, 2)} kW</b></span>
      <span>{c.consumed}<b>{fmt(state.last.servedKw, 2)} kW</b></span>
      <span>{c.line}<b>{fmt(state.lineL)} L</b></span>
      <span>{c.nutrients}<b>{fmt(state.nutrientsKg, 3)} kg</b></span>
    </div>
    <div className="eg-toggles">
      {([
        ['lights', state.controls.lights ? c.lightsOn : c.lightsOff],
        ['pump', state.controls.pump ? c.pumpOn : c.pumpOff],
        ['battery', state.controls.battery ? c.batteryOn : c.batteryOff],
        ['cooling', state.controls.cooling ? c.coldOn : c.coldOff],
        ['climate', state.controls.climate ? c.climateOn : c.climateOff],
      ] as const).map(([control, label]) => <button type="button" key={control} aria-pressed={state.controls[control]} onClick={() => onAction({ type: 'toggle', control })}>{label}</button>)}
    </div>
    <div className="eg-priority" aria-label={c.priority} data-testid="lab-priority"><span>{c.priority}</span>
      <div>{(['crop', 'food'] as const).map(value => <button type="button" key={value} aria-pressed={state.controls.priority === value} onClick={() => onAction({ type: 'priority', value })}>{value === 'crop' ? c.priorityCrop : c.priorityFood}</button>)}</div>
    </div>
    <div className="eg-alert" role="status" data-testid="lab-bottleneck" data-cause={state.last.bottleneck}>{alert}</div>
    {state.hour < state.dustUntil && <span className="eg-dust">{c.dustActive} · {fmt(state.dustUntil - state.hour)} {c.hour}</span>}
    {state.hour < state.coldUntil && <span className="eg-cold-warning">{c.coldActive} · {fmt(state.coldUntil - state.hour)} {c.hour}</span>}
    <div className="eg-crop">
      <div><ResourceIcon kind="crop" size={28} /><label>{c.crop}</label><b data-testid="lab-stage" data-stage={stage}>{c[stage]}</b></div>
      <div className="eg-progress"><i style={{ width: `${state.crop.progress * 100}%` }} /></div>
      <div className="eg-crop-stats"><span>{fmt(state.crop.progress * 100, 0)}%</span><span>{c.cropHealth} <b>{fmt(state.crop.health * 100, 0)}%</b></span></div>
      <button type="button" className="eg-primary" disabled={!canHarvest(state)} onClick={() => onAction({ type: 'harvest' })}>{c.harvest}</button>
      <div className="eg-buttons-row">
        <button type="button" disabled={state.crop.planted || state.seeds <= 0} onClick={() => onAction({ type: 'plant' })}>{c.plant}</button>
        <button type="button" disabled={!state.crop.planted} onClick={() => onAction({ type: 'clear' })}>{c.clear}</button>
      </div>
    </div>
    </div>
    <div hidden={panel !== 'service'} className="eg-console-section">
    <div className="eg-service">
      <div className="eg-eyebrow"><ResourceIcon kind="service" size={23} /> ARES / SERVICE</div>
      <button type="button" disabled={state.supplyL <= 1e-9 || state.tankL >= LAB.tankCapacityL * scale - 1e-9} onClick={() => onAction({ type: 'refill' })}>{c.refill}</button>
      <div className="eg-buttons-row">
        <button type="button" onClick={() => onAction({ type: 'dust' })}>{c.dust}</button>
        <button type="button" disabled={state.controls.pumpFault} onClick={() => onAction({ type: 'fault' })}>{c.fault}</button>
      </div>
      <button type="button" onClick={() => onAction({ type: 'cold' })}>{c.coldScenario}</button>
      <button type="button" disabled={!state.controls.pumpFault || state.spares <= 0} onClick={() => onAction({ type: 'repair' })}>{c.repair}</button>
      <p>{c.supply}: <b>{fmt(state.supplyL)} L</b> · {c.seeds}: <b>{state.seeds}</b> · {c.spares}: <b>{state.spares}</b></p>
    </div>
    <details className="eg-log"><summary>{c.events}</summary><ol>{state.events.slice(-6).reverse().map((item, index) => <li key={`${item.hour}:${index}`}><time>{fmt(item.hour)} {c.hour}</time>{eventNames[item.code]}{item.amount > 0 && <b>{fmt(item.amount)}</b>}</li>)}</ol></details>
    <button type="button" className="eg-reset" onClick={onReset}>{c.reset}</button>
    </div>
    </div>
    <small className="eg-version">{c.version}</small>
  </section>
}

export type EngineeringView = 'telemetry' | 'inventory' | 'log'
export function EngineeringTelemetry({ state, language, onAction, view = 'telemetry', onView }: { state: EngineeringState; language: string; onAction(action: EngineeringAction): void; view?: EngineeringView; onView?(view: EngineeringView): void }): JSX.Element {
  const c = engineeringCopy(language)
  const temperatures = state.history.flatMap(sample => [sample.temperatureC, sample.targetC])
  const lowC = Math.floor(Math.min(0, ...temperatures) / 10) * 10
  const highC = Math.ceil(Math.max(30, ...temperatures) / 10) * 10
  const climateY = (value: number): number => 90 - (value - lowC) / (highC - lowC) * 80
  const lines = [{ key: 'battery' as const, label: c.chartBattery, color: '#e0b877' }, { key: 'water' as const, label: c.chartWater, color: '#8bb8b2' }, { key: 'growth' as const, label: c.chartCrop, color: '#a7bc78' }]
  return <div className="eg-telemetry" data-testid="engineering-telemetry" data-field-id={state.fieldId}>
    <nav className="eg-deck-tabs" aria-label={c.telemetry}>
      {(['telemetry', 'inventory', 'log'] as const).map(tab => <button type="button" key={tab} aria-pressed={view === tab} onClick={() => onView?.(tab)}><ResourceIcon kind={tab === 'inventory' ? 'food' : tab === 'log' ? 'log' : 'telemetry'} size={23} />{tab === 'inventory' ? c.inventoryTab : tab === 'log' ? c.logTab : c.telemetryTab}</button>)}
    </nav>
    <div className="eg-deck-pane" hidden={view !== 'telemetry'}>
    <div className="eg-chart-header"><h3>{c.telemetry}</h3><span>SIM / %</span></div>
    <svg className="eg-chart" viewBox="0 0 600 130" role="img" aria-label={c.telemetryLabel}>
      <title>{c.telemetryLabel}</title>
      {[0, 50, 100].map(y => <g key={y}><line x1="35" y1={110 - y} x2="590" y2={110 - y} /><text x="4" y={114 - y}>{y}</text></g>)}
      {lines.map(line => <polyline key={line.key} fill="none" stroke={line.color} points={state.history.map((sample, i) => `${35 + i / Math.max(1, state.history.length - 1) * 555},${110 - sample[line.key] * 100}`).join(' ')} />)}
    </svg>
    <div className="eg-chart-legend">{lines.map(line => <span key={line.key}><i style={{ background: line.color }} />{line.label}</span>)}<span>{state.history[0]?.hour.toFixed(1)}–{state.hour.toFixed(1)} {c.hour}</span></div>
    <div className="eg-temperature-chart" data-testid="lab-temperature-chart">
      <div className="eg-chart-header"><h3>{c.temperatureChart}</h3><span>SIM / °C</span></div>
      <svg className="eg-chart" viewBox="0 0 600 110" role="img" aria-label={c.temperatureChartLabel}>
        <title>{c.temperatureChartLabel}</title>
        {[lowC, (lowC + highC) / 2, highC].map(y => <g key={y}><line x1="35" y1={climateY(y)} x2="590" y2={climateY(y)} /><text x="4" y={climateY(y) + 4}>{y}</text></g>)}
        <polyline className="eg-climate-target" fill="none" stroke="#a5ae89" points={state.history.map((sample, i) => `${35 + i / Math.max(1, state.history.length - 1) * 555},${climateY(sample.targetC)}`).join(' ')} />
        <polyline fill="none" stroke="#d89c74" points={state.history.map((sample, i) => `${35 + i / Math.max(1, state.history.length - 1) * 555},${climateY(sample.temperatureC)}`).join(' ')} />
      </svg>
      <div className="eg-chart-legend"><span>{c.temperature}</span><span>{c.target}</span></div>
    </div>
    </div>
    <div className="eg-deck-pane" hidden={view !== 'inventory'}>
    <div className="eg-inventory">
      <div className="eg-chart-header"><h3>{c.ledger}</h3><span>{storageKg(state).toFixed(1)} / {(LAB.storageCapacityKg * labScale(state.tier)).toFixed(1)} kg</span></div>
      {state.processing && <p role="status" data-testid="lab-processing">{c.processing}: {state.processing.remainingKg.toFixed(1)} kg</p>}
      {state.lots.length === 0 ? <p className="eg-empty">{c.noLots}</p> : <ul>
        {state.lots.map(lot => <li key={lot.id} data-lot-id={lot.id}>
          <div><b>#{String(lot.id).padStart(2, '0')} · {lot.kind === 'raw' ? c.raw : c.processed}</b><span>{lot.kg.toFixed(2)} kg</span></div>
          <small>{c.quality}: {(lotQuality(lot) * 100).toFixed(0)}% · {c.age}: {lot.ageHours.toFixed(1)} {c.hour}</small>
          {lot.kind === 'raw' && <button type="button" disabled={!!state.processing || lotQuality(lot) < 0.25 || state.lots.length >= LAB.maxLots} onClick={() => onAction({ type: 'process', lotId: lot.id })}>{c.process}</button>}
        </li>)}
      </ul>}
      <div className="eg-mass-ledger" data-testid="lab-mass-ledger"><span>{c.harvested}: <b>{state.totals.harvestedKg.toFixed(2)} kg</b></span><span>{c.spoiled}: <b>{state.totals.spoiledKg.toFixed(2)} kg</b></span><span>{c.loss}: <b>{state.totals.processingLossKg.toFixed(2)} kg</b></span></div>
    </div>
    </div>
    <div className="eg-deck-pane eg-deck-log" hidden={view !== 'log'}>
      <h3>{c.events}</h3>
      <ol>{state.events.slice(-12).reverse().map((event, index) => <li key={`${event.hour}:${index}`}><time>{event.hour.toFixed(1)} {c.hour}</time><span>{({ seed: c.eventSeed, harvest: c.eventHarvest, refill: c.eventRefill, fault: c.eventFault, repair: c.eventRepair, dust: c.eventDust, process: c.eventProcess, processed: c.eventProcessed, spoiled: c.eventSpoiled, dead: c.eventDead, cold: c.eventCold, supply: c.eventSupply, ship: c.eventShip })[event.code]}</span>{event.amount > 0 && <b>{event.amount.toFixed(1)}</b>}</li>)}</ol>
    </div>
    <p className="eg-source-note">{c.sourceNote}</p>
  </div>
}

export function EngineeringFlow({ state, language }: { state: EngineeringState; language: string }): JSX.Element {
  const c = engineeringCopy(language)
  const nodes = [
    { label: c.energy, kind: 'battery' as const, value: `${state.batteryKwh.toFixed(1)} kWh`, ok: state.batteryKwh > 1 },
    { label: c.water, kind: 'water' as const, value: `${state.tankL.toFixed(1)} L`, ok: state.tankL > 1 },
    { label: c.temperature, kind: 'temperature' as const, value: `${state.temperatureC.toFixed(1)} °C`, ok: state.last.temperatureFactor >= 0.75 },
    { label: c.crop, kind: 'crop' as const, value: c[cropStage(state.crop)], ok: state.crop.health > 0.6 },
  ]
  return <div className="eg-topology" data-testid="lab-topology" aria-label={c.visibleBoundary}>
    {nodes.map(node => <div key={node.label} className={node.ok ? 'is-active' : ''}><ResourceIcon kind={node.kind} size={42} /><span>{node.label}</span><b>{node.value}</b></div>)}
  </div>
}
