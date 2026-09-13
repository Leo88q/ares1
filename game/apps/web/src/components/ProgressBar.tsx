import { motion } from 'framer-motion'

interface Props {
 label: string
 value: number
 max: number
 color: string
}

export default function ProgressBar({ label, value, max, color }: Props) {
 const percentage = (value / max) * 100
 return (
  <div>
   <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
    <span style={{ color: 'var(--pf-text-secondary)' }}>{label}</span>
    <span style={{ color, fontWeight: '600' }}>{value}%</span>
   </div>
   <div style={{ height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
    <motion.div initial={{ width: 0 }} animate={{ width: `${percentage}%` }} transition={{ duration: 1, ease: 'easeOut' }} style={{ height: '100%', background: color, borderRadius: '4px' }} />
   </div>
  </div>
 )
}
