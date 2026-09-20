import { useEffect } from 'react'
import { PublicKey } from '@solana/web3.js'
import { getRefFromUrl } from '../utils/referral'
export const PENDING_REFERRER_KEY = 'ares_pending_referrer'
export function useReferralRegistration(): void {
 useEffect(() => {
  const ref = getRefFromUrl()
  if (!ref) return
  try { const key = new PublicKey(ref); if (!key.equals(PublicKey.default)) localStorage.setItem(PENDING_REFERRER_KEY, key.toBase58()) } catch { /* invalid URL or storage unavailable */ }
 }, [])
}
