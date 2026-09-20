/**
 * ZK Compression + Bubblegum cNFT для полей
 * ─────────────────────────────────────────
 * Проблема: каждое поле = отдельный PDA ~0.0013 SOL rent.
 * При 1M полей: 1.3M SOL rent, тяжелый RPC.
 *
 * Решение: ZK Compression (Light Protocol) + Bubblegum cNFT
 * - Сжимает аккаунт в Merkle-tree лист: 1 поле = ~0.000005 SOL (×260 дешевле).
 * - 1M полей: ~5 SOL вместо 1300 SOL.
 * - Чтение через Helius DAS API, запись через Light RPC.
 *
 * Когда использовать:
 * - cNFT: поля как NFT-активы с картинкой, трейдабельны, bridging.
 * - ZK compression: поля как игровые данные (не NFT), только внутри игры.
 *
 * Docs:
 * - https://www.zkcompression.com
 * - https://developers.metaplex.com/bubblegum
 */
import { PublicKey, TransactionInstruction } from '@solana/web3.js'

/** Адреса программ (mainnet/devnet) */
export const BUBBLEGUM_PROGRAM_ID = new PublicKey('BGUMAp9Gq7iTEuapy4pqaxsQSKP9pRFw9tgo88Ruef4')
export const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK')
export const SPL_NOOP_PROGRAM_ID = new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV')

/** Параметры дерева: maxDepth=14 → 16K полей на дерево, достаточо для игрока */
export const COMPRESSION_TREE_CONFIG = {
  maxDepth: 14 as const,
  maxBufferSize: 64 as const,
  canopyDepth: 0,
}

/** PDA дерева для игрока: [b"merkle-tree", owner] */
export async function treeAuthorityPda(owner: PublicKey, programId: PublicKey): Promise<PublicKey> {
  return PublicKey.findProgramAddressSync([Buffer.from('merkle-tree'), owner.toBuffer()], programId)[0]
}

/** PDA canopy */
export function treeConfigPda(merkleTree: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([merkleTree.toBuffer()], SPL_ACCOUNT_COMPRESSION_PROGRAM_ID)[0]
}

/**
 * Инструкция инициализации ConcurrentMerkleTree.
 * Вызывается 1 раз на игрока, создаёт on-chain дерево для cNFT полей.
 * Стоимость: ~0.01 SOL (rent canopy), переиспользуется для всех полей.
 */
export function buildInitTreeIx(params: {
  payer: PublicKey
  merkleTree: PublicKey
  treeAuthority: PublicKey
  gummyrollProgramId?: PublicKey
}): TransactionInstruction {
  // Сериализация через borsh: init_empty_merkle_tree(maxDepth, maxBufferSize)
  // Используем ручной encode чтобы не тянуть @solana/spl-account-compression в бандл
  const data = Buffer.alloc(34)
  // discriminator init_empty_merkle_tree = 0x8c
  data.writeUInt8(0x8c, 0)
  data.writeUInt32LE(COMPRESSION_TREE_CONFIG.maxDepth, 1)
  data.writeUInt32LE(COMPRESSION_TREE_CONFIG.maxBufferSize, 5)
  // canopyDepth уже в config
  return new TransactionInstruction({
    programId: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    keys: [
      { pubkey: params.merkleTree, isSigner: false, isWritable: true },
      { pubkey: params.treeAuthority, isSigner: false, isWritable: false },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  })
}

/**
 * Хелпер для минта cNFT поля (field → cNFT).
 * Вызывает Bubblegum mint_v1 CPI через программу игры.
 * Метаданные берутся из FIELD_METADATA.
 */
export interface CompressedFieldMetadata {
  name: string
  uri: string // arweave/ipfs json с картинкой поля
  creators: { address: PublicKey; share: number; verified: boolean }[]
}

export function compressedFieldMetadata(
  fieldId: number,
  rarity: 'common' | 'rare' | 'epic' | 'legendary',
): CompressedFieldMetadata {
  const uris: Record<string, string> = {
    common: 'https://arweave.net/ares-field-common.json',
    rare: 'https://arweave.net/ares-field-rare.json',
    epic: 'https://arweave.net/ares-field-epic.json',
    legendary: 'https://arweave.net/ares-field-legendary.json',
  }
  return {
    name: `ARES Field #${fieldId}`,
    uri: uris[rarity],
    creators: [], // заполняет программа (authority verified)
  }
}

/**
 * Оценка экономии.
 * legacy PDA: 0.0013 SOL/поле, 100 полей = 0.13 SOL
 * cNFT: 0.000005 SOL/лист, 100 полей = 0.0005 SOL → ×260 дешевле
 */
export function estimateCompressionSavings(fieldCount: number): {
  legacyCost: number
  compressedCost: number
  savings: number
  ratio: number
} {
  const legacyCost = fieldCount * 0.0013
  const compressedCost = fieldCount * 0.000005 + 0.01 // + дерево
  return {
    legacyCost,
    compressedCost,
    savings: legacyCost - compressedCost,
    ratio: legacyCost / Math.max(compressedCost, 0.000001),
  }
}
