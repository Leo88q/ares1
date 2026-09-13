import { useCallback, useMemo, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { useSolana } from '../contexts/SolanaContext'
import { useToast } from '../components/Toast'
import {
 decodeMarketOrder, decodeMarketStats, decodeExportLicense, pdas, potatoAta,
 ixCreateSellOrder, ixFillOrder, ixCancelOrder,
} from '../utils/anchorClient'
import { MICRO } from '../utils/constants'
import { describeError } from '../utils/errors'
import { randomU64, withRetry } from '../utils/rpc'
import { usePolling } from './usePolling'

export interface MarketOrder {
 publicKey: PublicKey
 seller: PublicKey
 amountMicro: number
 priceLamportsPerPotato: number
 feeMicro: number
 status: 'active' | 'filled' | 'cancelled' | 'expired'
 createdAt: number
 expiresAt: number
 totalLamports: number
 isOwn: boolean
}

export interface MarketStatsView {
 sellVolume24h: number
 buyVolume24h: number
 totalSolVolume: number
 totalTrades: number
}

const ORDER_DATA_SIZE = 8 + 32 + 8 + 8 + 8 + 1 + 8 + 8 + 1 + 1
/** Byte offset of `status` inside MarketOrder; base58("\0") === "1". */
const ORDER_STATUS_OFFSET = 8 + 32 + 8 + 8 + 8
const ORDERS_POLL_MS = 20_000

export function useMarketplace() {
 const { connection, programId, publicKey, ready, config, sendIx, refreshConfig } = useSolana()
 const { show } = useToast()
 const [orders, setOrders] = useState<MarketOrder[]>([])
 const [stats, setStats] = useState<MarketStatsView>({ sellVolume24h: 0, buyVolume24h: 0, totalSolVolume: 0, totalTrades: 0 })
 const [loading, setLoading] = useState(true)
 const [actionLoading, setActionLoading] = useState<string | null>(null)
 const [error, setError] = useState<string | null>(null)

 const loadOrders = useCallback(async () => {
  if (!ready) {
   setLoading(false)
   return
  }
  try {
   const { marketStats } = pdas(programId)
   const [accounts, statsInfo] = await Promise.all([
    withRetry(() =>
     connection.getProgramAccounts(programId, {
      filters: [{ dataSize: ORDER_DATA_SIZE }, { memcmp: { offset: ORDER_STATUS_OFFSET, bytes: '1' } }],
     }),
    ),
    withRetry(() => connection.getAccountInfo(marketStats())),
   ])
   const now = Math.floor(Date.now() / 1000)
   const mapped: MarketOrder[] = accounts.map(({ pubkey, account }) => {
    const d = decodeMarketOrder(account.data)
    const amountMicro = Number(d.amountMicro)
    const price = Number(d.priceLamportsPerPotato)
    return {
     publicKey: pubkey,
     seller: d.seller,
     amountMicro,
     priceLamportsPerPotato: price,
     feeMicro: Number(d.feeMicro),
     status: d.status === 'active' && now >= Number(d.expiresAt) ? 'expired' : d.status,
     createdAt: Number(d.createdAt),
     expiresAt: Number(d.expiresAt),
     totalLamports: Math.floor((amountMicro * price) / MICRO),
     isOwn: publicKey ? d.seller.equals(publicKey) : false,
    }
   })
   setError(null)
   setOrders(
    mapped
     .filter((o) => o.status === 'active')
     .sort((a, b) => a.priceLamportsPerPotato - b.priceLamportsPerPotato),
   )
   if (statsInfo) {
    const s = decodeMarketStats(statsInfo.data)
    setStats({
     sellVolume24h: Number(s.sellVolume24hMicro) / MICRO,
     buyVolume24h: Number(s.buyVolume24hMicro) / MICRO,
     totalSolVolume: Number(s.totalSolVolume) / 1e6,
     totalTrades: Number(s.totalTrades),
    })
   }
  } catch (err) {
   setError(describeError(err))
   throw err
  } finally {
   setLoading(false)
  }
 }, [ready, connection, publicKey, programId])

 usePolling(loadOrders, ORDERS_POLL_MS, ready)

 const myOrders = useMemo(() => orders.filter((o) => o.isOwn), [orders])

 const notifyError = useCallback(
  (title: string, err: unknown) => show({ type: 'error', title, message: describeError(err) }),
  [show],
 )

 const ensureAtaIx = useCallback(
  async (owner: PublicKey, mint: PublicKey) => {
   const ata = getAssociatedTokenAddressSync(mint, owner, false)
   const info = await withRetry(() => connection.getAccountInfo(ata))
   if (info || !publicKey) return { address: ata, ixs: [] }
   return { address: ata, ixs: [createAssociatedTokenAccountInstruction(publicKey, ata, owner, mint)] }
  },
  [connection, publicKey],
 )

 const createOrder = useCallback(
  async (amountPotato: number, priceSolPerPotato: number): Promise<boolean> => {
   if (!config || !publicKey) return false
   setActionLoading('create')
   try {
    const amountMicro = BigInt(Math.floor(amountPotato * MICRO))
    const priceLamports = BigInt(Math.floor(priceSolPerPotato * 1e6))
    const orderId = randomU64()
    const { config: configPda, order, escrow, sellerProfile, marketStats } = pdas(programId)
    const orderPda = order(orderId)
    const { address: sellerPotato, ixs } = await ensureAtaIx(publicKey, config.potatoMint)
    const ix = await ixCreateSellOrder(programId, {
     seller: publicKey, sellerProfile: sellerProfile(publicKey), order: orderPda, marketStats: marketStats(),
     sellerPotato, escrow: escrow(orderPda), potatoMint: config.potatoMint, config: configPda(),
     orderId, amountMicro, priceLamports,
    })
    await sendIx([...ixs, ix])
    show({ type: 'success', title: 'Ордер опубликован', message: 'Он будет активен 24 часа.' })
    await loadOrders()
    return true
   } catch (err) {
    notifyError('Не удалось создать ордер', err)
    return false
   } finally {
    setActionLoading(null)
   }
  },
  [config, publicKey, programId, ensureAtaIx, sendIx, show, loadOrders, notifyError],
 )

 const fillOrder = useCallback(
  async (order: MarketOrder): Promise<boolean> => {
   if (!config || !publicKey) return false
   setActionLoading(order.publicKey.toBase58())
   try {
    const solBal = await withRetry(() => connection.getBalance(publicKey))
    // ~0.003 SOL covers the fee plus a possible ATA rent for the buyer/treasury.
    if (solBal < order.totalLamports + 3_000_000) {
     show({
      type: 'warning', title: 'Недостаточно SOL',
      message: `Нужно ${(order.totalLamports / 1e6).toFixed(4)} SOL + комиссия, у тебя ${(solBal / 1e6).toFixed(4)} SOL.`,
     })
     return false
    }
    const { escrow, marketStats, config: configPdaFn } = pdas(programId)
    const configPda = configPdaFn()
    const { address: buyerPotato, ixs } = await ensureAtaIx(publicKey, config.potatoMint)
    // Продавец платит комиссию при листинге — его ATA всегда существует.
    const sellerPotato = getAssociatedTokenAddressSync(config.potatoMint, order.seller, true)
    // Лицензия продавца: скидка 3 % (slot [0] remaining_accounts)
    const sellerLicensePda = pdas(programId).exportLicense(order.seller)
    let sellerLicense: PublicKey | null = null
    try {
     const licAcc = await connection.getAccountInfo(sellerLicensePda)
     if (licAcc && licAcc.data.length > 0) {
      const lic = decodeExportLicense(licAcc.data as Buffer)
      if (Number(lic.expiresAt) > Math.floor(Date.now() / 1000)) {
       sellerLicense = sellerLicensePda
      }
     }
    } catch { /* лицензия не существует — нормально */ }
    // Рефералка покупателя: −1 % комиссии + 0.5 % рефереру (slots [1], [2])
    let buyerReferral: PublicKey | null = null
    let referrerPotato: PublicKey | null = null
    try {
     const referralPda = PublicKey.findProgramAddressSync(
      [Buffer.from('referral'), publicKey.toBuffer()], programId,
     )[0]
     const refAcc = await connection.getAccountInfo(referralPda)
     if (refAcc && refAcc.data.length >= 8 + 32 + 32) {
      const referrer = new PublicKey(refAcc.data.subarray(8 + 32, 8 + 64))
      if (referrer.toBase58() !== '11111111111111111111111111111111'
       && !referrer.equals(publicKey) && !referrer.equals(order.seller)) {
       buyerReferral = referralPda
       referrerPotato = getAssociatedTokenAddressSync(config.potatoMint, referrer, true)
      }
     }
    } catch { /* рефералка не зарегистрирована — нормально */ }

    const ix = await ixFillOrder(programId, {
     buyer: publicKey, seller: order.seller, config: configPda, potatoMint: config.potatoMint,
     marketStats: marketStats(), order: order.publicKey, escrow: escrow(order.publicKey),
     buyerPotato, sellerPotato,
     treasuryPotato: potatoAta(configPda, config.potatoMint),
     sellerLicense, buyerReferral, referrerPotato,
    })
    await sendIx([...ixs, ix])
    show({ type: 'success', title: 'Покупка выполнена', message: `+${(order.amountMicro / MICRO).toFixed(2)} POTATO` })
    await Promise.all([loadOrders(), refreshConfig()])
    return true
   } catch (err) {
    notifyError('Не удалось купить', err)
    return false
   } finally {
    setActionLoading(null)
   }
  },
  [config, publicKey, connection, programId, ensureAtaIx, sendIx, show, loadOrders, refreshConfig, notifyError],
 )

 const cancelOrder = useCallback(
  async (orderPk: PublicKey): Promise<boolean> => {
   if (!config || !publicKey) return false
   setActionLoading(orderPk.toBase58())
   try {
    const { escrow, sellerProfile } = pdas(programId)
    const { address: sellerPotato, ixs } = await ensureAtaIx(publicKey, config.potatoMint)
    const ix = await ixCancelOrder(programId, {
     seller: publicKey, sellerProfile: sellerProfile(publicKey), order: orderPk, escrow: escrow(orderPk), sellerPotato,
    })
    await sendIx([...ixs, ix])
    await loadOrders()
    return true
   } catch (err) {
    notifyError('Не удалось отменить ордер', err)
    return false
   } finally {
    setActionLoading(null)
   }
  },
  [config, publicKey, programId, ensureAtaIx, sendIx, loadOrders, notifyError],
 )

 return { orders, myOrders, stats, loading, actionLoading, error, createOrder, fillOrder, cancelOrder, reload: loadOrders }
}
