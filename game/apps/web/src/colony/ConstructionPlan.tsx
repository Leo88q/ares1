import { useState } from 'react'
import type { ColonyState, ModuleKind } from './simulation'
import { CATALOG } from './simulation'
import { COLONY_GRID_SIZE, COLONY_MODULE_LIMIT, footprint, modulePlacement, placementError, type Placement } from './layout'
import { moduleCopy } from './copy'
import { placementHitsNetwork, networksOf, NETWORK_COLORS } from './networks'
import './construction.css'

export interface ConstructionDraft { kind: ModuleKind; at: Placement; moveId?: string }

/** Always available, including when WebGL is lost. Taps select a draft; only an
 * explicit confirm may change resources. Coordinate fields offer keyboard/AT
 * access to every cell without thousands of tiny focusable cell buttons.
 */
export default function ConstructionPlan({ state, draft, language, onDraft, onConfirm, onCancel }: {
  state: ColonyState; draft: ConstructionDraft; language: string
  onDraft(draft: ConstructionDraft): void; onConfirm(): void; onCancel(): void
}): JSX.Element {
  const ru = language === 'ru', names = moduleCopy(language)
  const [span, setSpan] = useState(24)
  const [origin, setOrigin] = useState({ x: 10, z: 10 })
  const [w, d] = footprint(draft.kind, draft.at.rotation)
  const problem = placementError(state.modules, draft.kind, draft.at, draft.moveId) ?? (placementHitsNetwork(state, draft.kind, draft.at, draft.moveId) ? 'network' : null)
  const moving = state.modules.find(m => m.id === draft.moveId)
  const original = moving ? modulePlacement(moving) : null
  const unchanged = original && original.x === draft.at.x && original.z === draft.at.z && original.rotation === draft.at.rotation
  const affordable = !!draft.moveId || (state.credits >= CATALOG[draft.kind].credits && state.sparesKg >= 1 && state.modules.length < COLONY_MODULE_LIMIT)
  const error = unchanged ? (ru ? 'Выберите новое место или измените поворот. Линии пока не отсоединены.' : 'Choose a new site or rotation. Lines are still attached.')
    : problem === 'network' ? (ru ? 'Здесь проходит коммуникация. Выберите другое место или демонтируйте линию.' : 'A utility crosses this site. Choose another site or remove the line.')
    : problem === 'occupied' ? (ru ? 'Место занято — выберите свободную площадку.' : 'Occupied — choose a clear site.')
    : problem ? (ru ? 'Модуль выходит за границы карты.' : 'The module extends outside the map.')
    : !affordable ? (ru ? 'Недостаточно CR, запчастей или достигнут лимит модулей.' : 'Insufficient CR/spares or module limit reached.')
    : (ru ? 'Площадка свободна. Подтвердите размещение.' : 'Site clear. Confirm placement.')
  const change = (at: Partial<Placement>): void => onDraft({ ...draft, at: { ...draft.at, ...at } })
  const pan = (x: number, z: number): void => setOrigin(p => ({ x: Math.max(0, Math.min(COLONY_GRID_SIZE - span, p.x + x)), z: Math.max(0, Math.min(COLONY_GRID_SIZE - span, p.z + z)) }))
  const zoom = (next: number): void => {
    setSpan(next)
    setOrigin(p => ({ x: Math.max(0, Math.min(48 - next, p.x + (span - next) / 2)), z: Math.max(0, Math.min(48 - next, p.z + (span - next) / 2)) }))
  }
  return <section className="colony-construction" data-testid="construction-plan" aria-label={ru ? 'План строительства' : 'Construction plan'}>
    <header><b>{draft.moveId ? (ru ? 'ПЕРЕМЕСТИТЬ' : 'RELOCATE') : (ru ? 'РАЗМЕСТИТЬ' : 'PLACE')} · {names[draft.kind].name}</b><span>48 × 48 · 2.4 {ru ? 'м/клетка' : 'm/cell'}</span></header>
    <p>{ru ? 'Выберите место на 3D-карте или на плане. Предпросмотр ничего не списывает.' : 'Choose a site in 3D or on the plan. Preview never spends resources.'}</p>
    <svg viewBox={`${origin.x} ${origin.z} ${span} ${span}`} className="colony-construction-map" role="img" aria-label={ru ? 'Нажмите, чтобы выбрать клетку' : 'Tap to choose a cell'}
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        change({ x: Math.floor(origin.x + (event.clientX - rect.left) / rect.width * span), z: Math.floor(origin.z + (event.clientY - rect.top) / rect.height * span) })
      }}>
      <title>{ru ? 'Модули и предпросмотр размещения; координаты также доступны в полях ниже.' : 'Modules and placement preview; coordinates are also available below.'}</title>
      <rect x={0} y={0} width={48} height={48} fill="#292c25" />
      {Array.from({ length: 49 }, (_, i) => <path key={i} d={`M ${i} 0 V 48 M 0 ${i} H 48`} stroke="#847050" strokeWidth={0.025} />)}
      {state.modules.map(m => {
        const at = modulePlacement(m), [mw, md] = footprint(m.kind, at.rotation)
        return <g key={m.id} opacity={m.id === draft.moveId ? 0.25 : 1}>
          <rect x={at.x + 0.08} y={at.z + 0.08} width={mw - 0.16} height={md - 0.16} fill={CATALOG[m.kind].color} opacity={0.65} />
          <text x={at.x + mw / 2} y={at.z + md / 2} textAnchor="middle" dominantBaseline="central" fontSize={0.53} fill="#111912">{names[m.kind].code}</text>
        </g>
      })}
      {networksOf(state).map(n => <polyline key={n.id} points={n.cells.map(p => `${p.x + 0.5},${p.z + 0.5}`).join(' ')} fill="none" stroke={NETWORK_COLORS[n.type]} strokeWidth={0.12} />)}
      <rect data-testid="construction-ghost" x={draft.at.x + 0.04} y={draft.at.z + 0.04} width={w - 0.08} height={d - 0.08} fill={problem ? '#f07054' : '#b3df95'} fillOpacity={0.4} stroke={problem ? '#ff9572' : '#d0f5a4'} strokeWidth={0.12} />
    </svg>
    <div className="colony-plan-navigation" aria-label={ru ? 'Навигация по плану' : 'Plan navigation'}>
      <button type="button" aria-label={ru ? 'План влево' : 'Plan left'} onClick={() => pan(-4, 0)}>←</button>
      <button type="button" aria-label={ru ? 'План вверх' : 'Plan up'} onClick={() => pan(0, -4)}>↑</button>
      <button type="button" aria-label={ru ? 'План вниз' : 'Plan down'} onClick={() => pan(0, 4)}>↓</button>
      <button type="button" aria-label={ru ? 'План вправо' : 'Plan right'} onClick={() => pan(4, 0)}>→</button>
      <button type="button" aria-label={ru ? 'Приблизить план' : 'Zoom plan in'} disabled={span <= 12} onClick={() => zoom(span / 2)}>+</button>
      <button type="button" aria-label={ru ? 'Отдалить план' : 'Zoom plan out'} disabled={span >= 48} onClick={() => zoom(span * 2)}>−</button>
    </div>
    <div className="colony-plan-coordinates">
      <label>X<input aria-label={ru ? 'Клетка X' : 'Cell X'} type="number" min={0} max={47} value={draft.at.x} onChange={e => change({ x: Number(e.target.value) })} /></label>
      <label>Z<input aria-label={ru ? 'Клетка Z' : 'Cell Z'} type="number" min={0} max={47} value={draft.at.z} onChange={e => change({ z: Number(e.target.value) })} /></label>
      <button type="button" onClick={() => change({ rotation: ((draft.at.rotation + 1) % 4) as Placement['rotation'] })}>{ru ? 'Повернуть' : 'Rotate'} · {draft.at.rotation * 90}°</button>
    </div>
    <p role="status" data-testid="placement-status" className={problem || !affordable ? 'is-invalid' : 'is-valid'}>{error}</p>
    <small>{draft.moveId ? (ru ? 'Перенос отсоединит все линии этого модуля без возврата CR. Износ и грядки сохраняются.' : 'Relocation disconnects all attached lines without refunds. Condition and crops are preserved.') : `${CATALOG[draft.kind].credits} CR + 1 ${ru ? 'кг запчастей' : 'kg spares'}`} · {w} × {d}</small>
    <div className="colony-plan-actions">
      <button type="button" className="colony-button" onClick={onCancel}>{ru ? 'Отменить размещение' : 'Cancel placement'}</button>
      <button type="button" className="colony-button colony-button--primary" disabled={!!problem || !affordable || !!unchanged} onClick={onConfirm}>{ru ? 'Подтвердить размещение' : 'Confirm placement'}</button>
    </div>
  </section>
}
