import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { t } from '../i18n'
import { useToast } from './Toast'
import { calculateSettlementFee } from '../utils/marketFeePolicy'
import { formatFixedPointUnitsExact, parseFixedPointUnits } from '../utils/marketUnits'
import { MICRO, MIN_ORDER_AMOUNT_POTATO } from '../utils/constants'
import type { MarketQuoteAsset } from '../utils/anchorClient'

interface Props {
  open: boolean
  quoteAsset: MarketQuoteAsset
  skrMintReady: boolean
  balanceMicro: number
  sellerVolumeMicro: bigint
  onClose: () => void
  onCreate: (amountMicro: bigint, priceQuoteAtomsPerPotato: bigint, quoteAsset: MarketQuoteAsset) => Promise<boolean>
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 8,
  border: '1px solid rgba(255, 179, 71, 0.3)',
  background: 'rgba(10, 6, 3, 0.75)',
  color: 'var(--pf-text-primary)',
  fontSize: 15,
  fontFamily: 'var(--pf-font-mono)',
  fontWeight: 700,
  outline: 'none',
}

const formatQuote = (atoms: bigint, asset: MarketQuoteAsset) => {
  const decimals = asset === 'sol' ? 9 : 6
  return `${formatFixedPointUnitsExact(atoms, decimals)} ${asset.toUpperCase()}`
}

const formatFeeRates = (rates: readonly bigint[]) => [...new Set(rates)].map(rate => `${rate / 100n}%`).join(' · ')

export default function CreateOrderV2Modal({ open, quoteAsset, skrMintReady, balanceMicro, sellerVolumeMicro, onClose, onCreate }: Props) {
  const { show } = useToast()
  const [amount, setAmount] = useState('100')
  const [price, setPrice] = useState(quoteAsset === 'sol' ? '0.001' : '1')
  const [busy, setBusy] = useState(false)
  const quoteDecimals = quoteAsset === 'sol' ? 9 : 6
  const asset = quoteAsset.toUpperCase()

  useEffect(() => {
    setPrice(quoteAsset === 'sol' ? '0.001' : '1')
  }, [quoteAsset])

  const preview = useMemo(() => {
    try {
      const amountMicro = parseFixedPointUnits(amount, 6)
      const priceAtoms = parseFixedPointUnits(price, quoteDecimals)
      if (amountMicro <= 0n || priceAtoms <= 0n) return null
      return {
        amountMicro,
        priceAtoms,
        settlement: calculateSettlementFee({
          amountMicro,
          priceQuoteAtomsPerPotato: priceAtoms,
          sellerVolumeBeforeMicro: sellerVolumeMicro,
        }),
      }
    } catch {
      return null
    }
  }, [amount, price, quoteDecimals, sellerVolumeMicro])

  const handleSubmit = async () => {
    if (quoteAsset === 'skr' && !skrMintReady) {
      show({ type: 'warning', title: t('Mint SKR не настроен или имеет неверное число знаков в этой сети.') })
      return
    }
    if (!preview) {
      show({ type: 'warning', title: t('Укажи количество POTATO и цену в {asset}', { asset }) })
      return
    }
    if (preview.amountMicro < BigInt(MIN_ORDER_AMOUNT_POTATO) * BigInt(MICRO)) {
      show({ type: 'warning', title: t('Минимум 10 POTATO.') })
      return
    }
    if (preview.amountMicro > BigInt(Math.max(0, Math.floor(balanceMicro)))) {
      show({ type: 'warning', title: t('Недостаточно POTATO для депозита') })
      return
    }
    setBusy(true)
    const ok = await onCreate(preview.amountMicro, preview.priceAtoms, quoteAsset)
    setBusy(false)
    if (ok) {
      setAmount('100')
      setPrice(quoteAsset === 'sol' ? '0.001' : '1')
      onClose()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(14, 9, 5, 0.92)', backdropFilter: 'blur(10px)' }}
        >
          <motion.div
            role="dialog" aria-modal="true" aria-label={t('V2 · комиссия из выплаты продавца')}
            initial={{ opacity: 0, scale: 0.94, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 16 }}
            onClick={event => event.stopPropagation()}
            className="pf-card hull-skin"
            style={{ width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto', padding: 0 }}
          >
            <div style={{ padding: '18px 20px 14px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--pf-border-soft)' }}>
              <div style={{ flex: 1 }}>
                <div className="ares-mono" style={{ color: '#FFC94A', fontSize: 10, letterSpacing: '0.12em' }}>{t('POTATO / {asset}', { asset })} · V2</div>
                <h2 className="pf-h2" style={{ margin: '5px 0 0', fontSize: 18 }}>{t('Отгрузить $POTATO')}</h2>
              </div>
              <button type="button" onClick={onClose} className="mk-key" aria-label={t('Закрыть')} style={{ padding: 8, display: 'inline-flex' }}><X size={16} /></button>
            </div>

            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="pf-subtitle" style={{ fontSize: 11, textTransform: 'uppercase' }}>{t('Количество POTATO')}</span>
                <input type="text" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} style={inputStyle} placeholder="100" />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="pf-subtitle" style={{ fontSize: 11, textTransform: 'uppercase' }}>{t('Цена за 1 POTATO ({asset})', { asset })}</span>
                <input type="text" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} style={inputStyle} placeholder={quoteAsset === 'sol' ? '0.001' : '1'} />
              </label>

              <div style={{ borderRadius: 8, border: '1px solid rgba(255,179,71,0.25)', background: 'rgba(232,160,60,0.08)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--pf-text-secondary)' }}>{t('POTATO депонируется без комиссии; комиссия в валюте пары взимается только при fill.')}</div>
                {quoteAsset === 'skr' && !skrMintReady && <div role="alert" style={{ color: '#F5A190', fontSize: 11 }}>{t('Mint SKR не настроен или имеет неверное число знаков в этой сети.')}</div>}
                {!preview && <div role="alert" style={{ color: '#F5A190', fontSize: 11 }}>{t('Проверь сумму и цену: значения должны быть положительными, а gross — не ниже минимума пары.')}</div>}
                {preview && <>
                  <PreviewRow label={t('Сумма сделки')} value={`${formatFixedPointUnitsExact(preview.amountMicro, 6)} POTATO`} />
                  <PreviewRow label={t('Валовая сумма')} value={formatQuote(preview.settlement.grossQuoteAtoms, quoteAsset)} />
                  <PreviewRow label={t('Ставки комиссии')} value={formatFeeRates(preview.settlement.segments.map(segment => segment.feeBps))} />
                  <PreviewRow label={t('Оценка комиссии')} value={formatQuote(preview.settlement.feeQuoteAtoms, quoteAsset)} />
                  <PreviewRow label={t('Чистая выплата продавцу')} value={formatQuote(preview.settlement.sellerNetQuoteAtoms, quoteAsset)} highlight />
                </>}
              </div>
              <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--pf-text-secondary)' }}>{t('Оценка комиссии может измениться до исполнения из-за накопленного объёма продавца за UTC-день.')}</p>
              <div style={{ borderLeft: '3px solid #FFC94A', padding: '8px 10px', background: 'rgba(255,201,74,0.07)', fontSize: 10, lineHeight: 1.5, color: '#E8C997' }}>
                {t('Пороги 1k / 10k / 100k POTATO — черновик; утвердить до релиза V2.')}
              </div>
              <button type="button" className="mk-key mk-key--paint" disabled={busy || !preview || (quoteAsset === 'skr' && !skrMintReady)} onClick={() => void handleSubmit()} style={{ width: '100%', padding: 13, opacity: busy || !preview || (quoteAsset === 'skr' && !skrMintReady) ? 0.65 : 1 }}>
                {busy ? t('Публикуем…') : t('Отгрузить V2-ордер')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PreviewRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
    <span className="pf-subtitle">{label}</span>
    <span className="pf-mono" style={{ color: highlight ? 'var(--pf-green)' : 'var(--pf-text-primary)', fontWeight: 700 }}>{value}</span>
  </div>
}
