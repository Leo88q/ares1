import { PublicKey, Connection, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { ixMigrateConfig, ixMigrateField, ixMigrateEpoch, pdas } from './src/utils/anchorClient.ts'

const PID = '48D2uN5dwrpQuCJcb8Bge1hRkJVCRcS4J1JicAoAvMha'
const pid = new PublicKey(PID)
const conn = new Connection('https://api.devnet.solana.com', 'confirmed')

// Загружаем authority keypair
const keyPath = homedir() + '/.config/solana/id.json'
const keyBytes = JSON.parse(readFileSync(keyPath, 'utf8'))
const authority = Keypair.fromSecretKey(new Uint8Array(keyBytes))
console.log('Authority:', authority.publicKey.toBase58())

// Находим все аккаунты
const all = await conn.getProgramAccounts(pid)

// Известные дискриминаторы
import { createHash } from 'crypto'
function disc(name) {
  return createHash('sha256').update(`account:${name}`).digest().slice(0, 8)
}

const discs = {
  Field: disc('Field'),
  GameConfig: disc('GameConfig'),
  Epoch: disc('Epoch'),
}

const configPda = pdas(pid).config()

console.log('\n═══════════════════════════════════════════════════')
console.log('МИГРАЦИЯ DEVNET → v2')
console.log('═══════════════════════════════════════════════════')

// 1. Мигрируем GameConfig (156 → 164)
const cfgAcc = all.find(x => x.account.data.length === 156 && x.account.data.slice(0, 8).equals(discs.GameConfig))
if (cfgAcc) {
  console.log('\n[1/3] Миграция GameConfig (156 → 164)...')
  const ix = await ixMigrateConfig(pid, { config: cfgAcc.pubkey, authority: authority.publicKey })
  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(conn, tx, [authority])
  console.log('  ✓ GameConfig мигрирован:', sig.slice(0, 20) + '...')
} else {
  console.log('\n[1/3] GameConfig: не найден или уже мигрирован')
}

// 2. Мигрируем все Field (69 → 70)
const fields = all.filter(x => x.account.data.length === 69 && x.account.data.slice(0, 8).equals(discs.Field))
if (fields.length > 0) {
  console.log(`\n[2/3] Миграция ${fields.length} Field (69 → 70)...`)
  for (let i = 0; i < fields.length; i++) {
    const ix = await ixMigrateField(pid, { field: fields[i].pubkey, config: configPda, authority: authority.publicKey })
    const tx = new Transaction().add(ix)
    const sig = await sendAndConfirmTransaction(conn, tx, [authority])
    console.log(`  ✓ Field ${i+1}/${fields.length}:`, sig.slice(0, 20) + '...')
  }
} else {
  console.log('\n[2/3] Field: не найдены или уже мигрированы')
}

// 3. Мигрируем Epoch (41 → 49)
const epochAcc = all.find(x => x.account.data.length === 41 && x.account.data.slice(0, 8).equals(discs.Epoch))
if (epochAcc) {
  console.log('\n[3/3] Миграция Epoch (41 → 49)...')
  const ix = await ixMigrateEpoch(pid, { epoch: epochAcc.pubkey, config: configPda, authority: authority.publicKey })
  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(conn, tx, [authority])
  console.log('  ✓ Epoch мигрирован:', sig.slice(0, 20) + '...')
} else {
  console.log('\n[3/3] Epoch: не найден или уже мигрирован')
}

console.log('\n═══════════════════════════════════════════════════')
console.log('МИГРАЦИЯ ЗАВЕРШЕНА')
console.log('═══════════════════════════════════════════════════')
