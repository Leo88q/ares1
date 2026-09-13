import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import {
  ixBuyFieldSkr, pdas, presaleStatePda, buyerPresalePda, treasurySolPda,
  treasurySkrAta, buybackSkrAta, TEST_SKR_MINT,
} from '../src/utils/anchorClient'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const toml = readFileSync(join(process.cwd(), '../../Anchor.toml'), 'utf8')
  const devnet = toml.match(/\[programs\.devnet\]([\s\S]*?)(\n\[|$)/)!
  const PROGRAM_ID = new PublicKey(devnet[1].match(/solana_potato\s*=\s*"([^"]+)"/)![1])

  const buyer = new PublicKey('HPMr5r9sS5ApWsPNJytZRLbm2jz1veFxTn1wepjAhtho')
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed')

  const { config, field } = pdas(PROGRAM_ID)
  const configAddr = config()
  const presaleAddr = presaleStatePda(PROGRAM_ID)

  // читаем GameConfig и PresaleState, достаём оба authority
  const [cfgInfo, presaleInfo] = await conn.getMultipleAccountsInfo([configAddr, presaleAddr])
  if (!cfgInfo) throw new Error('GameConfig не найден')
  if (!presaleInfo) throw new Error('PresaleState не найден')

  // PresaleState: discriminator (8) | authority (32) | sold (4) | cap (4) | price (8) | bump (1)
  const presaleAuthority = new PublicKey(presaleInfo.data.slice(8, 40))
  const sold = presaleInfo.data.readUInt32LE(40)
  const cap = presaleInfo.data.readUInt32LE(44)
  const price = presaleInfo.data.readBigUInt64LE(48)
  console.log('PresaleState:')
  console.log('  authority :', presaleAuthority.toBase58())
  console.log('  sold      :', sold, '/', cap)
  console.log('  priceAtoms:', price.toString())

  // GameConfig: первое поле после дискриминатора = authority (Pubkey)
  const cfgAuthority = new PublicKey(cfgInfo.data.slice(8, 40))
  console.log('GameConfig authority:', cfgAuthority.toBase58())
  console.log('совпадают?', presaleAuthority.equals(cfgAuthority) ? 'ДА ✅' : 'НЕТ ❌')

  // собираем транзакцию с authority из PresaleState
  const fieldId = 99999n
  const buyerSkrAta = getAssociatedTokenAddressSync(TEST_SKR_MINT, buyer)
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(buyer, buyerSkrAta, buyer, TEST_SKR_MINT)
  const buyIx = await ixBuyFieldSkr(PROGRAM_ID, {
    config: configAddr,
    presaleState: presaleAddr,
    authority: presaleAuthority,
    buyerPresale: buyerPresalePda(PROGRAM_ID, buyer),
    field: field(fieldId),
    buyer,
    treasurySol: treasurySolPda(PROGRAM_ID),
    skrMint: TEST_SKR_MINT,
    buyerSkrAta,
    treasurySkrAta: treasurySkrAta(PROGRAM_ID, TEST_SKR_MINT),
    buybackSkrAta: buybackSkrAta(presaleAuthority, TEST_SKR_MINT),
    fieldId,
    fieldType: 0,
  })

  const tx = new Transaction().add(ataIx, buyIx)
  const { blockhash } = await conn.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = buyer
  const res = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })
  console.log('\n=== SIMULATE ===')
  console.log('err:', JSON.stringify(res.value.err))
  console.log('logs:')
  res.value.logs?.forEach(l => console.log('  ', l))
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
