import { PublicKey, Connection } from '@solana/web3.js'
import { Buffer } from 'buffer'

const PID = 'DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf'
const pid = new PublicKey(PID)
const conn = new Connection('https://api.devnet.solana.com', 'confirmed')

const [cfg] = PublicKey.findProgramAddressSync([Buffer.from('config')], pid)
const a = await conn.getAccountInfo(cfg)
console.log('GameConfig существует:', !!a)
if (a) {
  console.log('  текущий размер:', a.data.length, '(старый: 156, новый: 164)')
}

const all = await conn.getProgramAccounts(pid, { dataSlice: { offset: 0, length: 0 } }).catch(e => { console.error('gpa error:', e.message); return [] })
const sizes = {}
for (const x of all) sizes[x.account.data.length] = (sizes[x.account.data.length] || 0) + 1
console.log('Все аккаунты программы по размерам:', JSON.stringify(sizes))
console.log('Всего аккаунтов:', all.length)
