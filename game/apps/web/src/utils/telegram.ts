/** Minimal typing of the Telegram Mini App bridge we actually use. */
interface TelegramWebApp {
 version?: string
 initData?: string
 initDataUnsafe?: { start_param?: string }
 ready: () => void
 expand: () => void
 setHeaderColor?: (color: string) => void
 setBackgroundColor?: (color: string) => void
 HapticFeedback?: {
  impactOccurred: (style: 'light' | 'medium' | 'heavy') => void
  notificationOccurred: (type: 'success' | 'error' | 'warning') => void
 }
}

declare global {
 interface Window {
  Telegram?: { WebApp?: TelegramWebApp }
 }
}

const tg = (): TelegramWebApp | undefined => window.Telegram?.WebApp

export const isTelegram = () => Boolean(tg()?.initData)

export function initTelegram() {
 try {
  const app = tg()
  if (!app) return
  app.ready()
  app.expand()
  const major = parseInt(app.version?.split('.')[0] || '0', 10)
  if (major >= 7) {
   app.setHeaderColor?.('#0a0a0f')
   app.setBackgroundColor?.('#0a0a0f')
  }
 } catch {
  /* not inside Telegram */
 }
}

export function haptic(type: 'success' | 'error' | 'warning' | 'light' = 'light') {
 try {
  const app = tg()
  if (!app?.HapticFeedback || parseFloat(app.version || '0') < 6.1) return
  if (type === 'light') app.HapticFeedback.impactOccurred('light')
  else app.HapticFeedback.notificationOccurred(type)
 } catch {
  /* ignore */
 }
}

export function getTelegramInitData(): string | null {
 return tg()?.initData || null
}

export function getTelegramStartParam(): string | null {
 return tg()?.initDataUnsafe?.start_param || null
}
