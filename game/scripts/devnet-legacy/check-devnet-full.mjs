import { PublicKey, Connection } from '@solana/web3.js'
import { Buffer } from 'buffer'

const PID = 'DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf'
const pid = new PublicKey(PID)
const conn = new Connection('https://api.devnet.solana.com', 'confirmed')

const all = await conn.getProgramAccounts(pid).catch(e => { console.error('gpa error:', e.message); return [] })

// Известные дискриминаторы Anchor: sha256("account:<Name>")[0..8]
import { createHash } from 'crypto'
function disc(name) {
  return createHash('sha256').update(`account:${name}`).digest().slice(0, 8).toString('hex')
}

const known = {
  'Field': disc('Field'),
  'GameConfig': disc('GameConfig'),
  'Epoch': disc('Epoch'),
  'MarketOrder': disc('MarketOrder'),
  'MarketStats': disc('MarketStats'),
  'Achievements': disc('Achievements'),
  'ExportLicense': disc('ExportLicense'),
  'PresaleState': disc('PresaleState'),
  'BuyerPresale': disc('BuyerPresale'),
}

const byType = {}
for (const x of all) {
  const d = x.account.data.slice(0, 8).toString('hex')
  const name = Object.entries(known).find(([n, h]) => h === d)?.[0] || 'UNKNOWN'
  const size = x.account.data.length
  if (!byType[name]) byType[name] = []
  byType[name].push({ pubkey: x.pubkey.toBase58(), size, owner: name })
}

console.log('═══════════════════════════════════════════════════')
console.log('СОСТОЯНИЕ DEVNET (program:', PID, ')')
console.log('═══════════════════════════════════════════════════')
for (const [name, accs] of Object.entries(byType)) {
  console.log(`\n[${name}] — ${accs.length} шт.`)
  for (const a of accs.slice(0, 3)) {
    console.log(`  ${a.pubkey}  (${a.size} байт)`)
  }
  if (accs.length > 3) console.log(`  ... и ещё ${accs.length - 3}`)
}

// Старые vs новые размеры
// F-21/F-22: актуальные layout'ы (сверено с MIGRATIONS.md от 23.09.2026).
// olds = устаревшие размеры, требующие миграции; current = целевой.
const expected = {
  'GameConfig': { olds: [156, 164, 228], current: 260 },
  'Field': { olds: [69], current: 70 },
  'Epoch': { olds: [41], current: 49 },
  'AdminState': { olds: [97], current: 145 },
  'MarketOrder': { olds: [83], current: 83 }, // не менялся
}
console.log('\n═══════════════════════════════════════════════════')
console.log('НУЖНА МИГРАЦИЯ:')
for (const [name, accs] of Object.entries(byType)) {
  if (expected[name] && accs.some(a => expected[name].olds.includes(a.size))) {
    const oldCount = accs.filter(a => expected[name].olds.includes(a.size)).length
    console.log(`  ${name}: ${oldCount} шт. (${expected[name].olds.join('/')} → ${expected[name].current})`)
  }
}
