import { ReactNode, useState } from 'react'
import { t } from '../i18n'

import { motion, AnimatePresence } from 'framer-motion'
import { Volume2, VolumeX, Music, X, Bell, Vibrate, Settings } from 'lucide-react'
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
    style={{ position: 'relative', top: 0, left: 0, width: 44, height: 44, borderRadius: '50%', background: 'rgba(22, 17, 13, 0.9)', backdropFilter: 'blur(10px)', border: '1px solid rgba(160, 82, 40, 0.65)', boxShadow: '0 0 18px -4px rgba(193,68,14,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
   >
    {musicOn ? <Music size={18} color="var(--pf-teal)" /> : <Settings size={18} color="var(--pf-text-secondary)" />}
   </motion.button>

   <AnimatePresence>
    {isOpen && (
     <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={() => setIsOpen(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
     >
      <motion.div
       role="dialog" aria-modal="true" aria-labelledby="settings-title"
       initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
       onClick={(e) => e.stopPropagation()}
       className="pf-card hull-skin"
       style={{ width: '100%', maxWidth: 360, borderRadius: 24, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,214,170,0.1)' }}
      >
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 id="settings-title" style={{ fontSize: 20 }}>{t("НАСТРОЙКИ")}</h2>
        <button onClick={() => setIsOpen(false)} aria-label={t("Закрыть")} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(160, 82, 40, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
         <X size={16} color="var(--pf-text-secondary)" />
        </button>
       </div>

       <SettingRow icon={<Music size={18} color="var(--pf-teal)" />} title={t("Фоновая музыка")} subtitle={t("Трек: Cipher — Kevin MacLeod (incompetech.com), CC BY 4.0")} on={musicOn} color="var(--pf-teal)" onToggle={toggleMusic} />
       {musicOn && (
        <label style={{ display: 'block', margin: '-8px 0 20px 28px' }}>
         <span style={{ fontSize: 12, color: 'var(--pf-text-secondary)', marginBottom: 8, display: 'block' }}> {t("Громкость")}: {Math.round(musicVolume * 100)}%</span>
         <input type="range" min="0" max="1" step="0.05" value={musicVolume} onChange={(e) => changeVolume(parseFloat(e.target.value))} style={{ width: '100%' }} />
        </label>
       )}
       <SettingRow icon={soundsOn ? <Volume2 size={18} color="var(--ares-hud-amber, #FFB347)" /> : <VolumeX size={18} color="var(--ares-hud-amber, #FFB347)" />} title={t("Звуковые эффекты")} subtitle={t("Сбор урожая, покупки, достижения")} on={soundsOn} color="var(--ares-hud-amber, #FFB347)" onToggle={toggleSfx} />
       <SettingRow icon={<Vibrate size={18} color="#FF2E93" />} title={t("Вибрация")} subtitle={t("Тактильный отклик (Web Vibration API)")} on={hapticOn} color="#FF2E93" onToggle={toggleHaptic} />
       <SettingRow
        icon={<Bell size={18} color="var(--pf-gold)" />} title={t("Уведомления")} color="var(--pf-gold)"
        subtitle={permissionGranted ? t('Урожай готов, истекает налог, низкая прочность') : t('Браузер попросит разрешение')}
        on={notificationsEnabled && permissionGranted} onToggle={() => void toggleNotifications()}
       />
       {notificationsEnabled && permissionGranted && (
        <button onClick={testNotification} style={{ margin: '-8px 0 16px 28px', fontSize: 12, color: 'var(--pf-gold)', background: 'none', textDecoration: 'underline' }}>
         {t('Отправить тестовое уведомление')}
        </button>
       )}

       <div style={{ padding: 12, borderRadius: 12, background: 'rgba(193, 68, 14, 0.10)', border: '1px solid rgba(160, 82, 40, 0.5)', fontSize: 11, color: 'var(--pf-text-secondary)', lineHeight: 1.5 }}>
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
 color: string
 onToggle: () => void
}

function SettingRow({ icon, title, subtitle, on, color, onToggle }: RowProps) {
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
    style={{ width: 48, height: 26, borderRadius: 13, background: on ? color : 'rgba(255,255,255,0.1)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}
   >
    <motion.div animate={{ x: on ? 22 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
     style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--ares-parchment, #F2E8DA)', position: 'absolute', top: 2, boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }} />
   </button>
  </div>
 )
}
