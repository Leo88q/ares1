import { useEffect, useRef, useState } from 'react'
import { Focus, Minus, Plus, RotateCcw, RotateCw } from 'lucide-react'
import { colonyCopy, moduleCopy } from './copy'
import type { ColonyState } from './simulation'
import { CATALOG } from './simulation'
import { createColonyScene } from './scene'
import type { ColonyScene } from './scene'
import type { ColonyNetwork } from './networks'
import type { ConstructionDraft } from './ConstructionPlan'

export default function ColonyViewport({ state, selectedId, sunHours, language, onSelect, draft, onSite, networkPreview }: {
  state: ColonyState
  selectedId: string | null
  sunHours: number
  language: string
  networkPreview: ColonyNetwork | null
  draft: ConstructionDraft | null
  onSite: (at: { x: number; z: number }) => void
  onSelect: (id: string) => void
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<ColonyScene | null>(null)
  const select = useRef(onSelect)
  select.current = onSelect
  const site = useRef(onSite); site.current = onSite
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [modelError, setModelError] = useState(false)
  const [failedFiles, setFailedFiles] = useState<string[]>([])
  const c = colonyCopy(language)
  const modules = moduleCopy(language)

  useEffect(() => {
    if (failed || !host.current) return
    try {
      instance.current = createColonyScene(host.current, {
        onSelect: id => select.current(id),
        onSite: at => site.current(at),
        onReady: () => setReady(true),
        onModelError: (files: string[]) => { setModelError(true); setFailedFiles(files) },
        onContextLost: () => setFailed(true),
      })
    } catch {
      setFailed(true)
    }
    return () => { instance.current?.dispose(); instance.current = null }
  }, [failed])

  useEffect(() => { instance.current?.update(state, selectedId, sunHours) }, [state, selectedId, sunHours, failed])

  useEffect(() => { instance.current?.setDraft(draft) }, [draft, failed])

  useEffect(() => { instance.current?.setNetworkPreview(networkPreview) }, [networkPreview, failed])

  return (
    <div className="colony-viewport" data-testid="colony-viewport" data-ready={ready}>
      {failed ? (
        <div className="colony-plan-fallback">
          <p role="status">{c.noWebgl}</p>
          <div className="colony-plan-grid">
            {state.modules.map(m => <button key={m.id} type="button" className={selectedId === m.id ? 'is-active' : ''}
              style={{ borderColor: CATALOG[m.kind].color }} onClick={() => onSelect(m.id)}>
              <b>{modules[m.kind].code}</b><small>{modules[m.kind].name}</small>
            </button>)}
          </div>
        </div>
      ) : <div ref={host} className="colony-canvas-host" />}
      <div className="colony-scene-top" aria-hidden="true">
        <span className="colony-scene-tag"><i />{c.site}</span>
        <span className="colony-scene-coordinates">ARES—01 / STUDY 001</span>
      </div>
      {!ready && !failed && <div className="colony-scene-loading" role="status"><span />{c.loading}</div>}
      {modelError && !failed && <p className="colony-model-error" role="status">
        {c.modelError}
        {failedFiles.length > 0 && <> {c.modelErrorFiles}: {failedFiles.join(', ')}</>}
      </p>}
      {!failed && <>
        <div className="colony-camera-controls">
        <button type="button" aria-label={c.rotateLeft} title={c.rotateLeft} onClick={() => instance.current?.rotate(-1)}><RotateCcw size={16} /></button>
        <button type="button" aria-label={c.rotateRight} title={c.rotateRight} onClick={() => instance.current?.rotate(1)}><RotateCw size={16} /></button>
          <button type="button" onClick={() => instance.current?.zoom(1.2)} aria-label={c.zoomIn} title={c.zoomIn}><Plus size={17} /></button>
          <button type="button" onClick={() => instance.current?.zoom(1 / 1.2)} aria-label={c.zoomOut} title={c.zoomOut}><Minus size={17} /></button>
          <button type="button" onClick={() => instance.current?.resetCamera()} aria-label={c.center} title={c.center}><Focus size={17} /></button>
        </div>
        <p className="colony-scene-instructions">{c.controls}</p>
      </>}
    </div>
  )
}
