import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

/**
 * ЕДИНАЯ СИСТЕМА ФРОНТЕНДА (2026-09-28)
 * ─────────────────────────────────────
 * Единственная точка создания панелей/клавиш/приборов.
 * CSS-конструкция ровно одна: styles/kit.css (.k-*).
 * Значения — только токены (--s-* / --pf-* / --ares-* из theme/tokens.css).
 *
 * Правила для нового кода:
 *  1. Панель — <Panel>, никаких div-ов с inline background/border/shadow.
 *  2. Кнопка — <Key> или общий <Button>, никаких новых кнопочных стилей.
 *  3. Цвета/радиусы/тени/z-index — только var(--s-*) / var(--pf-*) / var(--ares-*).
 *  4. Сырой hex в компонентах — баг.
 */

export type PanelVariant = 'default' | 'quiet' | 'pop' | 'rare' | 'chip'

const PANEL_CLASS: Record<PanelVariant, string> = {
  default: 'k-panel',
  quiet: 'k-panel k-panel--quiet',
  chip: 'k-panel k-panel--quiet k-panel--chip',
  pop: 'k-panel k-panel--pop',
  rare: 'k-panel k-panel--rare',
}

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: PanelVariant
  children: ReactNode
}

/** Панель. Алиасы старого кода (.pf-card и др.) указывают на ту же конструкцию. */
export function Panel({ variant = 'default', className, children, ...rest }: PanelProps) {
  return (
   <div className={`${PANEL_CLASS[variant]}${className ? ` ${className}` : ''}`} {...rest}>
    {children}
   </div>
  )
}

export type KeyVariant = 'default' | 'ghost' | 'danger'

export interface KeyProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: KeyVariant
  engaged?: boolean
  children: ReactNode
}

/** Клавиша. Визуал наследует общему <Button>; здесь — канонический класс. */
export function Key({ variant = 'default', engaged, className, children, ...rest }: KeyProps) {
  const cls = [
    'k-key',
    variant === 'ghost' ? 'k-key--ghost' : '',
    variant === 'danger' ? 'k-key--danger' : '',
    engaged ? 'k-key--engaged' : '',
    className ?? '',
  ]
   .filter(Boolean)
   .join(' ')
  return (
   <button type="button" className={cls} {...rest}>
    {children}
   </button>
  )
}

