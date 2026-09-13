import { motion } from 'framer-motion'

export default function HarvestAnimation({ amount }: { amount: number }) {
 return (
  <motion.div
   initial={{ opacity: 0, y: 0 }}
   animate={{ opacity: [0, 1, 1, 0], y: -80 }}
   transition={{ duration: 1.8, times: [0, 0.2, 0.8, 1] }}
   exit={{ opacity: 0 }}
   style={{
    position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)',
    zIndex: 400, pointerEvents: 'none',
   }}>
   <div style={{
    padding: '18px 28px', borderRadius: '20px',
    background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.95), rgba(217, 119, 6, 0.95))',
    boxShadow: '0 20px 60px rgba(245, 158, 11, 0.5)',
    display: 'flex', alignItems: 'center', gap: '10px',
    backdropFilter: 'blur(20px)',
   }}>
    <span style={{ fontSize: '28px', fontWeight: '800', color: 'white', letterSpacing: '0.5px' }}>
     +{(amount / 1_000_000).toFixed(3)}
    </span>
   </div>
  </motion.div>
 )
}
