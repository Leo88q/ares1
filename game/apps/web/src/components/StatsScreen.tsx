import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { PublicKey } from '@solana/web3.js'
import { Flame, Coins, TrendingUp, Gauge, Trophy, Landmark, Moon, Percent, Shield } from 'lucide-react'
import { getMint } from '@solana/spl-token'
import { useSolana } from '../contexts/SolanaContext'
import { usePolling } from '../hooks/usePolling'
import { withRetry } from '../utils/rpc'
import { MICRO } from '../utils/constants'
import {
  getLunarMultiplier,
  getLunarPhase,
  getBaseTaxBps,
  getElasticCap,
} from '../utils/anchorClient'
import { StatsBay } from './ares/StatsBay'
import { MissionLog } from './MissionLog'
import { LiquidBar } from './ares/LiquidBar'
import { ConsolePanel } from './ares/panels'
import { TelemetryStrip } from './ares/TelemetryStrip'
import { describeError } from '../utils/errors'
import { ErrorState } from '../ui/states'

interface LeaderRow {
 address: string
 fields: number
 totalLevel: number
 score: number
 isMe: boolean
}

interface EconomyData {
 maxSupply: number
 currentSupply: number
 burned: number
 mintedToday: number
 dailyCap: number
 elasticCap: number
 fieldCount: number
 players: number
 // ФАЗА 1: лунный цикл + налог
 epochId: number
 lunarMultiplier: number
 lunarPhase: string
 taxBps: number
}

// 8 (disc) + 32 (owner) + 1 (level) + 1 (durability) + 8 (last_harvest)
// + 8 (tax_paid_until) + 8 (fertilizer_until) + 1 (is_active) + 1 (field_type)
// + 1 (bump) + 1 (reserved) = 70 — после migrate_field realloc
const FIELD_ACCOUNT_SIZE = 8 + 32 + 1 + 1 + 8 + 8 + 8 + 1 + 1 + 1 + 1
const STATS_POLL_MS = 30_000

/** Консольная строка-прибор: моно-лейбл, янтарное значение, светящийся бар */
function ConsoleStatRow({ icon, label, value, pct, color }: { icon: ReactNode; label: string; value: string; pct?: number; color: string }) {
 const p = pct === undefined ? undefined : Math.min(100, Math.max(0, pct))
 return (
  <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(160,82,40,0.35)', boxShadow: 'inset 0 1px 0 rgba(255,214,170,0.05)' }}>
   <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: p !== undefined ? 8 : 0 }}>
    <span aria-hidden="true" style={{ color, display: 'flex' }}>{icon}</span>
    <span className="ares-mono" style={{ flex: 1, fontSize: 11, color: 'rgba(255,179,71,0.85)', letterSpacing: '0.06em' }}>{label}</span>
    <span className="ares-mono" style={{ fontSize: 13, fontWeight: 700, color, textShadow: `0 0 8px ${color}55` }}>{value}</span>
   </div>
   {p !== undefined && (
    <LiquidBar value={p} height={10} label={label} />
   )}
  </div>
 )
}

function EconomySection({ data }: { data: EconomyData }) {
 const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)
 const fmt = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
 // Крупные числа без «250000000K»: 250_000 -> 250K, 750_000 -> 750K, 1e9 -> 1000M
 const fmtBig = (v: number) =>
   v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0)
 return (
  <ConsolePanel title="ЭКОНОМИКА КОЛОНИИ" tone="amber">
   <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <TelemetryStrip
     readings={[
      { label: 'SUPPLY', value: `${fmt(data.currentSupply)} POTATO` },
      { label: 'BURNED', value: `${fmt(data.burned)} POTATO` },
      { label: 'EPOCH', value: `${data.mintedToday.toFixed(0)}/${fmtBig(data.dailyCap)}` },
      { label: 'FIELDS', value: String(data.fieldCount) },
      { label: 'CREW', value: String(data.players) },
      { label: 'LUNAR', value: `x${data.lunarMultiplier.toFixed(2)}` },
      { label: 'TAX', value: `${(data.taxBps / 100).toFixed(2)}%` },
      { label: 'CAP', value: fmtBig(data.elasticCap) },
     ]}
    />
    <ConsoleStatRow icon={<Gauge size={16} />} label="ТЕКУЩИЙ SUPPLY" value={`${fmt(data.currentSupply)} POTATO`} pct={pct(data.currentSupply, data.maxSupply)} color="var(--ares-hud-amber, #FFB347)" />
    <ConsoleStatRow icon={<Flame size={16} />} label="ВСЕГО СОЖЖЕНО" value={`${fmt(data.burned)} POTATO`} pct={pct(data.burned, data.currentSupply + data.burned)} color="var(--ares-rust, #C1440E)" />
    <ConsoleStatRow icon={<TrendingUp size={16} />} label="СМАЙНЕНО ЗА ЭПОХУ" value={`${data.mintedToday.toFixed(0)} / ${fmtBig(data.dailyCap)} POTATO`} pct={pct(data.mintedToday, data.dailyCap)} color="var(--ares-blueset, #6B93D6)" />
    <ConsoleStatRow icon={<Moon size={16} />} label={`ЛУННЫЙ ЦИКЛ: ${data.lunarPhase}`} value={`x${data.lunarMultiplier.toFixed(2)}`} pct={data.lunarMultiplier * 100 - 85} color="#E0D8C0" />
    <ConsoleStatRow icon={<Percent size={16} />} label="НАЛОГ НА ХАРВЕСТ" value={`${(data.taxBps / 100).toFixed(2)}%`} pct={(data.taxBps - 200) / 8} color="var(--ares-rust, #C1440E)" />
    <ConsoleStatRow icon={<Shield size={16} />} label="ЭЛАСТИЧНЫЙ КАП" value={`${fmtBig(data.elasticCap)} POTATO`} pct={pct(data.elasticCap - 250_000, 750_000 - 250_000)} color="var(--ares-blueset, #6B93D6)" />
    <ConsoleStatRow icon={<Landmark size={16} />} label="ВСЕГО ДЕЛЯНОК" value={data.fieldCount.toString()} color="var(--ares-grow-violet, #B85CFF)" />
    <ConsoleStatRow icon={<Trophy size={16} />} label="ЭКИПАЖ С ДЕЛЯНКАМИ" value={data.players.toString()} color="#FFC94A" />
    <ConsoleStatRow icon={<Coins size={16} />} label="МАКС. SUPPLY" value={`${(data.maxSupply / 1e6).toFixed(0)}M POTATO`} color="var(--ares-hud-amber, #FFB347)" />

    <div style={{ marginTop: 4, padding: '10px 12px', borderRadius: 8, background: 'rgba(193,68,14,0.08)', border: '1px solid rgba(193,68,14,0.35)' }}>
     <div className="ares-stencil" style={{ fontSize: 11, color: 'var(--ares-rust, #C1440E)', marginBottom: 8 }}>ЗАЩИТА ЭКОНОМИКИ</div>
     {[
      'Эмиссия только через harvest и награды: лимит эпохи + максимальный supply',
      'Эпоха ротируется раз в 24 ч кем угодно (roll_epoch) — лимит не «замерзает»',
      'Все траты (налог, ремонт, улучшение, удобрения, покупка полей) сжигаются',
      'Комиссия рынка: 60% сжигается, 40% — в казну на PDA программы',
      'Escrow-ордера, запрет self-trade, кулдаун 3 ч после отмены',
      'Награды выдаёт только сервер от имени authority, не из клиента',
     ].map((t, i) => (
      <div key={i} className="ares-mono" style={{ fontSize: 10, color: 'rgba(255,179,71,0.8)', padding: '3px 0', display: 'flex', gap: 6, lineHeight: 1.5 }}>
       <span style={{ color: 'var(--ares-hud-amber, #FFB347)' }} aria-hidden="true">✓</span> {t}
      </div>
     ))}
    </div>
   </div>
  </ConsolePanel>
 )
}

// Реферальная программа — весь UI теперь в Каюте (components/ReferralSection.tsx).

function StatsScreenInner() {
 const { connection, programId, publicKey, config, epoch, ready } = useSolana()
 const [data, setData] = useState<EconomyData | null>(null)
 const [leaders, setLeaders] = useState<LeaderRow[]>([])
 const [loadError, setLoadError] = useState<string | null>(null)

 const load = useCallback(async () => {
  if (!config) return
  try {
  // dataSlice keeps the leaderboard query cheap: only owner (32) + level (1) per field.
  const [mintInfo, fieldAccounts] = await Promise.all([
   withRetry(() => getMint(connection, config.potatoMint)),
   withRetry(() =>
    connection.getProgramAccounts(programId, {
     filters: [{ dataSize: FIELD_ACCOUNT_SIZE }],
     dataSlice: { offset: 8, length: 33 },
    }),
   ),
  ])
  const byOwner = new Map<string, { fields: number; totalLevel: number }>()
  for (const { account } of fieldAccounts) {
   const owner = new PublicKey(account.data.subarray(0, 32)).toBase58()
   const level = account.data[32]
   const cur = byOwner.get(owner) ?? { fields: 0, totalLevel: 0 }
   cur.fields += 1
   cur.totalLevel += level
   byOwner.set(owner, cur)
  }
  const me = publicKey?.toBase58()
  setLeaders(
   [...byOwner.entries()]
    .map(([address, v]) => ({ address, ...v, score: v.totalLevel * 10 + v.fields * 5, isMe: me === address }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10),
  )
  // ФАЗА 1: вычисляемые параметры
  const prevBurned = Number(config.totalBurnedMicro) / MICRO
  const lastCap = epoch ? Number(epoch.mintCapMicro) / MICRO : 250_000
  const lastMinted = epoch ? Number(epoch.mintedMicro) / MICRO : 0
  const currentSupply = Number(mintInfo.supply) / MICRO
  const maxSupply = Number(config.maxSupplyMicro) / MICRO
  const elasticCap = getElasticCap(prevBurned, lastCap, lastMinted)
  const epochId = epoch ? Number(epoch.id) : 0
  const lunarMultiplier = getLunarMultiplier(epochId)
  const lunarPhase = getLunarPhase(epochId)
  const taxBps = getBaseTaxBps(currentSupply * MICRO, maxSupply * MICRO)

  setData({
   maxSupply,
   currentSupply,
   burned: prevBurned,
   mintedToday: lastMinted,
   dailyCap: lastCap,
   elasticCap,
   fieldCount: Number(config.fieldCount),
   players: byOwner.size,
   epochId,
   lunarMultiplier,
   lunarPhase,
   taxBps,
  })
  setLoadError(null)
  } catch (err) {
   setLoadError(describeError(err))
   throw err
  }
 }, [connection, programId, config, epoch, publicKey])

 usePolling(load, STATS_POLL_MS, ready)

 if (!data) {
  if (loadError) {
   return <ErrorState message={loadError} onRetry={() => void load()} />
  }
  return (
   <div style={{ padding: 40, textAlign: 'center', color: 'var(--pf-text-secondary)' }} role="status">
    {ready ? 'Загрузка журнала…' : 'Ждём подключения к блокчейну…'}
   </div>
  )
 }

 return (
  <div style={{ padding: 20, paddingBottom: 140 }}>
   <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>ЖУРНАЛ МИССИИ</h1>
   <p style={{ color: 'var(--pf-text-secondary)', fontSize: 14, marginBottom: 20 }}>Задачи смены, нашивки и показатели экипажа</p>
   {loadError && <ErrorState inline message={loadError} onRetry={() => void load()} />}

   <div style={{ marginBottom: 24 }}>
    <EconomySection data={data} />
   </div>

   <MissionLog />

   <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Доска почёта</h2>
   {leaders.length === 0 ? (
    <p style={{ color: 'var(--pf-text-secondary)', textAlign: 'center', padding: 30 }}>Пока нет игроков</p>
   ) : (
    <ol style={{ display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none' }}>
     {leaders.map((row, i) => (
      <motion.li key={row.address} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
       className="pf-card hull-skin" style={{ padding: '14px 16px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12, border: row.isMe ? '1px solid var(--pf-teal)' : undefined }}>
       <div style={{ width: 28, fontSize: 16, fontWeight: 800, color: i === 0 ? 'var(--pf-gold)' : i === 1 ? 'var(--pf-text-secondary)' : i === 2 ? '#b45309' : 'var(--pf-text-muted)' }}>{i + 1}</div>
       <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: row.isMe ? 'var(--ares-hud-amber, #FFB347)' : 'var(--ares-parchment, #F2E8DA)' }}>
         {row.address.slice(0, 6)}…{row.address.slice(-4)} {row.isMe && '(ты)'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)' }}>{row.fields} полей · суммарный ур. {row.totalLevel}</div>
       </div>
       <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pf-gold)' }}>{row.score} </div>
      </motion.li>
     ))}
    </ol>
   )}
  </div>
 )
}

export default function StatsScreen() {
 return (
  <StatsBay>
   <StatsScreenInner />
  </StatsBay>
 );
}
