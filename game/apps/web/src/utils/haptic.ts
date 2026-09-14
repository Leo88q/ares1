/**
 * Тактильный отклик — нейтральный к платформе (dApp Store / браузер).
 * Web Vibration API; в webview, где он недоступен, — тихо no-op.
 * (Раньше реализация была на Telegram.WebApp.HapticFeedback — убрана,
 *  продукт ориентирован на dApp Store. Публичный API не изменился.)
 */

export type HapticPattern =
 | 'light'    // Лёгкий клик
 | 'medium'   // Среднее нажатие
 | 'heavy'    // Тяжёлое действие
 | 'success'  // Успех
 | 'warning'  // Предупреждение
 | 'error'    // Ошибка
 | 'selection'  // Выбор
 | 'harvest'    // Сбор урожая
 | 'purchase'   // Покупка
 | 'achievement' // Достижение
 | 'levelup'    // Новый уровень

const VIBRATE_PATTERNS: Record<HapticPattern, number | number[]> = {
 light: 10,
 medium: 20,
 heavy: 40,
 success: [15, 40, 15],
 warning: [30, 60, 30],
 error: [50, 80, 50, 80, 50],
 selection: 15,
 harvest: [10, 30, 25],
 purchase: [20, 40, 20, 40, 20],
 achievement: [15, 30, 15, 30, 60],
 levelup: [10, 20, 10, 20, 10, 20, 40],
}

const HAPTIC_STORAGE_KEY = 'haptics_enabled'

export function isHapticEnabled(): boolean {
 try {
  return localStorage.getItem(HAPTIC_STORAGE_KEY) !== '0'
 } catch {
  return true
 }
}

export function setHapticEnabled(enabled: boolean): void {
 try {
  localStorage.setItem(HAPTIC_STORAGE_KEY, enabled ? '1' : '0')
 } catch {
  /* ignore */
 }
}

export function haptic(pattern: HapticPattern = 'light'): void {
 if (!isHapticEnabled()) return
 try {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  navigator.vibrate(VIBRATE_PATTERNS[pattern] ?? 10)
 } catch {
  /* ignore */
 }
}

function triggerHaptic(pattern: HapticPattern): void {
 haptic(pattern)
}

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
