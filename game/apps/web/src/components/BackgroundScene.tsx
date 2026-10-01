import { ReactNode } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

interface Props {
 children?: ReactNode
}

/**
 * Атмосферная марсианская подложка по телефонной раскладке:
 * Располагается внутри телефонного контейнера (max-width: 480px),
 * создавая глубину жилого купола и био-отсека без растянутых внешних фото.
 */
export default function BackgroundScene({ children }: Props) {
 const { scrollY } = useScroll()
 const y1 = useTransform(scrollY, [0, 1000], [0, -40])
 const y2 = useTransform(scrollY, [0, 1000], [0, -80])

 return (
  <div
   className="pf-phone-backdrop"
   style={{
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    backgroundColor: '#0E0805',
    overflow: 'hidden',
    pointerEvents: 'none',
   }}
  >
   {/* Глубокий марсианский градиент отсека */}
   <div
    style={{
     position: 'absolute',
     inset: 0,
     background: `
      linear-gradient(180deg, rgba(28, 17, 10, 0.45) 0%, rgba(18, 11, 7, 0.75) 45%, rgba(10, 6, 4, 0.95) 100%),
      radial-gradient(ellipse at 50% 20%, rgba(193, 68, 14, 0.14) 0%, transparent 65%)
     `,
    }}
   />

   {/* Атмосферный марсианский свет 1: тёплое янтарное свечение ламп */}
   <motion.div
    style={{
     position: 'absolute',
     top: '10%',
     left: '-20%',
     width: '90%',
     height: '60%',
     background: 'radial-gradient(circle, rgba(232, 160, 60, 0.08) 0%, transparent 70%)',
     filter: 'blur(70px)',
     y: y1,
    }}
    animate={{
     x: [0, 15, 0],
     y: [0, 10, 0],
    }}
    transition={{
     duration: 18,
     repeat: Infinity,
     ease: 'easeInOut',
    }}
   />

   {/* Атмосферный марсианский свет 2: терракотовый рефлекс купола */}
   <motion.div
    style={{
     position: 'absolute',
     bottom: '15%',
     right: '-20%',
     width: '90%',
     height: '55%',
     background: 'radial-gradient(circle, rgba(193, 68, 14, 0.09) 0%, transparent 70%)',
     filter: 'blur(80px)',
     y: y2,
    }}
    animate={{
     x: [0, -15, 0],
     y: [0, -12, 0],
    }}
    transition={{
     duration: 24,
     repeat: Infinity,
     ease: 'easeInOut',
    }}
   />

   {/* Тактическая координатная сетка купола */}
   <div
    style={{
     position: 'absolute',
     inset: 0,
     backgroundImage: `
      linear-gradient(rgba(217, 160, 107, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(217, 160, 107, 0.025) 1px, transparent 1px)
     `,
     backgroundSize: '40px 40px',
    }}
   />

   {/* Внутренняя виньетка по краям телефонной рамки */}
   <div
    style={{
     position: 'absolute',
     inset: 0,
     boxShadow: 'inset 0 0 45px rgba(0, 0, 0, 0.75)',
    }}
   />

   {children}
  </div>
 )
}
