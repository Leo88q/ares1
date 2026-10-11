import { useMemo, useState } from 'react'
import { Clock, Loader2, Plus, User, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { t } from '../i18n'
import { useMarketplaceV2, type MarketOrderV2View } from '../hooks/useMarketplaceV2'
import { useGame } from '../contexts/GameContext'
import type { MarketQuoteAsset } from '../utils/anchorClient'
import { formatFixedPointUnitsExact } from '../utils/marketUnits'
import CreateOrderV2Modal from './CreateOrderV2Modal'
import { HullPanel } from '../ui/HullPanel'
import { ErrorState, LoadingState } from '../ui/states'

function formatQuoteAmount(amount: bigint, asset: MarketQuoteAsset) {
  return formatFixedPointUnitsExact(amount, asset === 'sol' ? 9 : 6)
}

function formatQuote(amount: bigint, asset: MarketQuoteAsset) {
  return `${formatQuoteAmount(amount, asset)} ${asset.toUpperCase()}`
}

function formatFeeRates(rates: readonly bigint[]) {
  return [...new Set(rates)].map(rate => `${rate / 100n}%`).join(' · ')
}

function MarketScreenV2Inner() {
  const { orders, myOrders, stats, myVolumeMicro, skrMintReady, loading, actionLoading, error, createOrder, fillOrder, cancelOrder, closeExpiredOrder, reload } = useMarketplaceV2()
  const { stats: gameStats } = useGame()
  const [quoteAsset, setQuoteAsset] = useState<MarketQuoteAsset>('sol')
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [showCreate, setShowCreate] = useState(false)

  const pairOrders = useMemo(() => orders.filter(order => order.quoteAsset === quoteAsset), [orders, quoteAsset])
  const visibleOrders = filter === 'mine'
    ? pairOrders.filter(order => order.isOwn)
    : pairOrders.filter(order => order.status === 'expired' || !order.isOwn)

  const handleFill = async (order: MarketOrderV2View) => {
    const confirmed = window.confirm(t('Проверь сделку: gross {gross}; ставки {rates}; комиссия продавца {fee}; чистая выплата {net}. Казна получит комиссию в {asset}. Оценка может измениться до исполнения.', {
      gross: formatQuote(order.grossQuoteAtoms, order.quoteAsset),
      rates: formatFeeRates(order.feeRatesBps),
      fee: formatQuote(order.feeQuoteAtoms, order.quoteAsset),
      net: formatQuote(order.sellerNetQuoteAtoms, order.quoteAsset),
      asset: order.quoteAsset.toUpperCase(),
    }))
    if (confirmed) await fillOrder(order)
  }

  return (
    <div className="main-screen-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="pf-h1" style={{ fontSize: 26 }}>{t('СНАБЖЕНИЕ')}</h1>
          <p className="pf-subtitle" style={{ marginTop: 4 }}>{t('Приём и отгрузка грузов колонии')}</p>
        </div>
        <motion.button whileTap={{ y: 2 }} onClick={() => setShowCreate(true)} className="mk-key mk-key--paint" style={{ padding: '9px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} aria-hidden="true" /> {t('Отгрузить V2-ордер')}
        </motion.button>
      </div>

      <div role="status" style={{ padding: '12px 14px', marginBottom: 14, border: '1px solid rgba(255,179,71,0.28)', borderRadius: 8, background: 'linear-gradient(180deg, rgba(37,24,14,0.94), rgba(17,11,7,0.96))' }}>
        <div className="ares-mono" style={{ color: '#FFC94A', fontSize: 9, letterSpacing: '0.13em', marginBottom: 6 }}>{t('РЫНОК V2 · КОМИССИЯ В ВАЛЮТЕ РАСЧЁТА')}</div>
        <p style={{ color: 'var(--pf-text-secondary)', fontSize: 11, lineHeight: 1.55, margin: 0 }}>{t('V2 · комиссия продавца вычитается из выплаты только после успешного fill; вся сумма поступает в казну в валюте пары.')}</p>
        <p style={{ color: '#E8C997', fontSize: 10, lineHeight: 1.5, margin: '7px 0 0' }}>{t('Пороги 1k / 10k / 100k POTATO — черновик; утвердить до релиза V2.')}</p>
      </div>

      <div role="tablist" aria-label={t('Рынок V2: выбор валютной пары')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        {(['sol', 'skr'] as const).map(asset => {
          const active = quoteAsset === asset
          return <button key={asset} role="tab" aria-selected={active} onClick={() => setQuoteAsset(asset)} className={`mk-key${active ? ' mk-key--engaged' : ''}`} style={{ padding: 12, fontSize: 12 }}>
            {t(asset === 'sol' ? 'POTATO / SOL' : 'POTATO / SKR')}
          </button>
        })}
      </div>
      {!skrMintReady && <p style={{ margin: '-6px 0 12px', color: 'var(--pf-text-muted)', fontSize: 10 }}>{t('Пара POTATO / SKR недоступна для новых сделок без проверенного mint; ордера видны, свои можно отменить, истёкший escrow можно вернуть.')}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
        <Stat label={t('Оборот POTATO')} value={`${formatFixedPointUnitsExact(stats.totalPotatoVolumeMicro, 6)} POTATO`} />
        <Stat label={t('Всего сделок')} value={stats.totalTrades.toString()} />
        <Stat label={t('Оборот SOL')} value={formatQuote(stats.totalSolVolumeLamports, 'sol')} />
        <Stat label={t('Оборот SKR')} value={formatQuote(stats.totalSkrVolumeAtoms, 'skr')} />
      </div>
      <div className="ares-mono" style={{ marginBottom: 14, color: 'var(--pf-text-muted)', fontSize: 10 }}>
        {t('Мой объём за UTC-день: {amount} POTATO', { amount: formatFixedPointUnitsExact(myVolumeMicro, 6) })}
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {(['all', 'mine'] as const).map(tab => <button key={tab} role="tab" aria-selected={filter === tab} onClick={() => setFilter(tab)} className={`mk-key${filter === tab ? ' mk-key--engaged' : ''}`} style={{ flex: 1, padding: 11 }}>
          {tab === 'all' ? t('Все грузы') : t('Мои ордера ({count})', { count: myOrders.filter(order => order.quoteAsset === quoteAsset).length })}
        </button>)}
      </div>

      {loading ? <LoadingState label={t('Загружаем рынок…')} /> : error && visibleOrders.length === 0 ? <ErrorState message={error} onRetry={reload} /> : (
        <>
          {error && <ErrorState inline message={error} onRetry={reload} />}
          {visibleOrders.length === 0 ? <div className="po-plate po-plate--market" style={{ padding: '34px 18px', textAlign: 'center' }}>
            <div className="ares-mono" style={{ color: '#D4A576', fontSize: 11, marginBottom: 8 }}>{t('ТЕРМИНАЛ СНАБЖЕНИЯ // СТАТУС: СВОБОДЕН')}</div>
            <p style={{ margin: '0 0 16px', color: 'var(--pf-text-secondary)', fontSize: 13 }}>{t('Ордера V2 пока не опубликованы.')}</p>
            <button className="mk-key mk-key--paint" onClick={() => setShowCreate(true)} style={{ padding: '11px 18px' }}><Plus size={15} /> {t('Отгрузить V2-ордер')}</button>
          </div> : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {visibleOrders.map((order, index) => <V2OrderCard
              key={order.publicKey.toBase58()}
              order={order}
              index={index}
              skrMintReady={skrMintReady}
              busy={actionLoading === order.publicKey.toBase58()}
              onFill={() => void handleFill(order)}
              onCancel={() => {
                if (window.confirm(t('Отменить V2-ордер? Вернётся весь депозит POTATO, комиссия не взимается.'))) void cancelOrder(order.publicKey)
              }}
              onCloseExpired={() => {
                if (window.confirm(t('Закрыть истёкший ордер? Полный депозит вернётся продавцу; комиссия не взимается. Если ATA продавца отсутствует, ты оплатишь её создание.'))) {
                  void closeExpiredOrder(order.publicKey, order.seller)
                }
              }}
            />)}
          </div>}
        </>
      )}

      <CreateOrderV2Modal
        open={showCreate}
        quoteAsset={quoteAsset}
        skrMintReady={skrMintReady}
        balanceMicro={gameStats.potatoBalance}
        sellerVolumeMicro={myVolumeMicro}
        onClose={() => setShowCreate(false)}
        onCreate={createOrder}
      />
    </div>
  )
}

function V2OrderCard({ order, index, skrMintReady, busy, onFill, onCancel, onCloseExpired }: {
  order: MarketOrderV2View; index: number; skrMintReady: boolean; busy: boolean; onFill: () => void; onCancel: () => void; onCloseExpired: () => void
}) {
  const hoursLeft = Math.max(0, Math.ceil((order.expiresAt - Math.floor(Date.now() / 1000)) / 3600))
  const asset = order.quoteAsset.toUpperCase()
  const actionDisabled = busy || (order.status === 'active' && order.quoteAsset === 'skr' && !skrMintReady && !order.isOwn)
  return <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * 0.04 }} className="po-plate po-plate--market" style={{ padding: '15px 17px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, background: order.isOwn ? 'rgba(201,161,118,0.16)' : 'rgba(0,0,0,0.3)', display: 'grid', placeItems: 'center' }}>{order.isOwn ? <User size={17} color="var(--ares-blueset, #6B93D6)" /> : null}</div>
        <div>
          <div className="ares-mono" style={{ color: 'var(--pf-text-primary)', fontWeight: 700 }}>{formatFixedPointUnitsExact(order.amountMicro, 6)} POTATO</div>
          <div style={{ fontSize: 10, color: 'var(--pf-text-secondary)' }}>{order.isOwn ? t('Твой ордер') : `${order.seller.toBase58().slice(0, 6)}…${order.seller.toBase58().slice(-4)}`}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--pf-teal)' }}>{formatQuote(order.priceQuoteAtomsPerPotato, order.quoteAsset)}</div>
        <div style={{ fontSize: 10, color: 'var(--pf-text-secondary)' }}>{t('за 1 POTATO')}</div>
      </div>
    </div>
    {order.status === 'active' ? <div style={{ padding: '9px 0', borderTop: '1px solid rgba(255,214,170,0.08)', borderBottom: '1px solid rgba(255,214,170,0.08)', display: 'grid', gap: 5, marginBottom: 10 }}>
      <Row label={t('Валовая сумма')} value={formatQuote(order.grossQuoteAtoms, order.quoteAsset)} />
      <Row label={t('Ставки комиссии')} value={formatFeeRates(order.feeRatesBps)} />
      <Row label={t('Оценка комиссии')} value={formatQuote(order.feeQuoteAtoms, order.quoteAsset)} />
      <Row label={t('Чистая выплата продавцу')} value={formatQuote(order.sellerNetQuoteAtoms, order.quoteAsset)} />
    </div> : <p style={{ margin: '10px 0', padding: 10, borderRadius: 6, background: 'rgba(255,201,74,0.07)', fontSize: 11, color: '#E8C997' }}>{t('Истёкший V2-ордер: верни весь депозит POTATO без комиссии.')}</p>}
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, fontSize: 10, color: 'var(--pf-text-secondary)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={12} />{order.status === 'expired' ? t('Срок ордера истёк') : t('{h} ч осталось', { h: hoursLeft })}</span>
      {order.status === 'active' && <span>{t('Покупатель платит gross; комиссия вычитается из выплаты продавца.')}</span>}
    </div>
    <button type="button" disabled={actionDisabled} onClick={order.status === 'expired' ? onCloseExpired : order.isOwn ? onCancel : onFill} className={`mk-key ${order.isOwn || order.status === 'expired' ? 'mk-key--danger' : 'mk-key--paint'}`} style={{ width: '100%', padding: 11, opacity: actionDisabled ? 0.55 : 1 }}>
      {busy ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : order.isOwn || order.status === 'expired' ? <X size={15} /> : null}
      {order.status === 'expired'
        ? order.isOwn ? t('Вернуть депозит POTATO') : t('Вернуть продавцу депозит POTATO')
        : order.isOwn ? t('Отменить V2-ордер') : t('Купить за {amount} {asset}', { amount: formatQuoteAmount(order.grossQuoteAtoms, order.quoteAsset), asset })}
    </button>
  </motion.div>
}

function Row({ label, value }: { label: string; value: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11 }}><span className="pf-subtitle">{label}</span><strong className="pf-mono" style={{ color: 'var(--pf-text-primary)' }}>{value}</strong></div>
}

function Stat({ label, value }: { label: string; value: string }) {
  return <HullPanel><div style={{ padding: 12, textAlign: 'center' }}><div className="ares-mono" style={{ color: '#C9A176', fontSize: 9, letterSpacing: '0.12em', marginBottom: 5 }}>{label}</div><div className="ares-mono" style={{ color: '#FFC94A', fontSize: 13, fontWeight: 700 }}>{value}</div></div></HullPanel>
}

export default function MarketScreenV2() {
  return <MarketScreenV2Inner />
}
