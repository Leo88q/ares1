import { getItem, setItem, removeItem } from './consent'
/**
 * Реферальная ссылка — ?ref=<wallet> (dApp Store / любой браузер).
 * Регистрация происходит on-chain (register_referrer), без Telegram и backend.
 */

export const REF_LINK_STORAGE_KEY = 'ares_ref_link'

const REF_PARAM = 'ref'

/** Ссылка на игру с реферал-кодом (wallet-адрес реферера). */
export function buildRefLink(referrer: string, base = window.location.origin + window.location.pathname): string {
 const url = new URL(base)
 url.searchParams.set(REF_PARAM, referrer)
 return url.toString()
}

/** Реферал-код из ?ref= (если пользователь пришёл по ссылке) или null. */
export function getRefFromUrl(): string | null {
 try {
  const ref = new URLSearchParams(window.location.search).get(REF_PARAM)
  return ref ? ref : null
 } catch {
  return null
 }
}

export function saveRefLink(refLink: string): void {
 try {
  setItem("functional", REF_LINK_STORAGE_KEY, refLink)
 } catch {
  /* ignore */
 }
}

export function getSavedRefLink(): string | null {
 try {
  return getItem("functional", REF_LINK_STORAGE_KEY)
 } catch {
  return null
 }
}

export function clearRefLink(): void {
 try {
  removeItem("functional", REF_LINK_STORAGE_KEY)
 } catch {
  /* ignore */
 }
}
