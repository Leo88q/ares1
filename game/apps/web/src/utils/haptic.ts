import { haptic } from './telegram'

export type HapticPattern = 
 | 'light'    // Лёгкий клик
 | 'medium'    // Среднее нажатие
 | 'heavy'    // Тяжёлое действие
 | 'success'   // Успех
 | 'warning'   // Предупреждение
 | 'error'    // Ошибка
 | 'selection'  // Выбор
 | 'harvest'   // Сбор урожая
 | 'purchase'   // Покупка
 | 'achievement' // Достижение
 | 'levelup'   // Новый уровень

// Встроенные паттерны Telegram
const TELEGRAM_PATTERNS: Record<HapticPattern, () => void> = {
 light: () => haptic('light'),
 medium: () => haptic('light'),
 heavy: () => haptic('success'),
 success: () => haptic('success'),
 warning: () => haptic('warning'),
 error: () => haptic('error'),
 selection: () => haptic('light'),
 harvest: () => {
  haptic('success')
  setTimeout(() => haptic('light'), 100)
  setTimeout(() => haptic('success'), 200)
 },
 purchase: () => {
  haptic('light')
  setTimeout(() => haptic('success'), 150)
 },
 achievement: () => {
  haptic('success')
  setTimeout(() => haptic('success'), 150)
  setTimeout(() => haptic('success'), 300)
  setTimeout(() => haptic('success'), 450)
 },
 levelup: () => {
  for (let i = 0; i < 5; i++) {
   setTimeout(() => haptic(i === 4 ? 'success' : 'light'), i * 80)
  }
 },
}

// Fallback на Vibration API если нет Telegram
function vibrateWithPattern(pattern: number[]) {
 if ('vibrate' in navigator) {
  try {
   navigator.vibrate(pattern)
  } catch {}
 }
}

// Паттерны вибрации для браузеров без Telegram
const BROWSER_PATTERNS: Record<HapticPattern, number[]> = {
 light: [10],
 medium: [20],
 heavy: [40],
 success: [50, 30, 50],
 warning: [30, 50, 30],
 error: [100, 50, 100],
 selection: [10],
 harvest: [30, 50, 30, 50, 80],
 purchase: [20, 40],
 achievement: [80, 40, 80, 40, 120],
 levelup: [40, 30, 40, 30, 40, 30, 100],
}

let enabled = true

export const setHapticEnabled = (value: boolean) => {
 enabled = value
 localStorage.setItem('potato_haptic', value ? 'on' : 'off')
}

export const isHapticEnabled = () => {
 if (enabled === undefined) {
  enabled = localStorage.getItem('potato_haptic') !== 'off'
 }
 return enabled
}

export function triggerHaptic(pattern: HapticPattern = 'light') {
 if (!enabled) return
 
 // Проверяем есть ли Telegram
 const tg = window.Telegram?.WebApp
 if (tg) {
  TELEGRAM_PATTERNS[pattern]()
 } else {
  // Fallback на Vibration API
  vibrateWithPattern(BROWSER_PATTERNS[pattern])
 }
}

// Умный haptic для конкретных действий
export const haptics = {
 // UI interactions
 tap: () => triggerHaptic('light'),
 buttonPress: () => triggerHaptic('medium'),
 longPress: () => triggerHaptic('heavy'),
 
 // Game actions
 harvest: () => triggerHaptic('harvest'),
 purchaseField: () => triggerHaptic('purchase'),
 buyOrder: () => triggerHaptic('purchase'),
 sellOrder: () => triggerHaptic('purchase'),
 upgradeField: () => {
  triggerHaptic('heavy')
  setTimeout(() => triggerHaptic('success'), 150)
 },
 repairField: () => triggerHaptic('medium'),
 payTax: () => triggerHaptic('medium'),
 applyFertilizer: () => {
  triggerHaptic('light')
  setTimeout(() => triggerHaptic('light'), 100)
  setTimeout(() => triggerHaptic('light'), 200)
 },
 
 // Events
 success: () => triggerHaptic('success'),
 warning: () => triggerHaptic('warning'),
 error: () => triggerHaptic('error'),
 achievement: () => triggerHaptic('achievement'),
 levelUp: () => triggerHaptic('levelup'),
 
 // Navigation
 navigate: () => triggerHaptic('light'),
 openModal: () => triggerHaptic('selection'),
 closeModal: () => triggerHaptic('light'),
 
 // Swipe gestures
 swipeUp: () => triggerHaptic('light'),
 swipeDown: () => triggerHaptic('light'),
 pullToRefresh: () => triggerHaptic('medium'),
}
