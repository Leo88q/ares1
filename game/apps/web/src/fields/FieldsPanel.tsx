import { Component, lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, ChevronLeft, ChevronRight, LayoutGrid, Layers, Sprout } from 'lucide-react'
import { fieldCopy } from './copy'
import { FIELD_PROFILES, FIELDS_PER_PAGE, selectedFieldId, visibleFields } from './model'
import type { FieldVisual } from './model'
import { slotsReady } from '../slots/config'
import './fields.css'
import './art-direction.css'

const FieldsViewport = lazy(() => import('./FieldsViewport'))
// Paid SKR slots stay closed until a separately approved launch; this route is never loaded.
const SlotsPanel = lazy(() => import('../slots/SlotsPanel'))

// A failed lazy scene chunk must not hide the real account inspector/actions.
class ViewportBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children }
}

/** Read-only field rendering; all mutations live in the on-chain account inspector. */
export default function FieldsPanel({ fields, language, renderInspector, renderCards, onSelection }: {
  fields: readonly FieldVisual[]
  language: string
  renderInspector(field: FieldVisual): ReactNode
  renderCards?: () => ReactNode
  onSelection?(field: FieldVisual): void
}): JSX.Element {
  const c = fieldCopy(language)
  const [requestedId, setRequestedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'3d' | 'cards'>('3d')
  const [overview, setOverview] = useState(false), [roof, setRoof] = useState(false)
  const selectedId = selectedFieldId(fields, requestedId)
  const selected = fields.find(field => field.id === selectedId)
  const pageFields = visibleFields(fields, selectedId)
  const index = Math.max(0, fields.findIndex(field => field.id === selectedId))
  const page = Math.floor(index / FIELDS_PER_PAGE)
  const pages = Math.ceil(fields.length / FIELDS_PER_PAGE)

  function select(id: string): void {
    const field = fields.find(field => field.id === id)
    if (!field) return
    setRequestedId(id)
    onSelection?.(field)
  }

  return (
    <section className="mf-panel" data-testid="fields-panel" aria-label={c.title}>
      <div className="mf-panel-header">
        <div><span className="mf-eyebrow">{c.subtitle}</span><h2>{c.title}<span>{String(fields.length).padStart(2, '0')}</span></h2></div>
        {renderCards && <div className="mf-view-toggle" aria-label={c.title}>
          <button type="button" aria-pressed={mode === '3d'} onClick={() => setMode('3d')}><Box size={14} />{c.view3d}</button>
          <button type="button" aria-pressed={mode === 'cards'} onClick={() => setMode('cards')}><LayoutGrid size={14} />{c.cards}</button>
        </div>}
      </div>
      {mode === 'cards' && renderCards ? <div className="mf-card-grid">{renderCards()}</div> : selected ? <>
        <div className="mf-field-picker" aria-label={c.listLabel}>
          {pageFields.map(field => {
            const fieldIndex = fields.findIndex(item => item.id === field.id)
            return <button type="button" key={field.id} data-field-id={field.id} className={selectedId === field.id ? 'is-selected' : ''}
              aria-pressed={selectedId === field.id} onClick={() => select(field.id)}>
              <span><i className={field.ready ? 'is-ready' : ''} />{c.field} {String(fieldIndex + 1).padStart(2, '0')}</span>
              <b>{FIELD_PROFILES[field.tier].name}</b><small>{c.level} {field.level}</small>
            </button>
          })}
        </div>
        {pages > 1 && <div className="mf-pagination">
          <button type="button" className="mf-button" aria-label={c.previous} disabled={page === 0} onClick={() => select(fields[(page - 1) * FIELDS_PER_PAGE].id)}><ChevronLeft size={16} /></button>
          <span>{page + 1} / {pages}</span>
          <button type="button" className="mf-button" aria-label={c.next} disabled={page >= pages - 1} onClick={() => select(fields[(page + 1) * FIELDS_PER_PAGE].id)}><ChevronRight size={16} /></button>
        </div>}
        <div className="mf-workspace">
          <div className="mf-view-area">
            <div className="mf-scene-options">
              <button type="button" aria-pressed={!overview} onClick={() => setOverview(false)}><Sprout size={13} />{c.detail}</button>
              <button type="button" aria-pressed={overview} onClick={() => setOverview(true)}><LayoutGrid size={13} />{c.overview}</button>
              <button type="button" aria-pressed={roof} onClick={() => setRoof(value => !value)}><Layers size={13} />{c.roof}</button>
            </div>
            <ViewportBoundary fallback={<div className="mf-viewport mf-fallback" role="status">{c.modelError}</div>}>
              <Suspense fallback={<div className="mf-viewport mf-loading" role="status">{c.loading}</div>}>
                <FieldsViewport fields={pageFields} selectedId={selectedId} overview={overview} roof={roof} language={language} onSelect={select} />
              </Suspense>
            </ViewportBoundary>
            <div className="mf-status-strip" data-testid="fields-status">
              <span className={selected.ready ? 'is-ready' : ''}><i />{!selected.active ? c.inactive : selected.ready ? c.ready : c.normal}</span>
              <span>{c.condition} <b>{Math.round(selected.condition * 100)}%</b></span>
              {selected.fertilized && <span className="is-ready">{c.fertilizer}</span>}
              {selected.taxExpired && <span className="is-warning">{c.tax}</span>}
              {selected.condition < 0.6 && <span className="is-warning">{c.repair}</span>}
            </div>
          </div>
          <div className="mf-inspector" aria-label={c.selectedLabel} data-selected-id={selected.id}>
            {renderInspector(selected)}
          </div>
          {slotsReady() && <Suspense fallback={null}><SlotsPanel fieldId={selected.id} /></Suspense>}
        </div>
      </> : <p className="mf-empty">{c.noFields}</p>}
      <footer className="mf-footer"><p>{c.note}</p><span>{c.source}</span><a href="/models/fields/manifest.json" target="_blank" rel="noopener noreferrer">{c.credits} ↗</a></footer>
    </section>
  )
}
