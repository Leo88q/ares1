import { useSolana } from '../contexts/SolanaContext'
import { formatSkrCost } from '../utils/skrPayments'
import { skrAtomsToTokens } from '../utils/marketUnits'
import { ReactNode, useState, useMemo } from 'react'
import { t } from '../i18n'

import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Clock, User, Loader2 } from 'lucide-react'
import BigPurchaseEffect from './BigPurchaseEffect'
import CreateOrderModal from './CreateOrderModal'
import { haptics } from '../utils/haptic'
import { useMarketplace, MarketOrder } from '../hooks/useMarketplace'
import { useGame } from '../contexts/GameContext'
import { fmtPotato, MICRO, CANCEL_COOLDOWN_HOURS } from '../utils/constants'
import { SupplyBay } from './ares/SupplyBay';
import { HullPanel } from '../ui/HullPanel';
import { ErrorState, EmptyState as SharedEmptyState, LoadingState } from '../ui/states'
function MarketScreenInner() {
 const { orders, myOrders, legacyOrders, stats, loading, actionLoading, error, createOrder, fillOrder, cancelOrder, reload } = useMarketplace()
 const { skrPricing } = useSolana()
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
  const price = o.priceSkrAtomsPerPotato / 1e6
  const amt = o.amountMicro / MICRO
  if (fPriceMin && price < Number(fPriceMin)) return false
  if (fPriceMax && price > Number(fPriceMax)) return false
  if (fAmtMin && amt < Number(fAmtMin)) return false
  if (fAmtMax && amt > Number(fAmtMax)) return false
  return true
 }), [baseOrders, fPriceMin, fPriceMax, fAmtMin, fAmtMax])

 return (
  <div style={{ padding: 20, paddingBottom: 140 }}>
   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
     <div>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>{t("СНАБЖЕНИЕ")}</h1>
      <p style={{ color: 'var(--pf-text-secondary)', fontSize: 14 }}>{t("Приём и отгрузка грузов колонии")}</p>
     </div>
    </div>
    <motion.button
     whileTap={{ scale: 0.95 }}
     onClick={() => { haptics.tap(); setShowCreate(true) }}
     className="gradient-gold"
     style={{ padding: '10px 16px', borderRadius: 12, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
    >
     <Plus size={18} aria-hidden="true" /> {t('Отгрузить')}
    </motion.button>
   </div>

   <p style={{ fontSize: 12 }}>SKR — оплата и расчёты. SOL — только комиссия сети и rent.</p>
   {!skrPricing?.marketMinAtoms && <p role="status">{t('Цена в SKR ещё не настроена — действие недоступно.')}</p>}
   {legacyOrders.length > 0 && <section aria-label="Order recovery">
    <p>Старые SOL-ордера и ордера прежнего mint: возврат POTATO без конвертации цены.</p>
    {legacyOrders.map(o => <button key={o.publicKey.toBase58()} disabled={actionLoading !== null} onClick={() => void cancelOrder(o.publicKey, o.legacy)}>
     Вернуть {fmtPotato(o.amountMicro)} POTATO · {o.publicKey.toBase58().slice(0, 8)}
    </button>)}
   </section>}
   <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
    <StatCard label={t("Грузооборот за сол")} value={`${stats.sellVolume24h.toFixed(0)} POTATO`} />
    <StatCard label={t("Оборот рынка")} value={`${stats.totalSkrVolume.toFixed(2)} SKR`} />
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
        className={`ares-stencil market-tab${active ? ' market-tab--active' : ''}`}
        style={{ flex: 1, padding: '13px 10px', background: 'transparent', border: 'none', color: active ? 'var(--ares-hud-amber, #FFB347)' : 'rgba(255,179,71,0.6)', fontSize: 12, letterSpacing: '0.12em', cursor: 'pointer' }}
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
       <span className="ares-mono" style={{ fontSize: 9, color: 'var(--ares-hud-amber, #FFB347)', letterSpacing: '0.08em' }}>10 POTATO · {formatSkrCost(skrPricing?.marketMinAtoms || null)} SKR min</span>
      </div>
      <div className="market-filter-grid">
       <label className="market-filter-field">
        <span>{t('ЦЕНА ОТ, SKR')}</span>
        <input inputMode="decimal" placeholder="0.00" value={dPriceMin} onChange={e => setDPriceMin(e.target.value)} />
       </label>
       <label className="market-filter-field">
        <span>{t('ЦЕНА ДО, SKR')}</span>
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
      <SharedEmptyState
       title={filter === 'mine' ? t('У тебя нет активных ордеров') : t('Пока нет предложений')}
       hint={filter === 'mine' ? t('Создай свой первый ордер на продажу') : t('Будь первым, кто выставит картофель на продажу!')}
      />
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
       <button onClick={() => setCancelTarget(null)} style={{ flex: 1, padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: 14, fontWeight: 600 }}>
        {t('Оставить')}
       </button>
       <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={async () => {
         const ok = await cancelOrder(cancelTarget.publicKey)
         setCancelTarget(null)
         if (ok) setCancelInfo(true)
        }}
        style={{ flex: 1, padding: 12, borderRadius: 12, background: 'var(--pf-red)', color: 'white', fontSize: 14, fontWeight: 700 }}
       >
        {t('Отменить')}
       </motion.button>
      </div>
     </Modal>
    )}
   </AnimatePresence>

   <AnimatePresence>
    {cancelInfo && (
     <Modal onClose={() => setCancelInfo(false)} title={t("Ордер отменён")} emoji="">
      <div style={{ padding: 14, borderRadius: 14, background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
       <p style={{ fontSize: 13, color: 'var(--pf-gold)', lineHeight: 1.5 }}>
        {t('Токены возвращены на баланс. Новый ордер можно выставить через')} <b>{t('{hours} часа', { hours: CANCEL_COOLDOWN_HOURS })}</b>{t(' — так мы защищаем рынок от спама.')}
       </p>
      </div>
      <button onClick={() => setCancelInfo(false)} style={{ marginTop: 20, width: '100%', padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: 14, fontWeight: 600 }}>
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

function Modal({ title, emoji, children, onClose }: { title: string; emoji?: string; children: ReactNode; onClose: () => void }) {
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
    style={{ width: '100%', maxWidth: 340, padding: 28, borderRadius: 24, textAlign: 'center', background: '#1a1a2e' }}
   >
    {emoji && <div style={{ fontSize: 48, marginBottom: 12 }} aria-hidden="true">{emoji}</div>}
    <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{title}</h3>
    {children}
   </motion.div>
  </motion.div>
 )
}

const instrument = (v: string) => v.replace(/^(\d+)/, (_m, d: string) => d.padStart(4, '0'))

function StatCard({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
 return (
  <div className="pf-card hull-skin" style={{ padding: 14, borderRadius: 14 }}>
   <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
    <span aria-hidden="true">{icon}</span>
    <span style={{ fontSize: 12, color: 'var(--pf-text-secondary)', textAlign: 'center' }}>{label}</span>
   </div>
   <div style={{ textAlign: 'center' }}>
     <span className="ares-mono lcd-readout" style={{ fontSize: 18, fontWeight: 700 }}>{instrument(value)}</span>
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
   className="pf-card hull-skin" style={{ padding: 16, borderRadius: 16 }}
  >
   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
     <div style={{ width: 36, height: 36, borderRadius: 10, background: order.isOwn ? 'rgba(59, 130, 246, 0.2)' : 'rgba(193, 68, 14, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
      {order.isOwn ? <User size={18} color="var(--ares-blueset, #6B93D6)" /> : null }
     </div>
     <div>
      <div className="ares-mono" style={{ fontSize: 15, fontWeight: 700, textAlign: 'center', color: 'transparent', background: 'var(--ares-action)', WebkitBackgroundClip: 'text', backgroundClip: 'text' }}>{fmtPotato(order.amountMicro)} POTATO</div>
      <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)' }}>{order.isOwn ? t('Твой ордер') : `${seller.slice(0, 6)}…${seller.slice(-4)}`}</div>
     </div>
    </div>
    <div style={{ textAlign: 'right' }}>
     <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pf-teal)' }}>{skrAtomsToTokens(order.priceSkrAtomsPerPotato).toFixed(6)} SKR</div>
     <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)' }}>{t("за 1 POTATO")}</div>
    </div>
   </div>
   <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: 12, fontSize: 12 }}>
    <span style={{ color: 'var(--pf-text-secondary)' }}>{t('Итого к оплате')}:</span>
    <span style={{ fontWeight: 700, color: 'white' }}>{skrAtomsToTokens(order.totalSkrAtoms).toFixed(6)} SKR</span>
   </div>
   <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, fontSize: 11 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--pf-text-secondary)' }}>
     <Clock size={12} aria-hidden="true" /> {t('{h} ч осталось', { h: hoursLeft })}
    </div>
    <div style={{ color: 'var(--pf-gold)' }}>{t('Комиссия продавца')}: {(order.feeBps / 100).toFixed(1)}%</div>
   </div>
   {order.isOwn ? (
    <motion.button whileTap={{ scale: 0.95 }} onClick={onCancel} disabled={busy}
     style={{ width: '100%', padding: 12, borderRadius: 10, background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--pf-red)', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
     {busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <X size={16} />} {t('Отменить ордер')}
    </motion.button>
   ) : (
    <motion.button whileTap={{ scale: 0.95 }} onClick={onBuy} disabled={busy} className="gradient-primary"
     style={{ width: '100%', padding: 12, borderRadius: 10, color: 'white', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
     {busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : null  } {t('Купить за {price} SKR', { price: skrAtomsToTokens(order.totalSkrAtoms).toFixed(6) })}
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
