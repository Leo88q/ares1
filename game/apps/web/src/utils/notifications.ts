import { Field } from '../hooks/useGame'

export interface NotificationPayload {
 title: string
 body: string
 icon?: string
 tag?: string
 requireInteraction?: boolean
 actions?: Array<{ action: string; title: string }>
}

let notificationPermission: NotificationPermission = 'default'

export async function requestNotificationPermission(): Promise<boolean> {
 if (!('Notification' in window)) {
  console.warn('Notifications not supported')
  return false
 }

 if (Notification.permission === 'granted') {
  notificationPermission = 'granted'
  return true
 }

 if (Notification.permission !== 'denied') {
  const permission = await Notification.requestPermission()
  notificationPermission = permission
  return permission === 'granted'
 }

 return false
}

export function showNotification(payload: NotificationPayload) {
 if (notificationPermission !== 'granted') {
  console.log('Notification blocked:', payload)
  return
 }

 const notification = new Notification(payload.title, {
  body: payload.body,
  icon: payload.icon || '/android-chrome-192x192.png',
  badge: '/android-chrome-192x192.png',
  tag: payload.tag,
  requireInteraction: payload.requireInteraction || false,
  silent: false,
 })

 notification.onclick = () => {
  window.focus()
  notification.close()
 }

 // Автоматически закрываем через 8 секунд
 setTimeout(() => notification.close(), 8000)
}

// Отслеживаем состояние полей
export function checkFieldNotifications(
 fields: Field[],
 lastNotified: Record<string, number>
): Record<string, number> {
 const newNotified = { ...lastNotified }
 const now = Date.now()

 fields.forEach(field => {
  const fieldId = field.publicKey.toString()
  const lastTime = lastNotified[fieldId] || 0

  // Урожай готов (больше 100,000 micro = 0.1 POTATO)
  if (field.accumulated >= 100000 && now - lastTime > 3600000) { // не чаще раза в час
   showNotification({
    title: ' Урожай готов!',
    body: `На поле накопилось ${(field.accumulated / 1_000_000).toFixed(2)} POTATO. Собери сейчас!`,
    tag: `harvest-${fieldId}`,
    icon: '/android-chrome-192x192.png',
   })
   newNotified[fieldId] = now
  }

  // Пошлина истекает (меньше 1 дня)
  const taxDaysLeft = Math.ceil((field.taxPaidUntil * 1000 - now) / 86400000)
  if (taxDaysLeft <= 1 && taxDaysLeft > 0 && now - lastTime > 86400000) { // раз в день
   showNotification({
    title: ' Пошлина истекает!',
    body: `Осталось ${taxDaysLeft} день. Оплати налог чтобы не потерять урожай!`,
    tag: `tax-${fieldId}`,
    icon: '/android-chrome-192x192.png',
    requireInteraction: true,
   })
   newNotified[fieldId] = now
  }

  // Целостность низкая (меньше 25%)
  if (field.durability < 25 && now - lastTime > 7200000) { // раз в 2 часа
   showNotification({
    title: ' Поле нуждается в ремонте!',
    body: `Целостность поля всего ${field.durability}%. Отремонтируй чтобы не потерять урожай!`,
    tag: `repair-${fieldId}`,
    icon: '/android-chrome-192x192.png',
   })
   newNotified[fieldId] = now
  }
 })

 return newNotified
}
