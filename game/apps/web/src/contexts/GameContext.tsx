import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'

import { PublicKey, SystemProgram, TransactionInstruction, AddressLookupTableProgram } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, createAssociatedTokenAccountInstruction, createTransferInstruction, unpackAccount, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { useSolana, IS_MAINNET } from './SolanaContext'
import { useToast } from '../components/Toast'
 import {
 decodeField, pdas,
 ixCreateField, ixHarvest, ixRepairField, ixUpgradeField, ixPayTax, ixApplyFertilizer,
 ixBuyFieldSkr, ixBatchHarvest, ixCloseField, SKR_MINT, treasurySkrAta, buybackSkrAta, presaleStatePda, buyerPresalePda, treasurySolPda,
 potatoAta,
 achievementsPda, questTreasuryPda, decodeAchievementsBitmap, ixClaimAchievement, QUEST_REWARDS_MICRO,
} from '../utils/anchorClient'
import {
 accumulatedMicro, fieldPriceMicro, fertilizerCostMicro, repairCostMicro, taxCostMicro, upgradeCostMicro, fmtPotato, fmtPotatoExact, MICRO,
} from '../utils/constants'
import { describeError } from '../utils/errors'
import { randomU64, withRetry } from '../utils/rpc'

import { usePolling } from '../hooks/usePolling'

const FIELD_ACCOUNT_SIZE = 8 + 32 + 1 + 1 + 8 + 8 + 8 + 1 + 1 + 1 + 1 // 70: +mutation_type (v2)
const FIELDS_POLL_MS = 20_000

export interface Field {
 publicKey: PublicKey
 owner: PublicKey
 level: number
 durability: number
 lastHarvest: number
 taxPaidUntil: number
 fertilizerUntil: number
 isActive: boolean
 fieldType: number
 mutationType: number
 accumulated: number
}

export interface GameStats {
 totalFields: number
 pendingHarvest: number
 playerLevel: number
 experience: number
 potatoBalance: number
 skrBalance: number
}

export interface GameContextType {
 fields: Field[]
 stats: GameStats
 solBalance: number
 loading: boolean
 purchasing: boolean
 claimed: Record<string, boolean>
 harvest: (field: PublicKey) => Promise<boolean>
 batchHarvest: (fields: PublicKey[]) => Promise<boolean>
 closeField: (field: PublicKey) => Promise<boolean>
 ensureLut: () => Promise<string | null>
 purchaseField: (fieldType: number) => Promise<boolean>
 buyFieldPresale: () => Promise<number | null>
 upgradeField: (field: PublicKey) => Promise<boolean>
 repairField: (field: PublicKey) => Promise<boolean>
 payTax: (field: PublicKey) => Promise<boolean>
 applyFertilizer: (field: PublicKey) => Promise<boolean>
 claimReward: (questId: string, rewardMicro?: number) => Promise<boolean>
 airdropSol: () => Promise<boolean>
 sendPotato: (to: string, amount: number) => Promise<boolean>
 sendSol: (to: string, amount: number) => Promise<boolean>
 reload: () => Promise<void>
}

const GameContext = createContext<GameContextType | undefined>(undefined)

type RawField = Omit<Field, 'accumulated'>

export function GameProvider({ children }: { children: ReactNode }) {
 const { connection, programId, publicKey, connected, ready, config, refreshConfig, sendIx, lookupTable, ensureLookupTable } = useSolana()
 const { show } = useToast()

 const [rawFields, setRawFields] = useState<RawField[]>([])
 const [potatoBalance, setPotatoBalance] = useState(0)
 const [skrBalance, setSkrBalance] = useState(0)
 const [ataExists, setAtaExists] = useState(false)
 const [solBalance, setSolBalance] = useState(0)
 const [loading, setLoading] = useState(true)
 const [purchasing, setPurchasing] = useState(false)
 const [claimed, setClaimed] = useState<Record<string, boolean>>({})
 const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))

 useEffect(() => {
  const t = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000)
  return () => window.clearInterval(t)
 }, [])

 const notify = useCallback(
  (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => show({ type, title, message }),
  [show],
 )

 const loadFields = useCallback(async () => {
  if (!ready || !connected || !publicKey || !config) {
   setLoading(false)
   return
  }
  try {
   const ata = getAssociatedTokenAddressSync(config.potatoMint, publicKey, false)
   const skrMint = (config.skrMint as unknown as PublicKey) ?? SKR_MINT
   const skrAta = getAssociatedTokenAddressSync(skrMint, publicKey, false)
   const [accounts, infos] = await Promise.all([
    withRetry(() =>
     connection.getProgramAccounts(programId, {
      filters: [{ dataSize: FIELD_ACCOUNT_SIZE }, { memcmp: { offset: 8, bytes: publicKey.toBase58() } }],
     }),
    ),
    withRetry(() => connection.getMultipleAccountsInfo([publicKey, ata, skrAta])),
   ])
   const [walletInfo, ataInfo, skrInfo] = infos
   setSolBalance((walletInfo?.lamports ?? 0) / 1e9)
   if (ataInfo) {
    setAtaExists(true)
    setPotatoBalance(Number(unpackAccount(ata, ataInfo).amount))
   } else {
    setAtaExists(false)
    setPotatoBalance(0)
   }
   setSkrBalance(skrInfo ? Number(unpackAccount(skrAta, skrInfo).amount) / 1e6 : 0)
   setRawFields(
    accounts
     .map(({ pubkey, account }) => {
      const d = decodeField(account.data)
      return {
       publicKey: pubkey,
       owner: d.owner,
       level: d.level,
       durability: d.durability,
       lastHarvest: Number(d.lastHarvest),
       taxPaidUntil: Number(d.taxPaidUntil),
       fertilizerUntil: Number(d.fertilizerUntil),
       isActive: d.isActive,
       fieldType: d.fieldType,
       mutationType: d.mutationType ?? 0,
      }
     })
     .sort((a, b) => a.lastHarvest - b.lastHarvest),
   )
  } finally {
   setLoading(false)
  }
 }, [ready, connected, publicKey, config, connection, programId])

 usePolling(loadFields, FIELDS_POLL_MS, ready && connected && !!publicKey)

 const fields = useMemo<Field[]>(() => {
  if (!config) return []
  const cfg = { baseYieldMicroPerDay: Number(config.baseYieldMicroPerDay), globalMultiplierBps: config.globalMultiplierBps }
  const currentEpoch = Number(config.epochId)
  return rawFields.map((f) => ({
   ...f,
   accumulated: accumulatedMicro({ ...f, epochId: currentEpoch }, cfg, nowSec),
  }))
 }, [rawFields, config, nowSec])

 const stats = useMemo<GameStats>(
  () => ({
   totalFields: fields.length,
   pendingHarvest: fields.reduce((s, f) => s + f.accumulated, 0),
   playerLevel: Math.floor(fields.length / 3) + 1,
   experience: fields.length * 100 + potatoBalance / MICRO,
   potatoBalance,
   skrBalance,
  }),
  [fields, potatoBalance, skrBalance],
 )

 const refreshAll = useCallback(async () => {
  await Promise.all([loadFields(), refreshConfig()])
 }, [loadFields, refreshConfig])

 const ownAta = useCallback((): { address: PublicKey; ixs: TransactionInstruction[] } => {
  if (!publicKey || !config) throw new Error(t('Кошелёк не подключён.'))
  const address = getAssociatedTokenAddressSync(config.potatoMint, publicKey, false)
  const ixs = ataExists ? [] : [createAssociatedTokenAccountInstruction(publicKey, address, publicKey, config.potatoMint)]
  return { address, ixs }
 }, [publicKey, config, ataExists])

 const requireBalance = useCallback(
  (costMicro: number): boolean => {
   if (potatoBalance >= costMicro) return true
   notify('warning', t('Недостаточно $POTATO'), t('Нужно {need} POTATO, а у тебя {have} POTATO.', { need: fmtPotatoExact(costMicro), have: fmtPotatoExact(potatoBalance) }))
   return false
  },
  [potatoBalance, notify],
 )

 const runTx = useCallback(
  async (label: string, build: () => Promise<TransactionInstruction[]>, lut?: boolean): Promise<boolean> => {
   try {
    const ixs = await build()
    if (lut && lookupTable) {
      await sendIx(ixs, { lookupTables: [lookupTable] })
    } else {
      await sendIx(ixs)
    }
    await refreshAll()
    return true
   } catch (err) {
    notify('error', label, describeError(err))
    return false
   }
  },
  [sendIx, refreshAll, notify, lookupTable],
 )

 const purchaseField = useCallback(
  async (fieldType: number) => {
   if (!config || !publicKey || !ready) {
    notify('warning', t('Игра ещё загружается'), t('Подожди пару секунд.'))
    return false
   }
   if (!requireBalance(fieldPriceMicro(fieldType))) return false
   setPurchasing(true)
   try {
    return await runTx(t('Не удалось купить поле'), async () => {
     const { address: userPotato, ixs } = ownAta()
     const fieldId = randomU64()
     const { config: configPda, field } = pdas(programId)
     const ix = await ixCreateField(programId, {
      config: configPda(), field: field(fieldId), owner: publicKey,
      potatoMint: config.potatoMint, userPotato, fieldId, fieldType,
     })
     return [...ixs, ix]
    })
   } finally {
    setPurchasing(false)
   }
  },
  [config, publicKey, ready, requireBalance, runTx, ownAta, programId, notify],
 )

 const buyFieldPresale = useCallback(
  async (): Promise<number | null> => {
   if (!config || !publicKey || !ready) {
    notify('warning', t('Игра ещё загружается'), t('Подожди пару секунд.'))
    return null
   }
   const skrMint = (config.skrMint as unknown as PublicKey) ?? SKR_MINT
   const buyerSkrAta = getAssociatedTokenAddressSync(skrMint, publicKey)
   try {
    const skrBal = await withRetry(() => connection.getTokenAccountBalance(buyerSkrAta))
    const need = 1_053_000_000n
    if (BigInt(skrBal.value.amount) < need) {
     notify('warning', t('Недостаточно SKR'), t('Нужно 1053 SKR, у тебя {have} SKR.', { have: (Number(BigInt(skrBal.value.amount)) / 1e6).toFixed(0) }))
     return null
    }
   } catch {
    notify('error', t('SKR недоступны'), t('Mint SKR не найден на этом кластере — пресейл за SKR сейчас отключён.'))
    return null
   }
   if (solBalance < 0.02) {
    notify('warning', t('Недостаточно SOL'), t('Нужно ~0.02 SOL на rent и комиссию сети.'))
    return null
   }
   setPurchasing(true)
   try {
    const fieldId = randomU64()
    const { config: configPda, field } = pdas(programId)
    const ataIx = createAssociatedTokenAccountIdempotentInstruction(publicKey, buyerSkrAta, publicKey, skrMint)
    const ix = await ixBuyFieldSkr(programId, {
     config: configPda(),
     presaleState: presaleStatePda(programId),
     authority: config.authority,
     buyerPresale: buyerPresalePda(programId, publicKey),
     field: field(fieldId),
     buyer: publicKey,
     treasurySol: treasurySolPda(programId),
     skrMint,
     buyerSkrAta,
     treasurySkrAta: treasurySkrAta(programId, skrMint),
     buybackSkrAta: buybackSkrAta(config.authority, skrMint),
     fieldId,
    })
    await sendIx([ataIx, ix])
    await refreshAll()
    try {
     const info = await withRetry(() => connection.getAccountInfo(field(fieldId)))
     if (info) {
      const tier = info.data[67]
      notify('success', t('Модуль получен'), t('On-chain дроп: {tier}', { tier: ['COMMON', 'RARE', 'EPIC'][tier] ?? 'COMMON' }))
      return tier
     }
    } catch { /* ignore */ }
    return null
   } catch (err) {
    notify('error', t('Не удалось купить растение за SKR'), describeError(err))
    return null
   } finally {
    setPurchasing(false)
   }
  },
  [config, publicKey, ready, solBalance, sendIx, refreshAll, programId, notify, connection],
 )

 const harvest = useCallback(
  async (fieldPk: PublicKey) => {
   if (!config || !publicKey) return false
   return runTx(t('Не удалось собрать урожай'), async () => {
    const { address: userPotato, ixs } = ownAta()
    const { config: configPda, epoch } = pdas(programId)
    const ix = await ixHarvest(programId, {
     config: configPda(), epoch: epoch(config.epochId), field: fieldPk,
     potatoMint: config.potatoMint, userPotato, owner: publicKey,
     treasuryPotato: potatoAta(configPda(), config.potatoMint),
    })
    return [...ixs, ix]
   })
  },
  [config, publicKey, runTx, ownAta, programId],
 )

 const batchHarvest = useCallback(
  async (fieldPks: PublicKey[]) => {
   if (!config || !publicKey || fieldPks.length === 0) return false
   if (fieldPks.length > 10) {
    notify('warning', t('Слишком много полей'), t('Максимум 10 полей за один батч.'))
    return false
   }
   // LUT: если есть cached lookupTable — шлём VersionedTransaction V0 (дешевле ~40%)
   const useLut = !!lookupTable
   return runTx(t('Не удалось собрать урожай батчем'), async () => {
    const { address: userPotato, ixs } = ownAta()
    const { config: configPda, epoch } = pdas(programId)
    const ix = await ixBatchHarvest(programId, {
     config: configPda(), epoch: epoch(config.epochId), potatoMint: config.potatoMint,
     userPotato, treasuryPotato: potatoAta(configPda(), config.potatoMint), owner: publicKey,
     fieldPks,
    })
    return [...ixs, ix]
   }, useLut)
  },
  [config, publicKey, runTx, ownAta, programId, notify, lookupTable],
 )

 const closeField = useCallback(
  async (fieldPk: PublicKey) => {
   if (!config || !publicKey) return false
   return runTx(t('Не удалось закрыть поле'), async () => {
    const { config: configPda } = pdas(programId)
    const ix = await ixCloseField(programId, { config: configPda(), field: fieldPk, owner: publicKey })
    return [ix]
   })
  },
  [config, publicKey, runTx, programId, notify],
 )

 // ── LUT management (ALT) ──
 // Solana требует: create LUT в одном блоке, extend — в следующем (после подтверждения).
 // Поэтому делаем 2 транзакции: 1) create 2) extend (+ кэш в localStorage).
 const ensureLut = useCallback(async (): Promise<string | null> => {
   if (!publicKey) return null
   const existing = await ensureLookupTable()
   if (existing) return existing.key.toBase58()
   try {
     const slot = await connection.getSlot('confirmed')
     const [createIx, lutAddress] = AddressLookupTableProgram.createLookupTable({
       authority: publicKey,
       payer: publicKey,
       recentSlot: slot,
     })
     await sendIx([createIx])
     // Дожидаемся финализации LUT перед extend (иначе AddressLookupTableNotFound)
     await new Promise(r => setTimeout(r, 800))
     localStorage.setItem(`ares-lut:${publicKey.toBase58()}`, lutAddress.toBase58())
     const fieldPks = fields.map(f => f.publicKey)
     if (fieldPks.length > 0) {
       const extendIx = AddressLookupTableProgram.extendLookupTable({
         payer: publicKey,
         authority: publicKey,
         lookupTable: lutAddress,
         addresses: fieldPks.slice(0, 20),
       })
       try { await sendIx([extendIx]) } catch (e) {
         // extend может упасть если таблица ещё не активна (256 слотов warmup) — не критично, переиспользуется позже
         console.warn('[lut] extend deferred:', describeError(e))
       }
     }
     notify('success', t('LUT создана'), lutAddress.toBase58().slice(0, 8) + '…')
     return lutAddress.toBase58()
   } catch (err) {
     notify('error', t('Не удалось создать LUT'), describeError(err))
     return null
   }
 }, [publicKey, connection, fields, ensureLookupTable, sendIx, notify])

 const fieldSpend = useCallback(
  (build: typeof ixRepairField, cost: (f: Field) => number, label: string) =>
   async (fieldPk: PublicKey): Promise<boolean> => {
    if (!config || !publicKey) return false
    const f = fields.find((x) => x.publicKey.equals(fieldPk))
    if (!f) return false
    if (!requireBalance(cost(f))) return false
    return runTx(label, async () => {
     const { address: userPotato, ixs } = ownAta()
     const { config: configPda } = pdas(programId)
     const ix = await build(programId, {
      field: fieldPk, potatoMint: config.potatoMint, userPotato, config: configPda(), owner: publicKey,
     })
     return [...ixs, ix]
    })
   },
  [config, publicKey, fields, requireBalance, runTx, ownAta, programId],
 )

 const upgradeField = useMemo(
  () => fieldSpend(ixUpgradeField, (f) => upgradeCostMicro(f.level, f.fieldType), t('Не удалось улучшить поле')),
  [fieldSpend],
 )
 const repairField = useMemo(
  () => fieldSpend(ixRepairField, (f) => repairCostMicro(f.level, f.fieldType), t('Не удалось отремонтировать поле')),
  [fieldSpend],
 )
 const payTax = useMemo(
  () => fieldSpend(ixPayTax, (f) => taxCostMicro(f.level, f.fieldType), t('Не удалось оплатить налог')),
  [fieldSpend],
 )
 const applyFertilizer = useMemo(
  () => fieldSpend(ixApplyFertilizer, (f) => fertilizerCostMicro(f.fieldType), t('Не удалось удобрить поле')),
  [fieldSpend],
 )

 const QUEST_ID_BY_ACH: Record<string, number> = { a1: 0, a2: 1, a3: 2, a4: 3, a5: 4, a6: 5 }

 const loadClaimed = useCallback(async () => {
  if (!ready || !publicKey) return
  try {
   const pda = achievementsPda(publicKey, programId)
   const info = await withRetry(() => connection.getAccountInfo(pda))
   const bitmap = info ? decodeAchievementsBitmap(info.data) : 0
   const next: Record<string, boolean> = {}
   for (const [id, qid] of Object.entries(QUEST_ID_BY_ACH)) {
    next[id] = Boolean(bitmap & (1 << qid))
   }
   setClaimed(next)
  } catch { /* ignore */ }
 }, [ready, publicKey, connection, programId])

 useEffect(() => {
  void loadClaimed()
 }, [loadClaimed, publicKey])

 const claimReward = useCallback(
  async (questId: string, _rewardMicro?: number): Promise<boolean> => {
   const qid = QUEST_ID_BY_ACH[questId]
   if (qid === undefined || !publicKey || !ready || !config) return false
   try {
    const userAta = getAssociatedTokenAddressSync(config.potatoMint, publicKey, true)
    const questTreasury = questTreasuryPda(programId)
    const questAta = getAssociatedTokenAddressSync(config.potatoMint, questTreasury, true)
    const ix = await ixClaimAchievement(
     programId,
     {
      config: pdas(programId).config(),
      achievements: achievementsPda(publicKey, programId),
      user: publicKey,
      questTreasury,
      questAta,
      userAta,
      potatoMint: config.potatoMint,
     },
     qid,
     // Программа принимает не более MAX_CLAIM_PROOFS=12 пруфов (AUDIT M-5).
     // Сортировка по уровню гарантирует, что квест «6 полей L3+» пройдёт, даже
     // если у игрока больше 12 полей: самые прокачанные всегда в первых 12.
     [...fields].sort((a, b) => b.level - a.level).slice(0, 12).map((f) => f.publicKey),
    )
    // Идемпотентная ATA-инструкция: параллельные вкладки/ретраи не роняют tx (AUDIT L-4).
    const ataIx = [createAssociatedTokenAccountIdempotentInstruction(publicKey, userAta, publicKey, config.potatoMint)]
    await sendIx([...ataIx, ix])
    const amount = QUEST_REWARDS_MICRO[qid]
    setClaimed((c) => ({ ...c, [questId]: true }))
    notify('success', t('Награда получена'), t('+{amount} POTATO (on-chain)', { amount: fmtPotato(amount, 0) }))
    await loadFields()
    return true
   } catch (err) {
    notify('error', t('Награда не выдана'), describeError(err))
    return false
   }
  },
  [publicKey, ready, config, programId, sendIx, fields, notify, loadFields],
 )

 const airdropSol = useCallback(async (): Promise<boolean> => {
  if (!publicKey || IS_MAINNET) return false
  try {
   const sig = await connection.requestAirdrop(publicKey, 1e9)
   const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
   await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight })
   await loadFields()
   return true
  } catch (err) {
   notify('error', t('Airdrop недоступен'), describeError(err))
   return false
  }
 }, [publicKey, connection, loadFields, notify])

 const sendPotato = useCallback(
  async (to: string, amount: number): Promise<boolean> => {
   if (!publicKey || !config) return false
   const amountMicro = Math.floor(amount * MICRO)
   if (amountMicro <= 0) return false
   if (!requireBalance(amountMicro)) return false
   let toPub: PublicKey
   try {
    toPub = new PublicKey(to)
   } catch {
    notify('error', t('Неверный адрес получателя'))
    return false
   }
   return runTx(t('Не удалось отправить $POTATO'), async () => {
    const { address: fromAta, ixs } = ownAta()
    const toAta = getAssociatedTokenAddressSync(config.potatoMint, toPub, true)
    const toInfo = await withRetry(() => connection.getAccountInfo(toAta))
    const createTo = toInfo ? [] : [createAssociatedTokenAccountInstruction(publicKey, toAta, toPub, config.potatoMint)]
    return [...ixs, ...createTo, createTransferInstruction(fromAta, toAta, publicKey, amountMicro)]
   })
  },
  [publicKey, config, requireBalance, runTx, ownAta, connection, notify],
 )

 const sendSol = useCallback(
  async (to: string, amount: number): Promise<boolean> => {
   if (!publicKey) return false
   let toPub: PublicKey
   try {
    toPub = new PublicKey(to)
   } catch {
    notify('error', t('Неверный адрес получателя'))
    return false
   }
   const lamports = Math.floor(amount * 1e9)
   if (lamports <= 0) return false
   return runTx(t('Не удалось отправить SOL'), async () => [
    SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: toPub, lamports }),
   ])
  },
  [publicKey, runTx, notify],
 )

 const value = useMemo<GameContextType>(
  () => ({
   fields, stats, solBalance, loading, purchasing, claimed,
   harvest, batchHarvest, closeField, ensureLut,
   purchaseField, buyFieldPresale, upgradeField, repairField, payTax, applyFertilizer,
   claimReward, airdropSol, sendPotato, sendSol, reload: loadFields,
  }),
  [fields, stats, solBalance, loading, purchasing, claimed, harvest, batchHarvest, closeField, ensureLut, purchaseField, upgradeField, repairField,
   payTax, applyFertilizer, claimReward, airdropSol, sendPotato, sendSol, loadFields],
 )

 return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame(): GameContextType {
 const ctx = useContext(GameContext)
 if (!ctx) throw new Error('useGame must be used within GameProvider')
 return ctx
}
