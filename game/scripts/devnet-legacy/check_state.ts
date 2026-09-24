import { Connection, PublicKey } from '@solana/web3.js'
import { presaleStatePda, buyerPresalePda, SKR_MINT } from '../../apps/web/src/utils/anchorClient'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

async function bal(conn: Connection, addr: string, label: string) {
  try {
    const b = await conn.getTokenAccountBalance(new PublicKey(addr))
    console.log(`${label.padEnd(20)} ${addr}  ${b.value.uiAmount} SKR  (${b.value.amount} атомов)`)
  } catch (e: any) {
    console.log(`${label.padEnd(20)} ${addr}  ⚠️ ${e.message}`)
  }
}

async function main() {
  const toml = readFileSync(join(import.meta.dirname, '../../Anchor.toml'), 'utf8')
  const devnet = toml.match(/\[programs\.devnet\]([\s\S]*?)(\n\[|$)/)!
  const PROGRAM_ID = new PublicKey(devnet[1].match(/solana_potato\s*=\s*"([^"]+)"/)![1])
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed')

  // балансы трёх ключевых ATA
  console.log('===== БАЛАНСЫ ATA =====')
  await bal(conn, '5u1FMBgpov5mjZsm5DLTexSz44Apg52ZKxUopiHXEMdw', 'казна (treasury)')
  await bal(conn, 'CRJKfEZGD37XSextZGFddFScTizubyNDzwg3A79BoPWe', 'buyback')
  await bal(conn, '97xjyG6wgknx7e81ZsW9UJnrsYQhDp5CqMqPSbVQWjJJ', 'покупатель (HPMr5…)')

  // PresaleState
  const presaleAddr = presaleStatePda(PROGRAM_ID)
  const presaleInfo = await conn.getAccountInfo(presaleAddr)
  console.log('\n===== PresaleState =====')
  if (presaleInfo) {
    const authority = new PublicKey(presaleInfo.data.slice(8, 40))
    const sold = presaleInfo.data.readUInt32LE(40)
    const cap = presaleInfo.data.readUInt32LE(44)
    const price = presaleInfo.data.readBigUInt64LE(48)
    const bump = presaleInfo.data[56]
    console.log('address  :', presaleAddr.toBase58())
    console.log('authority:', authority.toBase58())
    console.log('sold     :', sold, '/', cap)
    console.log('price    :', price.toString(), 'атомов =', Number(price) / 1e6, 'SKR')
    console.log('bump     :', bump)
  } else {
    console.log('PresaleState НЕ найден')
  }

  // BuyerPresale counter
  const buyer = new PublicKey('HPMr5r9sS5ApWsPNJytZRLbm2jz1veFxTn1wepjAhtho')
  const bpInfo = await conn.getAccountInfo(buyerPresalePda(PROGRAM_ID, buyer))
  console.log('\n===== BuyerPresale (HPMr5…) =====')
  if (bpInfo) {
    console.log('raw hex:', bpInfo.data.toString('hex'))
    // типичный layout: 8 disc + 4 count
    const count = bpInfo.data.readUInt32LE(8)
    console.log('count (offset 8):', count)
  } else {
    console.log('BuyerPresale НЕ найден')
  }
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
