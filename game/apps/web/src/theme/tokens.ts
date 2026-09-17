/**
 * TS-зеркало дизайн-токенов (единый источник — theme/tokens.css).
 * Для inline-стилей: использовать `t.color.orange`, `t.space.md` и т.п.
 * Сырые hex/rgba в inline-стилях — баг (docs/UI-AUDIT-2026-09-14.md).
 */
const v = (name: string) => `var(${name})`

export const t = {
  color: {
    bgBase: v('--pf-bg-base'),
    bgElevated: v('--pf-bg-elevated'),
    glass: v('--pf-glass'),
    glassStrong: v('--pf-glass-strong'),
    borderSoft: v('--pf-border-soft'),
    borderStrong: v('--pf-border-strong'),
    orange: v('--pf-orange'),
    pink: v('--pf-pink'),
    teal: v('--pf-teal'),
    purple: v('--pf-purple'),
    gold: v('--pf-gold'),
    green: v('--pf-green'),
    red: v('--pf-red'),
    accent: v('--pf-accent'),
    success: v('--pf-success'),
    warning: v('--pf-warning'),
    danger: v('--pf-danger'),
    info: v('--pf-info'),
    textPrimary: v('--pf-text-primary'),
    textSecondary: v('--pf-text-secondary'),
    textMuted: v('--pf-text-muted'),
  },
  grad: {
    cta: v('--pf-grad-cta'),
    gold: v('--pf-grad-gold'),
    border: v('--pf-grad-border'),
  },
  font: {
    display: v('--pf-font-display'),
    ui: v('--pf-font-ui'),
    mono: v('--pf-font-mono'),
  },
  /** px-значения отступов (мобайл-first сетка) */
  space: {
    xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
  } as const,
  radius: {
    card: v('--pf-radius-card'),
    btn: v('--pf-radius-btn'),
    pill: v('--pf-radius-pill'),
  },
  glow: {
    orange: v('--pf-glow-orange'),
    pink: v('--pf-glow-pink'),
    teal: v('--pf-glow-teal'),
    gold: v('--pf-glow-gold'),
    green: v('--pf-glow-green'),
    red: v('--pf-glow-red'),
  },
  /** минимальная зона касания (px) */
  touchMin: 44,
} as const
