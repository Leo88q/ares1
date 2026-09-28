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
   <div style={{ position: 'relative', height: '22px', borderStyle: 'solid', borderWidth: 8, borderImage: "url('/ares/kit/track.webp') 34 fill / 8px", background: 'none', overflow: 'hidden' }}>
    <motion.div
     initial={{ width: 0 }}
     animate={{ width: `${percentage}%` }}
     transition={{ duration: 1, ease: 'easeOut' }}
     style={{
      height: '100%',
      borderRadius: 3,
      background: `linear-gradient(to right, ${color}CC, ${color}88), url('/ares/kit/fill.webp')`,
      backgroundSize: 'auto, 120px 100%',
      backgroundRepeat: 'no-repeat, repeat-x',
      boxShadow: `inset 0 0 6px -1px ${color}AA`,
     }}
    />
   </div>
  </div>
 )
}
