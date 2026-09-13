import { ReactNode, CSSProperties } from 'react'

type Rare = 'basic' | 'meadow' | 'gold'

interface Props {
 rare?: Rare
 children: ReactNode
 style?: CSSProperties
 className?: string
 onClick?: () => void
}

/**
 * Базовая карточка Vice Potato.
 * - basic: обычное стекло
 * - meadow: teal glow + conic border
 * - gold: gold glow + conic border + искры (опционально)
 */
export default function PotatoCard({ rare = 'basic', children, style, className, onClick }: Props) {
 const glowByRare: Record<Rare, string> = {
  basic: 'var(--pf-glow-green)',
  meadow: '0 0 30px rgba(184, 92, 255, 0.30)',
  gold: '0 0 40px rgba(255, 201, 74, 0.35)',
 }

 const isRare = rare !== 'basic'

 return (
  <div
   className={`pf-card hull-skin ${isRare ? 'pf-card--rare' : ''} ${className || ''}`}
   onClick={onClick}
   style={{
    cursor: onClick ? 'pointer' : undefined,
    boxShadow: glowByRare[rare],
    ...style,
   }}
  >
   {children}
  </div>
 )
}
