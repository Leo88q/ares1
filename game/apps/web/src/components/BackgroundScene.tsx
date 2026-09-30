import { ReactNode } from 'react'
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion'
import { useLocation } from 'react-router-dom'

type Variant = 'farm' | 'market' | 'profile' | 'stats'

interface Props {
 variant?: Variant
 children?: ReactNode
}

const BG_PHOTOS: Record<Variant, string> = {
 farm: '/ares/bg-colony.jpg',
 market: '/ares/bg-market.jpg',
 stats: '/ares/bg-engine.jpg',
 profile: '/ares/bg-cabin.jpg',
}

/**
 * Атмосферная марсианская подножка под окошки интерфейса ARES-1:
 * На каждой вкладке под панелями располагается тематическое окружение колонии:
 * - АГРО: гидропонный купол и био-ферма
 * - СНАБЖЕНИЕ: грузовой шлюз и торговый терминал
 * - ЖУРНАЛ: командный центр и отсек телеметрии
 * - КАЮТА: жилой отсек экипажа и персональный терминал
 */
export default function BackgroundScene({ variant, children }: Props) {
 const location = useLocation()
 const { scrollY } = useScroll()
 const y1 = useTransform(scrollY, [0, 1000], [0, -30])
 const y2 = useTransform(scrollY, [0, 1000], [0, -60])

 const activeVariant: Variant =
  variant ?? (
   location.pathname === '/market' ? 'market'
   : location.pathname === '/stats' ? 'stats'
   : location.pathname === '/profile' ? 'profile'
   : 'farm'
  )

 const photoSrc = BG_PHOTOS[activeVariant]

 return (
  <div
   style={{
    position: 'fixed',
    inset: 0,
    zIndex: 0,
    backgroundColor: '#080504',
    overflow: 'hidden',
    pointerEvents: 'none',
   }}
  >
   {/* Полноразмерная сгенерированная марсианская фотография отсека под окошками */}
   <AnimatePresence mode="wait">
    <motion.div
     key={activeVariant}
     initial={{ opacity: 0, scale: 1.03 }}
     animate={{ opacity: 1, scale: 1 }}
     exit={{ opacity: 0 }}
     transition={{ duration: 0.5, ease: 'easeOut' }}
     style={{
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
     }}
    >
     <img
      src={photoSrc}
      alt=""
      style={{
       width: '100%',
       height: '100%',
       objectFit: 'cover',
       objectPosition: 'center 35%',
       filter: 'brightness(0.50) contrast(1.12) saturate(0.9)',
      }}
     />

     {/* Глубокая атмосферная виньетка: сохраняет 100% читаемость металлических окошек */}
     <div
      style={{
       position: 'absolute',
       inset: 0,
       background: `
        linear-gradient(180deg, rgba(8,5,4,0.72) 0%, rgba(12,7,5,0.78) 35%, rgba(10,6,4,0.88) 75%, #080504 100%),
        radial-gradient(ellipse at 50% 35%, transparent 20%, rgba(8,5,4,0.82) 90%)
       `,
      }}
     />
    </motion.div>
   </AnimatePresence>

   {/* Атмосферный марсианский свет 1 */}
   <motion.div
    style={{
     position: 'absolute',
     top: '5%',
     left: '-5%',
     width: '65%',
     height: '65%',
     background: 'radial-gradient(circle, rgba(193, 68, 14, 0.12) 0%, transparent 70%)',
     filter: 'blur(90px)',
     y: y1,
    }}
    animate={{
     x: [0, 25, 0],
     y: [0, 15, 0],
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
     background: 'radial-gradient(circle, rgba(232, 160, 60, 0.09) 0%, transparent 70%)',
     filter: 'blur(100px)',
     y: y2,
    }}
    animate={{
     x: [0, -25, 0],
     y: [0, -15, 0],
    }}
    transition={{
     duration: 28,
     repeat: Infinity,
     ease: 'easeInOut',
    }}
   />

   {/* Тактическая координатная сетка шлюза */}
   <div
    style={{
     position: 'absolute',
     inset: 0,
     backgroundImage: `
      linear-gradient(rgba(217, 160, 107, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(217, 160, 107, 0.025) 1px, transparent 1px)
     `,
     backgroundSize: '48px 48px',
    }}
   />

   {children}
  </div>
 )
}
