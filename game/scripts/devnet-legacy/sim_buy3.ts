import { Connection, PublicKey, Transaction, VersionedTransaction, VersionedMessage } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import {
  ixBuyFieldSkr, pdas, presaleStatePda, buyerPresalePda, treasurySolPda,
  treasurySkrAta, buybackSkrAta, SKR_MINT,
} from '../../apps/web/src/utils/anchorClient'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const toml = readFileSync(join(import.meta.dirname, '../../Anchor.toml'), 'utf8')
  const devnet = toml.match(/\[programs\.devnet\]([\s\S]*?)(\n\[|$)/)!
  const PROGRAM_ID = new PublicKey(devnet[1].match(/solana_potato\s*=\s*"([^"]+)"/)![1])

  const buyer = new PublicKey('HPMr5r9sS5ApWsPNJytZRLbm2jz1veFxTn1wepjAhtho')
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed')

  const { config, field } = pdas(PROGRAM_ID)
  const configAddr = config()
  const presaleAddr = presaleStatePda(PROGRAM_ID)

  const presaleInfo = await conn.getAccountInfo(presaleAddr)
  if (!presaleInfo) throw new Error('PresaleState не найден')
  const presaleAuthority = new PublicKey(presaleInfo.data.slice(8, 40))
  console.log('authority:', presaleAuthority.toBase58())

  const fieldId = BigInt(Date.now())
  const buyerSkrAta = getAssociatedTokenAddressSync(SKR_MINT, buyer)
  const treasurySolAddr = treasurySolPda(PROGRAM_ID)
  const treasurySkrAddr = treasurySkrAta(PROGRAM_ID, SKR_MINT)
  const buybackSkrAddr = buybackSkrAta(presaleAuthority, SKR_MINT)

  console.log('buyerSkrAta:', buyerSkrAta.toBase58())
  console.log('treasurySkrAta:', treasurySkrAddr.toBase58())
  console.log('buybackSkrAta:', buybackSkrAddr.toBase58())

  const ataIx = createAssociatedTokenAccountIdempotentInstruction(buyer, buyerSkrAta, buyer, SKR_MINT)
  const buyIx = await ixBuyFieldSkr(PROGRAM_ID, {
    config: configAddr,
    presaleState: presaleAddr,
    authority: presaleAuthority,
    buyerPresale: buyerPresalePda(PROGRAM_ID, buyer),
    field: field(fieldId),
    buyer,
    treasurySol: treasurySolAddr,
    skrMint: SKR_MINT,
    buyerSkrAta,
    treasurySkrAta: treasurySkrAddr,
    buybackSkrAta: buybackSkrAddr,
    fieldId,
    fieldType: 0,
  })
  console.log('✅ инструкции созданы')

  const tx = new Transaction().add(ataIx, buyIx)
  const { blockhash } = await conn.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = buyer

  // simulateTransaction без опций — sigVerify=false по умолчанию для unsigned tx
  const sim = await conn.simulateTransaction(tx)
  console.log('\nerr:', JSON.stringify(sim.value.err))
  sim.value.logs?.forEach(l => console.log('  ', l))
}
main().catch(e => { console.error('FATAL:', e.message ?? e); process.exit(1) })
