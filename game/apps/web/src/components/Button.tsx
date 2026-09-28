import { ReactNode, CSSProperties } from 'react'
import { motion } from 'framer-motion'

type Variant = 'primary' | 'secondary' | 'ghost'
type Glow = 'orange' | 'pink' | 'teal' | 'gold' | 'purple' | 'green' | 'none'

interface Props {
 variant?: Variant
 glow?: Glow
 disabled?: boolean
 onClick?: () => void
 icon?: ReactNode
 children: ReactNode
 style?: CSSProperties
 className?: string
}

/**
 * Кнопка Vice Potato с вариантами и glow.
 */
export default function Button({
 variant = 'primary',
 glow = 'none',
 disabled = false,
 onClick,
 icon,
 children,
 style,
 className,
}: Props) {
 const glows: Record<Glow, string> = {
  orange: 'var(--pf-glow-orange)',
  pink: 'var(--pf-glow-pink)',
  teal: 'var(--pf-glow-teal)',
  gold: 'var(--pf-glow-gold)',
  purple: 'var(--pf-glow-purple)',
  green: 'var(--pf-glow-green)',
  none: 'none',
 }

 const bgByVariant: Record<Variant, string> = {
  primary: 'var(--pf-grad-cta)',
  secondary: 'rgba(255, 255, 255, 0.06)',
  ghost: 'transparent',
 }

 const borderByVariant: Record<Variant, string> = {
  primary: '1px solid rgba(255, 255, 255, 0.15)',
  secondary: '1px solid var(--pf-border-soft)',
  ghost: '1px solid transparent',
 }

 const textColor: Record<Variant, string> = {
  primary: 'white',
  secondary: 'var(--pf-text-primary)',
  ghost: 'var(--pf-text-secondary)',
 }

 return (
  <motion.button
   whileTap={disabled ? {} : { scale: 0.96 }}
   whileHover={disabled ? {} : { scale: 1.02 }}
   transition={{ type: 'spring', stiffness: 400, damping: 20 }}
   disabled={disabled}
   onClick={onClick}
   className={className}
   style={{
    padding: '12px 20px',
    borderRadius: 'var(--pf-radius-btn)',
    border: borderByVariant[variant],
    background: bgByVariant[variant],
    color: textColor[variant],
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'var(--pf-font-ui)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    boxShadow: disabled ? 'none' : glows[glow],
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...style,
   }}
  >
   {icon}
   <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
    {children}
   </span>
  </motion.button>
 )
}
