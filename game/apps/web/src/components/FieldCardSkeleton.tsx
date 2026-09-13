import { motion } from 'framer-motion'

export default function FieldCardSkeleton() {
 return (
  <motion.div
   initial={{ opacity: 0 }}
   animate={{ opacity: 1 }}
   className="pf-card hull-skin"
   style={{
    padding: '20px',
    borderRadius: '20px',
    position: 'relative',
    overflow: 'hidden',
   }}
  >
   {/* Шиммер эффект */}
   <div
    style={{
     position: 'absolute',
     inset: 0,
     background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
     animation: 'shimmer 1.5s infinite',
    }}
   />

   {/* Заголовок */}
   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
     <div style={{
      width: '32px', height: '32px', borderRadius: '10px',
      background: 'rgba(255,255,255,0.08)',
     }} />
     <div style={{ width: '60px', height: '12px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)' }} />
    </div>
    <div style={{
     width: '50px', height: '24px', borderRadius: '12px',
     background: 'rgba(255,255,255,0.08)',
    }} />
   </div>

   {/* Накоплено */}
   <div style={{ marginBottom: '12px' }}>
    <div style={{ width: '80px', height: '12px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', marginBottom: '6px' }} />
    <div style={{ width: '120px', height: '22px', borderRadius: '6px', background: 'rgba(255,255,255,0.08)' }} />
   </div>

   {/* Прогресс бары */}
   <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', marginBottom: '8px' }} />
   <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', marginBottom: '12px' }} />

   {/* Кнопка */}
   <div style={{
    width: '100%', height: '44px', borderRadius: '12px',
    background: 'rgba(255,255,255,0.08)',
   }} />

   <style>{`
    @keyframes shimmer {
     0% { transform: translateX(-100%); }
     100% { transform: translateX(100%); }
    }
   `}</style>
  </motion.div>
 )
}
