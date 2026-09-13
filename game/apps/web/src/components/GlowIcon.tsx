import { ReactNode } from 'react'

type Color = 'orange' | 'pink' | 'teal' | 'gold' | 'purple' | 'green'

interface Props {
 children: ReactNode
 color?: Color
 size?: number
}

/**
 * Обёртка для иконок с glow-эффектом.
 */
export default function GlowIcon({ children, color = 'teal', size = 48 }: Props) {
 const colors: Record<Color, string> = {
  orange: 'var(--pf-orange)',
  pink: 'var(--pf-pink)',
  teal: 'var(--pf-teal)',
  gold: 'var(--pf-gold)',
  purple: 'var(--ares-grow-violet, #B85CFF)',
  green: 'var(--pf-green)',
 }

 const glows: Record<Color, string> = {
  orange: 'var(--pf-glow-orange)',
  pink: 'var(--pf-glow-pink)',
  teal: 'var(--pf-glow-teal)',
  gold: 'var(--pf-glow-gold)',
  purple: 'var(--pf-glow-purple)',
  green: '0 0 20px rgba(124, 255, 107, 0.4)',
 }

 return (
  <div
   style={{
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    color: colors[color],
    filter: `drop-shadow(${glows[color]})`,
   }}
  >
   {children}
  </div>
 )
}
