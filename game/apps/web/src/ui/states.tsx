import { ReactNode } from 'react'
import { t as tr } from '../i18n'

import { AlertTriangle, Inbox, RefreshCw, type LucideIcon } from 'lucide-react'
import { t } from '../theme/tokens'

/**
 * Единые состояния данных (Stage 4): загрузка / ошибка / пусто.
 * Правило: экран не остаётся «слепым» — любое асинхронное состояние
 * одно из трёх. Моки/пустой div без текста — запрещены.
 */

export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        border: `2px solid ${t.color.borderSoft}`,
        borderTopColor: t.color.accent,
        animation: 'pf-spin 0.8s linear infinite',
      }}
    />
  )
}

interface LoadingStateProps {
  label?: string
  rows?: number
  compact?: boolean
}

/** Скелетоны вместо спиннера для списков. */
export function LoadingState({ label = undefined, rows = 3, compact = false }: LoadingStateProps) {
  return (
    <div aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="pf-card hull-skin shimmer"
          style={{
            height: compact ? 84 : 120,
            borderRadius: '16px',
            marginBottom: 12,
          }}
        />
      ))}
      <p style={{ textAlign: 'center', color: t.color.textSecondary, fontSize: 'var(--pf-text-md)', marginTop: 8 }}>
        {label ?? tr('Загрузка…')}
      </p>
    </div>
  )
}

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
  /** true — занять весь блок; false — тонкий баннер поверх старых данных */
  inline?: boolean
}

export function ErrorState({ title = undefined, message, onRetry, inline = false }: ErrorStateProps) {
  const body = (
    <>
      <AlertTriangle size={inline ? 18 : 40} color={t.color.danger} style={{ marginBottom: inline ? 0 : 12, flexShrink: 0 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ fontSize: inline ? 14 : 18, color: t.color.textPrimary, margin: inline ? 0 : '0 0 4px' }}>{title ?? tr('Не удалось загрузить')}</h3>
        <p style={{ color: t.color.textSecondary, fontSize: 'var(--pf-text-md)', margin: 0, wordBreak: 'break-word' }}>{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          aria-label={tr('Повторить загрузку')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: `1px solid ${t.color.borderStrong}`,
            borderRadius: t.radius.pill, color: t.color.textPrimary,
            padding: '10px 16px', fontSize: 'var(--pf-text-md)', cursor: 'pointer',
            minHeight: t.touchMin,
          }}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {tr('Повторить')}
        </button>
      )}
    </>
  )
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: inline ? 'row' : 'column',
        alignItems: inline ? 'center' : 'center',
        textAlign: 'center',
        padding: inline ? '12px 16px' : '60px 20px',
        ...(inline
          ? { background: 'rgba(255, 59, 59, 0.08)', border: '1px solid rgba(255, 59, 59, 0.35)', borderRadius: 'var(--pf-radius-card)', marginBottom: 12, gap: 12 }
          : {}),
      }}
    >
      {body}
    </div>
  )
}

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
}

export function EmptyState({ icon: Icon = Inbox, title, hint, action }: EmptyStateProps) {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
      <Icon size={48} color={t.color.textSecondary} style={{ marginBottom: 16, opacity: 0.5 }} aria-hidden="true" />
      <h3 style={{ fontSize: 18, marginBottom: 8, color: t.color.textPrimary }}>{title ?? tr('Не удалось загрузить')}</h3>
      {hint && <p style={{ color: t.color.textSecondary, fontSize: 'var(--pf-text-md)' }}>{hint}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}
