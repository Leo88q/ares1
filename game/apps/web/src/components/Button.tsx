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

 const plateByVariant: Record<Variant, string> = {
  primary: "url('/ares/kit/btn-primary.webp') 40 fill / 15px",
  secondary: "url('/ares/kit/btn-secondary.webp') 40 fill / 15px",
  ghost: 'none',
 }

 const borderByVariant: Record<Variant, string> = {
  primary: '15px solid transparent',
  secondary: '15px solid transparent',
  ghost: '1px solid transparent',
 }

 const textColor: Record<Variant, string> = {
  primary: '#2B1403',
  secondary: '#E9DBC4',
  ghost: 'var(--pf-text-secondary)',
 }

 const textShadowByVariant: Record<Variant, string> = {
  primary: '0 1px 0 rgba(255, 220, 150, 0.55)',
  secondary: '0 1px 2px rgba(0, 0, 0, 0.8)',
  ghost: 'none',
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
    borderRadius: variant === 'ghost' ? 'var(--pf-radius-btn)' : 0,
    borderStyle: 'solid',
    borderWidth: borderByVariant[variant],
    borderImage: plateByVariant[variant],
    background: 'none',
    color: textColor[variant],
    textShadow: textShadowByVariant[variant],
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
