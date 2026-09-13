import { useEffect, useState, useRef } from 'react'
import { useGame } from '../contexts/GameContext'
import { requestNotificationPermission, checkFieldNotifications, showNotification } from '../utils/notifications'

const STORAGE_KEY = 'potato_notifications'
const LAST_NOTIFIED_KEY = 'potato_last_notified'

function readLastNotified(): Record<string, number> {
 try {
  return JSON.parse(localStorage.getItem(LAST_NOTIFIED_KEY) || '{}') as Record<string, number>
 } catch {
  return {}
 }
}

/** Browser notifications for ready harvests, expiring tax and low durability. */
export function useNotifications() {
 const { fields } = useGame()
 const [permissionGranted, setPermissionGranted] = useState(
  () => typeof Notification !== 'undefined' && Notification.permission === 'granted',
 )
 const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem(STORAGE_KEY) !== 'off')
 const lastNotifiedRef = useRef<Record<string, number>>(readLastNotified())

 useEffect(() => {
  if (!notificationsEnabled || !permissionGranted || fields.length === 0) return
  const check = () => {
   lastNotifiedRef.current = checkFieldNotifications(fields, lastNotifiedRef.current)
   localStorage.setItem(LAST_NOTIFIED_KEY, JSON.stringify(lastNotifiedRef.current))
  }
  check()
  const interval = window.setInterval(check, 30_000)
  return () => window.clearInterval(interval)
 }, [fields, notificationsEnabled, permissionGranted])

 const toggleNotifications = async () => {
  const next = !notificationsEnabled
  if (next && !permissionGranted) {
   const granted = await requestNotificationPermission()
   setPermissionGranted(granted)
   if (!granted) {
    localStorage.setItem(STORAGE_KEY, 'off')
    setNotificationsEnabled(false)
    return
   }
  }
  setNotificationsEnabled(next)
  localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
 }

 const testNotification = () =>
  showNotification({
   title: ' Уведомления работают!',
   body: 'Ты получишь сигнал, когда урожай готов или истекает налог.',
   tag: 'test',
  })

 return { notificationsEnabled, permissionGranted, toggleNotifications, testNotification }
}
