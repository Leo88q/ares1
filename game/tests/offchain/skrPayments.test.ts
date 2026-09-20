import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import { skrCost, formatSkrCost, decodeSkrPricing, decodeSkrOrder, skrPdas, ixCreateFieldSkr, ixServiceFieldSkr, ixFillSkrOrder, ixCancelSkrOrder, ixRegisterReferrerSkr, ixCreateSkrOrder, ixCloseExpiredSkrOrder } from '../../apps/web/src/utils/skrPayments'
const program = new PublicKey('DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf')
const mint = PublicKey.unique(), owner = PublicKey.unique()
const price = { skrMint: mint, prices: Array<bigint>(6).fill(1_000_000n), marketMinAtoms: 1n }
test('SKR prices are unset-disabled, checked and retain the type/level multipliers', () => {
 assert.equal(skrCost(null, 0), null)
 assert.equal(skrCost({ ...price, prices: [0n, 0n, 0n, 0n, 0n, 0n] }, 0), null)
 assert.equal(skrCost(price, 0, 0), 400_000n)
 assert.equal(skrCost(price, 1, 2, 30), 20_000_000n)
 assert.equal(skrCost(price, 2, 1, 3), 3_000_000n)
 assert.equal(skrCost(price, 3, 1, 10), 5_000_000n)
 assert.equal(skrCost(price, 5, 0), 1_000_000n)
 assert.equal(skrCost({ ...price, prices: Array(6).fill(0xffffffffffffffffn) }, 2, 2, 50), null)
 assert.equal(skrCost(price, 9), null); assert.equal(skrCost(price, 2, 1, 0), null)
 assert.equal(formatSkrCost(null), '—'); assert.equal(formatSkrCost(1n), '0.000001'); assert.equal(formatSkrCost(1_500_000n), '1.5')
})
test('SKR account decoders validate exact discriminator, length and integer prices', () => {
 const b = Buffer.alloc(97); createHash('sha256').update('account:SkrPricing').digest().copy(b, 0, 0, 8); mint.toBuffer().copy(b, 8)
 b.writeBigUInt64LE(0xffffffffffffffffn, 40); b.writeBigUInt64LE(7n, 88)
 const decoded = decodeSkrPricing(b); assert.equal(decoded.prices[0], 0xffffffffffffffffn); assert.equal(decoded.marketMinAtoms, 7n); assert(decoded.skrMint.equals(mint))
 assert.throws(() => decodeSkrPricing(b.subarray(0, 96))); assert.throws(() => decodeSkrOrder(b))
 b[0] ^= 1; assert.throws(() => decodeSkrPricing(b))
})
test('new quote namespaces cannot collide with legacy SOL orders or other mints', () => {
 const a = skrPdas(program)
 const old = PublicKey.findProgramAddressSync([Buffer.from('order'), Buffer.alloc(8)], program)[0]
 assert(!old.equals(a.order(0n))); assert(!a.pricing(mint).equals(a.pricing(owner)))
})
test('SKR service builders encode explicit maximum, signer and fixed account order', async () => {
 const p = { config: PublicKey.unique(), pricing: PublicKey.unique(), skrMint: mint, userSkr: PublicKey.unique(), treasury: PublicKey.unique(), treasurySkr: PublicKey.unique(), owner }
 const ix = await ixCreateFieldSkr(program, { ...p, field: PublicKey.unique(), fieldId: 7n, fieldType: 1, maxSkrAtoms: 123n })
 assert.equal(ix.data.readBigUInt64LE(8), 7n); assert.equal(ix.data[16], 1); assert.equal(ix.data.readBigUInt64LE(17), 123n)
 assert(ix.keys[6].isSigner && ix.keys[6].pubkey.equals(owner)); assert(ix.keys[3].isWritable && ix.keys[5].isWritable)
 const service = await ixServiceFieldSkr(program, { ...p, field: ix.keys[9].pubkey, action: 2, maxSkrAtoms: 55n })
 assert.equal(service.data[8], 2); assert.equal(service.data.readBigUInt64LE(9), 55n)
 assert.throws(() => ixServiceFieldSkr(program, { ...p, field: owner, action: 2, maxSkrAtoms: 1n << 64n }))
})
// These exported builders are also compared against the genuine generated IDL
// once the ABI file is refreshed (see skrAbi.test.ts).
void [ixFillSkrOrder, ixCancelSkrOrder, ixRegisterReferrerSkr, ixCreateSkrOrder, ixCloseExpiredSkrOrder]
