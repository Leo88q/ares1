import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Particle {
 id: number
 x: number
 y: number
 targetX: number
 targetY: number
 kind: 'tuber' | 'spark'
 delay: number
 duration: number
 size: number
 rotate: number
}

interface Props {
 fromElement: HTMLElement | null
 toElement: HTMLElement | null
 amount: number
 onComplete?: () => void
}

export default function HarvestParticles({ fromElement, toElement, amount, onComplete }: Props) {
 const [particles, setParticles] = useState<Particle[]>([])

 useEffect(() => {
  if (!fromElement || !toElement || amount <= 0) return

  const fromRect = fromElement.getBoundingClientRect()
  const toRect = toElement.getBoundingClientRect()

  const particleCount = Math.min(25, Math.max(15, Math.floor(amount / 50000)))
  const kinds: Array<'tuber' | 'spark'> = ['tuber', 'tuber', 'tuber', 'spark', 'spark']
  
  const newParticles: Particle[] = Array.from({ length: particleCount }, (_, i) => ({
   id: Date.now() + i,
   x: fromRect.left + fromRect.width / 2 + (Math.random() - 0.5) * 60,
   y: fromRect.top + fromRect.height / 2 + (Math.random() - 0.5) * 60,
   targetX: toRect.left + toRect.width / 2,
   targetY: toRect.top + toRect.height / 2,
   kind: kinds[Math.floor(Math.random() * kinds.length)],
   delay: i * 0.05,
   duration: 0.8 + Math.random() * 0.4,
   size: 16 + Math.random() * 12,
   rotate: (Math.random() - 0.5) * 720,
  }))

  setParticles(newParticles)

  const timeout = setTimeout(() => {
   setParticles([])
   onComplete?.()
  }, 2500)

  return () => clearTimeout(timeout)
 }, [fromElement, toElement, amount])

 return (
  <AnimatePresence>
   {particles.map((particle) => (
    <motion.div
     key={particle.id}
     initial={{ x: particle.x, y: particle.y, scale: 0, opacity: 0, rotate: 0 }}
     animate={{
      x: [particle.x, particle.x + (Math.random() - 0.5) * 100, particle.targetX],
      y: [particle.y, particle.y - 100 - Math.random() * 50, particle.targetY],
      scale: [0, 1.2, 0.5],
      opacity: [0, 1, 0],
      rotate: particle.rotate,
     }}
     exit={{ opacity: 0 }}
     transition={{ duration: particle.duration, delay: particle.delay, ease: [0.25, 0.46, 0.45, 0.94] }}
     style={{
      position: 'fixed', top: 0, left: 0, width: particle.size, height: particle.size,
      pointerEvents: 'none', zIndex: 9999,
      filter: 'drop-shadow(0 2px 8px rgba(245, 158, 11, 0.5))',
     }}
    >
     {particle.kind === 'tuber' ? (
      <svg viewBox="0 0 24 24" width="100%" height="100%"><ellipse cx="12" cy="13" rx="8" ry="6.5" fill="#E8A94E" stroke="#8A5A1E" strokeWidth="1.5"/><circle cx="9" cy="11" r="1" fill="#8A5A1E"/><circle cx="14" cy="14" r="1" fill="#8A5A1E"/><circle cx="12" cy="10" r="0.8" fill="#8A5A1E"/></svg>
     ) : (
      <svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" fill="#FFD278"/></svg>
     )}
    </motion.div>
   ))}
  </AnimatePresence>
 )
}
