import { useEffect, useState, type CSSProperties } from 'react'
import { t } from '../i18n'

import { motion, AnimatePresence } from 'framer-motion'
import { X, ShoppingCart, Info } from 'lucide-react'
import Button from './Button'
import { MICRO, MIN_ORDER_AMOUNT_POTATO, feeBps } from '../utils/constants'
import { pdas, decodeExportLicense } from '../utils/anchorClient'
import { useSolana } from '../contexts/SolanaContext'
import { sounds } from '../utils/sounds'
import { haptics } from '../utils/haptic'
import { useToast } from './Toast'

interface Props {
 open: boolean
 onClose: () => void
 onCreate: (amount: number, price: number) => Promise<boolean>
 balanceMicro: number
}

const inputStyle: CSSProperties = {
 width: '100%',
 padding: '12px 14px',
 borderRadius: 12,
 border: '1px solid rgba(124, 255, 107, 0.25)',
 background: 'rgba(11, 7, 20, 0.6)',
 color: 'var(--pf-text-primary)',
 fontSize: 15,
 fontFamily: 'var(--pf-font-mono)',
 fontWeight: 700,
 outline: 'none',
 transition: 'border-color 0.2s, box-shadow 0.2s',
}

/**
 * Модальное окно создания ордера в стиле Vice Potato.
 * Тёмное стекло + blur, зелёная неоновая рамка, Anton-заголовок.
 */
export default function CreateOrderModal({ open, onClose, onCreate, balanceMicro }: Props) {
 const { show } = useToast()
 const { connection, programId, publicKey } = useSolana()
 const [amount, setAmount] = useState('100')
 const [price, setPrice] = useState('')
 const [busy, setBusy] = useState(false)
 const [hasLicense, setHasLicense] = useState(false)

 // Экспортная лицензия продавца (= текущий пользователь): скидка 3 %
 // от суммы списывается с комиссии при покупках — подсказываем это здесь.
 useEffect(() => {
  if (!open || !publicKey || !programId || !connection) {
   setHasLicense(false)
   return
  }
  let cancelled = false
  void (async () => {
   try {
    const licPda = pdas(programId).exportLicense(publicKey)
    const acc = await connection.getAccountInfo(licPda)
    if (cancelled) return
    if (acc && acc.data.length > 0) {
     const lic = decodeExportLicense(acc.data as Buffer)
     setHasLicense(Number(lic.expiresAt) > Math.floor(Date.now() / 1000))
    } else {
     setHasLicense(false)
    }
   } catch {
    if (!cancelled) setHasLicense(false)
   }
  })()
  return () => {
   cancelled = true
  }
 }, [open, publicKey, programId, connection])

 const amountNum = parseFloat(amount) || 0
 const priceNum = parseFloat(price) || 0
 const amountMicro = Math.floor(amountNum * MICRO)
 const bps = feeBps(amountMicro)
 const feeAmount = (amountNum * priceNum * bps) / 10_000
 const totalPotato = amountNum
 const totalSkr = amountNum * priceNum

 const handleSubmit = async () => {
  if (amountNum < MIN_ORDER_AMOUNT_POTATO) {
   show({ type: 'warning', title: t('Минимум {amount} POTATO', { amount: MIN_ORDER_AMOUNT_POTATO }) })
   return
  }
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
   show({ type: 'warning', title: t('Укажи цену за 1 POTATO в SKR') })
   return
  }
  if (totalPotato * MICRO > balanceMicro) {
   show({ type: 'warning', title: t('Недостаточно $POTATO'), message: t('Нужно {total} POTATO.', { total: totalPotato.toFixed(2) }) })
   return
  }
  sounds.click()
  haptics.buttonPress()
  setBusy(true)
  const ok = await onCreate(amountNum, priceNum)
  setBusy(false)
  if (ok) {
   setAmount('100')
   setPrice('')
   onClose()
  }
 }

 return (
  <AnimatePresence>
   {open && (
    <motion.div
     initial={{ opacity: 0 }}
     animate={{ opacity: 1 }}
     exit={{ opacity: 0 }}
     onClick={onClose}
     style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(11, 7, 20, 0.75)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
     }}
    >
     <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 24 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: 24 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      onClick={(e) => e.stopPropagation()}
      className="pf-card hull-skin"
      style={{ width: '100%', maxWidth: 400, padding: 0, overflow: 'hidden' }}
     >
      {/* Заголовок */}
      <div style={{
       padding: '18px 20px 14px',
       display: 'flex',
       alignItems: 'center',
       gap: 12,
       borderBottom: '1px solid var(--pf-border-soft)',
      }}>
       <span style={{
        display: 'inline-flex',
        color: 'var(--pf-green)',
        filter: 'drop-shadow(var(--pf-glow-green))',
       }}>
        <ShoppingCart size={22} />
       </span>
       <h2 className="pf-h2" style={{ fontSize: 18, flex: 1 }}>{t("Отгрузить $POTATO")}</h2>
       <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={onClose}
        aria-label={t("Закрыть")}
        style={{
         background: 'rgba(255,255,255,0.06)',
         border: '1px solid var(--pf-border-soft)',
         borderRadius: 10,
         padding: 6,
         cursor: 'pointer',
         color: 'var(--pf-text-secondary)',
         display: 'inline-flex',
        }}
       >
        <X size={16} />
       </motion.button>
      </div>

      {/* Форма */}
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
       <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="pf-subtitle" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
         {t('Количество POTATO')}
        </span>
        <input
         type="number"
         inputMode="decimal"
         value={amount}
         min="0"
         onChange={(e) => setAmount(e.target.value)}
         onFocus={(e) => { e.target.style.borderColor = 'var(--pf-green)'; e.target.style.boxShadow = 'var(--pf-glow-green)' }}
         onBlur={(e) => { e.target.style.borderColor = 'rgba(124, 255, 107, 0.25)'; e.target.style.boxShadow = 'none' }}
         style={inputStyle}
         placeholder="100"
        />
       </label>

       <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="pf-subtitle" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
         {t('Цена за 1 POTATO (SKR)')}
        </span>
        <input
         type="number"
         inputMode="decimal"
         value={price}
         min="0"
         step="0.000001"
         onChange={(e) => setPrice(e.target.value)}
         onFocus={(e) => { e.target.style.borderColor = 'var(--pf-green)'; e.target.style.boxShadow = 'var(--pf-glow-green)' }}
         onBlur={(e) => { e.target.style.borderColor = 'rgba(124, 255, 107, 0.25)'; e.target.style.boxShadow = 'none' }}
         style={inputStyle}
         placeholder="0.0001"
        />
       </label>

       {/* Сводка */}
       <div style={{
        borderRadius: 12,
        border: '1px solid rgba(124, 255, 107, 0.2)',
        background: 'rgba(124, 255, 107, 0.06)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
       }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
         <span className="pf-subtitle">{t("Таможенный сбор")} ({bps} bps)</span>
         <span className="pf-mono" style={{ color: 'var(--pf-text-secondary)' }}>−{feeAmount.toFixed(6)} SKR</span>
        </div>
        {hasLicense && (
         <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <span className="pf-subtitle" style={{ color: 'var(--pf-green)' }}>{t("С твоей лицензией (−3 % от суммы)")}</span>
          <span className="pf-mono" style={{ color: 'var(--pf-green)' }}>≈ {Math.max(0, bps - 300) / 100}% {t('факт.')}</span>
         </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
         <span className="pf-subtitle">{t("Спишется")}</span>
         <span className="pf-mono" style={{ color: 'var(--pf-gold)' }}>{totalPotato.toFixed(2)} POTATO</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderTop: '1px solid rgba(124,255,107,0.15)', paddingTop: 6 }}>
         <span className="pf-subtitle" style={{ color: 'var(--pf-text-primary)' }}>{t("Получишь не меньше (без скидок)")}</span>
         <span className="pf-mono" style={{ color: 'var(--pf-green)', textShadow: 'var(--pf-glow-green)' }}>
          ≈ {(totalSkr - feeAmount).toFixed(6)} SKR
         </span>
        </div>
       </div>

       <Button
        variant="primary"
        glow="green"
        disabled={busy}
        onClick={handleSubmit}
        icon={<ShoppingCart size={16} />}
        style={{ width: '100%' }}
       >
        {busy ? t('Создаём…') : t('Оформить ордер')}
       </Button>

       <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--pf-text-muted)', margin: 0 }}>
        <Info size={12} />
        {t('Ордер висит на бирже до 24ч или пока груз не примут.')}
       </p>
      </div>
     </motion.div>
    </motion.div>
   )}
  </AnimatePresence>
 )
}
