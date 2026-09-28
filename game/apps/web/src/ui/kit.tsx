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
 *  4. Сырой hex в компонентах — баг (см. docs/FRONTEND_AUDIT_2026-09-28.md).
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

/** Шильдик-метка (трафарет, капс). */
export function Tag({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
   <span className={`k-tag${className ? ` ${className}` : ''}`} {...rest}>
    {children}
   </span>
  )
}

export type LampTone = 'ok' | 'warn' | 'danger' | 'off'

const LAMP_CLASS: Record<LampTone, string> = {
  ok: 'k-lamp',
  warn: 'k-lamp k-lamp--warn',
  danger: 'k-lamp k-lamp--danger',
  off: 'k-lamp k-lamp--off',
}

/** Лампа-индикатор состояния. */
export function Lamp({ tone = 'ok', blink, ...rest }: { tone?: LampTone; blink?: boolean } & HTMLAttributes<HTMLSpanElement>) {
  return <span aria-hidden="true" className={`${LAMP_CLASS[tone]}${blink ? ' k-lamp--blink' : ''}`} {...rest} />
}

/** LCD-показание (моно, табличные цифры). */
export function Lcd({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
   <span className={`k-lcd${className ? ` ${className}` : ''}`} {...rest}>
    {children}
   </span>
  )
}

/** Скелетон загрузки. */
export function Skel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={`k-skel${className ? ` ${className}` : ''}`} {...rest} />
}
