import { useEffect, useRef, useState } from 'react'
import { Focus, Minus, Plus } from 'lucide-react'
import { createFieldScene } from './scene'
import type { FieldScene } from './scene'
import { FIELD_PROFILES } from './model'
import type { FieldVisual } from './model'
import { fieldCopy } from './copy'
import { FIELD_ART } from './visualAssets'

export default function FieldsViewport({ fields, selectedId, overview, roof, language, onSelect }: {
  fields: readonly FieldVisual[]
  selectedId: string | null
  overview: boolean
  roof: boolean
  language: string
  onSelect(id: string): void
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null), scene = useRef<FieldScene | null>(null)
  const select = useRef(onSelect); select.current = onSelect
  const [failure, setFailure] = useState<'models' | 'context' | null>(null)
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const c = fieldCopy(language)
  const selected = fields.find(field => field.id === selectedId)

  useEffect(() => {
    if (failure || !host.current) return
    let active = true
    try {
      scene.current = createFieldScene(host.current, {
        onSelect: id => select.current(id),
        onReady: () => { if (active) setReady(true) },
        onFailure: reason => { if (active) setFailure(reason) },
      })
    } catch { setFailure('context') }
    return () => { active = false; scene.current?.dispose(); scene.current = null }
  }, [failure, attempt])

  useEffect(() => { scene.current?.update(fields, selectedId, overview, roof) }, [fields, selectedId, overview, roof, failure, attempt])

  return (
    <div className="mf-viewport" data-testid="fields-viewport" data-ready={ready && !failure} data-selected-id={selectedId ?? ''}>
      <img className="mf-stage-art" src={FIELD_ART.background} alt="" aria-hidden="true" draggable={false} />
      {failure ? (
        <div className="mf-fallback" data-testid="fields-fallback">
          <p role="status">{failure === 'models' ? c.modelError : c.noWebgl}</p>
          <img className="mf-fallback-image" src="/ares/plantation.webp" alt="" aria-hidden="true" />
          <button type="button" className="mf-button" onClick={() => { setReady(false); setFailure(null); setAttempt(value => value + 1) }}>{c.retry}</button>
        </div>
      ) : <div ref={host} className="mf-canvas-host" />}
      {!failure && !ready && <div className="mf-loading" role="status"><span />{c.loading}</div>}
      {!failure && <div className="mf-camera-controls">
        <button type="button" aria-label={c.zoomIn} title={c.zoomIn} onClick={() => scene.current?.zoom(1.18)}><Plus size={16} /></button>
        <button type="button" aria-label={c.zoomOut} title={c.zoomOut} onClick={() => scene.current?.zoom(1 / 1.18)}><Minus size={16} /></button>
        <button type="button" aria-label={c.center} title={c.center} onClick={() => scene.current?.resetCamera()}><Focus size={16} /></button>
      </div>}
      {selected && <div className="mf-scene-tag" aria-hidden="true"><span>{FIELD_PROFILES[selected.tier].name}</span><b>{c.level} {selected.level}</b></div>}
      {!failure && ready && <span className="mf-scene-hint">{c.controls}</span>}
    </div>
  )
}
