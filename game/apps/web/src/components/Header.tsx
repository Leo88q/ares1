import { motion } from 'framer-motion'
import { t } from '../i18n'

import { Wallet } from 'lucide-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import { RollingNumber } from '../ui/RollingNumber'
import LangSwitcher from './LangSwitcher'
import { GameStats } from '../contexts/GameContext'
import { MICRO } from '../utils/constants'

interface Props {
 stats: GameStats
}

export default function Header({ stats }: Props) {
 const { setVisible } = useWalletModal()
 const { connected, publicKey } = useWallet()

 return (
  <header>
   <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
    <div>
     <h1 className="pf-h1" style={{ fontSize: 26 }}>{t("АГРО-ОТСЕК")}</h1>
     <p className="pf-subtitle" style={{ marginTop: 4 }}>{t("Теплица на Марсе под фитолампами")}</p>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, marginTop: 14 }}>
     <LangSwitcher compact />
     <div data-tutorial="balance" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div className="ares-mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'rgba(255,179,71,0.75)', marginBottom: 3, textAlign: 'center' }}>POTATO</div>
        <motion.div whileHover={{ scale: 1.03 }} className="pf-card hull-skin" style={{ padding: '10px 22px', borderRadius: 12, minWidth: 176, display: 'flex', justifyContent: 'center', border: '1px solid rgba(160, 82, 40, 0.65)' }} aria-label={t("Баланс POTATO")}>
          <RollingNumber value={stats.potatoBalance / MICRO} decimals={2} className="hud-balance" />
        </motion.div>
      </div>
      <div>
        <div className="ares-mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'rgba(255,179,71,0.75)', marginBottom: 3, textAlign: 'center' }}>SKR</div>
        <motion.div whileHover={{ scale: 1.03 }} className="pf-card hull-skin" style={{ padding: '10px 22px', borderRadius: 12, minWidth: 176, display: 'flex', justifyContent: 'center', border: '1px solid rgba(160, 82, 40, 0.65)' }} aria-label={t("Баланс SKR")}>
          <RollingNumber value={stats.skrBalance} decimals={3} className="hud-balance" />
        </motion.div>
      </div>
    </div>
    </div>
   </div>

   <div style={{ marginBottom: 16 }}>
    {connected && publicKey ? (
     <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={() => setVisible(true)}
      className="pf-card hull-skin"
      aria-label={t("Смена кошелька")}
      style={{ width: '100%', padding: 10, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid rgba(160, 82, 40, 0.65)' }}
     >
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--pf-teal)' }} />
      <span style={{ fontSize: 12, color: 'var(--pf-teal)', fontWeight: 600 }}>
       {publicKey.toString().slice(0, 4)}…{publicKey.toString().slice(-4)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--pf-text-muted)' }}>· {t("Смена кошелька")}</span>
     </motion.button>
    ) : (
     <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={() => setVisible(true)}
      style={{ width: '100%', padding: 12, borderRadius: 12, background: 'linear-gradient(135deg, var(--pf-teal), var(--pf-teal))', color: 'white', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 4px 20px rgba(193, 68, 14, 0.45)' }}
     >
      <Wallet size={18} aria-hidden="true" />
      {t('Подключить кошелёк')}
     </motion.button>
    )}
   </div>

   <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
    <StatCard label={t("РАНГ")} value={stats.playerLevel} />
    <StatCard label={t("РАСТЕНИЙ")} value={stats.totalFields} />
    <StatCard label={t("СТАЖ")} value={Math.floor(stats.experience)} />
   </div>
  </header>
 )
}

function StatCard({ label, value }: { label: string; value: number }) {
 return (
  <div className="pf-card hull-skin" style={{ padding: 16, borderRadius: 16, textAlign: 'center' }}>
   <div className="ares-mono" style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: 'var(--ares-hud-amber, #FFB347)', textShadow: '0 0 12px rgba(255,179,71,0.4)' }}>{value}</div>
   <div className="ares-stencil" style={{ fontSize: 10, color: 'rgba(255,179,71,0.8)' }}>{label}</div>
  </div>
 )
}
