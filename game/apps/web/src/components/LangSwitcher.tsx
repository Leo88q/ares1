// Компактный селектор языка: глобус в шапке + выпадающий список.
// Использует useI18n, чтобы перерисовываться при смене языка.
import { useEffect, useRef, useState } from 'react'
import { Glyph } from '../ui/Emblem'
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
    className="mk-key"
    style={{
     display: 'flex', alignItems: 'center', gap: 6,
     padding: compact ? '6px 10px' : '8px 12px',
     cursor: 'pointer',
     fontSize: compact ? 11 : 12,
    }}
   >
    <Glyph name="globe" size={compact ? 13 : 15} aria-hidden="true" />
    <span className="ares-mono">{(current?.label || 'English').split(' ')[0].toUpperCase().slice(0, 6)}</span>
   </button>
   {open && (
    <div
     role="menu"
     style={{
      // Компактный переключатель стоит у левого края шапки: при `right: 0`
      // попап шириной 190px уезжает за левую границу экрана на мобильном
      // (текст пунктов обрезан). В compact-режиме раскрываемся вправо.
      position: 'absolute', right: compact ? 'auto' : 0, left: compact ? 0 : 'auto',
      top: 'calc(100% + 6px)',
      // Число, а не var(): в inline-стилях React строка `'var(--s-z-header)'`
      // молча игнорируется, и попап оказывается под соседями (клики сквозь).
      zIndex: 60, // = --s-z-header (theme/tokens.css)
      background: 'var(--s-pop-bg)', border: '1px solid var(--s-panel-edge-soft)', boxShadow: 'var(--s-pop-shadow)',
      borderRadius: 12, padding: 6, minWidth: 190,
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
       {l.code === lang && <Glyph name="check" size={14} aria-hidden="true" />}
      </button>
     ))}
    </div>
   )}
  </div>
 )
}
