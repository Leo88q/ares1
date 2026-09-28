import { ReactNode, useState } from 'react'
import { t } from '../i18n'

import { motion, AnimatePresence } from 'framer-motion'
import { Glyph } from '../ui/Emblem'
import { Emblem } from '../ui/Emblem'
import { ambientMusic } from '../utils/ambientMusic'
import { useNotifications } from '../hooks/useNotifications'
import { setHapticEnabled, isHapticEnabled } from '../utils/haptic'
import { isSoundEnabled, toggleSounds } from '../utils/sounds'

/** Floating settings button: music, sound effects, haptics and notifications. */
export default function AudioSettings() {
 const { notificationsEnabled, permissionGranted, toggleNotifications, testNotification } = useNotifications()
 const [isOpen, setIsOpen] = useState(false)
 const [hapticOn, setHapticOn] = useState(isHapticEnabled())
 const [soundsOn, setSoundsOn] = useState(isSoundEnabled())
 const [musicOn, setMusicOn] = useState(() => ambientMusic.getOn())
 const [musicVolume, setMusicVolume] = useState(() => ambientMusic.getVolume())

 // Музыка глобальная: жизненный цикл в ambientMusic (init в App),
 // здесь только настройки. При уходе с «Каюты» трек не останавливается.
 const toggleMusic = () => {
  const next = !musicOn
  setMusicOn(next)
  ambientMusic.setOn(next)
 }

 const toggleSfx = () => {
  setSoundsOn(toggleSounds())
 }

 const toggleHaptic = () => {
  const next = !hapticOn
  setHapticOn(next)
  setHapticEnabled(next)
 }

 const changeVolume = (v: number) => {
  setMusicVolume(v)
  ambientMusic.setVolume(v)
 }

 return (
  <>
   <motion.button
    whileHover={{ scale: 1.1 }}
    whileTap={{ scale: 0.9 }}
    onClick={() => setIsOpen(true)}
    aria-label={t("Настройки звука и уведомлений")}
    style={{ position: 'relative', top: 0, left: 0, width: 44, height: 44, borderRadius: '50%', background: 'rgba(22, 17, 13, 0.9)', backdropFilter: 'blur(10px)', border: '1px solid rgba(160, 82, 40, 0.65)', boxShadow: '0 0 18px -4px rgba(193,68,14,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--s-z-sticky)' }}
   >
    {musicOn ? <Emblem name="flame" size={18} /> : <Emblem name="gear" size={18} />}
   </motion.button>

   <AnimatePresence>
    {isOpen && (
     <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={() => setIsOpen(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)', zIndex: 'var(--s-z-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
     >
      <motion.div
       role="dialog" aria-modal="true" aria-labelledby="settings-title"
       initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
       onClick={(e) => e.stopPropagation()}
       className="pf-card hull-skin"
       style={{ width: '100%', maxWidth: 360, padding: 28 }}
      >
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 id="settings-title" style={{ fontSize: 20 }}>{t("НАСТРОЙКИ")}</h2>
        <button onClick={() => setIsOpen(false)} aria-label={t("Закрыть")} style={{ width: 44, height: 44, margin: -6, borderRadius: 8, background: 'rgba(160, 82, 40, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
         <Glyph name="x" size={16} style={{ opacity: 0.8 }} />
        </button>
       </div>

       <SettingRow icon={<Glyph name="music" size={18} />} title={t("Фоновая музыка")} subtitle={t("Трек: Cipher — Kevin MacLeod (incompetech.com), CC BY 4.0")} on={musicOn} onToggle={toggleMusic} />
       {musicOn && (
        <label style={{ display: 'block', margin: '-8px 0 20px 28px' }}>
         <span style={{ fontSize: 12, color: 'var(--pf-text-secondary)', marginBottom: 8, display: 'block' }}> {t("Громкость")}: {Math.round(musicVolume * 100)}%</span>
         <input type="range" className="ares-range" min="0" max="1" step="0.05" value={musicVolume} onChange={(e) => changeVolume(parseFloat(e.target.value))} style={{ width: '100%' }} aria-label={t("Громкость музыки")} />
        </label>
       )}
       <SettingRow icon={soundsOn ? <Glyph name="speaker" size={18} /> : <Glyph name="speaker" size={18} style={{ opacity: 0.45 }} />} title={t("Звуковые эффекты")} subtitle={t("Сбор урожая, покупки, достижения")} on={soundsOn} onToggle={toggleSfx} />
       <SettingRow icon={<Glyph name="vibrate" size={18} />} title={t("Вибрация")} subtitle={t("Тактильный отклик (Web Vibration API)")} on={hapticOn} onToggle={toggleHaptic} />
       <SettingRow
        icon={<Glyph name="bell" size={18} />} title={t("Уведомления")}
        subtitle={permissionGranted ? t('Урожай готов, истекает налог, низкая прочность') : t('Браузер попросит разрешение')}
        on={notificationsEnabled && permissionGranted} onToggle={() => void toggleNotifications()}
       />
       {notificationsEnabled && permissionGranted && (
        <button onClick={testNotification} style={{ margin: '-8px 0 16px 28px', fontSize: 12, color: 'var(--pf-gold)', background: 'none', textDecoration: 'underline' }}>
         {t('Отправить тестовое уведомление')}
        </button>
       )}

       <div style={{ padding: 8, borderStyle: 'solid', borderWidth: 10, borderImage: "url('/ares/kit/btn-secondary.webp') 40 fill / 10px", background: 'none', fontSize: 11, color: 'var(--pf-text-secondary)', lineHeight: 1.5 }}>
        {t('Настройки хранятся только в этом браузере.')}
       </div>
      </motion.div>
     </motion.div>
    )}
   </AnimatePresence>
  </>
 )
}

interface RowProps {
 icon: ReactNode
 title: string
 subtitle: string
 on: boolean
 onToggle: () => void
}

function SettingRow({ icon, title, subtitle, on, onToggle }: RowProps) {
 return (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
   <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <span aria-hidden="true">{icon}</span>
    <div>
     <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
     <div style={{ fontSize: 11, color: 'var(--pf-text-muted)' }}>{subtitle}</div>
    </div>
   </div>
   <button
    role="switch" aria-checked={on} aria-label={title}
    onClick={onToggle}
    style={{ width: 52, height: 26, borderRadius: 0, borderStyle: 'solid', borderWidth: 6, borderImage: "url('/ares/kit/input.webp') 30 fill / 6px", background: on ? 'linear-gradient(90deg, rgba(255,150,30,0.55), rgba(255,179,71,0.2))' : 'rgba(0,0,0,0.55)', position: 'relative', transition: 'background 0.25s', flexShrink: 0 }}
   >
    <motion.img
     src="/ares/kit/knob.webp"
     alt=""
     aria-hidden="true"
     animate={{ x: on ? 22 : 2, rotate: on ? 150 : 0 }}
     transition={{ type: 'spring', stiffness: 500, damping: 30 }}
     style={{ width: 22, height: 22, position: 'absolute', top: -1, filter: on ? 'drop-shadow(0 0 6px rgba(255,150,30,0.6))' : 'none' }}
    />
   </button>
  </div>
 )
}
