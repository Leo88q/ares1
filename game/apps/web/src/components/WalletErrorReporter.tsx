import { useEffect } from 'react'
import { t } from '../i18n'
import { useToast } from './Toast'
import { onWalletError } from '../utils/walletBus'
import { describeError } from '../utils/errors'

/**
 * Показывает тосты об ошибках ПОДКЛЮЧЕНИЯ кошелька (шина из main.tsx).
 * Ошибки подписи сюда не попадают: их уже показывает sendIx своим тостом.
 */
export function WalletErrorReporter() {
 const { show } = useToast()
 useEffect(
  () =>
   onWalletError(({ kind, adapter, raw }) => {
    if (kind === 'not-found') {
     show({
      type: 'warning',
      title: t('Мобильный кошелёк не найден'),
      message: t(
       'Открой игру в Chrome на телефоне и убедись, что Seed Vault или Phantom установлены. Затем нажми «Подключить кошелёк» ещё раз.',
      ),
     })
     return
    }
    if (kind === 'rejected') {
     show({ type: 'info', title: t('Запрос отклонён в кошельке') })
     return
    }
    const detail = describeError(raw)
    show({
     type: 'error',
     title: t('Не удалось подключить кошелёк'),
     message: adapter ? `${adapter}: ${detail}` : detail || undefined,
    })
   }),
  [show],
 )
 return null
}
