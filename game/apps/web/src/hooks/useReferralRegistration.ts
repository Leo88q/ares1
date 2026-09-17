import { useEffect } from 'react'
import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { useSolana } from '../contexts/SolanaContext'
import { ixRegisterReferrer, pdas } from '../utils/anchorClient'
import { getRefFromUrl } from '../utils/referral'

const REGISTERED_KEY = 'ares_ref_registered'

// Не более одной попытки за страницу: иначе при неудаче (нет 5 🥔 на burn)
// кошелёк будет просить подпись при каждом 30-сек опросе config.
// При следующем открытии страницы — попробуем снова.
let attemptDone = false

/**
 * Автотегистрация по реферал-ссылке ?ref=<wallet> (dApp Store / любой браузер).
 * On-chain: PDA ["referral", owner], одноразовый burn 5 POTATO (см. register_referrer
 * в программе). Без Telegram и backend — токен кошелька и есть идентичность.
 */
export function useReferralRegistration(): void {
 const { connection, programId, publicKey, connected, config, sendIx } = useSolana()

 useEffect(() => {
  if (!connected || !publicKey || !config) return

  const ref = getRefFromUrl()
  if (!ref) return
  let referrer: PublicKey
  try {
   referrer = new PublicKey(ref)
  } catch {
   return // невалидный ref-код в ссылке — молча игнорируем
  }
  if (referrer.equals(publicKey)) return // сам на себя — не регистрируем
  if (attemptDone) return

  const done = () => {
   try {
    localStorage.setItem(REGISTERED_KEY, ref)
   } catch {
    /* ignore */
   }
  }
  try {
   if (localStorage.getItem(REGISTERED_KEY)) return
  } catch {
    /* ignore */
  }

  let cancelled = false
  void (async () => {
   try {
    const referralPda = PublicKey.findProgramAddressSync([Buffer.from('referral'), publicKey.toBuffer()], programId)[0]
    // Уже зарегистрирован on-chain — ничего не делаем (PDA одноразовый).
    const existing = await connection.getAccountInfo(referralPda)
    if (existing) {
     if (!cancelled) done()
     return
    }
    const { config: configPda } = pdas(programId)
    const userPotato = getAssociatedTokenAddressSync(config.potatoMint, publicKey, false)
    // ATA должна существовать до burn — создаём идемпотентно
    const ataIx = createAssociatedTokenAccountIdempotentInstruction(publicKey, userPotato, publicKey, config.potatoMint)
    const ix = await ixRegisterReferrer(
     programId,
     {
      referral: referralPda,
      config: configPda(),
      potatoMint: config.potatoMint,
      userPotato,
      owner: publicKey,
     },
     referrer,
    )
    attemptDone = true
    await sendIx([ataIx, ix])
    if (!cancelled) done()
   } catch (err) {
    // Недостаточно 5 POTATO для burn или сетевая ошибка — не спамим,
    // повторимся при следующем запуске (флаг не ставим).
    console.warn('Авторегистрация по ?ref= не удалась:', err)
   }
  })()
  return () => {
   cancelled = true
  }
 }, [connected, publicKey, config, connection, programId, sendIx])
}
