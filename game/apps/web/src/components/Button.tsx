import { ReactNode, CSSProperties } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonGlow = 'orange' | 'pink' | 'teal' | 'gold' | 'purple' | 'green' | 'none'

interface Props {
 variant?: ButtonVariant
 glow?: ButtonGlow
 disabled?: boolean
 onClick?: () => void
 icon?: ReactNode
 children: ReactNode
 style?: CSSProperties
 className?: string
 type?: 'button' | 'submit' | 'reset'
}

/**
 * Тактильная механическая клавиша пульта ARES-1.
 * Аутентичная военная/марсианская клавиша: 3D-ступень, фаска,
 * чёткий механический ход со щелчком при нажатии.
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
 type = 'button',
}: Props) {
 const reducedMotion = useReducedMotion()
 void glow

 const variantClass =
  variant === 'primary'
   ? 'mk-key mk-key--paint'
   : variant === 'danger'
   ? 'mk-key mk-key--danger'
   : variant === 'secondary'
   ? 'mk-key'
   : 'mk-key mk-key--ghost'

 return (
  <motion.button
   type={type}
   whileTap={disabled || reducedMotion ? undefined : { y: 3 }}
   whileHover={disabled || reducedMotion ? undefined : { filter: 'brightness(1.08)' }}
   transition={{ type: 'spring', stiffness: 520, damping: 26, mass: 0.9 }}
   disabled={disabled}
   onClick={onClick}
   className={`${variantClass}${className ? ` ${className}` : ''}`}
   style={{
    padding: '11px 18px',
    fontSize: 13,
    fontWeight: 700,
    fontFamily: 'var(--ares-font-stencil, "Oswald", sans-serif)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...style,
   }}
  >
   {icon}
   <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
    {children}
   </span>
  </motion.button>
 )
}
