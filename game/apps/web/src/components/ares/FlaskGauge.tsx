import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

interface Bubble {
 id: number
 left: number
 size: number
 duration: number
 delay: number
}

interface FlaskGaugeProps {
 value: number    // 0-100
 label: string
 color?: string
 glowColor?: string
 height?: number   // высота колбы (ширина = 0.6 × height)
 bubbles?: number
}

/** Колба-индикатор: уровень жидкости = прогресс, с подписью снизу. */
export function FlaskGauge({
 value,
 label,
 color = '#C1440E',
 glowColor = '#E86A3C',
 height = 90,
 bubbles = 10,
}: FlaskGaugeProps) {
 const v = Math.min(100, Math.max(0, value))
 const width = Math.round(height * 0.6)
 const maxLiquidHeight = Math.round(height * 0.65)
 const liquidHeight = Math.round((v / 100) * maxLiquidHeight)

 const [bubbleList, setBubbleList] = useState<Bubble[]>([])
 useEffect(() => {
  const list: Bubble[] = Array.from({ length: bubbles }, (_, i) => ({
   id: i,
   left: 20 + Math.random() * 60,
   size: 3 + Math.random() * 7,
   duration: 2 + Math.random() * 3,
   delay: Math.random() * 3,
  }))
  setBubbleList(list)
 }, [bubbles, height])

 return (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
   <div style={{ position: 'relative', width, height }}>
    {/* Свечение */}
    <div
     style={{
      position: 'absolute', inset: 0,
      borderRadius: '50%',
      filter: 'blur(18px)',
      opacity: 0.35,
      backgroundColor: glowColor,
      animation: 'pulse 2.4s ease-in-out infinite',
     }}
    />

    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: 'relative', zIndex: 1 }}>
     <defs>
      <linearGradient id={`fl-grad-${label}-${color}`} x1="0%" y1="0%" x2="0%" y2="100%">
       <stop offset="0%" stopColor={color} stopOpacity="0.95" />
       <stop offset="100%" stopColor={color} stopOpacity="0.6" />
      </linearGradient>
      <clipPath id={`fl-clip-${label}`}>
       <path d={`
        M ${width/2 - 9} 8
        L ${width/2 - 9} ${height * 0.28}
        Q ${width/2 - width * 0.38} ${height * 0.45} ${width/2 - width * 0.38} ${height * 0.72}
        Q ${width/2 - width * 0.38} ${height - 4} ${width/2} ${height - 4}
        Q ${width/2 + width * 0.38} ${height - 4} ${width/2 + width * 0.38} ${height * 0.72}
        Q ${width/2 + width * 0.38} ${height * 0.45} ${width/2 + 9} ${height * 0.28}
        L ${width/2 + 9} 8
        Z
       `} />
      </clipPath>
      <linearGradient id={`fl-shine-${label}`} x1="0%" y1="0%" x2="100%" y2="100%">
       <stop offset="0%" stopColor="white" stopOpacity="0.35" />
       <stop offset="50%" stopColor="white" stopOpacity="0.08" />
       <stop offset="100%" stopColor="white" stopOpacity="0" />
      </linearGradient>
     </defs>

     <g clipPath={`url(#fl-clip-${label})`}>
      <rect x="0" y={height - liquidHeight} width={width} height={liquidHeight}
       fill={`url(#fl-grad-${label}-${color})`} />

      <motion.path
       d={`M 0 ${height - liquidHeight} Q ${width * 0.25} ${height - liquidHeight - 5} ${width * 0.5} ${height - liquidHeight} T ${width} ${height - liquidHeight} L ${width} ${height} L 0 ${height} Z`}
       fill={color} fillOpacity="0.75"
       animate={{
        d: [
         `M 0 ${height - liquidHeight} Q ${width * 0.25} ${height - liquidHeight - 5} ${width * 0.5} ${height - liquidHeight} T ${width} ${height - liquidHeight} L ${width} ${height} L 0 ${height} Z`,
         `M 0 ${height - liquidHeight} Q ${width * 0.25} ${height - liquidHeight + 5} ${width * 0.5} ${height - liquidHeight} T ${width} ${height - liquidHeight} L ${width} ${height} L 0 ${height} Z`,
         `M 0 ${height - liquidHeight} Q ${width * 0.25} ${height - liquidHeight - 5} ${width * 0.5} ${height - liquidHeight} T ${width} ${height - liquidHeight} L ${width} ${height} L 0 ${height} Z`,
        ],
       }}
       transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
      />

      {bubbleList.map((b) => (
       <motion.circle
        key={b.id}
        cx={(b.left / 100) * width}
        cy={height - 8}
        r={b.size / 2}
        fill="rgba(107, 147, 214, 0.06)"
        stroke="rgba(107, 147, 214, 0.85)"
        strokeWidth="1"
        initial={{ cy: height - 8, opacity: 0 }}
        animate={{
         cy: [height - 8, height - liquidHeight + 2],
         opacity: [0, 0.9, 0],
        }}
        transition={{ duration: b.duration, delay: b.delay, repeat: Infinity, ease: 'easeOut' }}
       />
      ))}
     </g>

     <path
      d={`
       M ${width/2 - 9} 8
       L ${width/2 - 9} ${height * 0.28}
       Q ${width/2 - width * 0.38} ${height * 0.45} ${width/2 - width * 0.38} ${height * 0.72}
       Q ${width/2 - width * 0.38} ${height - 4} ${width/2} ${height - 4}
       Q ${width/2 + width * 0.38} ${height - 4} ${width/2 + width * 0.38} ${height * 0.72}
       Q ${width/2 + width * 0.38} ${height * 0.45} ${width/2 + 9} ${height * 0.28}
       L ${width/2 + 9} 8
      `}
      fill="none" stroke="rgba(255, 179, 71, 0.55)" strokeWidth="1.5"
     />
     <rect x={width/2 - 11} y={2} width={22} height={9} rx="1.5"
      fill="none" stroke="rgba(255, 179, 71, 0.65)" strokeWidth="1.5" />

     <ellipse cx={width * 0.32} cy={height * 0.5} rx={width * 0.07} ry={height * 0.14}
      fill={`url(#fl-shine-${label})`} transform={`rotate(-20 ${width * 0.32} ${height * 0.5})`} />
    </svg>
   </div>

   <div style={{ textAlign: 'center', lineHeight: 1.2 }}>
    <div className="ares-mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--ares-hud-amber, #FFB347)', textShadow: '0 0 8px rgba(255,179,71,0.4)' }}>{Math.round(v)}%</div>
    <div className="ares-stencil" style={{ fontSize: 9, color: 'rgba(255,179,71,0.85)', letterSpacing: '0.08em' }}>{label}</div>
   </div>
  </div>
 )
}
