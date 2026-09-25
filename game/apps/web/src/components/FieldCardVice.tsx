import { useState } from 'react'
import { t } from '../i18n'

import { motion } from 'framer-motion'
import { PublicKey } from '@solana/web3.js'

import { HullPanel } from '../ui/HullPanel'
import Button from './Button'
import AnimatedNumber from './AnimatedNumber'
import { Field } from '../contexts/GameContext'
import {
 fieldTypeInfo, MICRO, HARVEST_THRESHOLD_MICRO, MAX_DURABILITY,
 upgradeCostMicro, repairCostMicro, taxCostMicro, fertilizerCostMicro, fmtPotatoExact,
} from '../utils/constants'
import { sounds } from '../utils/sounds'
import { haptics } from '../utils/haptic'

type FieldAction = (field: PublicKey) => Promise<boolean>

interface Props {
 field: Field
 index: number
 onHarvest: FieldAction
 onUpgrade?: FieldAction
 onRepair?: FieldAction
 onPayTax?: FieldAction
 onApplyFertilizer?: FieldAction
}

const TIER_BY_TYPE: Array<'basic' | 'meadow' | 'gold'> = ['basic', 'meadow', 'gold']

const RARE_LABEL: Record<'basic' | 'meadow' | 'gold', string> = { basic: 'COMMON', meadow: 'RARE', gold: 'EPIC' }
const RARE_COLOR: Record<'basic' | 'meadow' | 'gold', string> = { basic: '#9AA0AC', meadow: '#B85CFF', gold: '#FFC94A' }

/**
 * Карточка поля в стиле Vice Potato.
 * Тир редкости: 0 (Грядка) → basic, 1 (Луг) → meadow, 2 (Поле) → gold.
 */
export default function FieldCardVice({ field, index, onHarvest, onUpgrade, onRepair, onPayTax, onApplyFertilizer }: Props) {
 const [busy, setBusy] = useState<string | null>(null)

 const now = Math.floor(Date.now() / 1000)
 const rare = TIER_BY_TYPE[field.fieldType] ?? 'basic'
 const cassette = fieldTypeInfo(field.fieldType)
 const accumulated = field.accumulated / MICRO
 const canHarvest = field.accumulated >= HARVEST_THRESHOLD_MICRO
 const durability = field.durability
 const needsRepair = durability < MAX_DURABILITY
 const fertActive = field.fertilizerUntil > now
 const taxExpired = now > field.taxPaidUntil
 const taxDaysLeft = Math.max(0, Math.ceil((field.taxPaidUntil - now) / 86400))
 const taxHoursLeft = Math.max(1, Math.ceil((field.taxPaidUntil - now) / 3600))
 const fertHoursLeft = Math.max(1, Math.ceil((field.fertilizerUntil - now) / 3600))

 const run = async (name: string, fn: FieldAction | undefined, sound: () => void, haptic: () => void) => {
  if (!fn || busy) return
  sound()
  haptic()
  setBusy(name)
  await fn(field.publicKey)
  setBusy(null)
 }

 return (
  <motion.div
   initial={{ opacity: 0, y: 20 }}
   animate={{ opacity: 1, y: 0 }}
   transition={{ delay: Math.min(index * 0.06, 0.4) }}
  >
   <HullPanel variant={rare === 'gold' ? 'accent' : 'default'} className="field-hull">
    {/* Заголовок */}
    <div style={{
     padding: '16px 20px 12px',
     display: 'flex',
     alignItems: 'center',
     gap: 12,
     borderBottom: '1px solid var(--pf-border-soft)',
    }}>
     <img
      src={cassette.image}
      alt={RARE_LABEL[rare]}
      width={48}
      height={56}
      loading="lazy"
      style={{ width: 48, height: 56, objectFit: 'contain', flexShrink: 0, filter: `drop-shadow(0 0 12px ${RARE_COLOR[rare]}66)` }}
     />
     <div style={{ flex: 1 }}>
      <div className="pf-h2" style={{ fontSize: 18 }}>{t("РАСТЕНИЕ")}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
       <span className="ares-mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', padding: '2px 8px', borderRadius: 4, color: RARE_COLOR[rare], border: `1px solid ${RARE_COLOR[rare]}66`, background: `${RARE_COLOR[rare]}1a`, textShadow: `0 0 8px ${RARE_COLOR[rare]}55` }}>
        {RARE_LABEL[rare]}
       </span>
       <span className="pf-subtitle" style={{ fontSize: 10 }}>{t('РАНГ {n}', { n: field.level })}</span>
      </div>
     </div>
     <div style={{ textAlign: 'right' }}>
      <div className="pf-mono" style={{
       fontSize: 18,
       color: canHarvest ? 'var(--pf-gold)' : 'var(--pf-text-muted)',
       textShadow: canHarvest ? 'var(--pf-glow-gold)' : 'none',
      }}>
       <AnimatedNumber value={accumulated} decimals={2} />
      </div>
      <div className="pf-subtitle" style={{ fontSize: 10 }}>{t("POTATO к сбору")}</div>
     </div>
    </div>

    {/* Целостность */}
    <div style={{ padding: '12px 20px' }}>
     <div className="pf-subtitle" style={{ fontSize: 10, marginBottom: 4 }}>
      {t('Целостность {d}/{max}', { d: durability, max: MAX_DURABILITY })}
     </div>
     <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
      <motion.div
       initial={{ width: 0 }}
       animate={{ width: `${durability}%` }}
       style={{
        height: '100%',
        background: durability > 60 ? 'var(--pf-teal)' : durability > 30 ? 'var(--pf-orange)' : 'var(--pf-red)',
        boxShadow: durability <= 40 ? '0 0 8px var(--pf-red)' : 'none',
       }}
      />
     </div>
    </div>


    {/* Статус-бейджи: налог и удобрение */}
    <div style={{ display: 'flex', gap: 8, padding: '0 20px 12px', flexWrap: 'wrap' }}>
     <span style={{
      fontSize: 10,
      fontWeight: 600,
      padding: '4px 10px',
      borderRadius: 999,
      background: taxExpired ? 'rgba(255, 59, 59, 0.15)' : taxDaysLeft <= 2 ? 'rgba(255, 122, 26, 0.15)' : 'rgba(18, 231, 196, 0.12)',
      color: taxExpired ? 'var(--pf-red)' : taxDaysLeft <= 2 ? 'var(--pf-orange)' : 'var(--pf-teal)',
      border: `1px solid ${taxExpired ? 'rgba(255,59,59,0.4)' : taxDaysLeft <= 2 ? 'rgba(255,122,26,0.4)' : 'rgba(18,231,196,0.35)'}`,
      boxShadow: taxExpired ? '0 0 10px rgba(255,59,59,0.3)' : 'none',
     }}>
{taxExpired ? t('Пошлина просрочен!') : taxDaysLeft <= 1 ? t('Пошлина: {h} ч', { h: taxHoursLeft }) : t('Пошлина: {d} дн', { d: taxDaysLeft })}
     </span>

     {fertActive && (
      <span style={{
       fontSize: 10,
       fontWeight: 600,
       padding: '4px 10px',
       borderRadius: 999,
       background: 'rgba(124, 255, 107, 0.12)',
       color: 'var(--pf-green)',
       border: '1px solid rgba(124,255,107,0.35)',
      }}>
        {t('Питание: {h} ч', { h: fertHoursLeft })}
      </span>
     )}
    </div>

    {/* Действия */}
    <div style={{ padding: '4px 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
     <Button
      variant={canHarvest ? 'primary' : 'secondary'}
      glow={canHarvest ? (rare === 'gold' ? 'gold' : 'teal') : 'none'}
      disabled={!canHarvest || busy !== null}
      onClick={() => run('harvest', onHarvest, () => sounds.harvest(), () => haptics.harvest())}
      className={canHarvest ? 'gradient-gold' : ''}
      style={{ fontSize: 11, padding: '10px 8px' }}
     >
      {t('Собрать')}
     </Button>

     <Button
      variant="secondary"
      disabled={busy !== null}
      onClick={() => run('upgrade', onUpgrade, () => sounds.upgrade(), () => haptics.upgradeField())}
      style={{ fontSize: 11, padding: '10px 8px' }}
     >
      {t('Апгрейд модуля')}
      <span style={{ display: 'block', fontSize: 10, marginTop: 3 }}>{fmtPotatoExact(upgradeCostMicro(field.level, field.fieldType))} POTATO</span>
     </Button>

     <Button
      variant="secondary"
      disabled={!needsRepair || busy !== null}
      onClick={() => run('repair', onRepair, () => sounds.repair(), () => haptics.repairField())}
      style={{ fontSize: 11, padding: '10px 8px' }}
     >
      {t('Полив')}
      <span style={{ display: 'block', fontSize: 10, marginTop: 3 }}>{fmtPotatoExact(repairCostMicro(field.level, field.fieldType))} POTATO</span>
     </Button>

     <Button
      variant="secondary"
      disabled={busy !== null}
      onClick={() => run('tax', onPayTax, () => sounds.payTax(), () => haptics.payTax())}
      style={{ fontSize: 11, padding: '10px 8px' }}
     >
      {t('Пошлина')}
      <span style={{ display: 'block', fontSize: 10, marginTop: 3 }}>{fmtPotatoExact(taxCostMicro(field.level, field.fieldType))} POTATO</span>
     </Button>

     <Button
      variant="secondary"
      disabled={fertActive || busy !== null}
      onClick={() => run('fert', onApplyFertilizer, () => sounds.fertilizer(), () => haptics.applyFertilizer())}
      style={{ fontSize: 11, gridColumn: '1 / -1' }}
     >
      {fertActive ? t('Удобрено ') : t('Питание +50% · 24ч')}
      <span style={{ display: 'block', fontSize: 10, marginTop: 3 }}>{fmtPotatoExact(fertilizerCostMicro(field.fieldType))} POTATO</span>
     </Button>
    </div>
   </HullPanel>
  </motion.div>
 )
}
