import { useCallback, useMemo, useState } from 'react'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { t } from '../i18n'
import { useSolana } from '../contexts/SolanaContext'
import { useToast } from '../components/Toast'
import { decodeMarketOrder, pdas, ixCancelOrder } from '../utils/anchorClient'
import { skrPdas, decodeSkrOrder, decodeSkrStats, ixCreateSkrOrder, ixFillSkrOrder, ixCancelSkrOrder } from '../utils/skrPayments'
import { skrAtomsToTokens, skrToAtoms, marketTotalSkrAtoms } from '../utils/marketUnits'
import { MICRO } from '../utils/constants'
import { describeError } from '../utils/errors'
import { randomU64 } from '../utils/rpc'
import { usePolling } from './usePolling'
export interface MarketOrder {
 publicKey: PublicKey; seller: PublicKey; amountMicro: number; priceSkrAtomsPerPotato: number; feeBps: number
 status: 'active' | 'expired'; createdAt: number; expiresAt: number; totalSkrAtoms: number; isOwn: boolean
}
export interface MarketStatsView { sellVolume24h: number; buyVolume24h: number; totalSkrVolume: number; totalTrades: number }
export function useMarketplace() {
 const { connection, programId, publicKey, config, skrPricing, sendIx, refreshConfig } = useSolana()
 const { show } = useToast()
 const [allOrders, setOrders] = useState<MarketOrder[]>([])
 const [legacyOrders, setLegacyOrders] = useState<{ publicKey: PublicKey; amountMicro: number; legacy: boolean }[]>([])
 const [stats, setStats] = useState<MarketStatsView>({ sellVolume24h: 0, buyVolume24h: 0, totalSkrVolume: 0, totalTrades: 0 })
 const [loading, setLoading] = useState(true), [actionLoading, setActionLoading] = useState<string | null>(null), [error, setError] = useState<string | null>(null)
 const loadOrders = useCallback(async () => {
  if (!config) { setLoading(false); setOrders([]); setLegacyOrders([]); return }
  try {
   const [accounts, info, legacy] = await Promise.all([
    connection.getProgramAccounts(programId, { filters: [{ dataSize: 140 }] }),
    connection.getAccountInfo(skrPdas(programId).stats(config.skrMint)),
    publicKey ? connection.getProgramAccounts(programId, { filters: [{ dataSize: 83 }, { memcmp: { offset: 8, bytes: publicKey.toBase58() } }, { memcmp: { offset: 64, bytes: '1' } }] }) : Promise.resolve([]),
   ])
   const now = Math.floor(Date.now() / 1000)
   const recovery: { publicKey: PublicKey; amountMicro: number; legacy: boolean }[] = []
   const mapped = accounts.flatMap(({ pubkey, account }): MarketOrder[] => {
    try {
     const d = decodeSkrOrder(account.data)
     if (!d.potatoMint.equals(config.potatoMint)) return []
     if (!d.skrMint.equals(config.skrMint)) {
      if (d.seller.equals(publicKey ?? PublicKey.default)) recovery.push({ publicKey: pubkey, amountMicro: Number(d.amountMicro), legacy: false })
      return []
     }
     if (d.amountMicro > BigInt(Number.MAX_SAFE_INTEGER) || d.priceSkrAtoms > BigInt(Number.MAX_SAFE_INTEGER)) return []
     return [{ publicKey: pubkey, seller: d.seller, amountMicro: Number(d.amountMicro), priceSkrAtomsPerPotato: Number(d.priceSkrAtoms), feeBps: d.feeBps,
      status: Number(d.expiresAt) <= now ? 'expired' : 'active', createdAt: Number(d.createdAt), expiresAt: Number(d.expiresAt),
      totalSkrAtoms: marketTotalSkrAtoms(d.amountMicro, d.priceSkrAtoms), isOwn: d.seller.equals(publicKey ?? PublicKey.default) }]
    } catch { return [] }
   })
   setOrders(mapped.sort((a, b) => a.priceSkrAtomsPerPotato - b.priceSkrAtomsPerPotato))
   setLegacyOrders([...recovery, ...legacy.map(({ pubkey, account }) => ({ publicKey: pubkey, amountMicro: Number(decodeMarketOrder(account.data).amountMicro), legacy: true }))])
   if (info) {
    if (!info.owner.equals(programId)) throw new Error('Invalid SKR stats owner')
    const s = decodeSkrStats(info.data); if (!s.skrMint.equals(config.skrMint)) throw new Error('Invalid SKR stats mint')
    const volume = Math.floor(Number(s.lastUpdate) / 86400) === Math.floor(now / 86400) ? Number(s.volume24hMicro) / MICRO : 0
    setStats({ sellVolume24h: volume, buyVolume24h: volume, totalSkrVolume: skrAtomsToTokens(s.totalSkrAtoms), totalTrades: Number(s.totalTrades) })
   } else setStats({ sellVolume24h: 0, buyVolume24h: 0, totalSkrVolume: 0, totalTrades: 0 })
   setError(null)
  } catch (e) { setError(describeError(e)) } finally { setLoading(false) }
 }, [config, connection, programId, publicKey])
 usePolling(loadOrders, 20_000)
 const myOrders = useMemo(() => allOrders.filter(o => o.isOwn), [allOrders])
 const orders = useMemo(() => allOrders.filter(o => o.status === 'active'), [allOrders])
 const ata = useCallback((owner: PublicKey, mint: PublicKey) => {
  if (!publicKey) throw new Error('Connect wallet')
  const address = getAssociatedTokenAddressSync(mint, owner, true)
  return { address, ix: createAssociatedTokenAccountIdempotentInstruction(publicKey, address, owner, mint) }
 }, [publicKey])
 const transact = useCallback(async (id: string, action: () => Promise<void>) => {
  setActionLoading(id)
  try { await action(); await Promise.all([loadOrders(), refreshConfig()]); return true }
  catch (e) { show({ type: 'error', title: t('Операция не выполнена'), message: describeError(e) }); return false }
  finally { setActionLoading(null) }
 }, [loadOrders, refreshConfig, show])
 const createOrder = useCallback(async (amount: number, price: number) => {
  if (!config || !publicKey) return false
  return transact('create', async () => {
   if (!skrPricing?.marketMinAtoms) throw new Error(t('Цена в SKR ещё не настроена — действие недоступно.'))
   if (!Number.isSafeInteger(Math.floor(amount * MICRO)) || amount < 10) throw new Error('Minimum 10 POTATO; amount must be in supported range')
   const amountMicro = BigInt(Math.floor(amount * MICRO)), priceSkrAtoms = skrToAtoms(price)
   if (BigInt(marketTotalSkrAtoms(amountMicro, priceSkrAtoms)) < skrPricing.marketMinAtoms) throw new Error(`Minimum ${skrAtomsToTokens(skrPricing.marketMinAtoms)} SKR`)
   const id = randomU64(), p = skrPdas(programId), order = p.order(id), sellerPotato = ata(publicKey, config.potatoMint)
   const ix = await ixCreateSkrOrder(programId, { seller: publicKey, config: pdas(programId).config(), pricing: p.pricing(config.skrMint), skrMint: config.skrMint,
    sellerProfile: pdas(programId).sellerProfile(publicKey), order, marketStats: p.stats(config.skrMint), sellerPotato: sellerPotato.address, escrow: p.escrow(order), potatoMint: config.potatoMint, orderId: id, amountMicro, priceSkrAtoms })
   await sendIx([sellerPotato.ix, ix])
  })
 }, [config, publicKey, skrPricing, transact, programId, ata, sendIx])
 const fillOrder = useCallback(async (order: MarketOrder) => {
  if (!config || !publicKey) return false
  return transact(order.publicKey.toBase58(), async () => {
   const p = skrPdas(programId), buyerSkr = getAssociatedTokenAddressSync(config.skrMint, publicKey)
   const balance = await connection.getTokenAccountBalance(buyerSkr)
   if (BigInt(balance.value.amount) < BigInt(order.totalSkrAtoms)) throw new Error(t('Недостаточно SKR'))
   const buyerPotato = ata(publicKey, config.potatoMint), sellerPotato = ata(order.seller, config.potatoMint), sellerSkr = ata(order.seller, config.skrMint), treasurySkr = ata(p.treasury(), config.skrMint)
   const ixs = [buyerPotato.ix, sellerPotato.ix, sellerSkr.ix, treasurySkr.ix]
   const referral = PublicKey.findProgramAddressSync([Buffer.from('referral'), publicKey.toBuffer()], programId)[0]
   const license = pdas(programId).exportLicense(order.seller)
   const [licInfo, refInfo] = await connection.getMultipleAccountsInfo([license, referral])
   const remaining = [{ pubkey: licInfo?.owner.equals(programId) ? license : SystemProgram.programId, isWritable: false, isSigner: false },
    { pubkey: refInfo?.owner.equals(programId) ? referral : SystemProgram.programId, isWritable: false, isSigner: false }]
   if (refInfo?.owner.equals(programId) && refInfo.data.length === 73) {
    const referrer = new PublicKey(refInfo.data.subarray(40, 72))
    if (!referrer.equals(PublicKey.default) && !referrer.equals(order.seller) && !referrer.equals(publicKey)) {
     const refAta = ata(referrer, config.skrMint); ixs.push(refAta.ix); remaining.push({ pubkey: refAta.address, isWritable: true, isSigner: false })
    }
   }
   ixs.push(await ixFillSkrOrder(programId, { buyer: publicKey, seller: order.seller, config: pdas(programId).config(), potatoMint: config.potatoMint, skrMint: config.skrMint,
    marketStats: p.stats(config.skrMint), order: order.publicKey, escrow: p.escrow(order.publicKey), buyerPotato: buyerPotato.address, sellerPotato: sellerPotato.address,
    buyerSkr, sellerSkr: sellerSkr.address, treasury: p.treasury(), treasurySkr: treasurySkr.address, maxSkrAtoms: BigInt(order.totalSkrAtoms), remaining }))
   await sendIx(ixs)
  })
 }, [config, publicKey, transact, programId, connection, ata, sendIx])
 const cancelOrder = useCallback(async (order: PublicKey, legacy = false) => {
  if (!config || !publicKey) return false
  return transact(order.toBase58(), async () => {
   const sellerPotato = ata(publicKey, config.potatoMint), old = pdas(programId)
   const build = legacy ? ixCancelOrder : ixCancelSkrOrder
   const ix = await build(programId, { seller: publicKey, sellerProfile: old.sellerProfile(publicKey), order,
    escrow: legacy ? old.escrow(order) : skrPdas(programId).escrow(order), sellerPotato: sellerPotato.address })
   await sendIx([sellerPotato.ix, ix])
  })
 }, [config, publicKey, transact, programId, ata, sendIx])
 return { orders, myOrders, legacyOrders, stats, loading, actionLoading, error, createOrder, fillOrder, cancelOrder, reload: loadOrders }
}
