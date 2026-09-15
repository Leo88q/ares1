import { useState } from 'react'
import { t } from '../i18n'

import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight } from 'lucide-react'
import { HullPanel } from '../ui/HullPanel'

interface TutorialStep {
 id: string
 eyebrow: string
 title: string
 description: string
 target?: string
 position: 'top' | 'bottom' | 'center'
}

const TUTORIAL_STEPS: TutorialStep[] = [
 {
  id: 'welcome',
  eyebrow: t('01 / КОЛОНИЯ'),
  title: t('ARES-1: картофельная колония на Solana'),
  description: t('Картошка = $POTATO. Всё через кошелёк, без посредников. 100% токена рождается в руках игроков — команда не майнит.'),
  position: 'center',
 },
 {
  id: 'field',
  eyebrow: t('02 / ДЕЛЯНКА'),
  title: t('Модуль, харвест, лунный цикл'),
  description: t('Купи модуль за SKR. Харвест ограничен капом эпохи 250–750K POTATO и лунным множителем 0.85×–1.15× (Фобос влияет).'),
  position: 'top',
 },
 {
  id: 'mutations',
  eyebrow: t('03 / ИЗНОС И МУТАЦИИ'),
  title: t('Ремонт, апгрейд, 5% шанс мутации'),
  description: t('Durability падает — чини. Апгрейд даёт 5% шанс: Golden +25% урожая навсегда, или Silicon — износ ×0.5.'),
  position: 'top',
 },
 {
  id: 'license',
  eyebrow: t('04 / НАЛОГ И ЛИЦЕНЗИЯ'),
  title: t('Налог на харвест и экспорт-лицензия'),
  description: t('Неуплаченный налог = −15% к урожаю. Лицензия 500 SKR / 30 дней → −3% комиссии рынка. Покупка в КАЮТЕ.'),
  position: 'bottom',
 },
 {
  id: 'market',
  eyebrow: t('05 / РЫНОК'),
  title: t('Ордера, комиссия, burn'),
  description: t('Комиссия 9–12%: 60% сгорает навсегда, 40% в казну. Отмена ордера — с кулдауном. Всё в escrow, без контрагентов.'),
  position: 'bottom',
 },
 {
  id: 'referral',
  eyebrow: t('06 / РЕФЕРАЛКА'),
  title: t('Приводи — экономьте вместе'),
  description: t('Ссылка в КАЮТЕ. Тебе и другу −1% комиссии. Рефереру +0.5% от каждой сделки приглашённого.'),
  position: 'bottom',
 },
 {
  id: 'done',
  eyebrow: t('07 / КВЕСТЫ И МОСТ'),
  title: t('Награды сервера, мост через burn'),
  description: t('Квесты минтит сервер (не клиент). Мост в Age of Farming работает только через burn — без пулов ликвидности. Удачи, колонист.'),
  position: 'center',
 },
]

interface Props {
 onComplete: () => void
}

export default function InteractiveTutorial({ onComplete }: Props) {
 const [currentStep, setCurrentStep] = useState(0)
 const [visible, setVisible] = useState(true)

 const step = TUTORIAL_STEPS[currentStep]
 const isLast = currentStep === TUTORIAL_STEPS.length - 1

 const handleNext = () => {
  if (isLast) {
   setVisible(false)
   setTimeout(onComplete, 300)
  } else {
   setCurrentStep(currentStep + 1)
  }
 }

 const handleSkip = () => {
  setVisible(false)
  setTimeout(onComplete, 300)
 }

 if (!visible) return null

 return (
  <AnimatePresence>
   <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    style={{
     position: 'fixed',
     inset: 0,
     background: 'rgba(0, 0, 0, 0.85)',
     backdropFilter: 'blur(8px)',
     zIndex: 1000,
     display: 'flex',
     alignItems: step.position === 'center' ? 'center' : step.position === 'top' ? 'flex-start' : 'flex-end',
     justifyContent: 'center',
     padding: '20px',
    }}
   >
    <motion.div
     key={currentStep}
     initial={{ opacity: 0, y: 20, scale: 0.95 }}
     animate={{ opacity: 1, y: 0, scale: 1 }}
     exit={{ opacity: 0, y: -20, scale: 0.95 }}
     transition={{ type: 'spring', damping: 20 }}
     style={{
      width: '100%',
      maxWidth: '420px',
      position: 'relative',
     }}
    >
     {/* Кнопка пропустить */}
     <button
      onClick={handleSkip}
      style={{
       position: 'absolute',
       top: '12px',
       right: '12px',
       width: '32px',
       height: '32px',
       borderRadius: '6px',
       background: 'rgba(255,255,255,0.05)',
       border: '1px solid rgba(255,255,255,0.1)',
       display: 'flex',
       alignItems: 'center',
       justifyContent: 'center',
       cursor: 'pointer',
       zIndex: 10,
      }}
     >
      <X size={16} color="var(--pf-text-muted)" />
     </button>

     <HullPanel style={{ padding: '24px 20px' }}>
      {/* Прогресс-сегмент */}
      <div style={{ marginBottom: 20 }}>
       <div style={{
        fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
        fontSize: 10,
        letterSpacing: 1.5,
        color: 'var(--pf-text-muted)',
        marginBottom: 8,
       }}>
        t('ПРОГРЕСС') · {currentStep + 1} / {TUTORIAL_STEPS.length}
       </div>
       <div style={{
        display: 'flex',
        gap: 3,
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.05)',
       }}>
        {TUTORIAL_STEPS.map((_, i) => (
         <div
          key={i}
          style={{
           flex: 1,
           background: i <= currentStep ? 'var(--pf-teal)' : 'rgba(255,255,255,0.08)',
           transition: 'background 0.3s',
          }}
         />
        ))}
       </div>
      </div>

      {/* Eyebrow */}
      <div style={{
       fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
       fontSize: 11,
       letterSpacing: 1.8,
       color: 'var(--pf-teal)',
       marginBottom: 10,
       fontWeight: 700,
      }}>
       {step.eyebrow}
      </div>

      {/* Заголовок */}
      <h2 style={{
       fontSize: 20,
       fontWeight: 700,
       marginBottom: 14,
       lineHeight: 1.3,
       color: 'var(--pf-text)',
      }}>
       {step.title}
      </h2>

      {/* Описание */}
      <p style={{
       fontSize: 14,
       lineHeight: 1.6,
       color: 'var(--pf-text-secondary)',
       marginBottom: 24,
      }}>
       {step.description}
      </p>

      {/* Кнопки */}
      <div style={{ display: 'flex', gap: 10 }}>
       {!isLast && (
        <button
         onClick={handleSkip}
         style={{
          flex: 1,
          padding: '12px 16px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.05)',
          color: 'var(--pf-text-secondary)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
         }}
        >
         {t('Пропустить')}
        </button>
       )}
       <button
        onClick={handleNext}
        className="gradient-gold"
        style={{
         flex: isLast ? 1 : 2,
         padding: '12px 20px',
         borderRadius: 8,
         border: 'none',
         fontSize: 14,
         fontWeight: 700,
         cursor: 'pointer',
         display: 'flex',
         alignItems: 'center',
         justifyContent: 'center',
         gap: 6,
        }}
       >
        {isLast ? t('Завершить') : t('Далее')}
        {!isLast && <ChevronRight size={16} />}
       </button>
      </div>
     </HullPanel>
    </motion.div>
   </motion.div>
  </AnimatePresence>
 )
}
