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
  pink: '#ED8A45',
  teal: '#9FBE7A',
  gold: 'var(--pf-gold)',
  purple: '#ED8A45',
  green: '#9FBE7A',
 }

 const glows: Record<Color, string> = {
  orange: 'var(--pf-glow-orange)',
  pink: '0 0 20px rgba(237, 138, 69, 0.4)',
  teal: '0 0 20px rgba(159, 190, 122, 0.4)',
  gold: 'var(--pf-glow-gold)',
  purple: '0 0 20px rgba(237, 138, 69, 0.4)',
  green: '0 0 20px rgba(159, 190, 122, 0.4)',
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
