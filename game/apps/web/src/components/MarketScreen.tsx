import { ReactNode, useState, useMemo } from 'react'
import { t } from '../i18n'

import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Clock, User, Loader2 } from 'lucide-react'
import BigPurchaseEffect from './BigPurchaseEffect'
import CreateOrderModal from './CreateOrderModal'
import { haptics } from '../utils/haptic'
import { useMarketplace, MarketOrder } from '../hooks/useMarketplace'
import { useGame } from '../contexts/GameContext'
import { fmtPotato, fmtSol, MICRO, CANCEL_COOLDOWN_HOURS } from '../utils/constants'
import { SupplyBay } from './ares/SupplyBay';
import { HullPanel } from '../ui/HullPanel';
import { ErrorState, LoadingState } from '../ui/states'
function MarketScreenInner() {
 const { orders, myOrders, stats, loading, actionLoading, error, createOrder, fillOrder, cancelOrder, reload } = useMarketplace()
 const { stats: gameStats } = useGame()


 const [showCreate, setShowCreate] = useState(false)
 const [filter, setFilter] = useState<'all' | 'mine'>('all')
 const [cancelTarget, setCancelTarget] = useState<MarketOrder | null>(null)
 const [cancelInfo, setCancelInfo] = useState(false)
 const [fPriceMin, setFPriceMin] = useState('')
 const [fPriceMax, setFPriceMax] = useState('')
 const [fAmtMin, setFAmtMin] = useState('')
 const [fAmtMax, setFAmtMax] = useState('')
 const [dPriceMin, setDPriceMin] = useState('')
 const [dPriceMax, setDPriceMax] = useState('')
 const [dAmtMin, setDAmtMin] = useState('')
 const [dAmtMax, setDAmtMax] = useState('')
 const [bigPurchase, setBigPurchase] = useState<number | null>(null)



 const handleBuy = async (order: MarketOrder) => {
  haptics.buyOrder()
  const ok = await fillOrder(order)
  if (ok && order.amountMicro >= 1_000 * MICRO) {
   setBigPurchase(order.amountMicro / MICRO)
   window.setTimeout(() => setBigPurchase(null), 2500)
  }
 }

 const baseOrders = filter === 'mine' ? myOrders : orders.filter((o) => !o.isOwn)
 const filteredOrders = useMemo(() => baseOrders.filter((o) => {
  const price = o.priceLamportsPerPotato / 1e9
  const amt = o.amountMicro / MICRO
  if (fPriceMin && price < Number(fPriceMin)) return false
  if (fPriceMax && price > Number(fPriceMax)) return false
  if (fAmtMin && amt < Number(fAmtMin)) return false
  if (fAmtMax && amt > Number(fAmtMax)) return false
  return true
 }), [baseOrders, fPriceMin, fPriceMax, fAmtMin, fAmtMax])

 return (
  <div className="main-screen-container">
   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
     <div>
      <h1 className="pf-h1" style={{ fontSize: 26 }}>{t("СНАБЖЕНИЕ")}</h1>
      <p className="pf-subtitle" style={{ marginTop: 4 }}>{t("Приём и отгрузка грузов колонии")}</p>
     </div>
    </div>
    <motion.button
     whileTap={{ y: 2 }}
     transition={{ type: 'spring', stiffness: 520, damping: 26 }}
     onClick={() => { haptics.tap(); setShowCreate(true) }}
     className="mk-key mk-key--paint"
     style={{ padding: '9px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
    >
     <Plus size={16} aria-hidden="true" /> {t('Отгрузить')}
    </motion.button>
   </div>

   <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
    <StatCard primary label={t("ГРУЗООБОРОТ ЗА СОЛ")} value={`${stats.sellVolume24h.toFixed(0)} POTATO`} />
    <StatCard label={t("Оборот рынка")} value={`${stats.totalSolVolume.toFixed(2)} SOL`} />
    <StatCard label={t("Всего операций")} value={stats.totalTrades.toString()} />
    <StatCard label={t("Активных ордеров")} value={orders.length.toString()} />
   </div>

   <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
    {(['all', 'mine'] as const).map((f) => {
     const active = filter === f
     return (
      <button
       key={f}
       role="tab"
       aria-selected={active}
       onClick={() => setFilter(f)}
        className={`mk-key${active ? ' mk-key--engaged' : ''}`}
        style={{ flex: 1, padding: '13px 10px', color: active ? 'var(--ares-hud-amber, #FFB347)' : 'rgba(255,179,71,0.6)', fontSize: 12, fontFamily: 'var(--ares-font-stencil)', letterSpacing: '0.14em', fontWeight: 600, cursor: 'pointer' }}
      >
       {f === 'all' ? t('Все грузы') : t('Мои ордера ({count})', { count: myOrders.length })}
      </button>
     )
    })}
   </div>

   {filter === 'all' && (
    <HullPanel style={{ marginBottom: 12 }}>
     <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
       <span className="ares-mono" style={{ fontSize: 10, color: 'var(--pf-text-muted)', letterSpacing: '0.14em' }}>{t("ФИЛЬТРЫ БИРЖИ")}</span>
       <span className="ares-mono" style={{ fontSize: 9, color: 'var(--ares-hud-amber, #FFB347)', letterSpacing: '0.08em' }}>{t("МИН. ОРДЕР: 10 POTATO · СУММА ОТ 0.001 SOL")}</span>
      </div>
      <div className="market-filter-grid">
       <label className="market-filter-field">
        <span>{t('ЦЕНА ОТ, SOL')}</span>
        <input inputMode="decimal" placeholder="0.00" value={dPriceMin} onChange={e => setDPriceMin(e.target.value)} />
       </label>
       <label className="market-filter-field">
        <span>{t('ЦЕНА ДО, SOL')}</span>
        <input inputMode="decimal" placeholder="∞" value={dPriceMax} onChange={e => setDPriceMax(e.target.value)} />
       </label>
       <label className="market-filter-field">
        <span>{t('ОБЪЁМ ОТ, POTATO')}</span>
        <input inputMode="decimal" placeholder="0" value={dAmtMin} onChange={e => setDAmtMin(e.target.value)} />
       </label>
       <label className="market-filter-field">
        <span>{t('ОБЪЁМ ДО, POTATO')}</span>
        <input inputMode="decimal" placeholder="∞" value={dAmtMax} onChange={e => setDAmtMax(e.target.value)} />
       </label>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
       <button
        type="button"
        className="ares-stencil market-filter-apply"
        onClick={() => {
         setFPriceMin(dPriceMin)
         setFPriceMax(dPriceMax)
         setFAmtMin(dAmtMin)
         setFAmtMax(dAmtMax)
        }}
       >
        {t('ПРИМЕНИТЬ')}
       </button>
       <button
        type="button"
        className="ares-stencil market-filter-reset"
        onClick={() => {
         setDPriceMin(''); setDPriceMax(''); setDAmtMin(''); setDAmtMax('')
         setFPriceMin(''); setFPriceMax(''); setFAmtMin(''); setFAmtMax('')
        }}
       >
        {t('СБРОСИТЬ')}
       </button>
       {[fPriceMin, fPriceMax, fAmtMin, fAmtMax].filter(Boolean).length > 0 && (
        <span className="ares-mono" style={{ fontSize: 9, color: 'var(--ares-bio-cyan, #12E7C4)', letterSpacing: '0.1em' }}>
         {t('АКТИВНО ФИЛЬТРОВ')}: {[fPriceMin, fPriceMax, fAmtMin, fAmtMax].filter(Boolean).length}
        </span>
       )}
      </div>
     </div>
    </HullPanel>
   )}

   {loading ? (
    <LoadingState label={t("Загружаем рынок…")} />
   ) : error && filteredOrders.length === 0 ? (
    <ErrorState message={error} onRetry={reload} />
   ) : (
    <>
     {error && <ErrorState inline message={error} onRetry={reload} />}
     {filteredOrders.length === 0 ? (
      <div className="po-plate po-plate--market" style={{ padding: '36px 20px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
       <div className="po-hazard" aria-hidden="true" />
       <span className="po-screw po-screw--tl" aria-hidden="true" />
       <span className="po-screw po-screw--tr" aria-hidden="true" />
       <span className="po-screw po-screw--bl" aria-hidden="true" />
       <span className="po-screw po-screw--br" aria-hidden="true" />
       <div className="po-spray" style={{ fontFamily: 'var(--ares-font-stencil)', fontSize: 11, letterSpacing: '0.2em', color: '#D4A576', marginBottom: 10, textTransform: 'uppercase' }}>
        {t("ТЕРМИНАЛ СНАБЖЕНИЯ // СТАТУС: СВОБОДЕН")}
       </div>
       <div style={{ fontSize: 18, fontWeight: 700, color: '#F6F1ED', marginBottom: 8, fontFamily: 'var(--ares-font-stencil)' }}>
        {filter === 'mine' ? t('У тебя нет активных ордеров') : t('В грузовом стакане нет заявок')}
       </div>
       <p style={{ fontSize: 13, color: 'var(--ares-dust, #E0A183)', maxWidth: 360, margin: '0 auto 20px', lineHeight: 1.5 }}>
        {filter === 'mine'
         ? t('Отгрузи собранный марсианский картофель со склада, чтобы получить SOL.')
         : t('Стань первым поставщиком пайка в колонии и отгрузи партию на P2P биржу!')}
       </p>
       <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() => { haptics.tap(); setShowCreate(true) }}
        className="mk-key mk-key--paint"
        style={{ padding: '12px 24px', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
       >
        <Plus size={16} aria-hidden="true" /> {t('Отгрузить на биржу')}
       </motion.button>
      </div>
     ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
       {filteredOrders.map((order, i) => (
        <OrderCard
         key={order.publicKey.toString()}
         order={order}
         index={i}
         busy={actionLoading === order.publicKey.toString()}
         onBuy={() => handleBuy(order)}
         onCancel={() => setCancelTarget(order)}
        />
       ))}
      </div>
     )}
    </>
   )}

   <BigPurchaseEffect show={bigPurchase !== null} amount={bigPurchase ?? 0} />

   <CreateOrderModal
    open={showCreate}
    onClose={() => setShowCreate(false)}
    onCreate={(a, p) => createOrder(a, p)}
    balanceMicro={gameStats.potatoBalance}
   />

   <AnimatePresence>
    {cancelTarget && (
     <Modal onClose={() => setCancelTarget(null)} title={t("Отозвать ордер?")}>
      <div style={{ padding: 14, borderRadius: 14, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', marginBottom: 20 }}>
       <p style={{ fontSize: 13, color: 'var(--pf-red)', lineHeight: 1.5 }}>
        {t('Груз вернётся на склад сразу, но новые ордера — только через')} <b>{t('{hours} часа', { hours: CANCEL_COOLDOWN_HOURS })}</b>.
       </p>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
       <button onClick={() => setCancelTarget(null)} className="mk-key" style={{ flex: 1, padding: 12, fontSize: 13, cursor: 'pointer' }}>
        {t('Оставить')}
       </button>
       <motion.button
        whileTap={{ y: 2 }}
        onClick={async () => {
         const ok = await cancelOrder(cancelTarget.publicKey)
         setCancelTarget(null)
         if (ok) setCancelInfo(true)
        }}
        className="mk-key mk-key--danger"
        style={{ flex: 1, padding: 12, fontSize: 13, cursor: 'pointer' }}
       >
        {t('Отменить')}
       </motion.button>
      </div>
     </Modal>
    )}
   </AnimatePresence>

   <AnimatePresence>
    {cancelInfo && (
     <Modal onClose={() => setCancelInfo(false)} title={t("Ордер отменён")}>
      <div style={{ padding: 14, borderRadius: 14, background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
       <p style={{ fontSize: 13, color: 'var(--pf-gold)', lineHeight: 1.5 }}>
        {t('Токены возвращены на баланс. Новый ордер можно выставить через')} <b>{t('{hours} часа', { hours: CANCEL_COOLDOWN_HOURS })}</b>{t(' — так мы защищаем рынок от спама.')}
       </p>
      </div>
      <button onClick={() => setCancelInfo(false)} className="mk-key mk-key--paint" style={{ marginTop: 20, width: '100%', padding: 12, fontSize: 13, cursor: 'pointer' }}>
       {t('Понятно')}
      </button>
     </Modal>
    )}
   </AnimatePresence>
  </div>
 )
}

export function Row({ label, value, valueColor = 'white' }: { label: string; value: string; valueColor?: string }) {
 return (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
   <span style={{ color: 'var(--pf-text-secondary)' }}>{label}</span>
   <span style={{ color: valueColor, fontWeight: 600 }}>{value}</span>
  </div>
 )
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
 return (
  <motion.div
   initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
   onClick={onClose}
   style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
  >
   <motion.div
    role="dialog" aria-modal="true" aria-label={title}
    initial={{ scale: 0.9 }} animate={{ scale: 1 }}
    onClick={(e) => e.stopPropagation()}
    className="pf-card hull-skin"
    style={{ width: '100%', maxWidth: 340, padding: 28, textAlign: 'center' }}
   >
    <div style={{ marginBottom: 12, color: 'var(--pf-teal)' }} aria-hidden="true"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5.5"/></svg></div>
    <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{title}</h3>
    {children}
   </motion.div>
  </motion.div>
 )
}

const instrument = (v: string) => v.replace(/^(\d+)/, (_m, d: string) => d.padStart(4, '0'))

function StatCard({ label, value, primary = false }: { icon?: ReactNode; label: string; value: string; primary?: boolean }) {
 return (
  <div
   style={{
    padding: primary ? '14px 12px' : '12px 10px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    background: primary
     ? 'linear-gradient(180deg, #2D1E13 0%, #1D130B 100%)'
     : 'linear-gradient(180deg, #22170F 0%, #160E08 100%)',
    border: `1px solid ${primary ? '#8A5222' : '#4A301C'}`,
    boxShadow: 'inset 0 1px 0 rgba(255,214,170,0.1), 0 4px 12px rgba(0,0,0,0.45)',
   }}
  >
   <div
    style={{
     fontFamily: 'var(--ares-font-stencil)',
     fontSize: 10,
     letterSpacing: '0.14em',
     color: primary ? '#FFC94A' : '#C9A176',
     textTransform: 'uppercase',
     textAlign: 'center',
    }}
   >
    {label}
   </div>
   <div style={{ textAlign: 'center', width: '100%' }}>
    <span
     className="ares-mono lcd-readout"
     style={{
      display: 'inline-block',
      fontSize: primary ? 17 : 14,
      fontWeight: 700,
      padding: '4px 10px',
     }}
    >
     {instrument(value)}
    </span>
   </div>
  </div>
 )
}

interface OrderCardProps {
 order: MarketOrder
 index: number
 busy: boolean
 onBuy: () => void
 onCancel: () => void
}

function OrderCard({ order, index, busy, onBuy, onCancel }: OrderCardProps) {
 const hoursLeft = Math.max(0, Math.ceil((order.expiresAt - Math.floor(Date.now() / 1000)) / 3600))
 const seller = order.seller.toString()
 return (
  <motion.div
   initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * 0.05 }}
   className="po-plate po-plate--market" style={{ padding: '16px 18px', position: 'relative', overflow: 'hidden' }}
  >
   <span className="po-screw po-screw--tl" aria-hidden="true" />
   <span className="po-screw po-screw--tr" aria-hidden="true" />
   <span className="po-screw po-screw--bl" aria-hidden="true" />
   <span className="po-screw po-screw--br" aria-hidden="true" />
   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
     <div style={{ width: 36, height: 36, borderRadius: 10, background: order.isOwn ? 'rgba(201, 161, 118, 0.16)' : 'rgba(0, 0, 0, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
      {order.isOwn ? <User size={18} color="var(--ares-blueset, #6B93D6)" /> : null }
     </div>
     <div>
      <div className="ares-mono" style={{ fontSize: 15, fontWeight: 700, textAlign: 'center', color: 'transparent', background: 'var(--ares-action)', WebkitBackgroundClip: 'text', backgroundClip: 'text' }}>{fmtPotato(order.amountMicro)} POTATO</div>
      <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)' }}>{order.isOwn ? t('Твой ордер') : `${seller.slice(0, 6)}…${seller.slice(-4)}`}</div>
     </div>
    </div>
    <div style={{ textAlign: 'right' }}>
     <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pf-teal)' }}>{fmtSol(order.priceLamportsPerPotato, 4)} SOL</div>
     <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)' }}>{t("за 1 POTATO")}</div>
    </div>
   </div>
   <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid rgba(255,214,170,0.08)', borderBottom: '1px solid rgba(255,214,170,0.08)', marginBottom: 12, fontSize: 12 }}>
    <span style={{ color: 'var(--pf-text-secondary)' }}>{t('Итого к оплате')}:</span>
    <span style={{ fontWeight: 700, color: 'white' }}>{fmtSol(order.totalLamports, 4)} SOL</span>
   </div>
   <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, fontSize: 11 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--pf-text-secondary)' }}>
     <Clock size={12} aria-hidden="true" /> {t('{h} ч осталось', { h: hoursLeft })}
    </div>
    <div style={{ color: 'var(--pf-gold)' }}>{t('Комиссия продавца')}: {((order.feeMicro / order.amountMicro) * 100).toFixed(1)}%</div>
   </div>
   {order.isOwn ? (
    <motion.button whileTap={{ y: 2 }} onClick={onCancel} disabled={busy} className="mk-key mk-key--danger"
     style={{ width: '100%', padding: '11px 16px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: busy ? 'not-allowed' : 'pointer' }}>
     {busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <X size={16} />} {t('Отменить ордер')}
    </motion.button>
   ) : (
    <motion.button whileTap={{ y: 2 }} onClick={onBuy} disabled={busy} className="mk-key mk-key--paint"
     style={{ width: '100%', padding: '11px 16px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: busy ? 'not-allowed' : 'pointer' }}>
     {busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : null  } {t('Купить за {price} SOL', { price: fmtSol(order.totalLamports, 4) })}
    </motion.button>
   )}
  </motion.div>
 )
}


export default function MarketScreen() {
 return (
  <SupplyBay>
   <MarketScreenInner />
  </SupplyBay>
 );
}
