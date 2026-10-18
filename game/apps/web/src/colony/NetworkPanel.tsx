import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ColonyState } from './simulation'
import { moduleCopy } from './copy'
import { footprint, modulePlacement } from './layout'
import { addNetwork, removeNetwork, planNetwork, networkCost, networkServices, networksOf, supportsNetwork,
  NETWORK_TYPES, NETWORK_COLORS, NETWORK_CREDITS_PER_CELL, type ColonyNetwork, type NetworkType } from './networks'
import './construction.css'

export function networkName(type: NetworkType, ru: boolean): string {
  return ({ power: ru ? 'Электрокабель' : 'Power cable', water: ru ? 'Подача воды' : 'Water supply',
    return: ru ? 'Возврат воды' : 'Water return', tunnel: ru ? 'Гермопереход' : 'Pressure tunnel' })[type]
}
export default function NetworkPanel({ state, language, selectedId, onChange, onPreview }: {
  state: ColonyState; language: string; selectedId: string | null
  onChange: Dispatch<SetStateAction<ColonyState>>; onPreview: Dispatch<SetStateAction<ColonyNetwork | null>>
}): JSX.Element {
  const ru = language === 'ru', names = moduleCopy(language)
  const [type, setType] = useState<NetworkType>('power')
  const [fromId, setFromId] = useState(selectedId ?? '')
  const [toId, setToId] = useState('')
  const [useVia, setUseVia] = useState(false)
  const [via, setVia] = useState({ x: 24, z: 24 })
  const [span, setSpan] = useState(24)
  const [removeId, setRemoveId] = useState('')
  const [message, setMessage] = useState('')
  const networks = useMemo(() => networksOf(state), [state])
  const eligible = state.modules.filter(m => supportsNetwork(m.kind, type))
  const from = eligible.find(m => m.id === fromId) ?? eligible[0]
  const preferred = type === 'water' || type === 'return' ? 'recycler' : 'habitat'
  const to = eligible.find(m => m.id === toId && m.id !== from?.id) ?? eligible.find(m => m.kind === preferred && m.id !== from?.id) ?? eligible.find(m => m.id !== from?.id)
  const preview = useMemo(() => from && to ? planNetwork(state, type, from.id, to.id, useVia ? via : undefined) : null,
    [state, type, from, to, useVia, via])
  const duplicate = networks.some(n => n.type === type && ((n.from === from?.id && n.to === to?.id) || (n.to === from?.id && n.from === to?.id)))
  const affordable = preview && state.credits >= networkCost(preview)
  const services = useMemo(() => networkServices(state), [state])
  const p = from ? modulePlacement(from) : { x: 24, z: 24 }
  const origin = { x: Math.max(0, Math.min(48 - span, p.x - span / 2)), z: Math.max(0, Math.min(48 - span, p.z - span / 2)) }
  const label = (id: string): string => {
    const m = state.modules.find(m => m.id === id)
    return m ? `${names[m.kind].name} · ${m.id}` : id
  }
  useEffect(() => { onPreview(preview); return () => onPreview(null) }, [preview, onPreview])
  return <section className="colony-construction colony-network-panel" data-testid="network-panel">
    <header><b>{ru ? 'КОММУНИКАЦИИ' : 'UTILITY NETWORKS'}</b></header>
    <p>{ru ? 'Одна магистраль базы: электросеть и гермопереходы идут от первого жилого модуля, вода — от подключённого регенератора. Пересечение линий не создаёт соединение.' : 'One base backbone: power and access start at the first habitat, water at a wired recycler. Crossing lines do not form junctions.'}</p>
    <label>{ru ? 'Тип сети' : 'Network type'}<select aria-label={ru ? 'Тип сети' : 'Network type'} value={type} onChange={e => { setType(e.target.value as NetworkType); setMessage('') }}>
      {NETWORK_TYPES.map(t => <option key={t} value={t}>{networkName(t, ru)} · {NETWORK_CREDITS_PER_CELL[t]} CR/{ru ? 'сегмент' : 'segment'}</option>)}
    </select></label>
    <label>{ru ? 'От модуля' : 'From module'}<select aria-label={ru ? 'От модуля' : 'From module'} value={from?.id ?? ''} onChange={e => { setFromId(e.target.value); setMessage('') }}>
      {eligible.map(m => <option key={m.id} value={m.id}>{label(m.id)}</option>)}
    </select></label>
    <label>{ru ? 'К модулю' : 'To module'}<select aria-label={ru ? 'К модулю' : 'To module'} value={to?.id ?? ''} onChange={e => { setToId(e.target.value); setMessage('') }}>
      {eligible.filter(m => m.id !== from?.id).map(m => <option key={m.id} value={m.id}>{label(m.id)}</option>)}
    </select></label>
    <div className="colony-plan-actions">
      <button type="button" className="colony-button" aria-pressed={useVia} onClick={() => { setUseVia(v => !v); setMessage('') }}>{ru ? 'Через выбранную точку' : 'Use waypoint'} · {useVia ? 'ON' : 'OFF'}</button>
      <button type="button" className="colony-button" onClick={() => setSpan(s => s === 48 ? 24 : s === 24 ? 12 : 48)}>{ru ? 'Масштаб плана' : 'Plan scale'} · {span}×{span}</button>
    </div>
    <svg className="colony-construction-map" viewBox={`${origin.x} ${origin.z} ${span} ${span}`} role="img" aria-label={ru ? 'План коммуникаций' : 'Utility plan'} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      setVia({ x: Math.floor(origin.x + (event.clientX - rect.left) / rect.width * span), z: Math.floor(origin.z + (event.clientY - rect.top) / rect.height * span) }); setUseVia(true); setMessage('')
    }}>
      <title>{ru ? 'Линия обходит здания. Нажмите, чтобы задать промежуточную точку.' : 'Routes avoid buildings. Tap to set a waypoint.'}</title>
      <rect x={0} y={0} width={48} height={48} fill="#292c25" />
      {span <= 24 && Array.from({ length: 49 }, (_, i) => <path key={i} d={`M ${i} 0 V 48 M 0 ${i} H 48`} stroke="#847050" strokeWidth={0.025} />)}
      {state.modules.map(m => { const at = modulePlacement(m), [w, d] = footprint(m.kind, at.rotation)
        return <g key={m.id}><title>{label(m.id)}</title><rect x={at.x} y={at.z} width={w} height={d} fill={m.id === from?.id || m.id === to?.id ? '#d5c49a' : '#767668'} opacity={0.8} />
          {span <= 24 && <text x={at.x + w / 2} y={at.z + d / 2} textAnchor="middle" dominantBaseline="central" fontSize={0.48} fill="#152018">{names[m.kind].code}</text>}</g> })}
      {networks.map(n => <polyline key={n.id} points={n.cells.map(c => `${c.x + 0.5},${c.z + 0.5}`).join(' ')} fill="none" stroke={NETWORK_COLORS[n.type]} strokeWidth={0.13} opacity={0.55} />)}
      {preview && <polyline data-testid="network-route-preview" points={preview.cells.map(c => `${c.x + 0.5},${c.z + 0.5}`).join(' ')} fill="none" stroke={NETWORK_COLORS[type]} strokeWidth={0.35} />}
      {useVia && <circle cx={via.x + 0.5} cy={via.z + 0.5} r={0.4} fill="#fff0b3" />}
    </svg>
    {useVia && <div className="colony-plan-coordinates">
      <label>X<input aria-label={ru ? 'Точка X' : 'Waypoint X'} type="number" min={0} max={47} value={via.x} onChange={e => { setVia(v => ({ ...v, x: Number(e.target.value) })); setMessage('') }} /></label>
      <label>Z<input aria-label={ru ? 'Точка Z' : 'Waypoint Z'} type="number" min={0} max={47} value={via.z} onChange={e => { setVia(v => ({ ...v, z: Number(e.target.value) })); setMessage('') }} /></label>
    </div>}
    <p role="status" data-testid="network-route-status">{message || (duplicate ? (ru ? 'Эти модули уже соединены этим типом сети.' : 'This connection already exists.')
      : !preview ? (ru ? 'Нет допустимого пути или совместимых портов. Измените точку или модули.' : 'No valid route or compatible ports. Change the waypoint or modules.')
      : `${Math.max(1, preview.cells.length - 1)} ${ru ? 'сегм.' : 'segments'} · ${networkCost(preview)} CR${!affordable ? (ru ? ' · недостаточно CR' : ' · insufficient CR') : ''}`)}</p>
    <button type="button" className="colony-button colony-relocate" disabled={!preview || !affordable || !!duplicate} onClick={() => {
      if (!preview) return
      onChange(s => addNetwork(s, preview)); setMessage(ru ? 'Линия проложена.' : 'Line installed.')
    }}>{ru ? 'Проложить линию' : 'Install line'}</button>
    <label>{ru ? 'Существующая линия' : 'Existing line'}<select aria-label={ru ? 'Существующая линия' : 'Existing line'} value={removeId} onChange={e => { setRemoveId(e.target.value); setMessage('') }}>
      <option value="">{ru ? 'Выберите линию' : 'Choose a line'}</option>
      {networks.map(n => <option key={n.id} value={n.id}>{networkName(n.type, ru)} · {n.from} → {n.to}</option>)}
    </select></label>
    <button type="button" className="colony-button colony-relocate" disabled={!removeId} onClick={() => { onChange(s => removeNetwork(s, removeId)); setRemoveId(''); setMessage(ru ? 'Линия демонтирована. CR не возвращаются.' : 'Line removed. No CR refund.') }}>{ru ? 'Демонтировать без возврата CR' : 'Remove without CR refund'}</button>
    {from && <p data-testid="network-module-status">{label(from.id)}: {(['power', 'water', 'return', 'access'] as const).map(t => `${t}: ${services.get(from.id)?.[t] ? '✓' : '—'}`).join(' · ')}</p>}
    <small>{ru ? 'Предпросмотр бесплатный. Вода требует подачи, возврат обеспечивает регенерацию. Нет потерь напряжения или гидродинамики; пропускная способность считается прежними формулами.' : 'Preview is free. Supply enables watering; return enables recovery. No voltage drop or hydraulics; existing capacity formulas still apply.'}</small>
  </section>
}
