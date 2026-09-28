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
 void maxLiquidHeight

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

    {/* Колба: сгенерированный арт + уровень в виде внутреннего свечения */}
    <img
     src="/ares/flask.webp"
     alt=""
     aria-hidden="true"
     style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
    />
    <div
     aria-hidden="true"
     style={{
      position: 'absolute', inset: 0, zIndex: 2,
      clipPath: 'circle(34% at 50% 61%)',
      overflow: 'hidden',
     }}
    >
     {/* Уровень жидкости — тёплое свечение */}
     <div
      style={{
       position: 'absolute', left: 0, right: 0, bottom: 0,
       height: `${Math.round(20 + (v / 100) * 62)}%`,
       background: `linear-gradient(to top, ${color}66 0%, transparent 100%)`,
       mixBlendMode: 'screen',
      }}
     />
     {bubbleList.map((b) => (
      <motion.span
       key={b.id}
       style={{
        position: 'absolute',
        left: `${b.left}%`,
        bottom: '14%',
        width: b.size,
        height: b.size,
        borderRadius: '50%',
        border: '1px solid rgba(255,214,140,0.85)',
        background: 'rgba(255,179,71,0.12)',
       }}
       initial={{ y: 0, opacity: 0 }}
       animate={{ y: -Math.round(height * 0.42), opacity: [0, 0.9, 0] }}
       transition={{ duration: b.duration, delay: b.delay, repeat: Infinity, ease: 'easeOut' }}
      />
     ))}
    </div>
   </div>

   <div style={{ textAlign: 'center', lineHeight: 1.2 }}>
    <div className="ares-mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--ares-hud-amber, #FFB347)', textShadow: '0 0 8px rgba(255,179,71,0.4)' }}>{Math.round(v)}%</div>
    <div className="ares-stencil" style={{ fontSize: 9, color: 'rgba(255,179,71,0.85)', letterSpacing: '0.08em' }}>{label}</div>
   </div>
  </div>
 )
}
