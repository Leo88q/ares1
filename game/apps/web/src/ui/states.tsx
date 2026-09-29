import { ReactNode } from 'react'
import { t as tr } from '../i18n'

import { AlertTriangle, RefreshCw, type LucideIcon } from 'lucide-react'
import { t } from '../theme/tokens'
import { Tuber9 } from '../components/ares/mascot'

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
          className="mk-skel"
          style={{
            height: compact ? 84 : 120,
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

export function EmptyState({ icon: Icon, title, hint, action }: EmptyStateProps) {
  return (
    <div
      className="mk-plate mk-plate--quiet"
      style={{ padding: '34px 20px', textAlign: 'center', marginBottom: 12 }}
    >
      {Icon ? (
        <Icon size={44} color={t.color.textSecondary} style={{ marginBottom: 14, opacity: 0.55 }} aria-hidden="true" />
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <Tuber9 mood={hint ? 'sleep' : 'happy'} size={64} />
        </div>
      )}
      <h3 style={{ fontSize: 17, marginBottom: 8, color: t.color.textPrimary, fontFamily: 'var(--ares-font-stencil)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title ?? tr('Не удалось загрузить')}</h3>
      {hint && <p style={{ color: t.color.textSecondary, fontSize: 'var(--pf-text-md)', maxWidth: 320, margin: '0 auto' }}>{hint}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}
