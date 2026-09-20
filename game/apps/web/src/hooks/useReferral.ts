import { useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { useSolana } from '../contexts/SolanaContext'
import { useToast } from '../components/Toast'
import { describeError } from '../utils/errors'
import { pdas } from '../utils/anchorClient'
import { skrCost, formatSkrCost, skrPdas, ixRegisterReferrerSkr } from '../utils/skrPayments'
import { t } from '../i18n'

/** Registration must be explicitly confirmed; a referral URL is not consent to pay SKR. */
export function useReferral() {
 const { publicKey, sendIx, programId, config, skrPricing } = useSolana()
 const { show } = useToast()
 const [loading, setLoading] = useState(false)
 const registerReferrer = async (referrerPubkey: string) => {
  if (!publicKey || !config || loading) return false
  try {
   const referrer = new PublicKey(referrerPubkey)
   if (referrer.equals(publicKey) || referrer.equals(PublicKey.default)) throw new Error(t('Нельзя пригласить самого себя'))
   const cost = skrCost(skrPricing, 5)
   if (cost === null) throw new Error(t('Цена в SKR ещё не настроена — действие недоступно.'))
   if (!window.confirm(t('Регистрация реферера: {cost} SKR. Дополнительно потребуется SOL для комиссии и rent. Продолжить?', { cost: formatSkrCost(cost) }))) return false
   setLoading(true)
   const treasury = skrPdas(programId).treasury(), treasurySkr = getAssociatedTokenAddressSync(config.skrMint, treasury, true)
   const referral = PublicKey.findProgramAddressSync([Buffer.from('referral'), publicKey.toBuffer()], programId)[0]
   const ix = await ixRegisterReferrerSkr(programId, { config: pdas(programId).config(), pricing: skrPdas(programId).pricing(config.skrMint), skrMint: config.skrMint,
    userSkr: getAssociatedTokenAddressSync(config.skrMint, publicKey), treasury, treasurySkr, owner: publicKey, referral, referrer, maxSkrAtoms: cost })
   await sendIx([createAssociatedTokenAccountIdempotentInstruction(publicKey, treasurySkr, treasury, config.skrMint), ix])
   show({ type: 'success', title: t('Реферер зарегистрирован!') }); return true
  } catch (error) { show({ type: 'error', title: t('Ошибка регистрации реферера'), message: describeError(error) }); return false }
  finally { setLoading(false) }
 }
 return { registerReferrer, loading }
}
