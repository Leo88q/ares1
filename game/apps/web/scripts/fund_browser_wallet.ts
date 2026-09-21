import { Connection, Keypair, Transaction, PublicKey } from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SKR_MINT } from '../src/utils/anchorClient'

async function main() {
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf8'))))
  const owner = new PublicKey('HPMr5r9sS5ApWsPNJytZRLbm2jz1veFxTn1wepjAhtho')
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
  const ata = getAssociatedTokenAddressSync(SKR_MINT, owner)

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, SKR_MINT),
    createMintToInstruction(SKR_MINT, ata, payer.publicKey, 5_000_000_000n), // 5000 SKR (6 dec)
  )
  const { blockhash } = await conn.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = payer.publicKey
  tx.sign(payer)
  const sig = await conn.sendRawTransaction(tx.serialize())
  await conn.confirmTransaction(sig, 'confirmed')
  const bal = await conn.getTokenAccountBalance(ata)
  console.log('✅ ATA:', ata.toBase58())
  console.log('✅ баланс браузер-кошелька:', bal.value.uiAmount, 'TEST SKR')
  console.log('   tx:', sig)
}
main().catch(e => { console.error(e.message); process.exit(1) })
