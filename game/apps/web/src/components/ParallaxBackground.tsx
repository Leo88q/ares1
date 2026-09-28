import { useEffect, useState } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

interface FloatingElement {
 id: number
 shape: number
 color: string
 x: number
 y: number
 size: number
 duration: number
 delay: number
 opacity: number
}

function FloatShape({ shape, color, size }: { shape: number; color: string; size: number }): JSX.Element {
 if (shape === 1) {
  return (
   <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
    <circle cx="12" cy="12" r="8" />
   </svg>
  )
 }
 if (shape === 2) {
  return (
   <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" />
   </svg>
  )
 }
 return (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
   <circle cx="12" cy="12" r="5" />
  </svg>
 )
}

export default function ParallaxBackground() {
 const [elements, setElements] = useState<FloatingElement[]>([])
 const { scrollYProgress } = useScroll()
 
 // Параллакс на скролле
 const y1 = useTransform(scrollYProgress, [0, 1], [0, -50])
 const y2 = useTransform(scrollYProgress, [0, 1], [0, -100])
 const y3 = useTransform(scrollYProgress, [0, 1], [0, -150])

 useEffect(() => {
  // Генерируем случайные плавающие элементы
  const palette = ['#FFB347', '#B85CFF', '#12E7C4', '#6B93D6']
  const newElements: FloatingElement[] = Array.from({ length: 15 }, (_, i) => ({
   id: i,
   shape: Math.floor(Math.random() * 3),
   color: palette[i % palette.length],
   x: Math.random() * 100,
   y: Math.random() * 100,
   size: 16 + Math.random() * 24,
   duration: 20 + Math.random() * 30,
   delay: Math.random() * 10,
   opacity: 0.1 + Math.random() * 0.2,
  }))
  setElements(newElements)
 }, [])

 return (
  <div style={{
   position: 'fixed',
   inset: 0,
   overflow: 'hidden',
   pointerEvents: 'none',
   zIndex: 0,
  }}>
   {/* Градиентный фон */}
   <div style={{
    position: 'absolute',
    inset: 0,
    background: `
     radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.15), transparent 40%),
     radial-gradient(circle at 80% 80%, rgba(168, 85, 247, 0.15), transparent 40%),
     radial-gradient(circle at 50% 50%, rgba(245, 158, 11, 0.1), transparent 60%)
    `,
   }} />

   {/* Слой 1: Медленные облака */}
   <motion.div style={{ y: y1, position: 'absolute', inset: 0 }}>
    {elements.slice(0, 5).map((el) => (
     <motion.div
      key={el.id}
      initial={{ x: `${el.x}vw`, y: `${el.y}vh`, opacity: 0 }}
      animate={{
       y: [`${el.y}vh`, `${el.y - 20}vh`, `${el.y}vh`],
       opacity: [0, el.opacity, 0],
      }}
      transition={{
       duration: el.duration,
       delay: el.delay,
       repeat: Infinity,
       ease: 'easeInOut',
      }}
      style={{
       position: 'absolute',
       fontSize: `${el.size}px`,
       filter: 'blur(1px)',
      }}
     >
      <FloatShape shape={el.shape} color={el.color} size={el.size} />
     </motion.div>
    ))}
   </motion.div>

   {/* Слой 2: Средние элементы */}
   <motion.div style={{ y: y2, position: 'absolute', inset: 0 }}>
    {elements.slice(5, 10).map((el) => (
     <motion.div
      key={el.id}
      initial={{ x: `${el.x}vw`, y: `${el.y}vh`, opacity: 0 }}
      animate={{
       y: [`${el.y}vh`, `${el.y - 30}vh`, `${el.y}vh`],
       opacity: [0, el.opacity, 0],
      }}
      transition={{
       duration: el.duration * 0.8,
       delay: el.delay,
       repeat: Infinity,
       ease: 'easeInOut',
      }}
      style={{
       position: 'absolute',
       fontSize: `${el.size * 0.8}px`,
       filter: 'blur(0.5px)',
      }}
     >
      <FloatShape shape={el.shape} color={el.color} size={el.size} />
     </motion.div>
    ))}
   </motion.div>

   {/* Слой 3: Быстрые звёзды */}
   <motion.div style={{ y: y3, position: 'absolute', inset: 0 }}>
    {elements.slice(10).map((el) => (
     <motion.div
      key={el.id}
      initial={{ x: `${el.x}vw`, y: `${el.y}vh`, opacity: 0 }}
      animate={{
       y: [`${el.y}vh`, `${el.y - 40}vh`, `${el.y}vh`],
       opacity: [0, el.opacity * 0.5, 0],
      }}
      transition={{
       duration: el.duration * 0.6,
       delay: el.delay,
       repeat: Infinity,
       ease: 'easeInOut',
      }}
      style={{
       position: 'absolute',
       fontSize: `${el.size * 0.6}px`,
      }}
     >
      <FloatShape shape={el.shape} color={el.color} size={el.size} />
     </motion.div>
    ))}
   </motion.div>

   {/* Анимированные частицы-точки */}
   {Array.from({ length: 20 }).map((_, i) => (
    <motion.div
     key={`particle-${i}`}
     initial={{
      x: `${Math.random() * 100}vw`,
      y: '110vh',
      opacity: 0,
     }}
     animate={{
      y: '-10vh',
      opacity: [0, 0.3, 0],
     }}
     transition={{
      duration: 15 + Math.random() * 20,
      delay: Math.random() * 10,
      repeat: Infinity,
      ease: 'linear',
     }}
     style={{
      position: 'absolute',
      width: '2px',
      height: '2px',
      borderRadius: '50%',
      background: 'var(--pf-teal)',
      boxShadow: '0 0 8px rgba(16, 185, 129, 0.5)',
     }}
    />
   ))}
  </div>
 )
}
