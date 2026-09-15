// Компактный селектор языка: глобус в шапке + выпадающий список.
// Использует useI18n, чтобы перерисовываться при смене языка.
import { useEffect, useRef, useState } from 'react'
import { Globe, Check } from 'lucide-react'
import { LANGS, useI18n } from '../i18n'

export default function LangSwitcher({ compact = false }: { compact?: boolean }) {
 const { lang, setLang, t } = useI18n()
 const [open, setOpen] = useState(false)
 const ref = useRef<HTMLDivElement>(null)

 useEffect(() => {
  if (!open) return
  const onDoc = (e: MouseEvent) => {
   if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
  }
  const onKey = (e: KeyboardEvent) => {
   if (e.key === 'Escape') setOpen(false)
  }
  document.addEventListener('mousedown', onDoc)
  document.addEventListener('keydown', onKey)
  return () => {
   document.removeEventListener('mousedown', onDoc)
   document.removeEventListener('keydown', onKey)
  }
 }, [open])

 const current = LANGS.find((l) => l.code === lang)

 return (
  <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
   <button
    onClick={() => setOpen((v) => !v)}
    aria-label={t('Язык')}
    aria-expanded={open}
    className="pf-card hull-skin"
    style={{
     display: 'flex', alignItems: 'center', gap: 6,
     padding: compact ? '7px 10px' : '9px 12px',
     borderRadius: 10,
     border: '1px solid rgba(160, 82, 40, 0.65)',
     cursor: 'pointer',
     background: 'transparent',
     color: 'var(--ares-hud-amber, #FFB347)',
     fontFamily: 'inherit',
     fontSize: compact ? 11 : 12,
     fontWeight: 700,
     letterSpacing: '0.08em',
    }}
   >
    <Globe size={compact ? 13 : 15} aria-hidden="true" />
    <span className="ares-mono">{(current?.label || 'English').split(' ')[0].toUpperCase().slice(0, 6)}</span>
   </button>
   {open && (
    <div
     role="menu"
     style={{
      position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60,
      background: '#15100b', border: '1px solid rgba(160, 82, 40, 0.65)',
      borderRadius: 12, padding: 6, minWidth: 190,
      boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
     }}
    >
     {LANGS.map((l) => (
      <button
       key={l.code}
       role="menuitemradio"
       aria-checked={l.code === lang}
       onClick={() => { setLang(l.code); setOpen(false) }}
       style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        width: '100%', padding: '8px 10px', borderRadius: 8, border: 'none',
        background: l.code === lang ? 'rgba(255,179,71,0.12)' : 'transparent',
        color: l.code === lang ? 'var(--ares-hud-amber, #FFB347)' : 'var(--pf-text-secondary)',
        fontSize: 13, fontWeight: l.code === lang ? 700 : 500, cursor: 'pointer',
        textAlign: 'left', fontFamily: 'inherit',
       }}
      >
       <span>{l.native}</span>
       {l.code === lang && <Check size={14} aria-hidden="true" />}
      </button>
     ))}
    </div>
   )}
  </div>
 )
}
