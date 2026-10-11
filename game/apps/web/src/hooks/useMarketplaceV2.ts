import { useCallback, useEffect, useMemo, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { createAssociatedTokenAccountInstruction, getAccount, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { useSolana } from '../contexts/SolanaContext'
import { useToast } from '../components/Toast'
import { t } from '../i18n'
import {
  decodeMarketOrderV2,
  decodeMarketStatsV2,
  decodeSellerVolumeV2,
  MARKET_ORDER_V2_ACCOUNT_SIZE,
  ixCreateSellOrderV2,
  ixFillOrderV2,
  ixFillOrderV2Skr,
  ixCancelOrderV2,
  ixCloseExpiredOrderV2,
  pdas,
  type MarketQuoteAsset,
} from '../utils/anchorClient'
import { calculateSettlementFee, MIN_SETTLEMENT_GROSS_QUOTE_ATOMS } from '../utils/marketFeePolicy'
import { formatFixedPointUnitsExact } from '../utils/marketUnits'
import { describeError } from '../utils/errors'
import { randomU64, withRetry } from '../utils/rpc'
import { usePolling } from './usePolling'

const MIN_ORDER_MICRO = 10_000_000n
const ORDER_POLL_MS = 20_000
const ATA_AND_TX_RENT_BUFFER_LAMPORTS = 10_000_000n

export interface MarketOrderV2View {
  publicKey: PublicKey
  seller: PublicKey
  amountMicro: bigint
  priceQuoteAtomsPerPotato: bigint
  quoteAsset: MarketQuoteAsset
  grossQuoteAtoms: bigint
  feeQuoteAtoms: bigint
  feeRatesBps: readonly bigint[]
  sellerNetQuoteAtoms: bigint
  sellerVolumeBeforeMicro: bigint
  status: 'active' | 'expired'
  createdAt: number
  expiresAt: number
  isOwn: boolean
}

export interface MarketStatsV2View {
  totalPotatoVolumeMicro: bigint
  totalSolVolumeLamports: bigint
  totalSkrVolumeAtoms: bigint
  totalTrades: bigint
}

const EMPTY_STATS: MarketStatsV2View = {
  totalPotatoVolumeMicro: 0n,
  totalSolVolumeLamports: 0n,
  totalSkrVolumeAtoms: 0n,
  totalTrades: 0n,
}

function splitIntoChunks<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export function useMarketplaceV2() {
  const { connection, programId, publicKey, ready, config, rpcError, sendIx, refreshConfig } = useSolana()
  const { show } = useToast()
  const [orders, setOrders] = useState<MarketOrderV2View[]>([])
  const [stats, setStats] = useState<MarketStatsV2View>(EMPTY_STATS)
  const [myVolumeMicro, setMyVolumeMicro] = useState(0n)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skrMintReady, setSkrMintReady] = useState(false)
  const skrMintAddress = config?.skrMint.toBase58() ?? ''

  useEffect(() => {
    let current = true
    setSkrMintReady(false)
    if (!skrMintAddress || skrMintAddress === '11111111111111111111111111111111') return () => { current = false }
    void getMint(connection, new PublicKey(skrMintAddress), 'confirmed', TOKEN_PROGRAM_ID)
      .then(mint => { if (current) setSkrMintReady(mint.decimals === 6) })
      .catch(() => { if (current) setSkrMintReady(false) })
    return () => { current = false }
  }, [connection, skrMintAddress])

  useEffect(() => {
    if (!ready && rpcError) {
      setError(rpcError)
      setLoading(false)
    }
  }, [ready, rpcError])

  const loadOrders = useCallback(async () => {
    if (!ready || !config) {
      setLoading(false)
      if (rpcError) setError(rpcError)
      return
    }
    try {
      const addresses = pdas(programId)
      const [accounts, statsInfo, slot] = await Promise.all([
        withRetry(() => connection.getProgramAccounts(programId, {
          filters: [{ dataSize: MARKET_ORDER_V2_ACCOUNT_SIZE }],
        })),
        withRetry(() => connection.getAccountInfo(addresses.marketStatsV2())),
        withRetry(() => connection.getSlot('confirmed')),
      ])
      const blockTime = await withRetry(() => connection.getBlockTime(slot))
      const now = blockTime ?? Math.floor(Date.now() / 1000)
      const parsed = accounts.map(({ pubkey, account }) => ({ publicKey: pubkey, decoded: decodeMarketOrderV2(account.data as Buffer) }))
      const sellerKeys = [...new Map(parsed.map(({ decoded }) => [decoded.seller.toBase58(), decoded.seller])).values()]
      if (publicKey && !sellerKeys.some(seller => seller.equals(publicKey))) sellerKeys.push(publicKey)
      const volumeInfos = (await Promise.all(splitIntoChunks(sellerKeys, 100).map(chunk =>
        withRetry(() => connection.getMultipleAccountsInfo(chunk, 'confirmed')),
      ))).flat()
      const volumeBySeller = new Map<string, bigint>()
      for (const [i, seller] of sellerKeys.entries()) {
        const info = volumeInfos[i]
        if (!info) {
          volumeBySeller.set(seller.toBase58(), 0n)
          continue
        }
        if (!info.owner.equals(programId)) throw new Error('Seller-volume PDA has the wrong owner')
        const volume = decodeSellerVolumeV2(info.data as Buffer)
        if (!volume.seller.equals(seller)) throw new Error('Seller-volume PDA does not match the order seller')
        const currentDay = BigInt(Math.floor(now / 86_400))
        volumeBySeller.set(seller.toBase58(), volume.dayIndex === currentDay ? volume.filledPotatoMicro : 0n)
      }

      const mapped: MarketOrderV2View[] = parsed.flatMap(({ publicKey: orderAddress, decoded }) => {
        if (decoded.feePolicyVersion !== 1) throw new Error('Unsupported marketplace fee policy version')
        const expiresAt = Number(decoded.expiresAt)
        if (decoded.status !== 'active') return []
        const sellerVolumeBeforeMicro = volumeBySeller.get(decoded.seller.toBase58()) ?? 0n
        const quote = calculateSettlementFee({
          amountMicro: decoded.amountMicro,
          priceQuoteAtomsPerPotato: decoded.priceQuoteAtomsPerPotato,
          sellerVolumeBeforeMicro,
        })
        return [{
          publicKey: orderAddress,
          seller: decoded.seller,
          amountMicro: decoded.amountMicro,
          priceQuoteAtomsPerPotato: decoded.priceQuoteAtomsPerPotato,
          quoteAsset: decoded.quoteAsset,
          grossQuoteAtoms: quote.grossQuoteAtoms,
          feeQuoteAtoms: quote.feeQuoteAtoms,
          feeRatesBps: [...new Set(quote.segments.map(segment => segment.feeBps))],
          sellerNetQuoteAtoms: quote.sellerNetQuoteAtoms,
          sellerVolumeBeforeMicro,
          status: now >= expiresAt ? 'expired' as const : 'active' as const,
          createdAt: Number(decoded.createdAt),
          expiresAt,
          isOwn: publicKey ? decoded.seller.equals(publicKey) : false,
        }]
      })
      setOrders(mapped.sort((a, b) => {
        if (a.quoteAsset !== b.quoteAsset) return a.quoteAsset === 'sol' ? -1 : 1
        if (a.priceQuoteAtomsPerPotato < b.priceQuoteAtomsPerPotato) return -1
        if (a.priceQuoteAtomsPerPotato > b.priceQuoteAtomsPerPotato) return 1
        return a.publicKey.toBase58().localeCompare(b.publicKey.toBase58())
      }))
      if (statsInfo) {
        if (!statsInfo.owner.equals(programId)) throw new Error('V2 market stats PDA has the wrong owner')
        setStats(decodeMarketStatsV2(statsInfo.data as Buffer))
      } else {
        setStats(EMPTY_STATS)
      }
      if (publicKey) setMyVolumeMicro(volumeBySeller.get(publicKey.toBase58()) ?? 0n)
      else setMyVolumeMicro(0n)
      setError(null)
    } catch (err) {
      setError(describeError(err))
      throw err
    } finally {
      setLoading(false)
    }
  }, [ready, config, rpcError, connection, programId, publicKey])

  usePolling(loadOrders, ORDER_POLL_MS, ready && !!config)
  const myOrders = useMemo(() => orders.filter(order => order.isOwn), [orders])

  const notifyError = useCallback(
    (title: string, err: unknown) => show({ type: 'error', title, message: describeError(err) }),
    [show],
  )

  const ensureAtaIx = useCallback(async (owner: PublicKey, mint: PublicKey) => {
    const ata = getAssociatedTokenAddressSync(mint, owner, false)
    const info = await withRetry(() => connection.getAccountInfo(ata))
    if (info || !publicKey) return { address: ata, ixs: [] }
    return { address: ata, ixs: [createAssociatedTokenAccountInstruction(publicKey, ata, owner, mint)] }
  }, [connection, publicKey])

  const createOrder = useCallback(async (
    amountMicro: bigint,
    priceQuoteAtomsPerPotato: bigint,
    quoteAsset: MarketQuoteAsset,
  ): Promise<boolean> => {
    if (!publicKey) { show({ type: 'warning', title: t('Кошелёк не подключён.') }); return false }
    if (!config) { show({ type: 'warning', title: t('Сеть ещё загружает конфигурацию рынка.') }); return false }
    setActionLoading('create')
    try {
      if (quoteAsset === 'skr' && !skrMintReady) throw new Error(t('Mint SKR не настроен или имеет неверное число знаков в этой сети.'))
      if (amountMicro < MIN_ORDER_MICRO) throw new Error(t('Минимум 10 POTATO.'))
      if (priceQuoteAtomsPerPotato <= 0n) throw new Error(t('Цена должна быть положительной.'))
      const quote = calculateSettlementFee({
        amountMicro,
        priceQuoteAtomsPerPotato,
        sellerVolumeBeforeMicro: myVolumeMicro,
      })
      if (quote.grossQuoteAtoms < MIN_SETTLEMENT_GROSS_QUOTE_ATOMS) throw new Error('Gross quote is below the market minimum')

      const orderId = randomU64()
      const p = pdas(programId)
      const order = p.orderV2(orderId)
      const { address: sellerPotato, ixs } = await ensureAtaIx(publicKey, config.potatoMint)
      const ix = await ixCreateSellOrderV2(programId, {
        seller: publicKey,
        sellerProfile: p.sellerProfile(publicKey),
        sellerVolumeV2: p.sellerVolumeV2(publicKey),
        marketStatsV2: p.marketStatsV2(),
        order,
        sellerPotato,
        escrow: p.escrowV2(order),
        potatoMint: config.potatoMint,
        config: p.config(),
        orderId,
        amountMicro,
        priceQuoteAtomsPerPotato,
        quoteAsset,
      })
      await sendIx([...ixs, ix])
      show({ type: 'success', title: t('Ордер V2 опубликован'), message: t('Комиссия удерживается только при успешной сделке.') })
      await loadOrders()
      return true
    } catch (err) {
      notifyError(t('Не удалось создать V2-ордер'), err)
      return false
    } finally {
      setActionLoading(null)
    }
  }, [config, publicKey, programId, myVolumeMicro, skrMintReady, ensureAtaIx, sendIx, show, loadOrders, notifyError])

  const fillOrder = useCallback(async (order: MarketOrderV2View): Promise<boolean> => {
    if (!publicKey) { show({ type: 'warning', title: t('Кошелёк не подключён.') }); return false }
    if (!config) { show({ type: 'warning', title: t('Сеть ещё загружает конфигурацию рынка.') }); return false }
    setActionLoading(order.publicKey.toBase58())
    try {
      const p = pdas(programId)
      const [volumeInfo, slot] = await Promise.all([
        withRetry(() => connection.getAccountInfo(p.sellerVolumeV2(order.seller))),
        withRetry(() => connection.getSlot('confirmed')),
      ])
      const blockTime = await withRetry(() => connection.getBlockTime(slot))
      const now = blockTime ?? Math.floor(Date.now() / 1000)
      let currentVolume = 0n
      if (volumeInfo) {
        if (!volumeInfo.owner.equals(programId)) throw new Error('Seller-volume PDA has the wrong owner')
        const volume = decodeSellerVolumeV2(volumeInfo.data as Buffer)
        if (!volume.seller.equals(order.seller)) throw new Error('Seller-volume PDA does not match the order seller')
        if (volume.dayIndex === BigInt(Math.floor(now / 86_400))) currentVolume = volume.filledPotatoMicro
      }
      const settlement = calculateSettlementFee({
        amountMicro: order.amountMicro,
        priceQuoteAtomsPerPotato: order.priceQuoteAtomsPerPotato,
        sellerVolumeBeforeMicro: currentVolume,
      })
      const { address: buyerPotato, ixs: potatoAtaIxs } = await ensureAtaIx(publicKey, config.potatoMint)

      if (order.quoteAsset === 'sol') {
        const solBalance = BigInt(await withRetry(() => connection.getBalance(publicKey)))
        if (solBalance < settlement.grossQuoteAtoms + ATA_AND_TX_RENT_BUFFER_LAMPORTS) {
          throw new Error(t('Недостаточно SOL для валовой оплаты, сетевой комиссии и аренды ATA.'))
        }
        const ix = await ixFillOrderV2(programId, {
          buyer: publicKey,
          seller: order.seller,
          config: p.config(),
          potatoMint: config.potatoMint,
          sellerVolumeV2: p.sellerVolumeV2(order.seller),
          marketStatsV2: p.marketStatsV2(),
          order: order.publicKey,
          escrow: p.escrowV2(order.publicKey),
          buyerPotato,
          treasurySol: p.treasurySol(),
        })
        await sendIx([...potatoAtaIxs, ix])
      } else {
        if (!skrMintReady) throw new Error(t('Mint SKR не настроен или имеет неверное число знаков в этой сети.'))
        const buyerSkrAta = getAssociatedTokenAddressSync(config.skrMint, publicKey, false)
        const buyerSkrInfo = await withRetry(() => connection.getAccountInfo(buyerSkrAta))
        if (!buyerSkrInfo) throw new Error(t('Создай и пополни ATA SKR перед покупкой.'))
        const buyerSkrBalance = (await getAccount(connection, buyerSkrAta)).amount
        if (buyerSkrBalance < settlement.grossQuoteAtoms) throw new Error(t('Недостаточно SKR для валовой оплаты.'))
        const solBalance = BigInt(await withRetry(() => connection.getBalance(publicKey)))
        if (solBalance < ATA_AND_TX_RENT_BUFFER_LAMPORTS) throw new Error(t('Недостаточно SOL для сетевых комиссий и аренды ATA.'))
        const sellerSkrAta = getAssociatedTokenAddressSync(config.skrMint, order.seller, true)
        const treasurySkrAta = getAssociatedTokenAddressSync(config.skrMint, p.treasurySol(), true)
        const ix = await ixFillOrderV2Skr(programId, {
          buyer: publicKey,
          seller: order.seller,
          config: p.config(),
          potatoMint: config.potatoMint,
          skrMint: config.skrMint,
          sellerVolumeV2: p.sellerVolumeV2(order.seller),
          marketStatsV2: p.marketStatsV2(),
          order: order.publicKey,
          escrow: p.escrowV2(order.publicKey),
          buyerPotato,
          buyerSkrAta,
          sellerSkrAta,
          treasurySol: p.treasurySol(),
          treasurySkrAta,
        })
        await sendIx([...potatoAtaIxs, ix])
      }

      show({
        type: 'success',
        title: t('Покупка V2 выполнена'),
        message: t('+{amount} POTATO; комиссия в казну: {fee} {asset}', {
          amount: formatFixedPointUnitsExact(order.amountMicro, 6),
          fee: formatFixedPointUnitsExact(settlement.feeQuoteAtoms, order.quoteAsset === 'sol' ? 9 : 6),
          asset: order.quoteAsset.toUpperCase(),
        }),
      })
      await Promise.all([loadOrders(), refreshConfig()])
      return true
    } catch (err) {
      notifyError(t('Не удалось исполнить V2-ордер'), err)
      return false
    } finally {
      setActionLoading(null)
    }
  }, [config, publicKey, programId, connection, skrMintReady, ensureAtaIx, sendIx, show, loadOrders, refreshConfig, notifyError])

  const cancelOrder = useCallback(async (orderPk: PublicKey): Promise<boolean> => {
    if (!publicKey) { show({ type: 'warning', title: t('Кошелёк не подключён.') }); return false }
    if (!config) { show({ type: 'warning', title: t('Сеть ещё загружает конфигурацию рынка.') }); return false }
    setActionLoading(orderPk.toBase58())
    try {
      const p = pdas(programId)
      const { address: sellerPotato, ixs } = await ensureAtaIx(publicKey, config.potatoMint)
      const ix = await ixCancelOrderV2(programId, {
        seller: publicKey,
        sellerProfile: p.sellerProfile(publicKey),
        order: orderPk,
        escrow: p.escrowV2(orderPk),
        sellerPotato,
      })
      await sendIx([...ixs, ix])
      await loadOrders()
      show({ type: 'success', title: t('V2-ордер отменён'), message: t('POTATO возвращён; комиссия за отмену не взимается.') })
      return true
    } catch (err) {
      notifyError(t('Не удалось отменить V2-ордер'), err)
      return false
    } finally {
      setActionLoading(null)
    }
  }, [config, publicKey, programId, ensureAtaIx, sendIx, loadOrders, show, notifyError])

  const closeExpiredOrder = useCallback(async (orderPk: PublicKey, seller: PublicKey): Promise<boolean> => {
    if (!publicKey) { show({ type: 'warning', title: t('Кошелёк не подключён.') }); return false }
    if (!config) { show({ type: 'warning', title: t('Сеть ещё загружает конфигурацию рынка.') }); return false }
    setActionLoading(orderPk.toBase58())
    try {
      const { address: sellerPotato, ixs } = await ensureAtaIx(seller, config.potatoMint)
      const ix = await ixCloseExpiredOrderV2(programId, {
        order: orderPk,
        escrow: pdas(programId).escrowV2(orderPk),
        sellerPotato,
        seller,
      })
      await sendIx([...ixs, ix])
      await loadOrders()
      show({ type: 'success', title: t('Истёкший V2-ордер закрыт'), message: t('Депозит POTATO возвращён продавцу без комиссии.') })
      return true
    } catch (err) {
      notifyError(t('Не удалось закрыть истёкший V2-ордер'), err)
      return false
    } finally {
      setActionLoading(null)
    }
  }, [config, publicKey, programId, ensureAtaIx, sendIx, loadOrders, show, notifyError])

  const reload = useCallback(async () => {
    if (config) {
      await loadOrders()
      return
    }
    setLoading(true)
    setError(null)
    try {
      await refreshConfig()
    } catch (err) {
      setError(describeError(err))
      setLoading(false)
    }
  }, [config, loadOrders, refreshConfig])

  return {
    orders,
    myOrders,
    stats,
    myVolumeMicro,
    skrMintReady,
    loading,
    actionLoading,
    error,
    createOrder,
    fillOrder,
    cancelOrder,
    closeExpiredOrder,
    reload,
  }
}
