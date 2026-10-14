import { useCallback, useMemo, useState } from 'react'
import { useI18n, plural } from '../i18n'

import { motion } from 'framer-motion'
import { PublicKey } from '@solana/web3.js'
import { getMint } from '@solana/spl-token'
import { useSolana } from '../contexts/SolanaContext'
import { usePolling } from '../hooks/usePolling'
import { withRetry } from '../utils/rpc'
import { LUNAR_TABLE, MAX_DURABILITY, MICRO, fieldTypeInfo, mutationInfo } from '../utils/constants'
import { useGame, type Field } from '../contexts/GameContext'
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
import { ErrorState, LoadingState, EmptyState } from '../ui/states'

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
 // Значения лунного цикла доступны только если текущая on-chain эпоха загружена.
 epochId: number | null
 lunarMultiplier: number | null
 lunarPhase: string | null
 taxBps: number
}

const FIELD_ACCOUNT_SIZE = 8 + 32 + 1 + 1 + 8 + 8 + 8 + 1 + 1 + 1 + 1 + 8 // 78: +mutation_type, +pending_drop_slot
const STATS_POLL_MS = 30_000

/** Консольная строка-прибор: моно-лейбл, янтарное значение, светящийся бар (без смайлов и иконок) */
function ConsoleStatRow({ label, value, pct, color }: { label: string; value: string; pct?: number; color: string }) {
 const p = pct === undefined ? undefined : Math.min(100, Math.max(0, pct))
 return (
  <div
   style={{
    padding: '11px 14px',
    borderRadius: 8,
    background: 'linear-gradient(180deg, #18110B 0%, #100B07 100%)',
    border: '1px solid rgba(255, 179, 71, 0.2)',
    boxShadow: 'inset 0 1px 0 rgba(255,214,170,0.08), 0 2px 6px rgba(0,0,0,0.4)',
   }}
  >
   <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: p !== undefined ? 8 : 0 }}>
    <span className="ares-mono" style={{ flex: 1, fontSize: 11, color: 'rgba(255,179,71,0.85)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
    <span className="ares-mono" style={{ fontSize: 13, fontWeight: 700, color, textShadow: `0 0 8px ${color}55`, textAlign: 'right' }}>{value}</span>
   </div>
   {p !== undefined && (
    <LiquidBar value={p} height={10} label={label} />
   )}
  </div>
 )
}

function EconomySection({ data }: { data: EconomyData }) {
 const { t } = useI18n()
 const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)
 const fmt = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
 const fmtBig = (v: number) =>
   v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0)
 return (
  <ConsolePanel title={t("ЭКОНОМИКА КОЛОНИИ")} tone="amber">
   <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <TelemetryStrip
     readings={[
      { label: 'SUPPLY', value: `${fmt(data.currentSupply)} POTATO` },
      { label: 'BURNED', value: `${fmt(data.burned)} POTATO` },
      { label: 'EPOCH', value: `${data.mintedToday.toFixed(0)}/${fmtBig(data.dailyCap)}` },
      { label: 'FIELDS', value: String(data.fieldCount) },
      { label: 'CREW', value: String(data.players) },
      { label: 'LUNAR', value: data.lunarMultiplier === null ? '—' : `x${data.lunarMultiplier.toFixed(2)}` },
      { label: 'TAX', value: `${(data.taxBps / 100).toFixed(2)}%` },
      { label: 'CAP', value: fmtBig(data.elasticCap) },
     ]}
    />
    <ConsoleStatRow label={t("ТЕКУЩИЙ SUPPLY")} value={`${fmt(data.currentSupply)} POTATO`} pct={pct(data.currentSupply, data.maxSupply)} color="var(--ares-hud-amber, #FFB347)" />
    <ConsoleStatRow label={t("ВСЕГО СОЖЖЕНО")} value={`${fmt(data.burned)} POTATO`} pct={pct(data.burned, data.currentSupply + data.burned)} color="var(--ares-rust, #C1440E)" />
    <ConsoleStatRow label={t("СМАЙНЕНО ЗА ЭПОХУ")} value={`${data.mintedToday.toFixed(0)} / ${fmtBig(data.dailyCap)} POTATO`} pct={pct(data.mintedToday, data.dailyCap)} color="var(--ares-blueset, #6B93D6)" />
    <ConsoleStatRow
     label={data.lunarPhase ? t("ЛУННЫЙ ЦИКЛ: {phase}", { phase: data.lunarPhase }) : t('ЛУННЫЙ ЦИКЛ')}
     value={data.lunarMultiplier === null ? '—' : `x${data.lunarMultiplier.toFixed(2)}`}
     pct={data.lunarMultiplier === null ? undefined : data.lunarMultiplier * 100 - 85}
     color="#E0D8C0"
    />
    <ConsoleStatRow label={t("НАЛОГ НА ХАРВЕСТ")} value={`${(data.taxBps / 100).toFixed(2)}%`} pct={(data.taxBps - 200) / 8} color="var(--ares-rust, #C1440E)" />
    <ConsoleStatRow label={t("ЭЛАСТИЧНЫЙ КАП")} value={`${fmtBig(data.elasticCap)} POTATO`} pct={pct(data.elasticCap - 250_000, 750_000 - 250_000)} color="var(--ares-blueset, #6B93D6)" />
    <ConsoleStatRow label={t("ВСЕГО ДЕЛЯНОК")} value={data.fieldCount.toString()} color="#ED8A45" />
    <ConsoleStatRow label={t("ЭКИПАЖ С ДЕЛЯНКАМИ")} value={data.players.toString()} color="#FFC94A" />
    <ConsoleStatRow label={t("МАКС. SUPPLY")} value={`${(data.maxSupply / 1e6).toFixed(0)}M POTATO`} color="var(--ares-hud-amber, #FFB347)" />

    <div
     style={{
      marginTop: 6,
      padding: '12px 14px',
      borderRadius: 8,
      background: 'linear-gradient(180deg, rgba(38,20,12,0.85) 0%, rgba(20,10,6,0.95) 100%)',
      border: '1px solid #5A2E16',
      boxShadow: 'inset 0 1px 0 rgba(255,214,170,0.08)',
     }}
    >
     <div className="ares-stencil" style={{ fontSize: 11, color: '#FFB347', letterSpacing: '0.14em', marginBottom: 8, textTransform: 'uppercase' }}>
      {t("ЗАЩИТА ЭКОНОМИКИ")}
     </div>
     {[
      t('Эмиссия только через harvest и награды: лимит эпохи + максимальный supply'),
      t('Эпоха ротируется раз в 24 ч кем угодно (roll_epoch) — лимит не «замерзает»'),
      t('Все траты (налог, ремонт, улучшение, удобрения, покупка полей) сжигаются'),
      t('Рынок devnet сейчас legacy V1: комиссия 9–12% в POTATO при создании ордера; settlement fee 9–12% в SOL/SKR и пара SKR ещё не активны'),
      t('Escrow-ордера, запрет self-trade, кулдаун 3 ч после отмены'),
      t('Награды выдаёт только сервер от имени authority, не из клиента'),
     ].map((rule, i) => (
      <div key={i} className="ares-mono" style={{ fontSize: 10, color: 'rgba(255,179,71,0.8)', padding: '3px 0', display: 'flex', gap: 6, lineHeight: 1.5 }}>
       <span style={{ color: 'var(--ares-hud-amber, #FFB347)' }} aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></span> {rule}
      </div>
     ))}
    </div>
   </div>
  </ConsolePanel>
 )
}

function LunarWeather({ epochId, lunarMultiplier, lunarPhase }: Pick<EconomyData, 'epochId' | 'lunarMultiplier' | 'lunarPhase'>) {
 const { t } = useI18n()
 if (epochId === null || lunarMultiplier === null || lunarPhase === null) {
  return (
   <ConsolePanel title={t('ЛУННОЕ ОКНО · 28 ЭПОХ')} tone="magenta">
    <EmptyState title={t('Нет данных текущей on-chain эпохи.')} hint={t('Ожидаем ответ Solana RPC…')} />
   </ConsolePanel>
  )
 }

 const day = ((epochId % 28) + 28) % 28 + 1
 const minBps = Math.min(...LUNAR_TABLE)
 const maxBps = Math.max(...LUNAR_TABLE)
 const range = Math.max(1, maxBps - minBps)
 const chartLabel = `${t('ЭПОХА {day} ИЗ 28', { day })} · ${lunarPhase} · ${t('МНОЖИТЕЛЬ УРОЖАЯ')}: x${lunarMultiplier.toFixed(2)}`

 return (
  <ConsolePanel title={t('ЛУННОЕ ОКНО · 28 ЭПОХ')} tone="magenta">
   <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
    <div>
     <div className="ares-mono" style={{ color: '#C9A176', fontSize: 9, letterSpacing: '0.14em' }}>{t('ТЕКУЩАЯ ФАЗА')}</div>
     <div className="ares-stencil" style={{ color: '#F2E8DA', fontSize: 16, marginTop: 5 }}>{lunarPhase}</div>
     <div className="ares-mono" style={{ color: '#A88D70', fontSize: 9, marginTop: 4 }}>{t('ЭПОХА {day} ИЗ 28', { day })}</div>
    </div>
    <div style={{ textAlign: 'right', minWidth: 118 }}>
     <div className="ares-mono" style={{ color: '#C9A176', fontSize: 9, letterSpacing: '0.1em' }}>{t('МНОЖИТЕЛЬ УРОЖАЯ')}</div>
     <div className="lcd-readout" style={{ display: 'inline-block', color: '#FFC94A', fontSize: 24, fontWeight: 800, marginTop: 4, padding: '5px 10px' }}>x{lunarMultiplier.toFixed(2)}</div>
    </div>
   </div>

   <div
    role="img"
    aria-label={chartLabel}
    style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64, marginTop: 16, padding: '4px 2px', borderBottom: '1px solid rgba(201,161,118,0.25)' }}
   >
    {LUNAR_TABLE.map((bps, index) => {
     const height = 10 + ((bps - minBps) / range) * 40
     const current = index + 1 === day
     return (
      <span
       key={index}
       title={t('ЭПОХА {day} ИЗ 28', { day: index + 1 })}
       style={{
        flex: '1 1 0',
        minWidth: 2,
        height: `${height}px`,
        borderRadius: '3px 3px 0 0',
        background: current ? '#FFC94A' : 'linear-gradient(180deg, rgba(224,161,131,0.58), rgba(107,61,35,0.42))',
        boxShadow: current ? '0 0 10px rgba(255,201,74,0.55)' : 'none',
        opacity: current ? 1 : 0.74,
       }}
      />
     )
    })}
   </div>
   <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 5 }}>
    <span className="ares-mono" style={{ color: '#A88D70', fontSize: 8 }}>x{(minBps / 10_000).toFixed(2)}</span>
    <span className="ares-mono" style={{ color: '#A88D70', fontSize: 8 }}>x{(maxBps / 10_000).toFixed(2)}</span>
   </div>
   <p style={{ color: 'var(--pf-text-secondary)', fontSize: 10, lineHeight: 1.55, margin: '11px 0 0' }}>
    {t('Текущий множитель берётся из on-chain эпохи и влияет только на расчёт урожая. Это не прогноз погоды и не отдельная награда.')}
   </p>
  </ConsolePanel>
 )
}

function MutationArchive({ fields, connected, loading, error, onRetry }: { fields: readonly Field[]; connected: boolean; loading: boolean; error: string | null; onRetry: () => void }) {
 const { t } = useI18n()
 const activeMutations = useMemo(
  () => fields.filter((field) => field.isActive && field.mutationType > 0),
  [fields],
 )

 return (
  <ConsolePanel title={t('АРХИВ МУТАЦИЙ')} tone="amber">
   <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
    <p style={{ color: 'var(--pf-text-secondary)', fontSize: 10, lineHeight: 1.5, margin: 0, flex: 1 }}>
     {t('Снимок активных on-chain полей этого кошелька, не полная история. Мутации не гарантированы; экран не проверяет честность случайного выбора.')}
    </p>
    <span className="ares-mono" style={{ color: '#FFC94A', fontSize: 12, whiteSpace: 'nowrap' }}>{t('МУТАЦИИ')} · {connected ? activeMutations.length : '—'}</span>
   </div>

   {!connected ? (
    <EmptyState
     title={t('Подключи кошелёк, чтобы увидеть текущие on-chain мутации.')}
     hint={t('Снимок активных on-chain полей этого кошелька, не полная история. Мутации не гарантированы; экран не проверяет честность случайного выбора.')}
    />
   ) : error ? (
    <ErrorState inline message={error} onRetry={onRetry} />
   ) : loading ? (
    <LoadingState label={t('Загрузка журнала…')} />
   ) : activeMutations.length === 0 ? (
    <EmptyState
     title={t('Нет активных мутаций в текущих полях.')}
     hint={t('Мутации могут появиться после улучшения поля, если сработает проверка контракта.')}
    />
   ) : (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 9 }}>
     {activeMutations.map((field) => {
      const mutation = mutationInfo(field.mutationType)
      const fieldInfo = fieldTypeInfo(field.fieldType)
      const address = field.publicKey.toBase58()
      return (
       <article key={address} style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, padding: 11, borderRadius: 8, border: '1px solid rgba(255,179,71,0.2)', background: 'linear-gradient(180deg, rgba(23,16,10,0.96), rgba(15,10,6,0.96))' }}>
        <img src={fieldInfo.image} alt="" aria-hidden="true" width={42} height={48} loading="lazy" style={{ width: 42, height: 48, objectFit: 'contain', flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
         <div className="ares-stencil" style={{ color: mutation.color, fontSize: 12 }}>{mutation.name}</div>
         <div style={{ color: 'var(--pf-text-secondary)', fontSize: 10, marginTop: 3 }}>{mutation.effect}</div>
         <code className="ares-mono" style={{ display: 'block', color: '#A88D70', fontSize: 8, marginTop: 5 }}>{address.slice(0, 5)}…{address.slice(-4)}</code>
        </div>
        <div className="ares-mono" style={{ display: 'grid', gap: 4, color: '#C9A176', fontSize: 8, textAlign: 'right', flexShrink: 0 }}>
         <span>{t('РАНГ {n}', { n: field.level })}</span>
         <span>{t('Целостность {d}/{max}', { d: field.durability, max: MAX_DURABILITY })}</span>
        </div>
       </article>
      )
     })}
    </div>
   )}
  </ConsolePanel>
 )
}

function StatsScreenInner() {
 const { t } = useI18n()
 const { connection, programId, publicKey, config, epoch, ready, connected } = useSolana()
 const { fields, loading: fieldsLoading, fieldsError, reload: reloadFields } = useGame()
 const [data, setData] = useState<EconomyData | null>(null)
 const [leaders, setLeaders] = useState<LeaderRow[]>([])
 const [loadError, setLoadError] = useState<string | null>(null)

 const load = useCallback(async () => {
  if (!config) return
  try {
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
  const prevBurned = Number(config.totalBurnedMicro) / MICRO
  const lastCap = epoch ? Number(epoch.mintCapMicro) / MICRO : 250_000
  const lastMinted = epoch ? Number(epoch.mintedMicro) / MICRO : 0
  const currentSupply = Number(mintInfo.supply) / MICRO
  const maxSupply = Number(config.maxSupplyMicro) / MICRO
  const elasticCap = getElasticCap(prevBurned, lastCap, lastMinted)
  const epochId = epoch ? Number(epoch.id) : null
  const lunarMultiplier = epochId === null ? null : getLunarMultiplier(epochId)
  const lunarPhase = epochId === null ? null : getLunarPhase(epochId)
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
   <div className="main-screen-container">
    <LoadingState label={ready ? t('Загрузка журнала…') : t('Ждём подключения к блокчейну…')} />
   </div>
  )
 }

 return (
  <div className="main-screen-container">
   <h1 className="pf-h1" style={{ fontSize: 26, marginBottom: 8 }}>{t("ЖУРНАЛ МИССИИ")}</h1>
   <p className="pf-subtitle" style={{ marginBottom: 20 }}>{t("Задачи смены, нашивки и показатели экипажа")}</p>
   {loadError && <ErrorState inline message={loadError} onRetry={() => void load()} />}

   <div style={{ display: 'grid', gap: 14, marginBottom: 24 }}>
    <EconomySection data={data} />
    <LunarWeather epochId={data.epochId} lunarMultiplier={data.lunarMultiplier} lunarPhase={data.lunarPhase} />
    <MutationArchive fields={fields} connected={connected} loading={fieldsLoading} error={fieldsError} onRetry={() => void reloadFields()} />
   </div>

   <MissionLog />

   <h2 className="pf-h2" style={{ fontSize: 20, marginBottom: 16 }}>{t("Доска почёта")}</h2>
   {leaders.length === 0 ? (
    <EmptyState
     title={t('Доска почёта пуста')}
     hint={t('Ни одно поле ещё не заложено. Стань первым — журнал запишет твоё имя первым.')}
    />
   ) : (
    <ol style={{ display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none', padding: 0, margin: 0 }}>
     {leaders.map((row, i) => (
      <motion.li
       key={row.address}
       initial={{ opacity: 0, x: -20 }}
       animate={{ opacity: 1, x: 0 }}
       transition={{ delay: i * 0.05 }}
       style={{
        padding: '14px 16px',
        borderRadius: 8,
        background: row.isMe
         ? 'radial-gradient(120% 80% at 50% 0%, rgba(255, 160, 50, 0.08) 0%, transparent 60%), linear-gradient(180deg, #24170E 0%, #150D08 100%)'
         : 'linear-gradient(180deg, #18110B 0%, #100B07 100%)',
        border: row.isMe ? '1px solid rgba(255, 179, 71, 0.55)' : '1px solid rgba(255, 179, 71, 0.16)',
        boxShadow: row.isMe ? '0 0 14px -2px rgba(255, 179, 71, 0.25), inset 0 1px 0 rgba(255, 224, 170, 0.16)' : 'inset 0 1px 0 rgba(255, 214, 170, 0.06)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        position: 'relative',
        overflow: 'hidden',
       }}
      >
       <div style={{ width: 28, fontSize: 16, fontWeight: 800, color: i === 0 ? 'var(--pf-gold)' : i === 1 ? 'var(--pf-text-secondary)' : i === 2 ? '#b45309' : 'var(--pf-text-muted)' }}>{i + 1}</div>
       <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: row.isMe ? 'var(--ares-hud-amber, #FFB347)' : 'var(--ares-parchment, #F2E8DA)' }}>
         {row.address.slice(0, 6)}…{row.address.slice(-4)} {row.isMe && t('(ты)')}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)' }}>{plural(row.fields, { one: t('поле'), few: t('поля'), many: t('полей') })} · {t('суммарный ур.')} {row.totalLevel}</div>
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
