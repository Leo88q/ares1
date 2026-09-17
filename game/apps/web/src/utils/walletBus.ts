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

// ---------------------------------------------------------------------------
// Классификация и дедупликация.
//
// Одна и та же ошибка приходит ДВАЖДЫ: сначала как событие 'error' адаптера
// (WalletProvider onError), потом как rejection промиса connect() — тот же
// объект ошибки. Отчёт по одному объекту — максимум один тост.
// ---------------------------------------------------------------------------
const reportedErrors = new WeakSet<object>()

export function reportWalletErrorOnce(source: unknown, detail: WalletErrorDetail): void {
 if (typeof source === 'object' && source !== null) {
  if (reportedErrors.has(source)) return
  reportedErrors.add(source)
 }
 reportWalletError(detail)
}

const NOT_FOUND_RE = /no installed wallet|wallet not found|ERROR_WALLET_NOT_FOUND|Found no installed wallet/i

/** «Мобильного кошелька нет»: на него уже показан отдельный тост из onWalletNotFound. */
export function isWalletNotFoundError(error: unknown): boolean {
 const name = (error as { name?: string } | null)?.name ?? ''
 const message = (error as { message?: string } | null)?.message ?? String(error)
 return NOT_FOUND_RE.test(name) || NOT_FOUND_RE.test(message)
}

export function isUserRejectedError(error: unknown): boolean {
 const message = (error as { message?: string } | null)?.message ?? String(error)
 return /user rejected|rejected the request/i.test(message)
}

/** Ошибки подписи/отправки — их уже показывает sendIx своим тостом. */
export function isSignOrSendError(error: unknown): boolean {
 const name = (error as { name?: string } | null)?.name ?? ''
 return /Sign|SendTransaction/i.test(name)
}

export function errorRawText(error: unknown): string {
 return (error as { message?: string } | null)?.message ?? String(error)
}
