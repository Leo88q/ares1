import { skrCost, formatSkrCost } from '../utils/skrPayments'
import { useSolana } from '../contexts/SolanaContext'
import { useState } from 'react'
import { t } from '../i18n'

import { motion, AnimatePresence } from 'framer-motion'
import { PublicKey } from '@solana/web3.js'
import { Wrench, ArrowUp, Droplet, Receipt, ChevronDown } from 'lucide-react'
import { Field } from '../contexts/GameContext'
import HarvestAnimation from './HarvestAnimation'
import ProgressBar from './ProgressBar'
import { sounds } from '../utils/sounds'
import { haptics } from '../utils/haptic'
import {
 fieldTypeInfo, mutationInfo, fmtPotato,
 HARVEST_THRESHOLD_MICRO, MAX_FIELD_LEVEL, MAX_DURABILITY, TAX_PERIOD_DAYS, FERTILIZER_HOURS,
} from '../utils/constants'
import { IconMutGold, IconMutSilicon } from './ares/icons'

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

export default function FieldCard({ field, index, onHarvest, onUpgrade, onRepair, onPayTax, onApplyFertilizer }: Props) {
 const { skrPricing } = useSolana()
 const price = (action: number) => skrCost(skrPricing, action, field.fieldType, field.level)
 const [showHarvest, setShowHarvest] = useState(false)
 const [harvestedAmount, setHarvestedAmount] = useState(0)
 const [harvesting, setHarvesting] = useState(false)
 const [showActions, setShowActions] = useState(false)

 const now = Math.floor(Date.now() / 1000)
 const type = fieldTypeInfo(field.fieldType)
 const mut = mutationInfo(field.mutationType)
 const canHarvest = field.accumulated >= HARVEST_THRESHOLD_MICRO
 const taxExpired = now > field.taxPaidUntil
 const taxDaysLeft = Math.max(0, Math.ceil((field.taxPaidUntil - now) / 86400))
 const fertActive = field.fertilizerUntil > now
 const fertHoursLeft = Math.max(0, Math.ceil((field.fertilizerUntil - now) / 3600))

 const handleHarvest = async () => {
  if (!canHarvest || harvesting) return
  setHarvestedAmount(field.accumulated)
  sounds.harvest()
  haptics.harvest()
  setHarvesting(true)
  const ok = await onHarvest(field.publicKey)
  if (ok) {
   setShowHarvest(true)
   window.setTimeout(() => setShowHarvest(false), 2000)
  }
  setHarvesting(false)
 }

 const action = (fn: FieldAction | undefined, sound: () => void, hapticFn: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation()
  if (!fn) return
  sound()
  hapticFn()
  void fn(field.publicKey)
 }

 const actionStyle = (color: string): React.CSSProperties => ({
  padding: 10, borderRadius: 10, background: `${color}33`, border: `1px solid ${color}4d`, color,
  fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
 })

 return (
  <>
   <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: Math.min(index, 6) * 0.08 }}
    className="pf-card hull-skin"
    style={{ padding: 20, borderRadius: 20, position: 'relative', overflow: 'hidden' }}
   >
    <button
     onClick={() => setShowActions(!showActions)}
     aria-expanded={showActions}
     aria-label={t('{name}, уровень {level}. {action} действия', { name: type.name, level: field.level, action: showActions ? t('Скрыть') : t('Показать') })}
     style={{ width: '100%', background: 'none', textAlign: 'left', color: 'inherit', padding: 0 }}
    >
     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
       <span style={{ fontSize: 32 }} aria-hidden="true">{type.emoji}</span>
       <div>
        <div style={{ fontSize: 12, color: 'var(--pf-text-secondary)' }}>{type.name}</div>
        <div style={{ fontSize: 11, color: 'var(--pf-text-muted)' }}>×{(type.yieldBps / 10_000).toFixed(2)} {t('урожай')}</div>
        {field.mutationType > 0 && (
         <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5,
          padding: '2px 7px', borderRadius: 4,
          background: `${mut.color}1a`, border: `1px solid ${mut.color}4d`,
          fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
          fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: mut.color,
         }}>
          {field.mutationType === 1 ? <IconMutGold size={11} /> : <IconMutSilicon size={11} />}
          <span>MUT {mut.code}</span>
          <span style={{ opacity: 0.6 }}>·</span>
          <span>{mut.effect}</span>
         </div>
        )}
       </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
       <span style={{ background: 'rgba(193, 68, 14, 0.12)', color: 'var(--pf-teal)', padding: '4px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
        {t('Ур. {n}', { n: field.level })}
       </span>
       <motion.div animate={{ rotate: showActions ? 180 : 0 }} transition={{ duration: 0.3 }}>
        <ChevronDown size={16} color="var(--pf-text-secondary)" />
       </motion.div>
      </div>
     </div>
    </button>

    <div style={{ marginBottom: 12 }}>
     <div style={{ fontSize: 12, color: 'var(--pf-text-secondary)', marginBottom: 4 }}>{t('Накоплено')}</div>
     <div style={{ fontSize: 22, fontWeight: 700, color: taxExpired ? 'var(--pf-red)' : 'var(--pf-gold)' }} aria-live="polite">
      {fmtPotato(field.accumulated, 3)} POTATO
     </div>
    </div>

    <ProgressBar
     label={t("Целостность")}
     value={field.durability}
     max={MAX_DURABILITY}
     color={field.durability > 50 ? 'var(--pf-teal)' : field.durability > 25 ? 'var(--pf-gold)' : 'var(--pf-red)'}
    />

    <div
     style={{
      marginTop: 10, padding: '8px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, textAlign: 'center',
      background: taxExpired ? 'rgba(239, 68, 68, 0.2)' : taxDaysLeft <= 2 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.15)',
      color: taxExpired ? 'var(--pf-red)' : taxDaysLeft <= 2 ? 'var(--pf-gold)' : 'var(--pf-teal)',
     }}
    >
     {taxExpired ? t(' Пошлина просрочен! Урожай −50%') : t(' Пошлина оплачен: {d} дн.', { d: taxDaysLeft })}
    </div>

    {fertActive && (
     <div style={{ marginTop: 8 }}>
      <ProgressBar label={t(` Удобрение ×1.5 ({h}ч)`, { h: fertHoursLeft })} value={Math.min(fertHoursLeft, FERTILIZER_HOURS)} max={FERTILIZER_HOURS} color="#22c55e" />
     </div>
    )}

    <motion.button
     whileTap={{ scale: 0.95 }}
     onClick={handleHarvest}
     disabled={!canHarvest || harvesting}
     data-tutorial={index === 0 ? 'harvest-button' : undefined}
     className={canHarvest ? 'gradient-gold shadow-glow-gold' : ''}
     style={{ width: '100%', padding: 12, borderRadius: 12, fontSize: 14, fontWeight: 600, marginTop: 12, background: canHarvest ? undefined : 'rgba(255,255,255,0.1)' }}
    >
     {harvesting ? t(' Сбор…') : canHarvest ? t('POTATO Жатва') : t(' Растёт…')}
    </motion.button>

    <AnimatePresence>
     {showActions && (
      <motion.div
       initial={{ height: 0, opacity: 0 }}
       animate={{ height: 'auto', opacity: 1 }}
       exit={{ height: 0, opacity: 0 }}
       style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, overflow: 'hidden' }}
      >
       {onUpgrade && field.level < MAX_FIELD_LEVEL && (
        <motion.button whileTap={{ scale: 0.95 }} disabled={price(2) === null} onClick={action(onUpgrade, sounds.upgrade, haptics.upgradeField)} style={actionStyle('var(--ares-blueset, #6B93D6)')}>
         <ArrowUp size={14} /> {t('Апгрейд модуля до ур. {level} ({cost} SKR)', { level: field.level + 1, cost: formatSkrCost(price(2)) })}
        </motion.button>
       )}
       {onRepair && field.durability < MAX_DURABILITY && (
        <motion.button whileTap={{ scale: 0.95 }} disabled={price(1) === null} onClick={action(onRepair, sounds.repair, haptics.repairField)} style={actionStyle('var(--pf-teal)')}>
         <Wrench size={14} /> {t('Техремонт до 100% ({cost} SKR)', { cost: formatSkrCost(price(1)) })}
        </motion.button>
       )}
       {onPayTax && (
        <motion.button whileTap={{ scale: 0.95 }} disabled={price(3) === null} onClick={action(onPayTax, sounds.payTax, haptics.payTax)} style={actionStyle('var(--pf-gold)')}>
         <Receipt size={14} /> {t('Пошлина: +{days} дней ({cost} SKR)', { days: TAX_PERIOD_DAYS, cost: formatSkrCost(price(3)) })}
        </motion.button>
       )}
       {onApplyFertilizer && (
        <motion.button whileTap={{ scale: 0.95 }} disabled={price(4) === null} onClick={action(onApplyFertilizer, sounds.fertilizer, haptics.applyFertilizer)} style={actionStyle('#22c55e')}>
         <Droplet size={14} /> {t('Удобрить ×1.5 на {h}ч ({cost} SKR)', { h: FERTILIZER_HOURS, cost: formatSkrCost(price(4)) })}
        </motion.button>
       )}
      </motion.div>
     )}
    </AnimatePresence>

    {canHarvest && <div style={{ position: 'absolute', inset: 0, borderRadius: 20, boxShadow: '0 0 20px rgba(245, 158, 11, 0.3)', pointerEvents: 'none' }} />}
   </motion.div>
   <AnimatePresence>{showHarvest && <HarvestAnimation amount={harvestedAmount} />}</AnimatePresence>
  </>
 )
}
