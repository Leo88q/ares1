import { ReactNode } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

type Variant = 'farm' | 'market' | 'profile' | 'stats'

interface Props {
 variant?: Variant
 children?: ReactNode
}

/**
 * Атмосферный фон марсианской колонии ARES-1 (глубокий базальт, марсианская пыль, тёплый янтарь).
 * Без неоновых фиолетовых/розовых свечений.
 */
export default function BackgroundScene({ variant = 'farm', children }: Props) {
 const { scrollY } = useScroll()
 const y1 = useTransform(scrollY, [0, 1000], [0, -40])
 const y2 = useTransform(scrollY, [0, 1000], [0, -80])

 const gradients: Record<Variant, { bg: string; blob1: string; blob2: string }> = {
  farm: {
   bg: 'linear-gradient(170deg, #0A0705 0%, #150E09 45%, #1C120B 80%, #0F0905 100%)',
   blob1: 'rgba(193, 68, 14, 0.10)', // mars rust
   blob2: 'rgba(232, 160, 60, 0.07)', // amber solar
  },
  market: {
   bg: 'linear-gradient(170deg, #0A0705 0%, #16100B 45%, #20140D 80%, #110B07 100%)',
   blob1: 'rgba(201, 146, 50, 0.09)', // bronze amber
   blob2: 'rgba(138, 46, 8, 0.08)',  // dark ore
  },
  profile: {
   bg: 'linear-gradient(170deg, #0A0705 0%, #170F0A 45%, #22150E 80%, #100A06 100%)',
   blob1: 'rgba(217, 106, 42, 0.09)', // warm copper
   blob2: 'rgba(193, 68, 14, 0.07)',  // rust
  },
  stats: {
   bg: 'linear-gradient(170deg, #0A0705 0%, #130E0A 45%, #1C140E 80%, #0E0906 100%)',
   blob1: 'rgba(232, 160, 60, 0.08)', // brass
   blob2: 'rgba(168, 70, 20, 0.07)',  // iron oxide
  },
 }

 const g = gradients[variant]

 return (
  <div
   style={{
    position: 'fixed',
    inset: 0,
    zIndex: 0,
    background: g.bg,
    overflow: 'hidden',
   }}
  >
   {/* Атмосферный марсианский свет 1 */}
   <motion.div
    style={{
     position: 'absolute',
     top: '5%',
     left: '-5%',
     width: '65%',
     height: '65%',
     background: `radial-gradient(circle, ${g.blob1} 0%, transparent 70%)`,
     filter: 'blur(90px)',
     y: y1,
    }}
    animate={{
     x: [0, 30, 0],
     y: [0, 20, 0],
    }}
    transition={{
     duration: 22,
     repeat: Infinity,
     ease: 'easeInOut',
    }}
   />

   {/* Атмосферный марсианский свет 2 */}
   <motion.div
    style={{
     position: 'absolute',
     bottom: '5%',
     right: '-5%',
     width: '70%',
     height: '70%',
     background: `radial-gradient(circle, ${g.blob2} 0%, transparent 70%)`,
     filter: 'blur(100px)',
     y: y2,
    }}
    animate={{
     x: [0, -30, 0],
     y: [0, -20, 0],
    }}
    transition={{
     duration: 28,
     repeat: Infinity,
     ease: 'easeInOut',
    }}
   />

   {/* Тактическая марсианская координатная сетка поверх (тёплая пылевая) */}
   <div
    style={{
     position: 'absolute',
     inset: 0,
     backgroundImage: `
      linear-gradient(rgba(217, 160, 107, 0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(217, 160, 107, 0.02) 1px, transparent 1px)
     `,
     backgroundSize: '48px 48px',
    }}
   />

   {children}
  </div>
 )
}
