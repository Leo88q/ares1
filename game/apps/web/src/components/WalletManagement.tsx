import { useState } from 'react'
import { t } from '../i18n'

import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronUp, ArrowDownLeft, ArrowUpRight, Copy, Check, Wallet } from 'lucide-react'
import { PublicKey } from '@solana/web3.js'
import { useSolana, IS_MAINNET, CLUSTER } from '../contexts/SolanaContext'
import { useGame } from '../contexts/GameContext'
import { useToast } from './Toast'
import { sounds } from '../utils/sounds'
import { haptics } from '../utils/haptic'
import { fmtPotato } from '../utils/constants'

type CurrencyId = 'SOL' | 'POTATO'

interface Currency {
 id: CurrencyId
 name: string
 symbol: string
 icon: string
 color: string
 min: number
}

const CURRENCIES: Currency[] = [
 { id: 'SOL', name: 'Solana', symbol: 'SOL', icon: '', color: 'var(--ares-grow-violet, #B85CFF)', min: 0.001 },
 { id: 'POTATO', name: 'Potato', symbol: 'POTATO', icon: '', color: 'var(--pf-gold)', min: 0.01 },
]

/** Deposit / withdraw panel. The $POTATO mint comes from the on-chain GameConfig. */
export default function WalletManagement() {
 const { publicKey, config } = useSolana()
 const { solBalance, stats, airdropSol, sendPotato, sendSol } = useGame()
 const { show } = useToast()
 const [isOpen, setIsOpen] = useState(false)
 const [selected, setSelected] = useState<CurrencyId>('SOL')
 const [action, setAction] = useState<'deposit' | 'withdraw' | null>(null)
 const [amount, setAmount] = useState('')
 const [recipient, setRecipient] = useState('')
 const [copied, setCopied] = useState(false)
 const [loading, setLoading] = useState(false)

 const currency = CURRENCIES.find((c) => c.id === selected)!
 const balanceLabel = selected === 'SOL' ? `${solBalance.toFixed(4)} SOL` : `${fmtPotato(stats.potatoBalance)} POTATO`

 const handleDeposit = async () => {
  if (!publicKey) {
   show({ type: 'warning', title: t('Подключи кошелёк') })
   return
  }
  sounds.click()
  haptics.buttonPress()
  if (selected === 'SOL' && !IS_MAINNET) {
   setLoading(true)
   const ok = await airdropSol()
   setLoading(false)
   if (ok) show({ type: 'success', title: t('SOL получен'), message: t('+1 SOL ({cluster} airdrop)', { cluster: CLUSTER }) })
  } else {
   void navigator.clipboard.writeText(publicKey.toString())
   show({ type: 'info', title: t('Адрес скопирован'), message: t('Отправь {cur} на этот адрес с биржи или другого кошелька.', { cur: currency.name }) })
  }
 }

 const handleWithdraw = async () => {
  if (!publicKey) {
   show({ type: 'warning', title: t('Подключи кошелёк') })
   return
  }
  const amountNum = parseFloat(amount)
  if (!amountNum || amountNum < currency.min) {
   show({ type: 'warning', title: t('Минимум {min} {sym}', { min: currency.min, sym: currency.symbol }) })
   return
  }
  try {
   new PublicKey(recipient)
  } catch {
   show({ type: 'error', title: t('Неверный адрес получателя') })
   return
  }
  if (recipient === publicKey.toString()) {
   show({ type: 'warning', title: t('Это твой собственный адрес') })
   return
  }
  sounds.click()
  haptics.buttonPress()
  setLoading(true)
  const ok = selected === 'SOL' ? await sendSol(recipient, amountNum) : await sendPotato(recipient, amountNum)
  setLoading(false)
  if (ok) {
   show({ type: 'success', title: t('{cur} отправлен', { cur: currency.name }), message: `${amountNum} ${currency.symbol} → ${recipient.slice(0, 8)}…` })
   setAmount('')
   setRecipient('')
   setAction(null)
  }
 }

 const copyAddress = () => {
  if (!publicKey) return
  void navigator.clipboard.writeText(publicKey.toString())
  setCopied(true)
  sounds.click()
  haptics.buttonPress()
  window.setTimeout(() => setCopied(false), 2000)
 }

 const inputStyle: React.CSSProperties = {
  width: '100%', padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(160,82,40,0.5)', color: 'white', fontSize: 13, outline: 'none', marginBottom: 10,
 }

 return (
  <div style={{ marginBottom: 16 }}>
   <motion.button
    whileTap={{ scale: 0.98 }}
    onClick={() => { setIsOpen(!isOpen); sounds.click(); haptics.buttonPress() }}
    aria-expanded={isOpen}
    className="pf-card hull-skin"
    style={{ width: '100%', padding: '16px 20px', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(160,82,40,0.65)' }}
   >
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
     <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #8A2E08, #C1440E)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
      <Wallet size={20} color="white" />
     </div>
     <div style={{ textAlign: 'left' }}>
      <div className="ares-stencil" style={{ fontSize: 13, color: 'var(--ares-hud-amber, #FFB347)' }}>{t('УПРАВЛЕНИЕ КОШЕЛЬКОМ')}</div>
      <div style={{ fontSize: 12, color: 'var(--pf-text-secondary)' }}>{t('Приём и передача топлива и пайка')}</div>
     </div>
    </div>
    {isOpen ? <ChevronUp size={20} color="var(--pf-text-secondary)" /> : <ChevronDown size={20} color="var(--pf-text-secondary)" />}
   </motion.button>

   <AnimatePresence>
    {isOpen && (
     <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} style={{ overflow: 'hidden' }}>
      <div style={{ padding: 16, marginTop: 8 }} className="pf-card hull-skin">
       <div style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.03)', marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)', marginBottom: 6 }}>{t('Твой адрес для получения')}:</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
         <code style={{ flex: 1, fontSize: 11, color: 'var(--ares-parchment, #F2E8DA)', fontFamily: 'var(--ares-font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {publicKey?.toString() || t('Не подключён')}
         </code>
         <motion.button whileTap={{ scale: 0.9 }} onClick={copyAddress} aria-label={t("Скопировать адрес")}
          style={{ padding: '6px 10px', borderRadius: 6, background: copied ? 'var(--pf-teal)' : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center' }}>
          {copied ? <Check size={12} color="white" /> : <Copy size={12} color="var(--pf-text-secondary)" />}
         </motion.button>
        </div>
       </div>

       <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--pf-text-secondary)', marginBottom: 8 }}>{t('Валюта')} · {t('баланс')} {balanceLabel}</div>
        <div role="radiogroup" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
         {CURRENCIES.map((c) => {
          const active = selected === c.id
          return (
           <motion.button key={c.id} role="radio" aria-checked={active} whileTap={{ scale: 0.95 }}
            onClick={() => { setSelected(c.id); sounds.click(); haptics.tap() }}
            style={{ padding: '12px 8px', borderRadius: 10, background: active ? `${c.color}20` : 'rgba(255,255,255,0.03)', border: active ? `2px solid ${c.color}` : '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: 'white' }}>
            <span style={{ fontSize: 20 }} aria-hidden="true">{c.icon}</span>
            <div style={{ fontSize: 11, fontWeight: 600 }}>{c.name}</div>
           </motion.button>
          )
         })}
        </div>
       </div>

       <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <ActionToggle active={action === 'deposit'} color="var(--pf-teal)" onClick={() => setAction(action === 'deposit' ? null : 'deposit')} icon={<ArrowDownLeft size={16} />} label={t("Принять")} />
        <ActionToggle active={action === 'withdraw'} color="var(--pf-gold)" onClick={() => setAction(action === 'withdraw' ? null : 'withdraw')} icon={<ArrowUpRight size={16} />} label={t("Передать")} />
       </div>

       <AnimatePresence>
        {action === 'deposit' && (
         <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
          <div style={{ padding: 14, borderRadius: 12, background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(193, 68, 14, 0.12)' }}>
           <div style={{ fontSize: 13, color: 'var(--pf-teal)', marginBottom: 8, fontWeight: 600 }}>{t('Приём')} {currency.name}</div>
           <div style={{ fontSize: 12, color: 'var(--pf-text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
            {selected === 'SOL' && !IS_MAINNET
             ? t(' Тестовая сеть ({cluster}): получи 1 SOL из крана или отправь SOL на адрес выше.', { cluster: CLUSTER })
             : selected === 'SOL'
              ? t('Отправь SOL с биржи или другого кошелька на адрес выше.')
              : `${t('$POTATO можно купить на вкладке «Рынок» за SOL или получить переводом на адрес выше')}${config ? t(' (mint {mint}…)', { mint: config.potatoMint.toString().slice(0, 6) }) : ''}.`}
           </div>
           <motion.button whileTap={{ scale: 0.95 }} onClick={handleDeposit} disabled={loading}
            style={{ width: '100%', padding: 12, borderRadius: 10, background: 'var(--pf-teal)', color: 'white', fontSize: 13, fontWeight: 700, opacity: loading ? 0.7 : 1 }}>
            {loading ? t(' Пополнение…') : selected === 'SOL' && !IS_MAINNET ? t(' Получить 1 SOL (airdrop)') : t(' Скопировать адрес')}
           </motion.button>
          </div>
         </motion.div>
        )}
       </AnimatePresence>

       <AnimatePresence>
        {action === 'withdraw' && (
         <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
          <div style={{ padding: 14, borderRadius: 12, background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
           <div style={{ fontSize: 13, color: 'var(--pf-gold)', marginBottom: 10, fontWeight: 600 }}>{t('Передача')} {currency.name}</div>
           <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder={t("Адрес получателя")} aria-label={t("Адрес получателя")} autoComplete="off" spellCheck={false}
            style={{ ...inputStyle, fontFamily: 'monospace' }} />
           <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t(`Сумма ${currency.symbol}`)} aria-label={t("Сумма")} step={currency.min} min={currency.min}
            style={inputStyle} />
           <p style={{ fontSize: 11, color: 'var(--pf-red)', marginBottom: 10 }}>{t('Проверь адрес дважды — транзакцию в блокчейне нельзя отменить.')}</p>
           <motion.button whileTap={{ scale: 0.95 }} onClick={handleWithdraw} disabled={loading || !amount || !recipient}
            style={{ width: '100%', padding: 12, borderRadius: 10, background: !amount || !recipient ? 'rgba(255,255,255,0.1)' : 'var(--pf-gold)', color: 'white', fontSize: 13, fontWeight: 700, opacity: loading ? 0.7 : 1 }}>
            {loading ? t(' Отправка…') : t('Передать {amount} {sym}', { amount: amount || '0', sym: currency.symbol })}
           </motion.button>
          </div>
         </motion.div>
        )}
       </AnimatePresence>
      </div>
     </motion.div>
    )}
   </AnimatePresence>
  </div>
 )
}

function ActionToggle({ active, color, onClick, icon, label }: { active: boolean; color: string; onClick: () => void; icon: React.ReactNode; label: string }) {
 return (
  <motion.button whileTap={{ scale: 0.95 }} onClick={onClick} aria-pressed={active}
   style={{ padding: 12, borderRadius: 10, background: active ? color : `${color}33`, border: `1px solid ${color}66`, color: active ? 'white' : color, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
   <span aria-hidden="true">{icon}</span>
   {label}
  </motion.button>
 )
}
