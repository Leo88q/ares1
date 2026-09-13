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
   <svg
    width={s.width}
    height={s.height}
    viewBox={`0 0 ${s.width} ${s.height}`}
    style={{ position: 'relative', zIndex: 10 }}
   >
    <defs>
     {/* Градиент жидкости */}
     <linearGradient id={`liquid-${color}`} x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stopColor={color} stopOpacity="0.9" />
      <stop offset="100%" stopColor={color} stopOpacity="0.6" />
     </linearGradient>

     {/* Маска для жидкости */}
     <clipPath id={`flask-clip-${size}`}>
      <path d={`
       M ${s.width/2 - 15} 10
       L ${s.width/2 - 15} ${s.height * 0.3}
       Q ${s.width/2 - s.width * 0.35} ${s.height * 0.5} ${s.width/2 - s.width * 0.35} ${s.height * 0.75}
       Q ${s.width/2 - s.width * 0.35} ${s.height - 5} ${s.width/2} ${s.height - 5}
       Q ${s.width/2 + s.width * 0.35} ${s.height - 5} ${s.width/2 + s.width * 0.35} ${s.height * 0.75}
       Q ${s.width/2 + s.width * 0.35} ${s.height * 0.5} ${s.width/2 + 15} ${s.height * 0.3}
       L ${s.width/2 + 15} 10
       Z
      `} />
     </clipPath>

     {/* Блик на стекле */}
     <linearGradient id="glass-shine" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="white" stopOpacity="0.4" />
      <stop offset="50%" stopColor="white" stopOpacity="0.1" />
      <stop offset="100%" stopColor="white" stopOpacity="0" />
     </linearGradient>
    </defs>

    {/* Жидкость (обрезана по форме колбы) */}
    <g clipPath={`url(#flask-clip-${size})`}>
     {/* Основная жидкость */}
     <rect
      x="0"
      y={s.height - s.liquidHeight}
      width={s.width}
      height={s.liquidHeight}
      fill={`url(#liquid-${color})`}
     />

     {/* Волны на поверхности */}
     <motion.path
      d={`
       M 0 ${s.height - s.liquidHeight}
       Q ${s.width * 0.25} ${s.height - s.liquidHeight - 8} ${s.width * 0.5} ${s.height - s.liquidHeight}
       T ${s.width} ${s.height - s.liquidHeight}
       L ${s.width} ${s.height}
       L 0 ${s.height}
       Z
      `}
      fill={color}
      fillOpacity="0.7"
      animate={{
       d: [
        `M 0 ${s.height - s.liquidHeight} Q ${s.width * 0.25} ${s.height - s.liquidHeight - 8} ${s.width * 0.5} ${s.height - s.liquidHeight} T ${s.width} ${s.height - s.liquidHeight} L ${s.width} ${s.height} L 0 ${s.height} Z`,
        `M 0 ${s.height - s.liquidHeight} Q ${s.width * 0.25} ${s.height - s.liquidHeight + 8} ${s.width * 0.5} ${s.height - s.liquidHeight} T ${s.width} ${s.height - s.liquidHeight} L ${s.width} ${s.height} L 0 ${s.height} Z`,
        `M 0 ${s.height - s.liquidHeight} Q ${s.width * 0.25} ${s.height - s.liquidHeight - 8} ${s.width * 0.5} ${s.height - s.liquidHeight} T ${s.width} ${s.height - s.liquidHeight} L ${s.width} ${s.height} L 0 ${s.height} Z`,
       ],
      }}
      transition={{
       duration: 3,
       repeat: Infinity,
       ease: 'easeInOut',
      }}
     />


    </g>

    {/* Стекло колбы (контур) */}
    <path
     d={`
      M ${s.width/2 - 15} 10
      L ${s.width/2 - 15} ${s.height * 0.3}
      Q ${s.width/2 - s.width * 0.35} ${s.height * 0.5} ${s.width/2 - s.width * 0.35} ${s.height * 0.75}
      Q ${s.width/2 - s.width * 0.35} ${s.height - 5} ${s.width/2} ${s.height - 5}
      Q ${s.width/2 + s.width * 0.35} ${s.height - 5} ${s.width/2 + s.width * 0.35} ${s.height * 0.75}
      Q ${s.width/2 + s.width * 0.35} ${s.height * 0.5} ${s.width/2 + 15} ${s.height * 0.3}
      L ${s.width/2 + 15} 10
     `}
     fill="none"
     stroke="rgba(255, 179, 71, 0.5)"
     strokeWidth="2"
    />

    {/* Горлышко колбы */}
    <rect
     x={s.width/2 - 18}
     y={2}
     width={36}
     height={12}
     rx="2"
     fill="none"
     stroke="rgba(255, 179, 71, 0.6)"
     strokeWidth="2"
    />

    {/* Блик на стекле */}
    <ellipse
     cx={s.width * 0.35}
     cy={s.height * 0.5}
     rx={s.width * 0.08}
     ry={s.height * 0.15}
     fill="url(#glass-shine)"
     transform={`rotate(-20 ${s.width * 0.35} ${s.height * 0.5})`}
    />
   </svg>
  </div>
 )
}
