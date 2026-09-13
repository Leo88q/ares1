import { Connection, Keypair, Transaction, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { pdas, potatoAta, ixFillOrder, decodeMarketOrder, decodeConfig, TEST_SKR_MINT } from '../src/utils/anchorClient'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ORDER_SIZE = 8 + 32 + 8 + 8 + 8 + 1 + 8 + 8 + 1 + 1

async function main() {
  const toml = readFileSync(join(process.cwd(), '../../Anchor.toml'), 'utf8')
  const devnet = toml.match(/\[programs\.devnet\]([\s\S]*?)(\n\[|$)/)!
  const PROGRAM_ID = new PublicKey(devnet[1].match(/solana_potato\s*=\s*"([^"]+)"/)![1])
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
  const buyer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf8'))))

  const { config, escrow, marketStats } = pdas(PROGRAM_ID)
  const cfgAcc = await conn.getAccountInfo(config())
  if (!cfgAcc) throw new Error('GameConfig не найден')
  const cfg = decodeConfig(cfgAcc.data)
  const mint = new PublicKey(cfg.potatoMint as any)
  console.log('potato mint:', mint.toBase58())

  // проверяем ATA у CLI
  const buyerSkrAta = getAssociatedTokenAddressSync(TEST_SKR_MINT, buyer.publicKey)
  try {
    const b = await conn.getTokenAccountBalance(buyerSkrAta)
    console.log('CLI SKR:', b.value.uiAmount)
  } catch (e: any) {
    throw new Error('У CLI нет ATA для SKR: ' + e.message)
  }

  // активные ордера
  const accs = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: ORDER_SIZE }, { memcmp: { offset: 44, bytes: '1' } }],
  })
  if (!accs.length) { console.log('⚠️ активных ордеров нет'); return }
  console.log('найдено активных ордеров:', accs.length)
  for (const a of accs) {
    const d = decodeMarketOrder(a.account.data)
    console.log(' -', a.pubkey.toBase58(), Number(d.amountMicro)/1e6, 'POTATO @', Number(d.priceLamportsPerPotato)/1e6, 'SKR/шт от', d.seller.toBase58())
  }

  const orderPk = accs[0].pubkey
  const d = decodeMarketOrder(accs[0].account.data)
  console.log('\nвыбран первый ордер:', orderPk.toBase58())
  console.log('  продавец:', d.seller.toBase58())
  console.log('  объём:', Number(d.amountMicro) / 1e6, 'POTATO')
  console.log('  цена:', Number(d.priceLamportsPerPotato) / 1e6, 'SKR/шт')

  const sellerSkrAta = getAssociatedTokenAddressSync(TEST_SKR_MINT, d.seller)
  try {
    const b = await conn.getTokenAccountBalance(sellerSkrAta)
    console.log('  SKR продавца (до):', b.value.uiAmount)
  } catch (e: any) {
    console.log('  ⚠️ у продавца нет SKR ATA — создастся idempotent в транзакции? нет, нужен ATA. Пропустим.')
  }

  const buyerPotatoAta = potatoAta(buyer.publicKey, mint)
  // idempotent: создаст ATA CLI для POTATO если его ещё нет
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    buyer.publicKey, buyerPotatoAta, buyer.publicKey, mint
  )

  const ix = await ixFillOrder(PROGRAM_ID, {
    buyer: buyer.publicKey,
    seller: d.seller,
    config: config(),
    potatoMint: mint,
    marketStats: marketStats(),
    order: orderPk,
    escrow: escrow(orderPk),
    buyerPotato: buyerPotatoAta,
    skrMint: TEST_SKR_MINT,
    buyerSkrAta,
    sellerSkrAta,
    treasuryPotato: potatoAta(config(), mint),
  })

  const tx = new Transaction().add(ataIx, ix)
  const { blockhash } = await conn.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = buyer.publicKey
  tx.sign(buyer)

  // симуляция для логов
  const sim = await conn.simulateTransaction(tx)
  console.log('\n=== SIM ===')
  console.log('err:', JSON.stringify(sim.value.err))
  sim.value.logs?.forEach(l => console.log(' ', l))
  if (sim.value.err) throw new Error('симуляция упала')

  const sig = await conn.sendRawTransaction(tx.serialize())
  console.log('sent:', sig)
  await conn.confirmTransaction(sig, 'confirmed')
  console.log('✅ куплено')

  const skrSeller = await conn.getTokenAccountBalance(sellerSkrAta)
  console.log('SKR продавца после:', skrSeller.value.uiAmount)
  const skrBuyer = await conn.getTokenAccountBalance(buyerSkrAta)
  console.log('SKR покупателя после:', skrBuyer.value.uiAmount)
}
main().catch(e => {
  console.error('FATAL:', e)
  if (e?.stack) console.error(e.stack)
  process.exit(1)
})
