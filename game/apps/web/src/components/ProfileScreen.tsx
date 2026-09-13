import { CheckCircle, XCircle, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import WalletManagement from './WalletManagement'
import { ReferralSection } from './ReferralSection'
import { useSolana } from '../contexts/SolanaContext'
import { useGame } from '../contexts/GameContext'
import { isTelegram } from '../utils/telegram'
import { fmtPotato, fmtSkr, EXPORT_LICENSE_PRICE_SKR_ATOMS } from '../utils/constants'
import { pdas, decodeExportLicense, ixBuyExportLicense, TEST_SKR_MINT } from '../utils/anchorClient'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { CabinBay } from './ares/CabinBay'
import AudioSettings from './AudioSettings'
import { HullPanel } from '../ui/HullPanel'
import { RollingNumber } from '../ui/RollingNumber'
import { SparkProgress } from '../ui/SparkProgress'

function ProfileScreenInner() {
 const { connected, publicKey, ready, programId, connection, sendIx } = useSolana()
 const { stats } = useGame()
 const [license, setLicense] = useState<{ expiresAt: number; active: boolean } | null>(null)
 const [buyingLicense, setBuyingLicense] = useState(false)

 useEffect(() => {
  if (!publicKey || !programId) return
  let cancelled = false
  const load = async () => {
   try {
    const pda = pdas(programId).exportLicense(publicKey)
    const acc = await connection.getAccountInfo(pda)
    if (acc) {
     const l = decodeExportLicense(acc.data as Buffer)
     const exp = Number(l.expiresAt)
     setLicense({ expiresAt: exp, active: exp > Math.floor(Date.now() / 1000) })
    } else setLicense(null)
   } catch { if (!cancelled) setLicense(null) }
  }
  load()
  const i = setInterval(load, 30_000)
  return () => { cancelled = true; clearInterval(i) }
 }, [publicKey, programId, connection])

 const buyLicense = async () => {
  if (!publicKey || !programId || !config || buyingLicense) return
  setBuyingLicense(true)
  try {
   const p = pdas(programId)
   const userSkrAta = await getAssociatedTokenAddress(TEST_SKR_MINT, publicKey)
   const ix = await ixBuyExportLicense(programId, {
    config: p.config(), license: p.exportLicense(publicKey), payer: publicKey,
    skrMint: TEST_SKR_MINT, userSkrAta,
   })
   await sendIx([ix])
   setLicense({ expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400, active: true })
  } catch (err) {
   console.error('buyLicense', err)
  } finally { setBuyingLicense(false) }
 }

 const licenseDays = license ? Math.max(0, Math.ceil((license.expiresAt - Math.floor(Date.now() / 1000)) / 86400)) : 0

 const fieldsToNext = 3 - (stats.totalFields % 3)

 return (
  <div style={{ padding: 20, paddingBottom: 140 }}>
   <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
    <h1 className="pf-h1" style={{ fontSize: 24 }}>КАЮТА</h1>
    <AudioSettings />
   </div>

   <WalletManagement />

   <ReferralSection />

   <HullPanel style={{ marginBottom: 16, padding: '14px 16px' }}>
    <div style={{ fontFamily: 'ui-monospace, "JetBrains Mono", monospace', fontSize: 10, letterSpacing: 1.5, opacity: 0.65, marginBottom: 8 }}>
     EXPORT LICENSE
    </div>
    {license?.active ? (
     <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pf-gold)', marginBottom: 4, fontFamily: 'ui-monospace, monospace' }}>
       АКТИВНА · {licenseDays} ДН.
      </div>
      <div style={{ fontSize: 12, opacity: 0.75, fontFamily: 'ui-monospace, monospace', marginBottom: 8 }}>
       КОМИССИЯ РЫНКА −3%
      </div>
      <button
       onClick={buyLicense}
       disabled={buyingLicense || !publicKey}
       style={{
        background: 'var(--pf-gold)', color: '#1a1208', border: 'none', cursor: 'pointer',
        padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
        fontFamily: 'ui-monospace, monospace', opacity: buyingLicense || !publicKey ? 0.6 : 1, width: '100%',
       }}
      >
       {buyingLicense ? 'ОТПРАВКА…' : 'ПРОДЛИТЬ ЛИЦЕНЗИЮ'}
      </button>
     </div>
    ) : (
     <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, opacity: 0.9, fontFamily: 'ui-monospace, monospace' }}>
       {fmtSkr(EXPORT_LICENSE_PRICE_SKR_ATOMS, 0)} SKR · 30 ДН.
      </div>
      <button
       onClick={buyLicense}
       disabled={buyingLicense || !publicKey}
       style={{
        background: 'var(--pf-gold)', color: '#1a1208', border: 'none', cursor: 'pointer',
        padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
        fontFamily: 'ui-monospace, monospace', opacity: buyingLicense || !publicKey ? 0.6 : 1, width: '100%',
       }}
      >
       {buyingLicense ? 'ОТПРАВКА…' : 'ПРИОБРЕСТИ ЛИЦЕНЗИЮ'}
      </button>
     </div>
    )}
   </HullPanel>

   <HullPanel variant="accent" style={{ marginBottom: 16 }}>
    <div style={{ padding: 20, textAlign: 'center' }}>
     <div className="ares-mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(255,179,71,0.8)', marginBottom: 8 }}>ПАЁК НА СКЛАДЕ</div>
     <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--pf-gold)' }}>
      <RollingNumber value={stats.potatoBalance / 1000000} decimals={2} /> POTATO
     </div>
     {stats.pendingHarvest > 0 && (
      <div style={{ fontSize: 12, color: 'var(--pf-teal)', marginTop: 4 }}>+{fmtPotato(stats.pendingHarvest, 3)} POTATO ждёт жатвы на делянках</div>
     )}
    </div>
   </HullPanel>

   <HullPanel style={{ marginBottom: 16 }}>
    <div style={{ padding: 20 }}>
     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
       <Trophy size={18} color="var(--pf-gold)" aria-hidden="true" />
       <span style={{ fontSize: 16, fontWeight: 700 }}>Ранг {stats.playerLevel}</span>
      </div>
      <span className="ares-mono" style={{ fontSize: 11, color: 'var(--pf-text-secondary)' }}>
       <RollingNumber value={Math.floor(stats.experience)} /> стажа
      </span>
     </div>
     <div style={{ marginBottom: 8 }}>
      <SparkProgress value={(stats.totalFields % 3) / 3 * 100} label="Прогресс до следующего ранга" color="#FFC94A" />
     </div>
     <p style={{ fontSize: 12, color: 'var(--pf-text-secondary)' }}>
      До ранга {stats.playerLevel + 1}: ещё {fieldsToNext} пол{fieldsToNext === 1 ? 'е' : 'я'}. Ранг игрока растёт с каждыми 3 полями.
     </p>
    </div>
   </HullPanel>

   <HullPanel variant="danger" style={{ marginBottom: 16 }}>
    <div style={{ padding: 20 }}>
    <h3 className="ares-mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'rgba(255,179,71,0.85)', marginBottom: 12 }}>ДИАГНОСТИКА СКАФАНДРА</h3>
    <StatusRow label="Кошелёк" ok={connected} value={publicKey ? `${publicKey.toString().slice(0, 4)}…${publicKey.toString().slice(-4)}` : 'Не подключён'} />
    <StatusRow label="Блокчейн" ok={ready} value={ready ? 'Подключён' : 'Загрузка…'} />
    <StatusRow label="Telegram" ok={isTelegram()} value={isTelegram() ? 'Mini App' : 'Браузер'} />
    </div>
   </HullPanel>
  </div>
 )
}

function StatusRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
 return (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
   <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    {ok ? <CheckCircle size={16} color="var(--pf-teal)" aria-hidden="true" /> : <XCircle size={16} color="var(--pf-red)" aria-hidden="true" />}
    <span style={{ fontSize: 14 }}>{label}</span>
   </div>
   <span style={{ fontSize: 13, color: ok ? 'var(--pf-teal)' : 'var(--pf-red)' }}>{value}</span>
  </div>
 )
}

export default function ProfileScreen() {
 return (
  <CabinBay>
   <ProfileScreenInner />
  </CabinBay>
 );
}
