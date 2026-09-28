import { useState } from 'react'

/**
 * Эмблема — сгенерированная иконка в тёплой стилистике ARES-1
 * (бронза/латунь, янтарные акценты; assets: public/ares/icons/*.webp).
 * Вместо generic line-иконок и эмодзи: <Emblem name="moon" size={16} />
 * При ошибке загрузки рендерит пустой слот нужного размера (layout не прыгает).
 */
export const EMBLEMS = [
 'gauge', 'flame', 'pickaxe', 'moon', 'gear',
 'percent', 'shield', 'bank', 'trophy',
 'coins', 'sprout', 'crate', 'clipboard', 'license',
 'bunk', 'wallet', 'gift',
] as const

export type EmblemName = (typeof EMBLEMS)[number]

export function Emblem({ name, size = 16, className, style }: {
 name: EmblemName
 size?: number
 className?: string
 style?: React.CSSProperties
}) {
 const [failed, setFailed] = useState(false)
 if (failed) return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, ...style }} className={className} />
 return (
  <img
   src={`/ares/icons/${name}.webp`}
   alt=""
   aria-hidden="true"
   width={size}
   height={size}
   onError={() => setFailed(true)}
   className={className}
   style={{ width: size, height: size, objectFit: 'contain', verticalAlign: '-3px', flexShrink: 0, ...style }}
  />
 )
}

/* ── Управленческие глифы (сгенерированные, тот же тёплый стиль) ──
   Вместо line-SVG: крестик, шевроны, копирование, стрелки, часы и т.д. */
export const GLYPHS = [
 'x', 'chevron-down', 'chevron-up', 'chevron-right', 'check',
 'copy', 'plus', 'clock', 'person', 'share',
 'deposit', 'arrow-up-right', 'wallet', 'bell', 'music',
 'speaker', 'vibrate', 'warning', 'globe', 'menu',
] as const

export type GlyphName = (typeof GLYPHS)[number]

export function Glyph({ name, size = 16, className, style }: {
 name: GlyphName
 size?: number
 className?: string
 style?: React.CSSProperties
}) {
 const [failed, setFailed] = useState(false)
 if (failed) return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, ...style }} className={className} />
 return (
  <img
   src={`/ares/glyphs/${name}.webp`}
   alt=""
   aria-hidden="true"
   width={size}
   height={size}
   onError={() => setFailed(true)}
   className={className}
   style={{ width: size, height: size, objectFit: 'contain', verticalAlign: '-3px', flexShrink: 0, ...style }}
  />
 )
}
