import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import {
  ixBuyFieldSkr, pdas, presaleStatePda, buyerPresalePda, treasurySolPda,
  treasurySkrAta, buybackSkrAta, SKR_MINT,
} from '../src/utils/anchorClient'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const toml = readFileSync(join(process.cwd(), '../../Anchor.toml'), 'utf8')
  const devnet = toml.match(/\[programs\.devnet\]([\s\S]*?)(\n\[|$)/)
  const PROGRAM_ID = new PublicKey(devnet![1].match(/solana_potato\s*=\s*"([^"]+)"/)![1])
  const buyer = new PublicKey('HPMr5r9sS5ApWsPNJytZRLbm2jz1veFxTn1wepjAhtho')
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed')

  const { config } = pdas(PROGRAM_ID)
  const authority = config() // заглушка: реальный authority читается из GameConfig; ниже перезапишем
  // читаем authority из конфига цепи
  const cfgAddr = config()
  const cfgAcc = await conn.getAccountInfo(cfgAddr)
  if (!cfgAcc) throw new Error('GameConfig не найден')
  const cfgAuthority = new PublicKey(cfgAcc.data.slice(8, 40)) // первое поле Pubkey после дискриминатора... уточним по логам

  const fieldId = 12345n
  const buyerSkrAta = getAssociatedTokenAddressSync(SKR_MINT, buyer)
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(buyer, buyerSkrAta, buyer, SKR_MINT)
  const buyIx = await ixBuyFieldSkr(PROGRAM_ID, {
    config: cfgAddr,
    presaleState: presaleStatePda(PROGRAM_ID),
    authority: cfgAuthority,
    buyerPresale: buyerPresalePda(PROGRAM_ID, buyer),
    field: pdas(PROGRAM_ID).field(fieldId),
    buyer,
    treasurySol: treasurySolPda(PROGRAM_ID),
    skrMint: SKR_MINT,
    buyerSkrAta,
    treasurySkrAta: treasurySkrAta(PROGRAM_ID, SKR_MINT),
    buybackSkrAta: buybackSkrAta(cfgAuthority, SKR_MINT),
    fieldId,
    fieldType: 0,
  })

  const tx = new Transaction().add(ataIx, buyIx)
  const { blockhash } = await conn.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = buyer
  const res = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })
  console.log('err:', res.value.err)
  console.log('logs:')
  res.value.logs?.forEach(l => console.log('  ', l))
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
