/**
 * Metaplex Core для NFT полей
 * ───────────────────────────
 * Зачем вместо Token Metadata (MPL) использовать Core:
 * - Core: 1 аккаунт = NFT (вместо 4: mint+token+metadata+masterEdition) → -75% rent.
 *   Поле как Core Asset: ~0.005 SOL вместо ~0.02 SOL (×4 дешевле).
 * - Нет token account, нет edition — меньше CPI.
 * - Нативные плагины: Royalties, Freeze, TransferDelegate, BurnDelegate.
 * - Collection как Core Collection (1 PDA на всю игру).
 *
 * Когда использовать:
 * - cNFT (Bubblegum) — массовые поля (1000+), ultra-cheap, через Merkle tree.
 * - Core — премиум поля (legendary), нужен on-chain owner, плагины, staking.
 *   Идеально для редких полей с плагином Freeze (заморозка при аренде).
 *
 * Стоимость: Core Collection ~0.005 SOL, Core Asset ~0.002 SOL.
 *
 * Docs: https://developers.metaplex.com/core
 */
import { PublicKey, TransactionInstruction } from '@solana/web3.js'

export const MPL_CORE_PROGRAM_ID = new PublicKey('CoREENxT6tWLL37r42jwFW6dvSzpzy1gZb98F1QYn7R')

/** PDA Core Collection для ARES-1: [b"collection", authority] */
export function coreCollectionPda(authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('collection'), authority.toBuffer()],
    MPL_CORE_PROGRAM_ID,
  )[0]
}

/** PDA Core Asset для поля: [b"asset", collection, fieldId] */
export function coreAssetPda(collection: PublicKey, fieldId: number): PublicKey {
  const idBuf = Buffer.alloc(8)
  idBuf.writeBigUInt64LE(BigInt(fieldId), 0)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('asset'), collection.toBuffer(), idBuf],
    MPL_CORE_PROGRAM_ID,
  )[0]
}

export interface CoreAssetArgs {
  name: string
  uri: string
  plugins?: CorePlugin[]
}

export interface CorePlugin {
  type: 'Royalties' | 'FreezeDelegate' | 'TransferDelegate' | 'BurnDelegate' | 'Attributes'
  data?: unknown
}

/**
 * Инструкция create (Core Asset).
 * Реально сериализуется borsh'ем mpl-core, здесь упрощённый encode для примера.
 */
export function buildCoreCreateIx(params: {
  asset: PublicKey
  collection: PublicKey
  authority: PublicKey
  payer: PublicKey
  owner: PublicKey
  args: CoreAssetArgs
}): TransactionInstruction {
  // discriminator Create = 0
  const nameBuf = Buffer.from(params.args.name, 'utf8')
  const uriBuf = Buffer.from(params.args.uri, 'utf8')
  const data = Buffer.alloc(6 + nameBuf.length + uriBuf.length)
  data.writeUInt8(0, 0) // Create
  data.writeUInt16LE(nameBuf.length, 1)
  nameBuf.copy(data, 3)
  data.writeUInt16LE(uriBuf.length, 3 + nameBuf.length)
  uriBuf.copy(data, 5 + nameBuf.length)
  // plugins добавляются отдельным AddPlugin CPI

  return new TransactionInstruction({
    programId: MPL_CORE_PROGRAM_ID,
    keys: [
      { pubkey: params.asset, isSigner: false, isWritable: true },
      { pubkey: params.collection, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.owner, isSigner: false, isWritable: false },
      { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // system
    ],
    data,
  })
}

/**
 * Плагин Attributes для on-chain характеристик поля.
 * Пример: level=3, fertility=80, water=60 — читается без off-chain индекса.
 */
export function attributesPlugin(attrs: Record<string, string | number>): CorePlugin {
  return {
    type: 'Attributes',
    data: {
      attributeList: Object.entries(attrs).map(([trait_type, value]) => ({
        trait_type,
        value: String(value),
      })),
    },
  }
}

/**
 * Оценка экономии Core vs Token Metadata для N полей.
 */
export function estimateCoreSavings(count: number): { legacy: number; core: number; ratio: number } {
  const legacy = count * 0.02
  const core = 0.005 + count * 0.002
  return { legacy, core, ratio: legacy / core }
}
