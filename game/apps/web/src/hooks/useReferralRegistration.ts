import { useEffect, useState } from 'react'
import { useSolana } from '../contexts/SolanaContext'
import { getTelegramInitData, getTelegramStartParam } from '../utils/telegram'
import { parseReferrerFromStartParam, registerReferral } from '../utils/referral'

/**
 * Автоматически регистрирует реферальную связь при первом запуске Mini App,
 * если пользователь пришёл по реферальной ссылке (?startapp=ref_<wallet>).
 *
 * Логика:
 * 1. При загрузке читаем Telegram.WebApp.initDataUnsafe.start_param
 * 2. Если там "ref_<wallet>" — ждём подключения кошелька
 * 3. Вызываем POST /api/referral/register
 * 4. Ставим флаг в localStorage чтобы не спамить API
 */
export function useReferralRegistration() {
 const { publicKey } = useSolana()
 const [status, setStatus] = useState<'idle' | 'registering' | 'registered' | 'error'>('idle')

 useEffect(() => {
  // Уже регистрировали в этой сессии
  if (localStorage.getItem('referral_registered') === 'true') {
   setStatus('registered')
   return
  }

  // Нет start_param или он не реферальный
  const startParam = getTelegramStartParam()
  const referrerWallet = parseReferrerFromStartParam(startParam)
  if (!referrerWallet) {
   setStatus('registered') // помечаем чтобы больше не проверять
   return
  }

  // Ждём подключения кошелька
  if (!publicKey) return

  const initData = getTelegramInitData() || ''
  if (!initData) {
   console.warn('[referral] нет Telegram initData, пропускаем регистрацию')
   return
  }

  let cancelled = false

  async function doRegister() {
   setStatus('registering')
   const result = await registerReferral({
    referrerWallet: referrerWallet!,
    invitedWallet: publicKey!.toBase58(),
    initData: initData || '',
   })

   if (cancelled) return

   if (result.ok) {
    localStorage.setItem('referral_registered', 'true')
    setStatus('registered')
    console.log('[referral]  зарегистрирован:', result.rewards)
   } else {
    console.warn('[referral]  ошибка регистрации:', result.error)
    // Не ставим флаг — попробуем ещё раз при следующем запуске
    setStatus('error')
   }
  }

  doRegister()

  return () => {
   cancelled = true
  }
 }, [publicKey])

 return { status }
}
