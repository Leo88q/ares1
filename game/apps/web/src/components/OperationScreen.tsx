import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Clock3, Download, Leaf, Share2, ShieldCheck, Sprout, Trophy } from 'lucide-react'
import { useI18n } from '../i18n'
import { useGame } from '../contexts/GameContext'
import { useSolana } from '../contexts/SolanaContext'
import { useToast } from './Toast'
import { MICRO } from '../utils/constants'
import {
  buildGreenhouseMissionProgress,
  greenhouseChapterIndex,
  greenhouseCycleEpoch,
  greenhouseCycleNumber,
} from '../utils/firstGreenhouse'
import { createGreenhouseShareCard } from '../utils/greenhouseShareCard'
import { ConsolePanel } from './ares/panels'
import { LiquidBar } from './ares/LiquidBar'

const CHAPTERS = [
  { title: 'Посадка', short: 'ЭПОХИ 01–07', icon: Sprout },
  { title: 'Вода', short: 'ЭПОХИ 08–14', icon: Leaf },
  { title: 'Ремонт колонии', short: 'ЭПОХИ 15–21', icon: ShieldCheck },
  { title: 'Первый урожай', short: 'ЭПОХИ 22–28', icon: Trophy },
] as const

const MISSION_COPY = {
  'first-field': { title: 'Заложить первую делянку', description: 'Построй первый активный гидропонный модуль.' },
  'three-fields': { title: 'Расширить теплицу', description: 'Поддерживай три активные делянки в колонии.' },
  'upgrade-level-five': { title: 'Укрепить кассету', description: 'Доведи одну активную делянку до 5-го уровня.' },
  mutation: { title: 'Сохранить мутацию', description: 'Добавь в генетический архив поле Golden или Silicon.' },
  'ration-reserve': { title: 'Собрать запас пайка', description: 'Держи 100 POTATO на кошельке.' },
  'active-fertilizer': { title: 'Поддержать рост', description: 'Активируй удобрение хотя бы на одной делянке.' },
} as const

function shortAddress(address: string | null): string {
  return address ? `${address.slice(0, 5)}…${address.slice(-4)}` : 'WALLET NOT CONNECTED'
}

export default function OperationScreen(): JSX.Element {
  const { t } = useI18n()
  const { fields, stats, loading, fieldsError, reload } = useGame()
  const { connected, ready, config, epoch, publicKey } = useSolana()
  const { show } = useToast()
  const [sharing, setSharing] = useState(false)

  const epochId = epoch?.id ?? config?.epochId ?? null
  const cycleEpoch = greenhouseCycleEpoch(epochId)
  const cycleNumber = greenhouseCycleNumber(epochId)
  const chapterIndex = greenhouseChapterIndex(cycleEpoch)
  const missions = useMemo(
    () => buildGreenhouseMissionProgress({ fields, potatoBalanceMicro: stats.potatoBalance, nowSec: Math.floor(Date.now() / 1000) }),
    [fields, stats.potatoBalance],
  )
  const completedMissions = missions.filter((mission) => mission.complete).length
  const activeFields = fields.filter((field) => field.isActive)
  const mutationCount = activeFields.filter((field) => field.mutationType > 0).length
  const highestLevel = activeFields.reduce((max, field) => Math.max(max, field.level), 0)
  const cycleValue = cycleEpoch === null ? '—' : `${cycleEpoch} / 28`

  const shareCard = async (): Promise<void> => {
    if (sharing) return
    setSharing(true)
    try {
      const blob = await createGreenhouseShareCard({
        title: t('ОПЕРАЦИЯ: ПЕРВАЯ ТЕПЛИЦА'),
        subtitle: t('28-эпоховый лунный цикл · личная карта состояния колонии'),
        cycleLabel: t('ЛУННЫЙ ЦИКЛ'),
        cycleValue,
        fieldsLabel: t('АКТИВНЫЕ ПОЛЯ'),
        fieldsValue: connected ? String(activeFields.length) : '—',
        mutationLabel: t('МУТАЦИИ'),
        mutationValue: connected ? String(mutationCount) : '—',
        levelLabel: t('МАКС. УРОВЕНЬ'),
        levelValue: connected ? String(highestLevel) : '—',
        missionsLabel: t('ЗАДАЧИ ПРОФИЛЯ'),
        missionsValue: connected ? `${completedMissions} / ${missions.length}` : '—',
        walletLabel: t('ЭКИПАЖ: {wallet} · ЦИКЛ #{cycle}', {
          wallet: shortAddress(publicKey?.toBase58() ?? null),
          cycle: cycleNumber ?? '—',
        }),
        networkLabel: t('SOLANA DEVNET · ИГРОВОЙ ПРОГРЕСС НЕ ПЕРЕНОСИТСЯ'),
        disclaimer: t('Снимок текущего состояния кошелька; не рейтинг, не награда и не обещание дохода.'),
      })
      const file = new File([blob], 'ares1-first-greenhouse.png', { type: 'image/png' })
      const shareUrl = new URL('/operation', window.location.origin).toString()

      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: t('Операция: Первая теплица'),
          text: t('Моя карточка состояния колонии ARES-1.'),
          url: shareUrl,
          files: [file],
        })
        show({ type: 'success', title: t('Карточка готова к публикации') })
      } else {
        const objectUrl = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = 'ares1-first-greenhouse.png'
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(objectUrl)
        try {
          await navigator.clipboard?.writeText(shareUrl)
          show({ type: 'success', title: t('Карточка скачана'), message: t('Ссылка на операцию скопирована.') })
        } catch {
          show({ type: 'success', title: t('Карточка скачана') })
        }
      }
    } catch (error) {
      show({ type: 'error', title: t('Не удалось создать карточку'), message: error instanceof Error ? error.message : undefined })
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="main-screen-container" style={{ paddingBottom: 100 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
        <div>
          <p className="ares-mono" style={{ color: 'var(--ares-hud-amber, #FFB347)', fontSize: 10, letterSpacing: '0.14em', margin: '0 0 6px' }}>
            {t('СЕЗОННЫЙ ПРОТОКОЛ · 28 ДНЕЙ')}
          </p>
          <h1 className="pf-h1" style={{ fontSize: 25, margin: 0 }}>{t('ОПЕРАЦИЯ: ПЕРВАЯ ТЕПЛИЦА')}</h1>
          <p className="pf-subtitle" style={{ marginTop: 5 }}>{t('Посадка → Вода → Ремонт колонии → Первый урожай')}</p>
        </div>
        <button
          type="button"
          className="mk-key"
          onClick={() => void shareCard()}
          disabled={sharing}
          aria-label={t('Создать карточку операции')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 11px', flexShrink: 0 }}
        >
          {sharing ? <Download size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
          <span className="ares-mono" style={{ fontSize: 9 }}>{sharing ? '…' : t('КАРТОЧКА')}</span>
        </button>
      </div>

      <div className="po-plate po-plate--market" style={{ padding: 18, marginBottom: 14, position: 'relative', overflow: 'hidden' }}>
        <span className="po-hazard-corner" aria-hidden="true" />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 230px' }}>
            <div className="ares-mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: '#E0A183', marginBottom: 7 }}>
              {t('ЦЕЛЬ КОЛОНИИ · DEVNET')}
            </div>
            <h2 className="ares-stencil" style={{ fontSize: 18, margin: '0 0 8px', color: '#F6F1ED' }}>
              {t('ЧЕТЫРЕ ГЛАВЫ. ОДИН ЛУННЫЙ ЦИКЛ.')}
            </h2>
            <p style={{ color: 'var(--pf-text-secondary)', fontSize: 12, lineHeight: 1.55, margin: 0, maxWidth: 490 }}>
              {t('Подготовь теплицу за 28 дней. Задачи ниже сверяются с текущими on-chain аккаунтами; пока это журнал состояния, без сезонных очков, рейтинга или награды.')}
            </p>
          </div>
          <div style={{ textAlign: 'right', minWidth: 105 }}>
            <div className="ares-mono" style={{ color: '#C9A176', fontSize: 9, letterSpacing: '0.14em' }}>{t('ЦИКЛ · ЭПОХА')}</div>
            <div className="lcd-readout" style={{ display: 'inline-block', marginTop: 5, padding: '6px 10px', fontSize: 20, fontWeight: 700 }}>
              {cycleNumber === null ? '—' : `#${cycleNumber}`} · {cycleValue}
            </div>
            <div className="ares-mono" style={{ color: 'rgba(224,161,131,0.72)', fontSize: 8, marginTop: 4 }}>{t('по on-chain эпохе')}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(128px, 100%), 1fr))', gap: 7, marginTop: 18 }}>
          {CHAPTERS.map((chapter, index) => {
            const Icon = chapter.icon
            const active = chapterIndex === index
            const previous = chapterIndex !== null && chapterIndex > index
            return (
              <div
                key={chapter.title}
                style={{
                  borderRadius: 7,
                  padding: '10px 9px',
                  minHeight: 77,
                  background: active ? 'rgba(255,179,71,0.12)' : 'rgba(10,6,3,0.45)',
                  border: `1px solid ${active ? 'rgba(255,179,71,0.62)' : previous ? 'rgba(201,161,118,0.26)' : 'rgba(255,179,71,0.15)'}`,
                  opacity: chapterIndex === null ? 0.62 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 6 }}>
                  <Icon size={15} color={active ? '#FFC94A' : '#C9A176'} aria-hidden="true" />
                  <span className="ares-mono" style={{ fontSize: 7, color: '#A88D70' }}>{t(chapter.short)}</span>
                </div>
                <div className="ares-stencil" style={{ fontSize: 10, color: active ? '#FFC94A' : '#E0A183', lineHeight: 1.2 }}>{t(chapter.title)}</div>
                <div className="ares-mono" style={{ fontSize: 7, color: active ? '#E0A183' : 'rgba(224,161,131,0.5)', marginTop: 4 }}>
                  {active ? t('ТЕКУЩАЯ ГЛАВА') : previous ? t('ПРЕДЫДУЩАЯ') : t('ДАЛЕЕ')}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {fieldsError && <div style={{ marginBottom: 12 }}><button className="mk-key" onClick={() => void reload()}>{t('Обновить данные')}</button></div>}

      <ConsolePanel title={t('ЛИЧНЫЙ ЖУРНАЛ ОПЕРАЦИИ')} tone="amber">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div className="ares-mono" style={{ fontSize: 10, color: 'var(--pf-text-secondary)' }}>
            {connected ? t('ПРОВЕРКА: ТЕКУЩЕЕ СОСТОЯНИЕ ON-CHAIN') : t('ПОДКЛЮЧИ КОШЕЛЁК ДЛЯ ЛИЧНОГО ЖУРНАЛА')}
          </div>
          <div className="ares-mono" style={{ fontSize: 10, color: connected ? '#9FBE7A' : '#E0A183' }}>
            {!connected ? t('НЕТ СВЯЗИ') : loading ? t('СИНХРОНИЗАЦИЯ…') : t('ГОТОВО: {done} ИЗ {total}', { done: completedMissions, total: missions.length })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 9 }}>
          {missions.map((mission) => {
            const copy = MISSION_COPY[mission.id]
            const value = mission.id === 'ration-reserve'
              ? `${(mission.progress / MICRO).toFixed(1)} / ${(mission.target / MICRO).toFixed(0)} POTATO`
              : `${mission.progress} / ${mission.target}`
            const percent = mission.target > 0 ? (mission.progress / mission.target) * 100 : 0
            return (
              <article key={mission.id} style={{ padding: '12px 13px', borderRadius: 8, border: `1px solid ${mission.complete ? 'rgba(159,190,122,0.38)' : 'rgba(255,179,71,0.16)'}`, background: 'linear-gradient(180deg, rgba(23,16,10,0.96), rgba(15,10,6,0.96))' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 50, display: 'grid', placeItems: 'center', flexShrink: 0, background: mission.complete ? 'rgba(159,190,122,0.14)' : 'rgba(255,179,71,0.08)' }}>
                    {mission.complete ? <Check size={15} color="#9FBE7A" aria-hidden="true" /> : <Clock3 size={14} color="#C9A176" aria-hidden="true" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ares-stencil" style={{ color: mission.complete ? '#C8D9A6' : '#F2E8DA', fontSize: 12 }}>{t(copy.title)}</div>
                    <div style={{ color: 'var(--pf-text-secondary)', fontSize: 10, marginTop: 3, lineHeight: 1.4 }}>{t(copy.description)}</div>
                  </div>
                  <div className="ares-mono" style={{ color: mission.complete ? '#9FBE7A' : '#FFC94A', fontSize: 10, textAlign: 'right', flexShrink: 0 }}>{connected ? value : '—'}</div>
                </div>
                <div style={{ marginTop: 9 }}><LiquidBar value={connected ? percent : 0} height={6} label={t(copy.title)} /></div>
              </article>
            )
          })}
        </div>
      </ConsolePanel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9, marginTop: 14 }}>
        <div className="mk-key" style={{ padding: 12, cursor: 'default' }}>
          <div className="ares-mono" style={{ color: '#C9A176', fontSize: 8 }}>{t('ОБЩИЙ СЧЁТЧИК КОЛОНИИ')}</div>
          <div className="ares-stencil" style={{ color: '#FFC94A', fontSize: 16, marginTop: 5 }}>{config ? Number(config.fieldCount).toLocaleString() : '—'}</div>
          <div className="ares-mono" style={{ color: '#A88D70', fontSize: 8, marginTop: 3 }}>{t('ДЕЛЯНКИ, ЗАВЕДЁННЫЕ ON-CHAIN')}</div>
        </div>
        <div className="mk-key" style={{ padding: 12, cursor: 'default' }}>
          <div className="ares-mono" style={{ color: '#C9A176', fontSize: 8 }}>{t('КОЛЛЕКТИВНЫЙ РЕЗЕРВ')}</div>
          <div className="ares-stencil" style={{ color: '#FFC94A', fontSize: 16, marginTop: 5 }}>{config ? `${(Number(config.totalBurnedMicro) / MICRO).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}</div>
          <div className="ares-mono" style={{ color: '#A88D70', fontSize: 8, marginTop: 3 }}>{t('POTATO СОЖЖЕНО В ИГРОВЫХ ОПЕРАЦИЯХ')}</div>
        </div>
      </div>

      <div style={{ padding: 13, marginTop: 14, borderRadius: 8, border: '1px solid rgba(224,161,131,0.2)', background: 'rgba(10,6,3,0.55)' }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <ShieldCheck size={16} color="#E0A183" aria-hidden="true" />
          <p style={{ color: 'var(--pf-text-secondary)', fontSize: 10, lineHeight: 1.55, margin: 0 }}>
            {t('Это devnet-журнал состояния, а не запущенный соревновательный сезон. Очки, призы, глобальный рейтинг и архив появятся только после внедрения сезонного on-chain учёта; тестовые активы и прогресс не имеют денежной ценности.')}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <Link to="/" className="mk-key mk-key--paint op-action" style={{ textDecoration: 'none', padding: '10px 14px', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
          {t('В ТЕПЛИЦУ')} <ArrowRight size={14} aria-hidden="true" />
        </Link>
        <Link to="/market" className="mk-key op-action" style={{ textDecoration: 'none', padding: '10px 14px', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
          {t('К РЫНКУ')} <ArrowRight size={14} aria-hidden="true" />
        </Link>
        {!connected && <Link to="/lab" className="mk-key op-action" style={{ textDecoration: 'none', padding: '10px 14px', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11 }}>{t('ОТКРЫТЬ ЛАБОРАТОРИЮ')}</Link>}
      </div>

      {!ready && <div style={{ marginTop: 12, color: 'var(--pf-text-muted)', fontSize: 11 }}>{t('Ожидаем ответ Solana RPC…')}</div>}
    </div>
  )
}
