import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from '@solana/web3.js'
import { t } from '../i18n'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'

export const SKR_MINT = new PublicKey('Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o')
/** @deprecated — use SKR_MINT; kept for back-compat */
export const TEST_SKR_MINT = SKR_MINT

async function sha256(input: string): Promise<Uint8Array> {
 const bytes = new TextEncoder().encode(input)
 const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
 return new Uint8Array(digest)
}

const discriminatorCache = new Map<string, Uint8Array>()

export async function ixDiscriminator(name: string): Promise<Uint8Array> {
 const key = `global:${name}`
 if (!discriminatorCache.has(key)) {
  discriminatorCache.set(key, (await sha256(key)).slice(0, 8))
 }
 return discriminatorCache.get(key)!
}

export function u64LE(value: bigint): Uint8Array {
 const b = new Uint8Array(8)
 new DataView(b.buffer).setBigUint64(0, value, true)
 return b
}

export function u8(value: number): Uint8Array {
 return new Uint8Array([value])
}

export function concatBytes(...parts: Uint8Array[]): Buffer {
 return Buffer.concat(parts.map((p) => Buffer.from(p)))
}

export function pdas(programId: PublicKey) {
 const config = () => PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0]
 const epoch = (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from('epoch'), u64LE(id)], programId)[0]
 const field = (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from('field'), u64LE(id)], programId)[0]
 const order = (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from('order'), u64LE(id)], programId)[0]
 const escrow = (orderPk: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('escrow'), orderPk.toBuffer()], programId)[0]
 const sellerProfile = (owner: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('seller'), owner.toBuffer()], programId)[0]
 const marketStats = () => PublicKey.findProgramAddressSync([Buffer.from('market_stats')], programId)[0]
 const treasuryAuthority = () => config()
 const exportLicense = (owner: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('license'), owner.toBuffer()], programId)[0]
 return { config, epoch, field, order, escrow, sellerProfile, marketStats, treasuryAuthority, exportLicense }
}

export function potatoAta(owner: PublicKey, mint: PublicKey): PublicKey {
 return getAssociatedTokenAddressSync(mint, owner, true) // allowOwnerOffcurve = true: owner может быть PDA (config, quest_treasury)
}

export async function ixCreateField(programId: PublicKey, params: {
 config: PublicKey; field: PublicKey; owner: PublicKey; potatoMint: PublicKey; userPotato: PublicKey
 fieldId: bigint; fieldType: number
}): Promise<TransactionInstruction> {
 const data = concatBytes(await ixDiscriminator('create_field'), u64LE(params.fieldId), u8(params.fieldType))
 const keys = [
  { pubkey: params.config, isSigner: false, isWritable: true },
  { pubkey: params.field, isSigner: false, isWritable: true },
  { pubkey: params.owner, isSigner: true, isWritable: true },
  { pubkey: params.potatoMint, isSigner: false, isWritable: true },
  { pubkey: params.userPotato, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
 ]
 return new TransactionInstruction({ programId, keys, data })
}

export async function ixHarvest(programId: PublicKey, params: {
 config: PublicKey; epoch: PublicKey; field: PublicKey; potatoMint: PublicKey; userPotato: PublicKey
 owner: PublicKey; treasuryPotato: PublicKey
}): Promise<TransactionInstruction> {
 const data = concatBytes(await ixDiscriminator('harvest'))
 const keys = [
  { pubkey: params.config, isSigner: false, isWritable: true },
  { pubkey: params.epoch, isSigner: false, isWritable: true },
  { pubkey: params.field, isSigner: false, isWritable: true },
  { pubkey: params.potatoMint, isSigner: false, isWritable: true },
  { pubkey: params.userPotato, isSigner: false, isWritable: true },
  { pubkey: params.treasuryPotato, isSigner: false, isWritable: true },
  { pubkey: params.owner, isSigner: true, isWritable: true },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
 ]
 return new TransactionInstruction({ programId, keys, data })
}

async function ixFieldAction(name: string, programId: PublicKey, params: {
 field: PublicKey; potatoMint: PublicKey; userPotato: PublicKey; config: PublicKey; owner: PublicKey
}): Promise<TransactionInstruction> {
 const data = concatBytes(await ixDiscriminator(name))
 const keys = [
  { pubkey: params.field, isSigner: false, isWritable: true },
  { pubkey: params.potatoMint, isSigner: false, isWritable: true },
  { pubkey: params.userPotato, isSigner: false, isWritable: true },
  { pubkey: params.config, isSigner: false, isWritable: true },
  { pubkey: params.owner, isSigner: true, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
 ]
 return new TransactionInstruction({ programId, keys, data })
}

export const ixRepairField = (programId: PublicKey, params: Parameters<typeof ixFieldAction>[2]) =>
 ixFieldAction('repair_field', programId, params)
export const ixUpgradeField = (programId: PublicKey, params: Parameters<typeof ixFieldAction>[2]) =>
 ixFieldAction('upgrade_field', programId, params)
export const ixPayTax = (programId: PublicKey, params: Parameters<typeof ixFieldAction>[2]) =>
 ixFieldAction('pay_tax', programId, params)
export const ixApplyFertilizer = (programId: PublicKey, params: Parameters<typeof ixFieldAction>[2]) =>
 ixFieldAction('apply_fertilizer', programId, params)

export async function ixCreateSellOrder(programId: PublicKey, params: {
 seller: PublicKey; sellerProfile: PublicKey; order: PublicKey; marketStats: PublicKey
 sellerPotato: PublicKey; escrow: PublicKey; potatoMint: PublicKey; config: PublicKey
 orderId: bigint; amountMicro: bigint; priceLamports: bigint
}): Promise<TransactionInstruction> {
 const data = concatBytes(
  await ixDiscriminator('create_sell_order'),
  u64LE(params.orderId),
  u64LE(params.amountMicro),
  u64LE(params.priceLamports)
 )
 const keys = [
  { pubkey: params.seller, isSigner: true, isWritable: true },
  { pubkey: params.config, isSigner: false, isWritable: false },
  { pubkey: params.sellerProfile, isSigner: false, isWritable: true },
  { pubkey: params.order, isSigner: false, isWritable: true },
  { pubkey: params.marketStats, isSigner: false, isWritable: true },
  { pubkey: params.sellerPotato, isSigner: false, isWritable: true },
  { pubkey: params.escrow, isSigner: false, isWritable: true },
  { pubkey: params.potatoMint, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
 ]
 return new TransactionInstruction({ programId, keys, data })
}

export async function ixFillOrder(programId: PublicKey, params: {
 buyer: PublicKey; seller: PublicKey; config: PublicKey; potatoMint: PublicKey; marketStats: PublicKey
 order: PublicKey; escrow: PublicKey; buyerPotato: PublicKey; sellerPotato: PublicKey; treasuryPotato: PublicKey
 /** remaining_accounts, fixed positions: [0] license PDA, [1] buyer referral PDA, [2] referrer's POTATO ATA */
 sellerLicense?: PublicKey | null
 buyerReferral?: PublicKey | null
 referrerPotato?: PublicKey | null
}): Promise<TransactionInstruction> {
 const data = concatBytes(await ixDiscriminator('fill_order'))
 const keys = [
  { pubkey: params.buyer, isSigner: true, isWritable: true },
  { pubkey: params.seller, isSigner: false, isWritable: true },
  { pubkey: params.config, isSigner: false, isWritable: true },
  { pubkey: params.potatoMint, isSigner: false, isWritable: true },
  { pubkey: params.marketStats, isSigner: false, isWritable: true },
  { pubkey: params.order, isSigner: false, isWritable: true },
  { pubkey: params.escrow, isSigner: false, isWritable: true },
  { pubkey: params.buyerPotato, isSigner: false, isWritable: true },
  { pubkey: params.sellerPotato, isSigner: false, isWritable: true },
  { pubkey: params.treasuryPotato, isSigner: false, isWritable: true },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
 ]
 // Fixed positions must not shift when an earlier optional account is absent.
 // System Program is a harmless, readonly placeholder (not a license/referral PDA).
 if (params.sellerLicense || params.buyerReferral || params.referrerPotato) {
  keys.push({ pubkey: params.sellerLicense ?? SystemProgram.programId, isSigner: false, isWritable: false })
 }
 if (params.buyerReferral || params.referrerPotato) {
  keys.push({ pubkey: params.buyerReferral ?? SystemProgram.programId, isSigner: false, isWritable: false })
 }
 if (params.referrerPotato) keys.push({ pubkey: params.referrerPotato, isSigner: false, isWritable: true })
 return new TransactionInstruction({ programId, keys, data })
}

export async function ixCancelOrder(programId: PublicKey, params: {
 seller: PublicKey; sellerProfile: PublicKey; order: PublicKey; escrow: PublicKey; sellerPotato: PublicKey
}): Promise<TransactionInstruction> {
 const data = concatBytes(await ixDiscriminator('cancel_order'))
 const keys = [
  { pubkey: params.seller, isSigner: true, isWritable: true },
  { pubkey: params.sellerProfile, isSigner: false, isWritable: true },
  { pubkey: params.order, isSigner: false, isWritable: true },
  { pubkey: params.escrow, isSigner: false, isWritable: true },
  { pubkey: params.sellerPotato, isSigner: false, isWritable: true },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
 ]
 return new TransactionInstruction({ programId, keys, data })
}

function readPubkey(data: Buffer, o: number) { return { value: new PublicKey(data.subarray(o, o + 32)), next: o + 32 } }
function readU64(data: Buffer, o: number) { return { value: data.readBigUInt64LE(o), next: o + 8 } }
function readI64(data: Buffer, o: number) { return { value: data.readBigInt64LE(o), next: o + 8 } }
function readU8(data: Buffer, o: number) { return { value: data.readUInt8(o), next: o + 1 } }
function readBool(data: Buffer, o: number) { return { value: data.readUInt8(o) !== 0, next: o + 1 } }

export interface DecodedField {
 owner: PublicKey; level: number; durability: number; lastHarvest: bigint
 taxPaidUntil: bigint; fertilizerUntil: bigint; isActive: boolean; fieldType: number
 bump: number; mutationType: number
}

export function decodeField(data: Buffer): DecodedField {
 let o = 8
 const owner = readPubkey(data, o); o = owner.next
 const level = readU8(data, o); o = level.next
 const durability = readU8(data, o); o = durability.next
 const lastHarvest = readI64(data, o); o = lastHarvest.next
 const taxPaidUntil = readI64(data, o); o = taxPaidUntil.next
 const fertilizerUntil = readI64(data, o); o = fertilizerUntil.next
 const isActive = readBool(data, o); o = isActive.next
 const fieldType = readU8(data, o); o = fieldType.next
 const bump = readU8(data, o); o = bump.next
 const mutationType = readU8(data, o)
 return {
  owner: owner.value, level: level.value, durability: durability.value,
  lastHarvest: lastHarvest.value, taxPaidUntil: taxPaidUntil.value,
  fertilizerUntil: fertilizerUntil.value, isActive: isActive.value, fieldType: fieldType.value,
  bump: bump.value, mutationType: mutationType.value,
 }
}

export type OrderStatusStr = 'active' | 'filled' | 'cancelled' | 'expired'
const ORDER_STATUS_MAP: OrderStatusStr[] = ['active', 'filled', 'cancelled', 'expired']

export interface DecodedOrder {
 seller: PublicKey; amountMicro: bigint; priceLamportsPerPotato: bigint; feeMicro: bigint
 status: OrderStatusStr; createdAt: bigint; expiresAt: bigint
}

export function decodeMarketOrder(data: Buffer): DecodedOrder {
 let o = 8
 const seller = readPubkey(data, o); o = seller.next
 const amountMicro = readU64(data, o); o = amountMicro.next
 const priceLamportsPerPotato = readU64(data, o); o = priceLamportsPerPotato.next
 const feeMicro = readU64(data, o); o = feeMicro.next
 const statusByte = readU8(data, o); o = statusByte.next
 const createdAt = readI64(data, o); o = createdAt.next
 const expiresAt = readI64(data, o)
 return {
  seller: seller.value, amountMicro: amountMicro.value,
  priceLamportsPerPotato: priceLamportsPerPotato.value, feeMicro: feeMicro.value,
  status: ORDER_STATUS_MAP[statusByte.value] ?? 'active',
  createdAt: createdAt.value, expiresAt: expiresAt.value,
 }
}

export interface DecodedMarketStats {
 sellVolume24hMicro: bigint; buyVolume24hMicro: bigint; totalSolVolume: bigint; totalTrades: bigint
}

export function decodeMarketStats(data: Buffer): DecodedMarketStats {
 let o = 8
 const sell = readU64(data, o); o = sell.next
 const buy = readU64(data, o); o = buy.next
 const solVol = readU64(data, o); o = solVol.next
 const trades = readU64(data, o)
 return { sellVolume24hMicro: sell.value, buyVolume24hMicro: buy.value, totalSolVolume: solVol.value, totalTrades: trades.value }
}

export interface DecodedConfig {
 authority: PublicKey; pendingAuthority: PublicKey; potatoMint: PublicKey
 skrMint: PublicKey; rewardSigner: PublicKey
 maxSupplyMicro: bigint; dailyMintCapMicro: bigint; baseYieldMicroPerDay: bigint
 globalMultiplierBps: number; fieldCount: bigint; epochId: bigint; totalBurnedMicro: bigint
 lastTotalBurnedMicro: bigint; paused: boolean
}

export interface DecodedEpoch {
 id: bigint; mintCapMicro: bigint; mintedMicro: bigint; startTime: bigint
 bump: number; burnedMicro: bigint
}

export function decodeEpoch(data: Buffer): DecodedEpoch {
 let o = 8
 const id = readU64(data, o); o = id.next
 const mintCapMicro = readU64(data, o); o = mintCapMicro.next
 const mintedMicro = readU64(data, o); o = mintedMicro.next
 const startTime = readI64(data, o); o = startTime.next
 const bump = readU8(data, o); o = bump.next
 const burnedMicro = data.length === 41 ? { value: 0n } : readU64(data, o)
 return { id: id.value, mintCapMicro: mintCapMicro.value, mintedMicro: mintedMicro.value, startTime: startTime.value, bump: bump.value, burnedMicro: burnedMicro.value }
}

export function decodeConfig(data: Buffer): DecodedConfig {
 if (![156, 164, 228].includes(data.length)) throw new Error("Unsupported GameConfig layout")
 let o = 8
 const authority = readPubkey(data, o); o = authority.next
 const pendingAuthority = readPubkey(data, o); o = pendingAuthority.next
 const potatoMint = readPubkey(data, o); o = potatoMint.next
 // S-01/S-03: новые поля skr_mint + reward_signer (64 bytes). Поддержка старых аккаунтов 164 байт (до миграции).
 let skrMint: PublicKey, rewardSigner: PublicKey
 if (data.length >= 8 + 32*5 + 8*4 + 2 + 8*3 + 1 + 1) {
   const skr = readPubkey(data, o); o = skr.next; skrMint = skr.value
   const rw = readPubkey(data, o); o = rw.next; rewardSigner = rw.value
 } else {
   skrMint = SKR_MINT
   rewardSigner = authority.value
 }
 const maxSupplyMicro = readU64(data, o); o = maxSupplyMicro.next
 const dailyMintCapMicro = readU64(data, o); o = dailyMintCapMicro.next
 const baseYieldMicroPerDay = readU64(data, o); o = baseYieldMicroPerDay.next
 const bpsView = new DataView(data.buffer, data.byteOffset + o, 2)
 const globalMultiplierBps = bpsView.getUint16(0, true); o += 2
 const fieldCount = readU64(data, o); o = fieldCount.next
 const epochId = readU64(data, o); o = epochId.next
 const totalBurnedMicro = readU64(data, o); o = totalBurnedMicro.next
 const lastTotalBurnedMicro = data.length === 156 ? { value: 0n, next: o } : readU64(data, o); o = lastTotalBurnedMicro.next
 const paused = readBool(data, o)
 return {
  authority: authority.value, pendingAuthority: pendingAuthority.value, potatoMint: potatoMint.value,
  skrMint, rewardSigner,
  maxSupplyMicro: maxSupplyMicro.value, dailyMintCapMicro: dailyMintCapMicro.value,
  baseYieldMicroPerDay: baseYieldMicroPerDay.value, globalMultiplierBps,
  fieldCount: fieldCount.value, epochId: epochId.value, totalBurnedMicro: totalBurnedMicro.value,
  lastTotalBurnedMicro: lastTotalBurnedMicro.value, paused: paused.value,
 }
}

export interface DecodedExportLicense {
 owner: PublicKey; expiresAt: bigint; bump: number
}

export function decodeExportLicense(data: Buffer): DecodedExportLicense {
 let o = 8
 const owner = readPubkey(data, o); o = owner.next
 const expiresAt = readI64(data, o); o = expiresAt.next
 const bump = readU8(data, o)
 return { owner: owner.value, expiresAt: expiresAt.value, bump: bump.value }
}


// ─────────────────────────── Presale (SOL) ───────────────────────────

const U32LE = (v: number) => {
 const b = Buffer.alloc(4)
 b.writeUInt32LE(v >>> 0)
 return b
}

export function presaleStatePda(programId: PublicKey): PublicKey {
 return PublicKey.findProgramAddressSync([Buffer.from('presale')], programId)[0]
}

export function buyerPresalePda(programId: PublicKey, buyer: PublicKey): PublicKey {
 return PublicKey.findProgramAddressSync([Buffer.from('buyer_presale'), buyer.toBuffer()], programId)[0]
}

export function treasurySkrAta(programId: PublicKey, skrMint: PublicKey): PublicKey {
  const treasurySol = treasurySolPda(programId)
  return getAssociatedTokenAddressSync(skrMint, treasurySol, true) // allowOwnerOffcurve = true для PDA
}
export function buybackSkrAta(authority: PublicKey, skrMint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(skrMint, authority, true) // allowOwnerOffcurve = true для PDA
}

export function treasurySolPda(programId: PublicKey): PublicKey {
 return PublicKey.findProgramAddressSync([Buffer.from('treasury_sol')], programId)[0]
}

export async function ixInitPresale(programId: PublicKey, params: {
 config: PublicKey; presaleState: PublicKey; authority: PublicKey; cap: number; priceLamports: bigint
}): Promise<TransactionInstruction> {
 const data = concatBytes(await ixDiscriminator('init_presale'), U32LE(params.cap), u64LE(params.priceLamports))
 const keys = [
  { pubkey: params.config, isSigner: false, isWritable: false },
  { pubkey: params.presaleState, isSigner: false, isWritable: true },
  { pubkey: params.authority, isSigner: true, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
 ]
 return new TransactionInstruction({ programId, keys, data })
}

export async function ixUpdatePresalePrice(programId: PublicKey, params: {
 config: PublicKey; presaleState: PublicKey; authority: PublicKey; priceLamports: bigint
}): Promise<TransactionInstruction> {
 const data = concatBytes(await ixDiscriminator('update_presale_price'), u64LE(params.priceLamports))
 const keys = [
  { pubkey: params.config, isSigner: false, isWritable: false },
  { pubkey: params.presaleState, isSigner: false, isWritable: true },
  { pubkey: params.authority, isSigner: true, isWritable: false },
 ]
 return new TransactionInstruction({ programId, keys, data })
}

export async function ixBuyFieldSol(programId: PublicKey, params: {
 config: PublicKey; presaleState: PublicKey; authority: PublicKey; buyerPresale: PublicKey;
 field: PublicKey; buyer: PublicKey; treasurySol: PublicKey; fieldId: bigint; fieldType: number
}): Promise<TransactionInstruction> {
 const data = concatBytes(await ixDiscriminator('buy_field_sol'), u64LE(params.fieldId), u8(params.fieldType))
 const keys = [
  { pubkey: params.config, isSigner: false, isWritable: true },
  { pubkey: params.presaleState, isSigner: false, isWritable: true },
  { pubkey: params.authority, isSigner: false, isWritable: false },
  { pubkey: params.buyerPresale, isSigner: false, isWritable: true },
  { pubkey: params.field, isSigner: false, isWritable: true },
  { pubkey: params.buyer, isSigner: true, isWritable: true },
  { pubkey: params.treasurySol, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
 ]
 return new TransactionInstruction({ programId, keys, data })
}


export async function ixBuyFieldSkr(programId: PublicKey, params: {
  config: PublicKey; presaleState: PublicKey; authority: PublicKey; buyerPresale: PublicKey;
  field: PublicKey; buyer: PublicKey; treasurySol: PublicKey;
  skrMint: PublicKey; buyerSkrAta: PublicKey; treasurySkrAta: PublicKey; buybackSkrAta: PublicKey;
  fieldId: bigint;
}): Promise<TransactionInstruction> {
  // Тир поля кидает программа (keccak(buyer ‖ sold ‖ slot)): аргумента типа нет.
  const data = concatBytes(await ixDiscriminator('buy_field_skr'), u64LE(params.fieldId))
  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: params.config, isSigner: false, isWritable: true },
      { pubkey: params.presaleState, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: false, isWritable: false },
      { pubkey: params.buyerPresale, isSigner: false, isWritable: true },
      { pubkey: params.field, isSigner: false, isWritable: true },
      { pubkey: params.buyer, isSigner: true, isWritable: true },
      { pubkey: params.skrMint, isSigner: false, isWritable: false },
      { pubkey: params.buyerSkrAta, isSigner: false, isWritable: true },
      { pubkey: params.treasurySol, isSigner: false, isWritable: true },
      { pubkey: params.treasurySkrAta, isSigner: false, isWritable: true },
      { pubkey: params.buybackSkrAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  })
}

export async function ixBuyExportLicense(programId: PublicKey, params: {
 config: PublicKey; license: PublicKey; payer: PublicKey;
 skrMint: PublicKey; userSkrAta: PublicKey;
 treasurySol: PublicKey; treasurySkrAta: PublicKey;
}): Promise<TransactionInstruction> {
 const data = concatBytes(await ixDiscriminator('buy_export_license'))
 return new TransactionInstruction({
  programId,
  data,
  keys: [
   { pubkey: params.config, isSigner: false, isWritable: false },
   { pubkey: params.license, isSigner: false, isWritable: true },
   { pubkey: params.payer, isSigner: true, isWritable: true },
   { pubkey: params.skrMint, isSigner: false, isWritable: false },
   { pubkey: params.userSkrAta, isSigner: false, isWritable: true },
   { pubkey: params.treasurySol, isSigner: false, isWritable: true },
   { pubkey: params.treasurySkrAta, isSigner: false, isWritable: true },
   { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
   { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
   { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
 })
}

// ═══════════════════════════════════════════════════════════════
// Migration helpers (devnet v1 → v2)
// ═══════════════════════════════════════════════════════════════

export async function ixMigrateConfig(programId: PublicKey, params: {
 config: PublicKey; authority: PublicKey;
}): Promise<TransactionInstruction> {
 const data = Buffer.from(await ixDiscriminator('migrate_config'))
 return new TransactionInstruction({
  programId,
  data,
  keys: [
   { pubkey: params.config, isSigner: false, isWritable: true },
   { pubkey: params.authority, isSigner: true, isWritable: true },
   { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
 })
}

export async function ixMigrateField(programId: PublicKey, params: {
 field: PublicKey; config: PublicKey; authority: PublicKey;
}): Promise<TransactionInstruction> {
 const data = Buffer.from(await ixDiscriminator('migrate_field'))
 return new TransactionInstruction({
  programId,
  data,
  keys: [
   { pubkey: params.field, isSigner: false, isWritable: true },
   { pubkey: params.config, isSigner: false, isWritable: false },
   { pubkey: params.authority, isSigner: true, isWritable: true },
   { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
 })
}

export async function ixMigrateEpoch(programId: PublicKey, params: {
 epoch: PublicKey; config: PublicKey; authority: PublicKey;
}): Promise<TransactionInstruction> {
 const data = Buffer.from(await ixDiscriminator('migrate_epoch'))
 return new TransactionInstruction({
  programId,
  data,
  keys: [
   { pubkey: params.epoch, isSigner: false, isWritable: true },
   { pubkey: params.config, isSigner: false, isWritable: false },
   { pubkey: params.authority, isSigner: true, isWritable: true },
   { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
 })
}

// ═══════════════════════════════════════════════════════════════
// ФАЗА 1: Адаптивный кап + Лунный цикл + Растущий налог + Рефералка
// ═══════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────
// Лунный цикл (п.3 документа): детерминированный множитель 0.85× – 1.15×
// ───────────────────────────────────────────────────────────────
export const LUNAR_TABLE: number[] = [
  10000, 10334, 10651, 10935, 11173, 11352, 11462, 11500, // дни 0-7 (пик)
  11462, 11352, 11173, 10935, 10651, 10334, 10000, 9666,  // дни 8-15
  9349,  9065,  8827,  8648,  8538,  8500,  8538,  8648,  // дни 16-23 (дно)
  8827,  9065,  9349,  9666,                               // дни 24-27
];

export function getLunarMultiplier(epochId: number): number {
  const idx = epochId % 28;
  return LUNAR_TABLE[idx] / 10000;
}

export function getLunarPhase(epochId: number): string {
  const day = epochId % 28;
  if (day <= 3) return t('🌒 Растущая луна');
  if (day <= 7) return t('🌓 Первая четверть');
  if (day <= 10) return t('🌔 Прибывающая луна');
  if (day <= 14) return t('🌕 Полнолуние (пик)');
  if (day <= 17) return t('🌖 Убывающая луна');
  if (day <= 21) return t('🌗 Последняя четверть');
  return t('🌘 Новолуние (дно)');
}

// ───────────────────────────────────────────────────────────────
// Растущий налог от supply (п.7 документа): 2% + 8% × (supply/max)²
// ───────────────────────────────────────────────────────────────
export function getBaseTaxBps(totalSupply: number, maxSupply: number): number {
  if (maxSupply === 0) return 200;
  const ratio = (totalSupply / maxSupply) * 10000;
  const tax = 200 + (800 * ratio * ratio) / 100_000_000;
  return Math.min(tax, 1000); // жёсткий потолок 10%
}

export function getTaxRate(totalSupply: number, maxSupply: number): string {
  const bps = getBaseTaxBps(totalSupply, maxSupply);
  return (bps / 100).toFixed(2) + '%';
}

// ───────────────────────────────────────────────────────────────
// Адаптивный эластичный кап (п.2 документа): burn + utilization
// ───────────────────────────────────────────────────────────────
export function getElasticCap(
  prevBurned: number,
  lastCap: number,
  lastMinted: number,
  // Целые POTATO (те же юниты, что у prevBurned/lastCap/lastMinted) —
  // зеркало on-chain roll_epoch: [250k, 750k] POTATO за эпоху.
  baseCap: number = 250_000, // 250k POTATO
  maxCap: number = 750_000 // 750k POTATO
): number {
  // Ось 1: burn-бонус
  const burnBonus = prevBurned / 2;
  const capFromBurn = baseCap + burnBonus;
  
  // Ось 2: utilization-бонус
  const utilizationBps = lastCap > 0 ? (lastMinted / lastCap) * 10000 : 8500;
  const adjustBps = 1500 * (utilizationBps - 8500) / 10000;
  const capFromUtil = adjustBps >= 0
    ? lastCap * (10000 + adjustBps) / 10000
    : lastCap * (10000 + adjustBps) / 10000;
  
  // Гибрид: среднее двух осей
  const hybrid = (capFromBurn + capFromUtil) / 2;
  return Math.max(baseCap, Math.min(hybrid, maxCap));
}

// ───────────────────────────────────────────────────────────────
// Рефералка (п.8 документа)
// ───────────────────────────────────────────────────────────────

export async function ixRegisterReferrer(programId: PublicKey, params: {
  referral: PublicKey;
  config: PublicKey;
  potatoMint: PublicKey;
  userPotato: PublicKey;
  owner: PublicKey;
}, referrer: PublicKey): Promise<TransactionInstruction> {
  const DISCRIMINATOR_SIZE = 8;
  const data = Buffer.alloc(DISCRIMINATOR_SIZE + 32);
  const disc = await ixDiscriminator('register_referrer');
  data.set(disc, 0);
  data.set(referrer.toBytes(), DISCRIMINATOR_SIZE);
  
  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: params.referral, isSigner: false, isWritable: true },
      { pubkey: params.config, isSigner: false, isWritable: true },
      { pubkey: params.potatoMint, isSigner: false, isWritable: true },
      { pubkey: params.userPotato, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

// ───────────────────────────────────────────────────────────────
// Квесты/достижения on-chain (claim_achievement) — идентичность: кошелёк
// ───────────────────────────────────────────────────────────────

export const QUEST_REWARDS_MICRO = [50_000_000, 50_000_000, 100_000_000, 100_000_000, 200_000_000, 50_000_000] as const

/** PDA ["achv", user] — bitmap выданных наград (одноразовые, u64). */
export function achievementsPda(user: PublicKey, programId: PublicKey): PublicKey {
 return PublicKey.findProgramAddressSync([Buffer.from('achv'), user.toBuffer()], programId)[0]
}

/** PDA ["quest_treasury"] — владеет пулом наград квестов (550 POTATO, заправлен init-onchain). */
export function questTreasuryPda(programId: PublicKey): PublicKey {
 return PublicKey.findProgramAddressSync([Buffer.from('quest_treasury')], programId)[0]
}

/** Bitmap выданных квестов из данных PDA Achievements (8 disc + u64 bitmap). */
export function decodeAchievementsBitmap(data: Buffer): number {
 if (data.length < 16) return 0
 return Number(data.readBigUInt64LE(8))
}

/**
 * claim_achievement(quest_id) — верификация прогресса в программе:
 *  0: ≥1 поле · 1: ≥100 🥔 · 2: ≥1000 🥔 · 3: ≥5 полей · 4: ≥10 000 🥔 · 5: ≥6 полей, ≥3-го уровня одно.
 * Поля игрока передаются в remaining_accounts (proof by ownership).
 */

// ── Batch harvest (cheap, 1 tx for up to 10 fields) ──
export async function ixBatchHarvest(programId: PublicKey, params: {
 config: PublicKey; epoch: PublicKey; potatoMint: PublicKey; userPotato: PublicKey; treasuryPotato: PublicKey; owner: PublicKey;
 fieldPks: PublicKey[];
}): Promise<TransactionInstruction> {
 const data = concatBytes(await ixDiscriminator('batch_harvest'))
 const keys = [
  { pubkey: params.config, isSigner: false, isWritable: true },
  { pubkey: params.epoch, isSigner: false, isWritable: true },
  { pubkey: params.potatoMint, isSigner: false, isWritable: true },
  { pubkey: params.userPotato, isSigner: false, isWritable: true },
  { pubkey: params.treasuryPotato, isSigner: false, isWritable: true },
  { pubkey: params.owner, isSigner: true, isWritable: true },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ...params.fieldPks.map(pk => ({ pubkey: pk, isSigner: false, isWritable: true })),
 ]
 return new TransactionInstruction({ programId, keys, data })
}

export async function ixCloseField(programId: PublicKey, params: {
 field: PublicKey; owner: PublicKey;
}): Promise<TransactionInstruction> {
 const data = concatBytes(await ixDiscriminator('close_field'))
 return new TransactionInstruction({
  programId,
  data,
  keys: [
   { pubkey: params.field, isSigner: false, isWritable: true },
   { pubkey: params.owner, isSigner: true, isWritable: true },
  ],
 })
}

// ───────────────────────────────────────────────────────────────
// Advanced Solana: Token-2022 + ZK Compression + Metaplex Core + LUT
// ───────────────────────────────────────────────────────────────

/** Token-2022 mint PDA — для mainnet migrated POTATO (hook+metadata) */
export { TOKEN_2022_PROGRAM_ID }
export const BUBBLEGUM_PROGRAM_ID = new PublicKey('BGUMAp9Gq7iTEuapy4pqaxsQSKP9pRFw9tgo88Ruef4')
export const MPL_CORE_PROGRAM_ID = new PublicKey('CoREENxT6tWLL37r42jwFW6dvSzpzy1gZb98F1QYn7R')
export const COMPRESSION_PROGRAM_ID = new PublicKey('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK')

export function token2022Ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID)
}

/** PDA для Token-2022 transfer hook: [b"hook", mint] */
export function hookPda(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('hook'), mint.toBuffer()], programId)[0]
}

/** PDA compression tree: [b"merkle-tree", authority] */
export function compressionTreePda(authority: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('merkle-tree'), authority.toBuffer()], programId)[0]
}

/** PDA Core collection: [b"collection", authority] */
export function coreCollectionPda(authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('collection'), authority.toBuffer()], MPL_CORE_PROGRAM_ID)[0]
}

export async function ixInitCompressionTree(programId: PublicKey, params: {
  tree: PublicKey; authority: PublicKey; payer: PublicKey
}): Promise<TransactionInstruction> {
  const data = concatBytes(await ixDiscriminator('init_compression_tree'))
  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: params.tree, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  })
}
// Back-compat alias for old call sites (merkleTree/treeAuthority)
export const ixInitCompressionTreeLegacy = ixInitCompressionTree

export async function ixMintCompressedField(programId: PublicKey, params: {
  tree: PublicKey; authority: PublicKey; leafOwner: PublicKey; payer: PublicKey
  fieldId: bigint; fieldType: number
}): Promise<TransactionInstruction> {
  const data = concatBytes(await ixDiscriminator('mint_compressed_field'), u64LE(params.fieldId), u8(params.fieldType))
  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: params.tree, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: params.leafOwner, isSigner: false, isWritable: false },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: BUBBLEGUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  })
}
// Back-compat overload: old signature with merkleTree/treeAuthority
export async function ixMintCompressedFieldLegacy(programId: PublicKey, params: { merkleTree: PublicKey; treeAuthority: PublicKey; leafOwner: PublicKey; payer: PublicKey; fieldId: bigint; fieldType: number }): Promise<TransactionInstruction> {
  return ixMintCompressedField(programId, { tree: params.merkleTree, authority: params.payer, leafOwner: params.leafOwner, payer: params.payer, fieldId: params.fieldId, fieldType: params.fieldType })
}

export async function ixMintCoreField(programId: PublicKey, params: {
  collection: PublicKey; asset: PublicKey; authority: PublicKey; payer: PublicKey; owner: PublicKey
  fieldId: bigint; fieldType: number
}): Promise<TransactionInstruction> {
  const data = concatBytes(await ixDiscriminator('mint_core_field'), u64LE(params.fieldId), u8(params.fieldType))
  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: params.collection, isSigner: false, isWritable: true },
      { pubkey: params.asset, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.owner, isSigner: false, isWritable: false },
      { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  })
}

/** Token-2022 hook exec — валидация налога на transfer POTATO (0.5% burn) */
export async function ixExecuteTransferHook(programId: PublicKey, params: {
  mint: PublicKey; source: PublicKey; dest: PublicKey; authority: PublicKey
  amount: bigint
}): Promise<TransactionInstruction> {
  const data = concatBytes(await ixDiscriminator('execute_transfer_hook'), u64LE(params.amount))
  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.source, isSigner: false, isWritable: true },
      { pubkey: params.dest, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  })
}

export async function ixUpdateSkrMint(programId: PublicKey, params: { config: PublicKey; authority: PublicKey; newSkrMint: PublicKey }): Promise<TransactionInstruction> {
  const data = concatBytes(await ixDiscriminator('update_skr_mint'), params.newSkrMint.toBuffer())
  return new TransactionInstruction({ programId, data, keys: [
    { pubkey: params.config, isSigner: false, isWritable: true },
    { pubkey: params.authority, isSigner: true, isWritable: false },
  ]})
}
export async function ixUpdateRewardSigner(programId: PublicKey, params: { config: PublicKey; authority: PublicKey; newSigner: PublicKey }): Promise<TransactionInstruction> {
  const data = concatBytes(await ixDiscriminator('update_reward_signer'), params.newSigner.toBuffer())
  return new TransactionInstruction({ programId, data, keys: [
    { pubkey: params.config, isSigner: false, isWritable: true },
    { pubkey: params.authority, isSigner: true, isWritable: false },
  ]})
}
export async function ixClaimAchievement(programId: PublicKey, params: {
 config: PublicKey;
 achievements: PublicKey;
 user: PublicKey;
 questTreasury: PublicKey;
 questAta: PublicKey;
 userAta: PublicKey;
 potatoMint: PublicKey;
}, questId: number, fieldPkas: PublicKey[]): Promise<TransactionInstruction> {
 // Порядок ключей = полей ClaimAchievement в программе:
 // config, achievements, user(signer), quest_treasury, quest_ata,
 // user_potato_ata, potato_mint, token_program, system_program, [remaining: поля]
 const DISCRIMINATOR_SIZE = 8;
 const data = Buffer.alloc(DISCRIMINATOR_SIZE + 1);
 const disc = await ixDiscriminator('claim_achievement');
 data.set(disc, 0);
 data.writeUInt8(questId, DISCRIMINATOR_SIZE);

 return new TransactionInstruction({
  programId,
  data,
  keys: [
   { pubkey: params.config, isSigner: false, isWritable: true },
   { pubkey: params.achievements, isSigner: false, isWritable: true },
   { pubkey: params.user, isSigner: true, isWritable: true },
   { pubkey: params.questTreasury, isSigner: false, isWritable: false },
   { pubkey: params.questAta, isSigner: false, isWritable: true },
   { pubkey: params.userAta, isSigner: false, isWritable: true },
   { pubkey: params.potatoMint, isSigner: false, isWritable: false },
   { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
   { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
   ...fieldPkas.map((pk) => ({ pubkey: pk, isSigner: false, isWritable: false })),
  ],
 });
}
