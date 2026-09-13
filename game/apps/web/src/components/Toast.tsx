import { useState, createContext, useContext, ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'
interface ToastData { id: number; type: ToastType; title: string; message?: string }

const ToastContext = createContext<{ show: (t: Omit<ToastData, 'id'>) => void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
 const [toasts, setToasts] = useState<ToastData[]>([])

 const show = (t: Omit<ToastData, 'id'>) => {
  const id = Date.now() + Math.random()
  setToasts(prev => [...prev, { ...t, id }])
  setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 4000)
 }

 return (
  <ToastContext.Provider value={{ show }}>
   {children}
   <div style={{ position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '440px', zIndex: 500, padding: '0 16px', pointerEvents: 'none' }}>
    <AnimatePresence>
     {toasts.map((t, i) => <ToastItem key={t.id} toast={t} index={i} onClose={() => setToasts(p => p.filter(x => x.id !== t.id))} />)}
    </AnimatePresence>
   </div>
  </ToastContext.Provider>
 )
}

export function useToast() {
 const ctx = useContext(ToastContext)
 if (!ctx) throw new Error('useToast must be used within ToastProvider')
 return ctx
}

function ToastItem({ toast, index, onClose }: { toast: ToastData; index: number; onClose: () => void }) {
 const config = {
  success: { icon: <CheckCircle size={20} />, color: 'var(--pf-teal)', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(193, 68, 14, 0.45)' },
  error:  { icon: <X size={20} />,     color: 'var(--pf-red)', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.4)' },
  warning: { icon: <AlertTriangle size={20} />, color: 'var(--pf-gold)', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.4)' },
  info:  { icon: <Info size={20} />,    color: 'var(--ares-blueset, #6B93D6)', bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.4)' },
 }[toast.type]

 return (
  <motion.div
   initial={{ opacity: 0, y: -20, scale: 0.9 }}
   animate={{ opacity: 1, y: index * 8, scale: 1 }}
   exit={{ opacity: 0, x: 100 }}
   role={toast.type === 'error' ? 'alert' : 'status'}
   onClick={onClose}
   style={{
    marginTop: '10px', padding: '14px 16px', borderRadius: '14px', cursor: 'pointer',
    background: config.bg, border: `1px solid ${config.border}`,
    backdropFilter: 'blur(20px)',
    display: 'flex', alignItems: 'flex-start', gap: '12px',
    pointerEvents: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
   }}>
   <div style={{ color: config.color, marginTop: '2px' }}>{config.icon}</div>
   <div style={{ flex: 1 }}>
    <div style={{ fontSize: '14px', fontWeight: '700', color: 'white', marginBottom: toast.message ? '4px' : 0 }}>{toast.title}</div>
    {toast.message && <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5 }}>{toast.message}</div>}
   </div>
  </motion.div>
 )
}
