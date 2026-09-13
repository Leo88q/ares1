import { motion, AnimatePresence } from 'framer-motion'

interface Props {
 show: boolean
 amount: number
}

export default function BigPurchaseEffect({ show, amount }: Props) {
 return (
  <AnimatePresence>
   {show && (
    <motion.div
     initial={{ opacity: 0, scale: 0.5 }}
     animate={{ opacity: 1, scale: 1 }}
     exit={{ opacity: 0, scale: 1.5 }}
     transition={{ duration: 0.5, ease: 'easeOut' }}
     style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 9998,
      pointerEvents: 'none',
     }}
    >
     <motion.div
      animate={{
       scale: [1, 1.2, 1],
       rotate: [0, 5, -5, 0],
      }}
      transition={{ duration: 0.6, repeat: 2 }}
      style={{
       fontSize: '80px',
       filter: 'drop-shadow(0 0 40px rgba(245, 158, 11, 0.8))',
      }}
     >
      
     </motion.div>
     <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      style={{
       position: 'absolute',
       top: '100%',
       left: '50%',
       transform: 'translateX(-50%)',
       marginTop: '20px',
       textAlign: 'center',
       whiteSpace: 'nowrap',
      }}
     >
      <div style={{
       fontSize: '24px',
       fontWeight: '800',
       color: 'var(--pf-gold)',
       textShadow: '0 2px 10px rgba(245, 158, 11, 0.5)',
      }}>
       +{amount} POTATO
      </div>
     </motion.div>
    </motion.div>
   )}
  </AnimatePresence>
 )
}
