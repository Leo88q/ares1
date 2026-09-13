import { Connection, Keypair, Transaction, PublicKey } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  ixInitPresale, presaleStatePda, treasurySolPda, treasurySkrAta, buybackSkrAta,
  TEST_SKR_MINT, pdas,
} from '../src/utils/anchorClient'

async function main() {
  const toml = readFileSync(join(process.cwd(), '../../Anchor.toml'), 'utf8')
  const devnet = toml.match(/\[programs\.devnet\]([\s\S]*?)(\n\[|$)/)
  const m = devnet ? devnet[1].match(/solana_potato\s*=\s*"([^"]+)"/) : null
  if (!m) throw new Error('program id не найден в [programs.devnet]')
  const PROGRAM_ID = new PublicKey(m[1])
  console.log('program id (devnet):', PROGRAM_ID.toBase58())

  const walletPath = process.env.ANCHOR_WALLET ?? join(homedir(), '.config', 'solana', 'id.json')
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, 'utf8'))))
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed')

  const { config } = pdas(PROGRAM_ID)
  const presaleState = presaleStatePda(PROGRAM_ID)
  const treasurySol = treasurySolPda(PROGRAM_ID)
  const treasuryAta = treasurySkrAta(PROGRAM_ID, TEST_SKR_MINT)
  const buybackAta = buybackSkrAta(payer.publicKey, TEST_SKR_MINT)

  console.log('Создание ATA казны и buyback + инициализация пресейла (cap 500, 1053 SKR)...')
  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, treasuryAta, treasurySol, TEST_SKR_MINT),
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, buybackAta, payer.publicKey, TEST_SKR_MINT),
    await ixInitPresale(PROGRAM_ID, {
      config: config(),
      presaleState,
      authority: payer.publicKey,
      cap: 500,
      priceLamports: 1_053_000_000n, // 1053 SKR (6 dec) = 2000 RUB
    }),
  ]

  const tx = new Transaction().add(...ixs)
  const { blockhash } = await conn.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = payer.publicKey
  tx.sign(payer)
  const sig = await conn.sendRawTransaction(tx.serialize())
  await conn.confirmTransaction(sig, 'confirmed')
  console.log('✅ пресейл: цена 1053 SKR, ATA казны и buyback созданы')
  console.log('   tx:', sig)
  console.log('   treasuryAta:', treasuryAta.toBase58())
  console.log('   buybackAta :', buybackAta.toBase58())
}

main().catch(console.error)
