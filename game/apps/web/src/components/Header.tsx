import { motion } from 'framer-motion'
import { t } from '../i18n'

import { Wallet } from 'lucide-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import { RollingNumber } from '../ui/RollingNumber'
import { Lamp, Stamp } from '../ui/mk/Panel'
import LangSwitcher from './LangSwitcher'
import { GameStats } from '../contexts/GameContext'
import { MICRO } from '../utils/constants'

interface Props {
 stats: GameStats
}

/**
 * Шапка АГРО-отсека (MK-редизайн, 2026-09-28).
 * Главная плита экрана — баланс POTATO (mk-plate--primary: клёпка, двойной
 * шов, LCD-дисплей и стрелочный прибор ранга с реальными данными состояния).
 * Никаких выдуманных показаний: всё, что видно, приходит из `stats`.
 */
export default function Header({ stats }: Props) {
 const { setVisible } = useWalletModal()
 const { connected, publicKey, wallet, connect, connecting } = useWallet()
 // Имя подключённого кошелька (Phantom / Solana Mobile / Solflare) —
 // видно в шапке: по скриншоту сразу понятно, какой кошелёк не отдаёт подпись.
 const walletName =
  ((wallet as { adapter?: { name?: string } } | null)?.adapter?.name as string | undefined) ?? undefined

 // Если кошелёк уже выбран (адаптер существует), а подключения нет —
 // штатный changeWallet в модалке early-return'ит (кошелёк уже «selected»),
 // и connect не вызывается: «абсолютно ничего не происходит». Обходим:
 // вызываем connect() адаптера напрямую.
 const handleConnectClick = () => {
  if (wallet && !connected && !connecting) {
   console.info('[wallet] direct connect:', wallet.adapter.name, wallet.readyState)
   void connect().catch((e: unknown) => console.error('[wallet] direct connect failed:', e))
   return
  }
  setVisible(true)
 }

 return (
  <header>
   <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
    <div style={{ minWidth: 0 }}>
     <h1 className="pf-h1" style={{ fontSize: 26 }}>{t("АГРО-ОТСЕК")}</h1>
     <p className="pf-subtitle" style={{ marginTop: 4 }}>{t("Теплица на Марсе под фитолампами")}</p>
    </div>
    <LangSwitcher compact />
   </div>

   <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 12, marginBottom: 12 }}>
    {/* ── ГЛАВНАЯ ПЛИТА ЭКРАНА: паёк на балансе ── */}
    <div className="mk-plate mk-plate--primary" data-tutorial="balance" aria-label={t("Баланс POTATO")} style={{ padding: '14px 16px 12px' }}>
     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <span className="mk-tag">{t('ПАЁК · POTATO')}</span>
      <Lamp color="green" on={connected} blink={!connected} />
     </div>
     <div className="lcd-readout" style={{ display: 'block', padding: '8px 12px', fontSize: 26, textAlign: 'center' }}>
      <RollingNumber value={stats.potatoBalance / MICRO} decimals={2} />
     </div>
     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
      <span className="mk-sticker" aria-label={t("Баланс SKR")}>
       <span className="mk-sticker__label">SKR</span>
       <RollingNumber value={stats.skrBalance} decimals={3} />
      </span>
      <RankGauge level={stats.playerLevel} progress={(stats.totalFields % 3) / 3} />
     </div>
    </div>

    {/* Служебная плита: связь с блокчейном */}
    <div className="mk-plate mk-plate--quiet" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
     <span className="mk-tag" style={{ fontSize: 10 }}>{t('КАНАЛ СВЯЗИ')}</span>
     <Stamp status={connected ? 'ok' : 'warn'}>{connected ? t('НА СВЯЗИ') : t('НЕТ КОШЕЛЬКА')}</Stamp>
     <WalletLineButton
      connected={connected}
      connecting={connecting}
      publicKey={publicKey?.toString() ?? null}
      walletName={walletName}
      onOpen={() => setVisible(true)}
      onConnect={handleConnectClick}
     />
    </div>
   </div>

   <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
    <StatPlate label={t("РАНГ")} value={stats.playerLevel} />
    <StatPlate label={t("РАСТЕНИЙ")} value={stats.totalFields} />
    <StatPlate label={t("СТАЖ")} value={Math.floor(stats.experience)} />
   </div>
  </header>
 )
}

/** Стрелочный прибор ранга: угол стрелки = прогресс до следующего ранга. */
function RankGauge({ level, progress }: { level: number; progress: number }) {
 const clamped = Math.min(1, Math.max(0, progress))
 const angle = -100 + clamped * 200
 return (
  <svg width="54" height="34" viewBox="0 0 54 34" role="img" aria-label={t('Ранг {n}, прогресс {p}%', { n: level, p: Math.round(clamped * 100) })}>
   <path d="M4 30 A23 23 0 0 1 50 30" fill="none" stroke="#171008" strokeWidth="6" />
   <path d="M4 30 A23 23 0 0 1 50 30" fill="none" stroke="#8A4A22" strokeWidth="1" opacity="0.7" />
   {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
    const a = (-100 + p * 200) * (Math.PI / 180)
    const x1 = 27 + Math.sin(a) * 17
    const y1 = 30 - Math.cos(a) * 17
    const x2 = 27 + Math.sin(a) * 21
    const y2 = 30 - Math.cos(a) * 21
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#C9A176" strokeWidth="1.4" opacity="0.8" />
   })}
   <g transform={`rotate(${angle} 27 30)`}>
    <path d="M27 30 L24.6 12 L27 8.5 L29.4 12 Z" fill="#FFB347" stroke="#3A1D0E" strokeWidth="0.6" />
   </g>
   <circle cx="27" cy="30" r="3" fill="#8A4A22" stroke="#171008" strokeWidth="1" />
   <text x="27" y="9" textAnchor="middle" fill="#C9A176" fontFamily="'JetBrains Mono', monospace" fontSize="7">{`R${level}`}</text>
  </svg>
 )
}

function WalletLineButton({
 connected, connecting, publicKey, walletName, onOpen, onConnect,
}: {
 connected: boolean
 connecting: boolean
 publicKey: string | null
 walletName?: string
 onOpen: () => void
 onConnect: () => void
}) {
 if (connected && publicKey) {
  return (
   <motion.button
    whileTap={{ y: 2 }}
    transition={{ type: 'spring', stiffness: 520, damping: 26 }}
    onClick={onOpen}
    className="mk-key"
    aria-label={t("Смена кошелька")}
    style={{ padding: '8px 10px', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
   >
    <Wallet size={13} aria-hidden="true" />
    <span className="ares-mono" style={{ fontWeight: 700 }}>{publicKey.slice(0, 4)}…{publicKey.slice(-4)}</span>
    {walletName ? <span style={{ fontSize: 9, color: 'var(--pf-text-muted)' }}>· {walletName}</span> : null}
   </motion.button>
  )
 }
 return (
  <motion.button
   whileTap={connecting ? undefined : { y: 3 }}
   transition={{ type: 'spring', stiffness: 520, damping: 26 }}
   onClick={onConnect}
   disabled={connecting}
   className="mk-key mk-key--paint"
   style={{ padding: '11px 10px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: connecting ? 0.7 : 1 }}
  >
   <Wallet size={15} aria-hidden="true" />
   {connecting ? t('Подключение…') : t('Подключить кошелёк')}
  </motion.button>
 )
}

/** Приборная плитка: моно-значение + гравированная метка. Одна из трёх в ряду — тише главной. */
function StatPlate({ label, value }: { label: string; value: number }) {
 return (
  <div className="mk-plate mk-plate--quiet" style={{ padding: '10px 8px', textAlign: 'center' }}>
   <div className="ares-mono" style={{ fontSize: String(value).length > 6 ? 13 : String(value).length > 4 ? 16 : 20, fontWeight: 700, marginBottom: 4, color: 'var(--ares-hud-amber, #FFB347)', overflowWrap: 'anywhere', lineHeight: 1.2 }}>{value}</div>
   <div className="mk-tag" style={{ fontSize: 9, padding: '1px 6px' }}>{label}</div>
  </div>
 )
}
