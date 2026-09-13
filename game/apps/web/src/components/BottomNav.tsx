import { motion } from 'framer-motion'
import { haptics } from '../utils/haptic'
import { Home, ShoppingCart, BarChart3, User } from 'lucide-react'

interface Props {
 current: 'farm' | 'market' | 'stats' | 'profile'
 onNavigate: (screen: 'farm' | 'market' | 'stats' | 'profile') => void
}

export default function BottomNav({ current, onNavigate }: Props) {
 const items = [
  { id: 'farm' as const, icon: Home, label: 'Ферма' },
  { id: 'market' as const, icon: ShoppingCart, label: 'Рынок' },
  { id: 'stats' as const, icon: BarChart3, label: 'Стата' },
  { id: 'profile' as const, icon: User, label: 'Профиль' },
 ]

 return (
  <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px', background: 'rgba(20, 20, 30, 0.95)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-around', padding: '10px 0 calc(12px + env(safe-area-inset-bottom, 0px)) 0', zIndex: 50 }}>
   {items.map((item) => {
    const Icon = item.icon
    const isActive = current === item.id
    return (
     <motion.button key={item.id} data-tutorial={item.id === 'market' ? 'market-tab' : undefined} whileTap={{ scale: 0.9 }} onClick={() => { haptics.navigate(); onNavigate(item.id) }}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', color: isActive ? 'var(--pf-teal)' : 'var(--pf-text-secondary)' }}>
      <Icon size={22} />
      <span style={{ fontSize: '11px', fontWeight: isActive ? '600' : '400' }}>{item.label}</span>
     </motion.button>
    )
   })}
  </div>
 )
}
