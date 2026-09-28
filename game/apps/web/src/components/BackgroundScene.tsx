import { ReactNode } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

type Variant = 'farm' | 'market' | 'profile' | 'stats'

interface Props {
 variant?: Variant
 children?: ReactNode
}

/**
 * Фон приложения в стиле Vice Potato.
 * Варианты: farm (фиолет-оранж), market (фиолет-оранж), profile (оранж-розовый), stats (бирюза-фиолет)
 */
export default function BackgroundScene({ variant = 'farm', children }: Props) {
 const { scrollY } = useScroll()
 const y1 = useTransform(scrollY, [0, 1000], [0, -50])
 const y2 = useTransform(scrollY, [0, 1000], [0, -100])

 const gradients: Record<Variant, { bg: string; blob1: string; blob2: string }> = {
  farm: {
   bg: 'linear-gradient(135deg, #0B0714 0%, #1A0E2E 50%, #2D0B3D 100%)',
   blob1: 'rgba(255, 122, 26, 0.08)', // orange
   blob2: 'rgba(184, 92, 255, 0.07)', // purple
  },
  market: {
   bg: 'linear-gradient(135deg, #0B0714 0%, #1A0E2E 50%, #3D1F5C 100%)',
   blob1: 'rgba(184, 92, 255, 0.07)',
   blob2: 'rgba(255, 122, 26, 0.08)',
  },
  profile: {
   bg: 'linear-gradient(135deg, #0B0714 0%, #2D0B3D 50%, #6A1B5D 100%)',
   blob1: 'rgba(255, 62, 127, 0.08)', // pink
   blob2: 'rgba(255, 122, 26, 0.08)',
  },
  stats: {
   bg: 'linear-gradient(135deg, #0B0714 0%, #0A1E2E 50%, #1A3E5C 100%)',
   blob1: 'rgba(193, 68, 14, 0.08)', // teal
   blob2: 'rgba(184, 92, 255, 0.07)',
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
   {/* Живописный интерьер колонии (арт-фон) */}
   <div
    aria-hidden="true"
    style={{
     position: 'absolute',
     inset: 0,
     backgroundImage: 'url(/ares/bg-colony.jpg)',
     backgroundSize: 'cover',
     backgroundPosition: 'center',
     opacity: 0.5,
    }}
   />
   {/* Тёплая виньетка поверх арта */}
   <div
    aria-hidden="true"
    style={{
     position: 'absolute',
     inset: 0,
     background: 'radial-gradient(120% 90% at 50% 20%, transparent 30%, rgba(6,3,1,0.72) 100%), linear-gradient(to bottom, rgba(6,3,1,0.35), transparent 30%, transparent 65%, rgba(6,3,1,0.55))',
    }}
   />

   {/* Blob 1 */}
   <motion.div
    style={{
     position: 'absolute',
     top: '10%',
     left: '-10%',
     width: '60%',
     height: '60%',
     background: `radial-gradient(circle, ${g.blob1} 0%, transparent 70%)`,
     filter: 'blur(80px)',
     y: y1,
    }}
    animate={{
     x: [0, 50, 0],
     y: [0, 30, 0],
    }}
    transition={{
     duration: 20,
     repeat: Infinity,
     ease: 'easeInOut',
    }}
   />

   {/* Blob 2 */}
   <motion.div
    style={{
     position: 'absolute',
     bottom: '10%',
     right: '-10%',
     width: '70%',
     height: '70%',
     background: `radial-gradient(circle, ${g.blob2} 0%, transparent 70%)`,
     filter: 'blur(80px)',
     y: y2,
    }}
    animate={{
     x: [0, -50, 0],
     y: [0, -30, 0],
    }}
    transition={{
     duration: 25,
     repeat: Infinity,
     ease: 'easeInOut',
    }}
   />

   {/* Зернистая металлическая текстура поверх */}
   <div
    aria-hidden="true"
    style={{
     position: 'absolute',
     inset: 0,
     backgroundImage: 'url(/ares/bg-plates.jpg)',
     backgroundSize: '512px 512px',
     opacity: 0.1,
     mixBlendMode: 'overlay',
    }}
   />

   {children}
  </div>
 )
}
