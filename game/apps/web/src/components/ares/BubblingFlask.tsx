import { motion } from 'framer-motion'

interface FlaskProps {
 color?: string    // цвет жидкости
 glowColor?: string  // цвет свечения
 size?: 'sm' | 'md' | 'lg'
}

/** Колба с бурлящей терракотовой жидкостью и голубыми пузырьками. */
export function BubblingFlask({
 color = '#450001',   // терракот по умолчанию
 glowColor = '#8B1A1A', // ржаво-красное свечение
 size = 'md'
}: FlaskProps) {
 const sizes = {
  sm: { width: 60, height: 100, liquidHeight: 60 },
  md: { width: 100, height: 160, liquidHeight: 95 },
  lg: { width: 140, height: 220, liquidHeight: 130 },
 }

 const s = sizes[size]

 return (
  <div
   style={{
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: s.width,
    height: s.height,
   }}
  >
   {/* Свечение вокруг колбы */}
   <div
    style={{
     position: 'absolute',
     inset: 0,
     borderRadius: '50%',
     filter: 'blur(24px)',
     opacity: 0.4,
     backgroundColor: glowColor,
     animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
    }}
   />

   {/* SVG колба */}
   {/* Колба: сгенерированный арт + бурление внутри сферы */}
   <div style={{ position: 'relative', width: s.width, height: s.height, zIndex: 10 }}>
    <img
     src="/ares/flask.webp"
     alt=""
     aria-hidden="true"
     style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
    />
    <div
     aria-hidden="true"
     style={{
      position: 'absolute', inset: 0,
      clipPath: 'circle(34% at 50% 61%)',
      overflow: 'hidden',
     }}
    >
     {/* Жидкость — терракотовое свечение внизу */}
     <div
      style={{
       position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%',
       background: `linear-gradient(to top, ${color}AA 0%, transparent 100%)`,
       mixBlendMode: 'screen',
      }}
     />
     {/* Пузырьки */}
     {Array.from({ length: 9 }, (_, i) => (
      <motion.span
       key={i}
       style={{
        position: 'absolute',
        left: `${16 + ((i * 37) % 66)}%`,
        bottom: '18%',
        width: 3 + ((i * 5) % 5),
        height: 3 + ((i * 5) % 5),
        borderRadius: '50%',
        border: '1px solid rgba(255,214,140,0.8)',
        background: 'rgba(255,179,71,0.1)',
       }}
       initial={{ y: 0, opacity: 0 }}
       animate={{ y: -Math.round(s.height * 0.38), opacity: [0, 0.9, 0] }}
       transition={{ duration: 2 + ((i * 7) % 30) / 10, delay: ((i * 11) % 30) / 10, repeat: Infinity, ease: 'easeOut' }}
      />
     ))}
    </div>
   </div>
  </div>
 )
}
