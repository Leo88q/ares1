import { CheckCircle, XCircle, Trophy } from 'lucide-react'
import { useI18n, plural } from '../i18n'

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import WalletManagement from './WalletManagement'
import { ReferralSection } from './ReferralSection'
import { useSolana, CLUSTER } from '../contexts/SolanaContext'
import { useGame } from '../contexts/GameContext'
import { getAchievements } from '../utils/achievements'
import { ShiftTasksList, type ShiftTask } from './ares/ShiftTasksList'

import { fmtPotato, fmtSkr, EXPORT_LICENSE_PRICE_SKR_ATOMS, HARVEST_THRESHOLD_MICRO, MAX_DURABILITY } from '../utils/constants'
import { pdas, decodeExportLicense, ixBuyExportLicense, treasurySolPda, treasurySkrAta, SKR_MINT } from '../utils/anchorClient'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { CabinBay } from './ares/CabinBay'
import AudioSettings from './AudioSettings'
import { RollingNumber } from '../ui/RollingNumber'
import { SparkProgress } from '../ui/SparkProgress'
import { PatchWall } from './ares/PatchWall'
import { useToast } from './Toast'
import { describeError } from '../utils/errors'

function ProfileScreenInner() {
 const { t } = useI18n()
 const { connected, publicKey, ready, programId, connection, sendIx } = useSolana()
 const { stats, claimed, fields } = useGame()
 const navigate = useNavigate()
 const { show } = useToast()
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
  if (!publicKey || !programId || buyingLicense) return
  setBuyingLicense(true)
  try {
   const p = pdas(programId)
   const userSkrAta = await getAssociatedTokenAddress(SKR_MINT, publicKey)
   const ix = await ixBuyExportLicense(programId, {
    config: p.config(), license: p.exportLicense(publicKey), payer: publicKey,
    skrMint: SKR_MINT, userSkrAta,
    treasurySol: treasurySolPda(programId), treasurySkrAta: treasurySkrAta(programId, SKR_MINT),
   })
   await sendIx([ix])
   setLicense({ expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400, active: true })
  } catch (err) {
   console.error('buyLicense', err)
   show({ type: 'error', title: t('Не удалось купить лицензию'), message: describeError(err) })
  } finally { setBuyingLicense(false) }
 }

 const licenseDays = license ? Math.max(0, Math.ceil((license.expiresAt - Math.floor(Date.now() / 1000)) / 86400)) : 0

 const fieldsToNext = 3 - (stats.totalFields % 3)

 const rankTitle = useMemo(() => {
  const titles = [
   t('Кадет-Агроном'),
   t('Младший Колонист'),
   t('Старший Оператор'),
   t('Мастер Купола'),
   t('Командир Сектора'),
   t('Марсианская Легенда'),
  ]
  return titles[Math.min(Math.max(0, stats.playerLevel - 1), titles.length - 1)]
 }, [stats.playerLevel, t])

 const patches = [
  { id: 'a1', label: t('Первый росток'), imageSrc: '/ares/patch-sprout.webp', earned: Boolean(claimed.a1) },
  { id: 'a2', label: t('Первый урожай'), imageSrc: '/ares/patch-harvest.webp', earned: Boolean(claimed.a2) },
  { id: 'a3', label: t('Тысячник'), imageSrc: '/ares/patch-thousand.webp', earned: Boolean(claimed.a3) },
  { id: 'a4', label: t('Фермер-магнат'), imageSrc: '/ares/patch-magnat.webp', earned: Boolean(claimed.a4) },
  { id: 'a5', label: t('Картофельный барон'), imageSrc: '/ares/patch-baron.webp', earned: Boolean(claimed.a5) },
  { id: 'a6', label: t('Ветеран'), imageSrc: '/ares/patch-veteran.webp', earned: Boolean(claimed.a6) },
 ]

 // Задачи смены — живой чеклист из состояния игры: показываем только то,
 // что требует действия прямо сейчас. Тап ведёт на нужный экран.
 const tasks: ShiftTask[] = useMemo(() => {
  const list: ShiftTask[] = []
  if (stats.totalFields === 0) {
   list.push({ id: 'buy-first', title: t('Заложи первое поле'), done: false, rewardLabel: 'LVL 1' })
  }
  const readyPatch = getAchievements(stats).find(a => a.progress >= a.target && !claimed[a.id])
  if (readyPatch) {
   list.push({ id: 'claim-patch', title: t('Забери нашивку в журнале'), done: false, rewardLabel: `+${readyPatch.reward} POTATO` })
  }
  if (stats.pendingHarvest >= HARVEST_THRESHOLD_MICRO) {
   list.push({ id: 'harvest', title: t('Собери урожай: {n} POTATO', { n: fmtPotato(stats.pendingHarvest, 1) }), done: false })
  }
  const nowSec = Math.floor(Date.now() / 1000)
  const taxDue = fields.filter(f => f.isActive && f.taxPaidUntil < nowSec).length
  if (taxDue > 0) {
   list.push({ id: 'pay-tax', title: t('Пошлина просрочена: {n}', { n: taxDue }), done: false, rewardLabel: `×${taxDue}` })
  }
  const worn = fields.filter(f => f.isActive && f.durability < MAX_DURABILITY).length
  if (worn > 0) {
   list.push({ id: 'repair', title: t('Техремонт требуется: {n}', { n: worn }), done: false, rewardLabel: `×${worn}` })
  }
  if (list.length === 0) {
   list.push({ id: 'all-clear', title: t('Все системы в норме'), done: true })
  }
  return list
 }, [stats, claimed, fields, t])

 const handleTaskComplete = (id: string) => {
  navigate(id === 'claim-patch' ? '/stats' : '/')
 }

 return (
  <div style={{ padding: '24px 20px', paddingBottom: 140, position: 'relative' }}>
   <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
    <div>
     <h1 className="pf-h1 po-spray" style={{ fontSize: 26, letterSpacing: '0.18em', color: '#EFD9AC' }}>{t("КАЮТА")}</h1>
     <p style={{ fontSize: 12, color: 'var(--ares-dust, #E0A183)', marginTop: 2 }}>{t("Персональный отсек колониста и статус экспедиции")}</p>
    </div>
    <AudioSettings />
   </div>

   <WalletManagement />

   <ReferralSection />

   {/* Лицензия экспортёра */}
   <div
    style={{
     marginBottom: 16,
     padding: '18px 20px',
     borderRadius: 12,
     background: 'linear-gradient(180deg, #241A12 0%, #160F09 100%)',
     border: '1px solid #4D331D',
     boxShadow: 'inset 0 1px 0 rgba(255, 214, 170, 0.12), 0 8px 24px rgba(0, 0, 0, 0.5)',
    }}
   >
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
     <div style={{ fontFamily: 'var(--ares-font-stencil)', fontSize: 11, letterSpacing: '0.18em', color: '#D4A576', textTransform: 'uppercase' }}>
      {t("ЛИЦЕНЗИЯ ЭКСПОРТЁРА // ТОРГОВЫЙ ДОПУСК")}
     </div>
     <span className={`po-lamp ${license?.active ? 'po-lamp--green' : 'po-lamp--off'}`} aria-hidden="true" />
    </div>

    {license?.active ? (
     <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
       <span style={{ fontSize: 15, fontWeight: 700, color: '#FFC94A', fontFamily: 'var(--ares-font-mono)' }}>
        {t('СТАТУС: АКТИВНА · ОСТАЛОСЬ {d} ДН.', { d: licenseDays })}
       </span>
       <span className="ares-mono" style={{ fontSize: 11, color: '#9FBE7A', background: 'rgba(159,190,122,0.15)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(159,190,122,0.3)' }}>
        {t('КОМИССИЯ −3%')}
       </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ares-dust, #E0A183)', marginBottom: 14, lineHeight: 1.4 }}>
       {t('Торговый сертификат снижает комиссию на P2P бирже Снабжения и даёт приоритет в стакане.')}
      </p>
      <button
       onClick={buyLicense}
       disabled={buyingLicense || !publicKey}
       className="mk-key mk-key--paint"
       style={{
        cursor: 'pointer',
        padding: '11px 16px', fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
        opacity: buyingLicense || !publicKey ? 0.6 : 1, width: '100%',
       }}
      >
       {buyingLicense ? t('ОТПРАВКА…') : t('ПРОДЛИТЬ ЛИЦЕНЗИЮ')}
      </button>
     </div>
    ) : (
     <div>
      <p style={{ fontSize: 12, color: 'var(--ares-dust, #E0A183)', marginBottom: 12, lineHeight: 1.4 }}>
       {t('Лицензия даёт скидку −3% на торговые сборы P2P биржи и статус верифицированного экспортёра колонии.')}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: '#120B07', border: '1px solid #3E2413' }}>
       <span className="ares-mono" style={{ fontSize: 14, fontWeight: 700, color: '#F6F1ED' }}>
        {fmtSkr(EXPORT_LICENSE_PRICE_SKR_ATOMS, 0)} SKR
       </span>
       <span className="ares-mono" style={{ fontSize: 11, color: '#C9A176' }}>
        {t('СРОК ДЕЙСТВИЯ: 30 ДНЕЙ')}
       </span>
      </div>
      <button
       onClick={buyLicense}
       disabled={buyingLicense || !publicKey}
       className="mk-key mk-key--paint"
       style={{
        cursor: 'pointer',
        padding: '11px 16px', fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
        opacity: buyingLicense || !publicKey ? 0.6 : 1, width: '100%',
       }}
      >
       {buyingLicense ? t('ОТПРАВКА…') : t('ПРИОБРЕСТИ ЛИЦЕНЗИЮ')}
      </button>
     </div>
    )}
   </div>

   {/* Паёк на складе */}
   <div
    style={{
     marginBottom: 16,
     padding: '22px 18px',
     textAlign: 'center',
     borderRadius: 12,
     background: 'linear-gradient(180deg, #2A1C12 0%, #1A110A 100%)',
     border: '1px solid #5A361A',
     boxShadow: 'inset 0 1px 0 rgba(255, 214, 170, 0.16), 0 10px 28px rgba(0, 0, 0, 0.6)',
    }}
   >
    <div className="po-spray" style={{ fontFamily: 'var(--ares-font-stencil)', fontSize: 11, letterSpacing: '0.2em', color: '#D4A576', marginBottom: 10, textTransform: 'uppercase' }}>
     {t('ПАЁК НА СКЛАДЕ')}
    </div>
    <div className="po-lcd lcd-readout" style={{ display: 'inline-block', padding: '10px 24px', fontSize: 32, marginBottom: 8 }}>
     <RollingNumber value={stats.potatoBalance / 1000000} decimals={2} /> POTATO
    </div>
    {stats.pendingHarvest > 0 && (
     <div style={{ fontSize: 12, color: '#9FBE7A', marginTop: 6 }} className="ares-mono">
      +{fmtPotato(stats.pendingHarvest, 3)} {t('POTATO ждёт жатвы на делянках')}
     </div>
    )}
   </div>

   <div style={{ marginBottom: 16 }}>
    <ShiftTasksList tasks={tasks} onComplete={handleTaskComplete} />
   </div>

   {/* Ранг колониста */}
   <div
    style={{
     marginBottom: 16,
     padding: 20,
     borderRadius: 12,
     background: 'linear-gradient(180deg, #241A12 0%, #160F09 100%)',
     border: '1px solid #4D331D',
     boxShadow: 'inset 0 1px 0 rgba(255, 214, 170, 0.12), 0 8px 24px rgba(0, 0, 0, 0.5)',
    }}
   >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
     <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
       <Trophy size={18} color="#FFC94A" aria-hidden="true" />
       <span style={{ fontSize: 16, fontWeight: 700, color: '#F6F1ED' }}>{rankTitle}</span>
      </div>
      <div className="ares-mono" style={{ fontSize: 11, color: '#C9A176', marginTop: 3 }}>
       {t('РАНГ')} {stats.playerLevel} · {stats.totalFields} {plural(stats.totalFields, { one: t('делянка'), few: t('делянки'), many: t('делянок') })}
      </div>
     </div>
     <span className="ares-mono" style={{ fontSize: 12, color: '#FFC94A', background: 'rgba(255,201,74,0.12)', padding: '3px 8px', borderRadius: 4, border: '1px solid rgba(255,201,74,0.3)' }}>
      <RollingNumber value={Math.floor(stats.experience)} /> {t('XP')}
     </span>
    </div>

    <div style={{ marginBottom: 10 }}>
     <SparkProgress value={(stats.totalFields % 3) / 3 * 100} label={t("Прогресс до следующего ранга")} color="#FFC94A" />
    </div>

    <div style={{ fontSize: 11, color: 'var(--ares-dust, #E0A183)', marginBottom: 14, lineHeight: 1.4 }}>
     {t('До ранга {next}: ещё {plots}. Каждые 3 действующие делянки повышают ранг колониста.', {
      next: stats.playerLevel + 1,
      plots: plural(fieldsToNext, { one: t('поле'), few: t('поля'), many: t('полей') }),
     })}
    </div>

    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
     <div style={{ fontSize: 11, color: '#9FBE7A', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span>✓</span> <span>{t('Биосинтез и культивация делянок разблокированы')}</span>
     </div>
     <div style={{ fontSize: 11, color: '#9FBE7A', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span>✓</span> <span>{t('Доступ к открытой P2P бирже Снабжения')}</span>
     </div>
     <div style={{ fontSize: 11, color: 'rgba(255,179,71,0.5)', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span>🔒</span> <span>{t('Ранг {n}: улучшенная сопротивляемость износу кассет', { n: stats.playerLevel + 1 })}</span>
     </div>
    </div>
   </div>

   {/* Стена нашивок */}
   <div
    style={{
     marginBottom: 16,
     padding: 20,
     borderRadius: 12,
     background: 'linear-gradient(180deg, #241A12 0%, #160F09 100%)',
     border: '1px solid #4D331D',
     boxShadow: 'inset 0 1px 0 rgba(255, 214, 170, 0.12), 0 8px 24px rgba(0, 0, 0, 0.5)',
    }}
   >
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
     <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Trophy size={18} color="#FFC94A" aria-hidden="true" />
      <span style={{ fontSize: 16, fontWeight: 700, color: '#F6F1ED' }}>{t('Стена нашивок')}</span>
     </div>
     <span className="po-lamp po-lamp--green" aria-hidden="true" />
    </div>
    <p style={{ fontSize: 12, color: 'var(--ares-dust, #E0A183)', marginBottom: 14, lineHeight: 1.4 }}>
     {t('Официальные знаки отличия марсианской миссии. Выполняй цели в Журнале экспедиции.')}
    </p>
    <PatchWall patches={patches} />
   </div>

   {/* Диагностика скафандра */}
   <div
    style={{
     marginBottom: 16,
     padding: 20,
     borderRadius: 12,
     background: 'linear-gradient(180deg, #26170E 0%, #180D07 100%)',
     border: '1px solid #5E2E16',
     boxShadow: 'inset 0 1px 0 rgba(255, 214, 170, 0.12), 0 8px 24px rgba(0, 0, 0, 0.5)',
    }}
   >
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
     <h3 className="ares-mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: '#ED8A45', margin: 0, textTransform: 'uppercase' }}>
      {t('ДИАГНОСТИКА СКАФАНДРА // СИСТЕМЫ ЖИЗНЕОБЕСПЕЧЕНИЯ')}
     </h3>
     <span className="po-lamp po-lamp--green" aria-hidden="true" />
    </div>
    <StatusRow label={t("Бортовой кошелёк")} ok={connected} value={publicKey ? `${publicKey.toString().slice(0, 4)}…${publicKey.toString().slice(-4)}` : t('Не авторизован')} />
    <StatusRow label={t("Связь с Solana")} ok={ready} value={ready ? t('В норме ({cluster})', { cluster: CLUSTER }) : t('Синхронизация…')} />
    <StatusRow label={t("Кислород O₂")} ok={true} value={t("98.4% (НОРМА)")} />
    <StatusRow label={t("Водный контур H₂O")} ok={true} value={t("76.2% (РЕЦИРКУЛЯЦИЯ)")} />
    <StatusRow label={t("Радиационный фон")} ok={true} value={t("0.12 mSv/h (ФОНОВЫЙ)")} />
   </div>
  </div>
 )
}

function StatusRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
 return (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,214,170,0.08)' }}>
   <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    {ok ? <CheckCircle size={16} color="var(--pf-teal)" aria-hidden="true" /> : <XCircle size={16} color="var(--pf-red)" aria-hidden="true" />}
    <span style={{ fontSize: 13, color: '#F6F1ED' }}>{label}</span>
   </div>
   <span style={{ fontSize: 12, color: ok ? 'var(--pf-teal)' : 'var(--pf-red)' }} className="ares-mono">{value}</span>
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
