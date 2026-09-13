import { motion, AnimatePresence } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { ReactNode } from 'react'

interface Props {
 children: ReactNode
}

export default function PageTransition({ children }: Props) {
 const location = useLocation()

 return (
  <AnimatePresence mode="wait">
   <motion.div
    key={location.pathname}
    initial={{ 
     opacity: 0, 
     y: 20,
     scale: 0.98,
    }}
    animate={{ 
     opacity: 1, 
     y: 0,
     scale: 1,
    }}
    exit={{ 
     opacity: 0, 
     y: -20,
     scale: 0.98,
    }}
    transition={{ 
     duration: 0.3, 
     ease: [0.25, 0.46, 0.45, 0.94],
    }}
    style={{
     position: 'relative',
     width: '100%',
    }}
   >
    {children}
   </motion.div>
  </AnimatePresence>
 )
}
