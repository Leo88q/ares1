import { useEffect, useRef, useState } from 'react'
import { Focus, Minus, Plus } from 'lucide-react'
import { colonyCopy, moduleCopy } from './copy'
import type { ColonyState } from './simulation'
import { CATALOG, SLOTS } from './simulation'
import { createColonyScene } from './scene'
import type { ColonyScene } from './scene'

export default function ColonyViewport({ state, selectedId, sunHours, language, onSelect }: {
  state: ColonyState
  selectedId: string | null
  sunHours: number
  language: string
  onSelect: (id: string) => void
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<ColonyScene | null>(null)
  const select = useRef(onSelect)
  select.current = onSelect
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [modelError, setModelError] = useState(false)
  const c = colonyCopy(language)
  const modules = moduleCopy(language)

  useEffect(() => {
    if (failed || !host.current) return
    try {
      instance.current = createColonyScene(host.current, {
        onSelect: id => select.current(id),
        onReady: () => setReady(true),
        onModelError: () => setModelError(true),
        onContextLost: () => setFailed(true),
      })
    } catch {
      setFailed(true)
    }
    return () => { instance.current?.dispose(); instance.current = null }
  }, [failed])

  useEffect(() => { instance.current?.update(state, selectedId, sunHours) }, [state, selectedId, sunHours, failed])

  return (
    <div className="colony-viewport" data-testid="colony-viewport" data-ready={ready}>
      {failed ? (
        <div className="colony-plan-fallback">
          <p role="status">{c.noWebgl}</p>
          <div className="colony-plan-grid">
            {SLOTS.map((_, slot) => {
              const m = state.modules.find(item => item.slot === slot)
              return m ? <button key={slot} type="button" className={selectedId === m.id ? 'is-active' : ''}
                style={{ borderColor: CATALOG[m.kind].color }} onClick={() => onSelect(m.id)}>
                <b>{modules[m.kind].code}</b><small>{modules[m.kind].name}</small>
              </button> : <span key={slot} />
            })}
          </div>
        </div>
      ) : <div ref={host} className="colony-canvas-host" />}
      <div className="colony-scene-top" aria-hidden="true">
        <span className="colony-scene-tag"><i />{c.site}</span>
        <span className="colony-scene-coordinates">ARES—01 / STUDY 001</span>
      </div>
      {!ready && !failed && <div className="colony-scene-loading" role="status"><span />{c.loading}</div>}
      {modelError && !failed && <p className="colony-model-error" role="status">{c.modelError}</p>}
      {!failed && <>
        <div className="colony-camera-controls">
          <button type="button" onClick={() => instance.current?.zoom(1.2)} aria-label={c.zoomIn} title={c.zoomIn}><Plus size={17} /></button>
          <button type="button" onClick={() => instance.current?.zoom(1 / 1.2)} aria-label={c.zoomOut} title={c.zoomOut}><Minus size={17} /></button>
          <button type="button" onClick={() => instance.current?.resetCamera()} aria-label={c.center} title={c.center}><Focus size={17} /></button>
        </div>
        <p className="colony-scene-instructions">{c.controls}</p>
      </>}
    </div>
  )
}
