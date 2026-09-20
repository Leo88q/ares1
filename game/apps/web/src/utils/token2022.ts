/**
 * Token-2022 для ARES-1 (POTATO + SKR)
 * ───────────────────────────────────
 * Зачем мигрировать с SPL Token на Token-2022:
 * - Transfer Hook: налог/royalty на каждый transfer POTATO без изменения клиента.
 *   Нужен для экономики: 0.5% burn на каждую торговлю POTATO на DEX.
 * - Metadata Pointer: метаданные POTATO on-chain (logo, decimals) без Metaplex.
 * - Interest-Bearing / Non-Transferable: можно сделать soulbound SKR-пропуск.
 * - Group/Member: коллекция SKR-Pass как Token Group.
 *
 * Миграция: SPL Token → Token-2022 — breaking, требует нового mint.
 * План: POTATO остаётся SPL на devnet, Token-2022 на mainnet с теми же 6 decimals.
 *
 * Стоимость: создание Token-2022 mint ~0.002 SOL (против 0.0014 SPL).
 * Выгода: hook = автоматический налог, экономия на off-chain индексаторе.
 *
 * Docs: https://spl.solana.com/token-2022
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'

// ── Константы Token-2022 ──
export const POTATO_DECIMALS = 6
export const POTATO_NAME = 'Potato'
export const POTATO_SYMBOL = 'POTATO'
export const POTATO_URI = 'https://arweave.net/potato-metadata.json'

export const SKR_DECIMALS = 6
export const SKR_NAME = 'SKR Token'
export const SKR_SYMBOL = 'SKR'

// ── Transfer Hook ──
/** PDA hook-программы: логика налога живёт в отдельной программе */
export function transferHookPda(mint: PublicKey, hookProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('transfer-hook'), mint.toBuffer()],
    hookProgramId,
  )[0]
}

/**
 * Создаёт инструкцию initialize_mint2 с расширениями Token-2022.
 * Расширения: TransferHook + MetadataPointer + GroupPointer
 * Вызывать при деплое mainnet mint'ов.
 */
export function buildToken2022MintIx(params: {
  mint: PublicKey
  mintAuthority: PublicKey
  decimals: number
  hookProgramId?: PublicKey
}): TransactionInstruction {
  // Token-2022 InitializeMint2 = 20, ручной encode
  const data = Buffer.alloc(36)
  data.writeUInt8(20, 0) // InitializeMint2
  data.writeUInt8(params.decimals, 1)
  params.mintAuthority.toBuffer().copy(data, 2)
  data.writeUInt8(0, 34) // freezeAuthority None
  // Расширения добавляются отдельными InitializeTransferHook / InitializeMetadataPointer
  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: params.mint, isSigner: false, isWritable: true },
    ],
    data,
  })
}

/**
 * Хелпер: определяет, Token-2022 ли mint (по owner программы).
 */
export function isToken2022Mint(owner: PublicKey): boolean {
  return owner.equals(TOKEN_2022_PROGRAM_ID)
}

export function isSplTokenMint(owner: PublicKey): boolean {
  return owner.equals(TOKEN_PROGRAM_ID)
}

/**
 * ATA для Token-2022 использует тот же ASSOCIATED_TOKEN_PROGRAM_ID,
 * но с TOKEN_2022_PROGRAM_ID как tokenProgram.
 */
export function ataFor2022(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0]
}

/** Оценочная rent для Token-2022 mint с 3 расширениями */
export const TOKEN2022_RENT_EXAMPLE = {
  baseMint: 0.00144,
  transferHookExtension: 0.0002,
  metadataPointerExtension: 0.0004,
  groupExtension: 0.00015,
  totalApprox: 0.0022,
}
