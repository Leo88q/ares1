import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Particle {
 id: number
 x: number
 y: number
 color: string
 size: number
 rotation: number
 duration: number
 delay: number
}

interface Props {
 trigger: boolean
 onComplete?: () => void
}

export default function Confetti({ trigger, onComplete }: Props) {
 const [particles, setParticles] = useState<Particle[]>([])

 useEffect(() => {
  if (!trigger) {
   setParticles([])
   return
  }

  const colors = ['var(--pf-gold)', 'var(--pf-teal)', 'var(--ares-blueset, #6B93D6)', 'var(--ares-grow-violet, #B85CFF)', 'var(--pf-red)', 'var(--pf-pink)']
  const newParticles: Particle[] = Array.from({ length: 100 }, (_, i) => ({
   id: i,
   x: Math.random() * window.innerWidth,
   y: -20,
   color: colors[Math.floor(Math.random() * colors.length)],
   size: 6 + Math.random() * 8,
   rotation: Math.random() * 360,
   duration: 2 + Math.random() * 2,
   delay: Math.random() * 0.5,
  }))

  setParticles(newParticles)

  const timeout = setTimeout(() => {
   setParticles([])
   onComplete?.()
  }, 4000)

  return () => clearTimeout(timeout)
 }, [trigger])

 return (
  <AnimatePresence>
   {particles.map((particle) => (
    <motion.div
     key={particle.id}
     initial={{
      x: particle.x,
      y: particle.y,
      rotate: 0,
      opacity: 1,
     }}
     animate={{
      y: window.innerHeight + 100,
      rotate: particle.rotation + 720,
      opacity: [1, 1, 0],
     }}
     exit={{ opacity: 0 }}
     transition={{
      duration: particle.duration,
      delay: particle.delay,
      ease: [0.25, 0.46, 0.45, 0.94],
     }}
     style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: `${particle.size}px`,
      height: `${particle.size}px`,
      backgroundColor: particle.color,
      borderRadius: Math.random() > 0.5 ? '50%' : '2px',
      pointerEvents: 'none',
      zIndex: 9999,
      boxShadow: `0 2px 8px ${particle.color}40`,
     }}
    />
   ))}
  </AnimatePresence>
 )
}
