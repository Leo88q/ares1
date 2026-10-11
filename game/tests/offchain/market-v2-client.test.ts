import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, type TransactionInstruction } from '@solana/web3.js'
import * as client from '../../apps/web/src/utils/anchorClient'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'

const programId = PublicKey.unique()
const key = () => PublicKey.unique()
const keys = {
  buyer: key(), seller: key(), config: key(), potatoMint: key(), skrMint: key(),
  sellerProfile: key(), sellerVolumeV2: key(), marketStatsV2: key(), order: key(), escrow: key(),
  buyerPotato: key(), sellerPotato: key(), buyerSkrAta: key(), sellerSkrAta: key(),
  treasurySol: key(), treasurySkrAta: key(),
}

function assertMetas(actual: TransactionInstruction, expected: Array<[PublicKey, boolean, boolean]>) {
  assert.equal(actual.keys.length, expected.length)
  for (const [i, [pubkey, isSigner, isWritable]] of expected.entries()) {
    assert.deepEqual(actual.keys[i], { pubkey, isWritable, isSigner }, `account meta ${i}`)
  }
}

async function assertDiscriminator(name: string, data: Buffer) {
  assert.deepEqual(data.subarray(0, 8), Buffer.from(await client.ixDiscriminator(name)))
}

test('V2 listing encodes the quote pair and account order without touching legacy builders', async () => {
  const orderId = 0x8123456789abcdefn
  const ix = await client.ixCreateSellOrderV2(programId, {
    ...keys,
    orderId,
    amountMicro: 10_000_000n,
    priceQuoteAtomsPerPotato: 1_000_000n,
    quoteAsset: 'skr',
  })
  await assertDiscriminator('create_sell_order_v2', ix.data)
  assert.equal(ix.data.readBigUInt64LE(8), orderId)
  assert.equal(ix.data.readBigUInt64LE(16), 10_000_000n)
  assert.equal(ix.data.readBigUInt64LE(24), 1_000_000n)
  assert.equal(ix.data.readUInt8(32), 1)
  assertMetas(ix, [
    [keys.seller, true, true], [keys.config, false, false], [keys.sellerProfile, false, true],
    [keys.sellerVolumeV2, false, true], [keys.marketStatsV2, false, true], [keys.order, false, true],
    [keys.sellerPotato, false, true], [keys.escrow, false, true], [keys.potatoMint, false, false],
    [TOKEN_PROGRAM_ID, false, false], [SystemProgram.programId, false, false],
    [SYSVAR_RENT_PUBKEY, false, false],
  ])
})

test('V2 SOL fill sends the treasury writable recipient and uses the separate V2 accounts', async () => {
  const ix = await client.ixFillOrderV2(programId, keys)
  await assertDiscriminator('fill_order_v2', ix.data)
  assert.equal(ix.data.length, 8)
  assertMetas(ix, [
    [keys.buyer, true, true], [keys.seller, false, true], [keys.config, false, false],
    [keys.potatoMint, false, false], [keys.sellerVolumeV2, false, true],
    [keys.marketStatsV2, false, true], [keys.order, false, true], [keys.escrow, false, true],
    [keys.buyerPotato, false, true], [keys.treasurySol, false, true],
    [TOKEN_PROGRAM_ID, false, false], [SystemProgram.programId, false, false],
  ])
})

test('V2 SKR fill uses the configured quote mint and only writable token destinations', async () => {
  const ix = await client.ixFillOrderV2Skr(programId, keys)
  await assertDiscriminator('fill_order_v2_skr', ix.data)
  assert.equal(ix.data.length, 8)
  assertMetas(ix, [
    [keys.buyer, true, true], [keys.seller, false, true], [keys.config, false, false],
    [keys.potatoMint, false, false], [keys.skrMint, false, false],
    [keys.sellerVolumeV2, false, true], [keys.marketStatsV2, false, true],
    [keys.order, false, true], [keys.escrow, false, true], [keys.buyerPotato, false, true],
    [keys.buyerSkrAta, false, true], [keys.sellerSkrAta, false, true],
    [keys.treasurySol, false, false], [keys.treasurySkrAta, false, true],
    [TOKEN_PROGRAM_ID, false, false], [ASSOCIATED_TOKEN_PROGRAM_ID, false, false],
    [SystemProgram.programId, false, false],
  ])
})

test('V2 cancel and expiry instructions use V2 escrow seeds and preserve seller refund account', async () => {
  const cancel = await client.ixCancelOrderV2(programId, keys)
  await assertDiscriminator('cancel_order_v2', cancel.data)
  assertMetas(cancel, [
    [keys.seller, true, true], [keys.sellerProfile, false, true], [keys.order, false, true],
    [keys.escrow, false, true], [keys.sellerPotato, false, true],
    [TOKEN_PROGRAM_ID, false, false], [SystemProgram.programId, false, false],
  ])

  const expire = await client.ixCloseExpiredOrderV2(programId, keys)
  await assertDiscriminator('close_expired_order_v2', expire.data)
  assertMetas(expire, [
    [keys.order, false, true], [keys.escrow, false, true], [keys.sellerPotato, false, true],
    [keys.seller, false, true], [TOKEN_PROGRAM_ID, false, false],
  ])
})

test('V2 account decoders reject wrong sizes and preserve quote asset/volume fields', () => {
  const order = Buffer.alloc(client.MARKET_ORDER_V2_ACCOUNT_SIZE)
  order.writeBigUInt64LE(77n, 8)
  keys.seller.toBuffer().copy(order, 16)
  order.writeBigUInt64LE(50_000_000n, 48)
  order.writeBigUInt64LE(2_000_000n, 56)
  order.writeUInt8(1, 64) // SKR quote
  order.writeUInt8(1, 65) // fee policy v1
  order.writeUInt8(0, 66) // active
  order.writeBigInt64LE(100n, 67)
  order.writeBigInt64LE(100n + 86_400n, 75)
  order.writeUInt8(250, 83)
  order.writeUInt8(251, 84)
  assert.deepEqual(client.decodeMarketOrderV2(order), {
    orderId: 77n,
    seller: keys.seller,
    amountMicro: 50_000_000n,
    priceQuoteAtomsPerPotato: 2_000_000n,
    quoteAsset: 'skr',
    feePolicyVersion: 1,
    status: 'active',
    createdAt: 100n,
    expiresAt: 86_500n,
    escrowBump: 250,
    orderBump: 251,
  })
  assert.throws(() => client.decodeMarketOrderV2(Buffer.alloc(84)), /account size/)
  const invalidQuote = Buffer.from(order)
  invalidQuote.writeUInt8(2, 64)
  assert.throws(() => client.decodeMarketOrderV2(invalidQuote), /quote asset/)
  const invalidStatus = Buffer.from(order)
  invalidStatus.writeUInt8(4, 66)
  assert.throws(() => client.decodeMarketOrderV2(invalidStatus), /status/)

  const volume = Buffer.alloc(client.SELLER_VOLUME_V2_ACCOUNT_SIZE)
  keys.seller.toBuffer().copy(volume, 8)
  volume.writeBigInt64LE(2_000n, 40)
  volume.writeBigUInt64LE(9_000_000_000n, 48)
  volume.writeUInt8(17, 56)
  assert.deepEqual(client.decodeSellerVolumeV2(volume), {
    seller: keys.seller, dayIndex: 2_000n, filledPotatoMicro: 9_000_000_000n, bump: 17,
  })
  assert.throws(() => client.decodeSellerVolumeV2(Buffer.alloc(56)), /account size/)

  const stats = Buffer.alloc(client.MARKET_STATS_V2_ACCOUNT_SIZE)
  stats.writeBigUInt64LE(10_000_000n, 8)
  stats.writeBigUInt64LE(100_000_000n, 16)
  stats.writeBigUInt64LE(10_000_000n, 24)
  stats.writeBigUInt64LE(2n, 32)
  stats.writeBigInt64LE(1234n, 40)
  stats.writeUInt8(22, 48)
  assert.deepEqual(client.decodeMarketStatsV2(stats), {
    totalPotatoVolumeMicro: 10_000_000n,
    totalSolVolumeLamports: 100_000_000n,
    totalSkrVolumeAtoms: 10_000_000n,
    totalTrades: 2n,
    lastUpdate: 1234n,
    bump: 22,
  })
})

test('V2 PDA derivations are disjoint from every legacy market account', () => {
  const p = client.pdas(programId)
  const id = 42n
  assert.notEqual(p.orderV2(id).toBase58(), p.order(id).toBase58())
  assert.notEqual(p.escrowV2(p.orderV2(id)).toBase58(), p.escrow(p.order(id)).toBase58())
  assert.equal(p.escrowV2(p.orderV2(id)).toBase58(), PublicKey.findProgramAddressSync([
    Buffer.from('escrow_v2'), p.orderV2(id).toBuffer(),
  ], programId)[0].toBase58())
})
