import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, type AccountMeta } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { concatBytes, ixDiscriminator, u64LE, u8 } from './anchorClient'

export const SKR_ATOMS = 1_000_000
export interface SkrPricing { skrMint: PublicKey; prices: bigint[]; marketMinAtoms: bigint }
export const skrPdas = (program: PublicKey) => {
 const derive = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program)[0]
 return {
  pricing: (mint: PublicKey) => derive(Buffer.from('skr_pricing'), mint.toBuffer()),
  order: (id: bigint) => derive(Buffer.from('skr_order'), Buffer.from(u64LE(id))),
  escrow: (order: PublicKey) => derive(Buffer.from('skr_escrow'), order.toBuffer()),
  stats: (mint: PublicKey) => derive(Buffer.from('skr_market_stats'), mint.toBuffer()),
  treasury: () => derive(Buffer.from('treasury_sol')),
 }
}
// Stable v2 account layouts. Discriminators are Anchor's sha256("account:<Name>")[:8].
const DISCRIMINATORS: Record<string, string> = {"SkrPricing": "61e6abeac0820096", "SkrOrder": "8038624a305f121d", "SkrMarketStats": "c5d1d39aacd3fc51"}
export function verifySkrAccount(data: Buffer, type: string, size: number): void {
 if (data.length !== size || data.subarray(0, 8).toString('hex') !== DISCRIMINATORS[type]) throw new Error(`Invalid ${type} account`)
}
export function decodeSkrPricing(data: Buffer): SkrPricing {
 verifySkrAccount(data, 'SkrPricing', 97)
 return { skrMint: new PublicKey(data.subarray(8, 40)), prices: Array.from({ length: 6 }, (_, i) => data.readBigUInt64LE(40 + i * 8)), marketMinAtoms: data.readBigUInt64LE(88) }
}
export function decodeSkrOrder(data: Buffer) {
 verifySkrAccount(data, 'SkrOrder', 140)
 return { seller: new PublicKey(data.subarray(8, 40)), potatoMint: new PublicKey(data.subarray(40, 72)), skrMint: new PublicKey(data.subarray(72, 104)),
  amountMicro: data.readBigUInt64LE(104), priceSkrAtoms: data.readBigUInt64LE(112), feeBps: data.readUInt16LE(120), createdAt: data.readBigInt64LE(122), expiresAt: data.readBigInt64LE(130) }
}
export function decodeSkrStats(data: Buffer) {
 verifySkrAccount(data, 'SkrMarketStats', 73)
 return { skrMint: new PublicKey(data.subarray(8, 40)), volume24hMicro: data.readBigUInt64LE(40), totalSkrAtoms: data.readBigUInt64LE(48), totalTrades: data.readBigUInt64LE(56), lastUpdate: data.readBigInt64LE(64) }
}
export function skrCost(pricing: SkrPricing | null, action: number, fieldType = 1, level = 1): bigint | null {
 if (!pricing || !Number.isInteger(action) || action < 0 || action > 5 || ![0, 1, 2].includes(fieldType) || !Number.isInteger(level) || level < 1 || level > 50) return null
 const base = pricing.prices[action]; if (!base) return null
 const typeBps = action === 5 ? 10_000n : [4_000n, 10_000n, 20_000n][fieldType]
 const levelMultiplier = action === 1 ? Math.max(1, Math.floor(level / 3)) : action === 2 ? level : action === 3 ? Math.max(1, Math.floor((level + 1) / 2)) : 1
 const cost = base * typeBps * BigInt(levelMultiplier) / 10_000n
 return cost > 0n && cost <= 0xffffffffffffffffn ? cost : null
}
export const formatSkrCost = (atoms: bigint | null) => atoms === null ? '—' : `${atoms / 1_000_000n}${atoms % 1_000_000n ? '.' + (atoms % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '') : ''}`
function checkedU64(value: bigint) { if (value < 0n || value > 0xffffffffffffffffn) throw new Error('SKR amount out of u64 range'); return u64LE(value) }
const key = (pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isWritable, isSigner })
async function instruction(programId: PublicKey, name: string, keys: AccountMeta[], ...args: Uint8Array[]) {
 return new TransactionInstruction({ programId, keys, data: concatBytes(await ixDiscriminator(name), ...args) })
}
export interface SkrPaymentAccounts { config: PublicKey; pricing: PublicKey; skrMint: PublicKey; userSkr: PublicKey; treasury: PublicKey; treasurySkr: PublicKey; owner: PublicKey }
const paymentKeys = (p: SkrPaymentAccounts) => [key(p.config, true), key(p.pricing), key(p.skrMint), key(p.userSkr, true), key(p.treasury), key(p.treasurySkr, true), key(p.owner, true, true), key(TOKEN_PROGRAM_ID), key(SystemProgram.programId)]
export const ixCreateFieldSkr = (program: PublicKey, p: SkrPaymentAccounts & { field: PublicKey; fieldId: bigint; fieldType: number; maxSkrAtoms: bigint }) => instruction(program, 'create_field_skr', [...paymentKeys(p), key(p.field, true)], checkedU64(p.fieldId), u8(p.fieldType), checkedU64(p.maxSkrAtoms))
export const ixServiceFieldSkr = (program: PublicKey, p: SkrPaymentAccounts & { field: PublicKey; action: number; maxSkrAtoms: bigint }) => instruction(program, 'service_field_skr', [...paymentKeys(p), key(p.field, true)], u8(p.action), checkedU64(p.maxSkrAtoms))
export const ixRegisterReferrerSkr = (program: PublicKey, p: SkrPaymentAccounts & { referral: PublicKey; referrer: PublicKey; maxSkrAtoms: bigint }) => instruction(program, 'register_referrer_skr', [...paymentKeys(p), key(p.referral, true)], p.referrer.toBytes(), checkedU64(p.maxSkrAtoms))
export const ixCreateSkrOrder = (program: PublicKey, p: { seller: PublicKey; config: PublicKey; pricing: PublicKey; skrMint: PublicKey; sellerProfile: PublicKey; order: PublicKey; marketStats: PublicKey; sellerPotato: PublicKey; escrow: PublicKey; potatoMint: PublicKey; orderId: bigint; amountMicro: bigint; priceSkrAtoms: bigint }) => instruction(program, 'create_skr_order', [key(p.seller, true, true), key(p.config), key(p.pricing), key(p.skrMint), key(p.sellerProfile, true), key(p.order, true), key(p.marketStats, true), key(p.sellerPotato, true), key(p.escrow, true), key(p.potatoMint), key(TOKEN_PROGRAM_ID), key(SystemProgram.programId), key(SYSVAR_RENT_PUBKEY)], checkedU64(p.orderId), checkedU64(p.amountMicro), checkedU64(p.priceSkrAtoms))
export const ixFillSkrOrder = (program: PublicKey, p: { buyer: PublicKey; seller: PublicKey; config: PublicKey; potatoMint: PublicKey; skrMint: PublicKey; marketStats: PublicKey; order: PublicKey; escrow: PublicKey; buyerPotato: PublicKey; sellerPotato: PublicKey; buyerSkr: PublicKey; sellerSkr: PublicKey; treasury: PublicKey; treasurySkr: PublicKey; maxSkrAtoms: bigint; remaining?: AccountMeta[] }) => instruction(program, 'fill_skr_order', [key(p.buyer, true, true), key(p.seller, true), key(p.config), key(p.potatoMint), key(p.skrMint), key(p.marketStats, true), key(p.order, true), key(p.escrow, true), key(p.buyerPotato, true), key(p.sellerPotato, true), key(p.buyerSkr, true), key(p.sellerSkr, true), key(p.treasury), key(p.treasurySkr, true), key(TOKEN_PROGRAM_ID), ...(p.remaining ?? [])], checkedU64(p.maxSkrAtoms))
export const ixCancelSkrOrder = (program: PublicKey, p: { seller: PublicKey; sellerProfile: PublicKey; order: PublicKey; escrow: PublicKey; sellerPotato: PublicKey }) => instruction(program, 'cancel_skr_order', [key(p.seller, true, true), key(p.sellerProfile, true), key(p.order, true), key(p.escrow, true), key(p.sellerPotato, true), key(TOKEN_PROGRAM_ID)])
export const ixCloseExpiredSkrOrder = (program: PublicKey, p: { seller: PublicKey; order: PublicKey; escrow: PublicKey; sellerPotato: PublicKey }) => instruction(program, 'close_expired_skr_order', [key(p.seller, true), key(p.order, true), key(p.escrow, true), key(p.sellerPotato, true), key(TOKEN_PROGRAM_ID)])
