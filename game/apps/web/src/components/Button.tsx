import { ReactNode, CSSProperties } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

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
 * Клавиша пульта ARES-1 (MK-редизайн представления, 2026-09-28).
 * Физическое поведение: клавиша имеет ход — при нажатии утапливается
 * на 3px, пружина даёт лёгкий овершут; нижнее поле (край клавиши)
 * «уходит» под палец. При prefers-reduced-motion — только подсветка.
 *
 * Пропсы и API не менялись (variant/glow/disabled/icon/onClick/…):
 * `glow` сохранён для совместимости и трактуется как «лампа действия».
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
 const reducedMotion = useReducedMotion()
 void glow

 const variantClass =
  variant === 'primary' ? 'mk-key mk-key--paint' : variant === 'secondary' ? 'mk-key' : 'mk-key mk-key--ghost'

 return (
  <motion.button
   whileTap={disabled || reducedMotion ? undefined : { y: 3 }}
   whileHover={disabled || reducedMotion ? undefined : { filter: 'brightness(1.08)' }}
   transition={{ type: 'spring', stiffness: 520, damping: 26, mass: 0.9 }}
   disabled={disabled}
   onClick={onClick}
   className={`${variantClass}${className ? ` ${className}` : ''}`}
   style={{
    padding: '12px 20px',
    fontSize: 14,
    fontWeight: 700,
    fontFamily: 'var(--pf-font-ui)',
    letterSpacing: '0.04em',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
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
