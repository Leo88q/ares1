/**
 * Шина ошибок кошелька.
 *
 * WalletProvider и onWalletNotFound живут в main.tsx — ВЫШЕ ToastProvider,
 * поэтому показать тост оттуда напрямую нельзя. Ошибки едут через window
 * CustomEvent, а тост показывает <WalletErrorReporter/> внутри App.
 */
export type WalletErrorKind = 'connect' | 'not-found' | 'rejected'

export interface WalletErrorDetail {
 kind: WalletErrorKind
 /** Имя адаптера (Mobile Wallet Adapter / Phantom / ...), если известно. */
 adapter: string
 /** Сырой текст ошибки (только для kind === 'connect'). */
 raw: string
}

const EVENT = 'ares:wallet-error'

export function reportWalletError(detail: WalletErrorDetail): void {
 console.error('[wallet]', detail.kind, detail.adapter, detail.raw)
 if (typeof window !== 'undefined') {
  window.dispatchEvent(new CustomEvent<WalletErrorDetail>(EVENT, { detail }))
 }
}

export function onWalletError(cb: (detail: WalletErrorDetail) => void): () => void {
 const fn = (e: Event) => cb((e as CustomEvent<WalletErrorDetail>).detail)
 window.addEventListener(EVENT, fn)
 return () => window.removeEventListener(EVENT, fn)
}
