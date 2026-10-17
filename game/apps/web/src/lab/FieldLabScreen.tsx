import { useMemo, useState } from 'react'
import { ArrowRight, BatteryMedium, Droplets, FlaskConical, Hammer, Leaf, Pause, Play, RotateCcw, Sprout, Truck, Wallet } from 'lucide-react'
import { useI18n } from '../i18n'
import { useGame } from '../contexts/GameContext'
import type { Field } from '../contexts/GameContext'
import { useSolana } from '../contexts/SolanaContext'
import { useColony } from '../colony/ColonyContext'
import { dailyBudget, foodDemand, PARAMETERS } from '../colony/simulation'
import type { ColonyState, DayBudget } from '../colony/simulation'
import FieldsPanel from '../fields/FieldsPanel'
import { fieldVisual } from '../fields/model'
import type { FieldVisual } from '../fields/model'
import FieldCardVice from '../components/FieldCardVice'
import ResourceIcon from '../fields/ResourceIcon'
import type { ResourceArt } from '../fields/visualAssets'
import { useMarketplace } from '../hooks/useMarketplace'
import { dailyYieldMicro, fmtPotato, fmtSol, HARVEST_THRESHOLD_MICRO, MICRO } from '../utils/constants'
import { LAB, labScale, supplyRoom } from '../fields/engineering/engine'
import type { EngineeringAction, EngineeringState } from '../fields/engineering/engine'
import {
  colonyFreeStorageKg, colonyStock, drawFromColony, receiveLabFood, shippableKg, shippableLots, supplyGrant, SUPPLY_STEP,
} from './bridge'
import type { LabSupplyResource } from './bridge'
import { colonyLink, microFieldEconomics, tierEconomics } from './economics'
import type { ColonyLink, MicroFieldEconomics, TierEconomics } from './economics'
import './lab.css'

/**
 * ARES—1 / FIELD LAB — продуктовая версия (2026-10-17).
 *
 * Настоящее (из игры):
 *  - поля, балансы POTATO/SKR, накопленный урожай, лицензия, лимит батча и все
 *    пять действий поля — из `GameContext` (тот же on-chain контур, что в АГРО);
 *  - выход полей в день — живая формула `dailyYieldMicro` с текущей on-chain
 *    конфигурацией и эпохой;
 *  - цены тиров, налог, окупаемость и микро-поле — зеркало программы
 *    (`utils/constants`) и принятые правила входа (`organism/market`);
 *  - стакан и обороты POTATO/SOL — `useMarketplace` (только с кошельком);
 *  - вода, питание, запчасти, площадки, еда и энергия — ОБЩИЙ стор колонии
 *    (`colony/ColonyContext`): те же числа, что во вкладке КОЛОНИЯ.
 *
 * Учебное (локальный учёт, без денег): инженерный SIM-слой поля (ARES-LAB/2) и
 * песочница колонии. Передачи стенд↔база пишутся в оба локальных реестра, не
 * конвертируются в POTATO, не создают аккаунтов и не подписывают транзакций.
 */
const BENCH_TIERS = [0, 1, 2] as const
const BENCH_PREFIX = 'lab-bench-'
const TIER_NAMES = ['COMMON', 'RARE', 'EPIC'] as const
const isBenchId = (id: string): boolean => id.startsWith(BENCH_PREFIX)
const number = (value: number, decimals = 0): string => (Number.isFinite(value) ? value.toFixed(decimals) : '—')

export default function FieldLabScreen(): JSX.Element {
  const { t, lang } = useI18n()
  const game = useGame()
  const { connected, ready, config, rpcError, publicKey } = useSolana()
  const colony = useColony()
  const budget = useMemo(() => dailyBudget(colony.state, colony.scenario), [colony.state, colony.scenario])
  const [report, setReport] = useState('')
  const nowSec = Math.floor(Date.now() / 1000)

  const ownedFields = game.fields.map(field => fieldVisual(field, nowSec))
  // Учебные стенды трёх тиров: работают без кошелька и без полей, явно помечены.
  const benchFields = useMemo<FieldVisual[]>(() => BENCH_TIERS.map(tier => ({
    id: `${BENCH_PREFIX}${tier}`, tier, level: 1, condition: 1, active: true, ready: false,
    fertilized: false, taxExpired: false, mutation: 0, growth: 0.4, pendingMicro: 0,
  })), [])
  const live = connected && ownedFields.length > 0
  const panelFields = live ? ownedFields : benchFields

  const cfg = config ? { baseYieldMicroPerDay: Number(config.baseYieldMicroPerDay), globalMultiplierBps: config.globalMultiplierBps } : null
  const epochId = config ? Number(config.epochId) : undefined
  const yieldPerDay = (field: Field): number => (cfg ? dailyYieldMicro({ ...field, epochId }, cfg, nowSec) : 0)
  const totalYield = cfg ? game.fields.reduce((sum, field) => sum + yieldPerDay(field), 0) : null

  const link = colonyLink(game.fields.length, colony.state.modules.length)
  const tiers = tierEconomics(game.stats.potatoBalance)
  const micro = microFieldEconomics(game.fields.length, game.stats.potatoBalance)
  const freeStorageKg = colonyFreeStorageKg(colony.state)
  const readyCount = game.fields.filter(field => field.accumulated >= HARVEST_THRESHOLD_MICRO).length
  const walletTag = publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : ''

  return (
    <div className="lab-app" data-testid="field-lab">
      <div className="lab-main">
        <section className="lab-hero" data-testid="lab-hero">
          <img className="lab-hero-image" src="/ares/art/mars-sector.webp" alt="" aria-hidden="true" draggable={false} />
          <div className="lab-hero-copy">
            <p className="lab-eyebrow">ARES—1 / FIELD LAB · {t('ПРОДАКТ · ЖИВЫЕ ДАННЫЕ ИГРЫ')}</p>
            <h1>{t('ПОЛЕВАЯ ЛАБОРАТОРИЯ')}</h1>
            <p className="lab-lead">{t('Настоящие поля кошелька, общий сток колонии и правила рынка в одной секции. Инженерный SIM остаётся учебным слоем и не платит токенами.')}</p>
          </div>
          <div className="lab-hero-chip" data-testid="lab-wallet">
            <Wallet size={14} aria-hidden="true" />
            {connected && publicKey
              ? <span className="ares-mono">{t('ЭКИПАЖ: {wallet}', { wallet: walletTag })}</span>
              : <span className="ares-mono">{t('НЕТ КОШЕЛЬКА')} · <a href="/">{t('АВТОРИЗАЦИЯ В АГРО-ОТСЕКЕ')}</a></span>}
          </div>
        </section>

        <div className="lab-live" data-testid="lab-live">
          <LiveTile art="crop" label={t('ПАЁК · POTATO')} value={fmtPotato(game.stats.potatoBalance, 0)} unit="POTATO"
            detail={t('ЖДЁТ СБОРА: {n} POTATO', { n: fmtPotato(game.stats.pendingHarvest, 2) })} />
          <LiveTile art="budget" label={t('ЗАПАС · SKR')} value={number(game.stats.skrBalance, 2)} unit="SKR"
            detail={game.licenseActive ? t('ЛИЦЕНЗИЯ ЭКСПОРТА АКТИВНА') : t('ЛИЦЕНЗИЯ ЭКСПОРТА НЕ КУПЛЕНА')} />
          <LiveTile art="solar" label={t('ВЫХОД ПОЛЕЙ В ДЕНЬ')} value={totalYield === null ? '—' : fmtPotato(totalYield, 2)} unit="POTATO"
            detail={t('ПО ON-CHAIN КОНФИГУРАЦИИ И ЭПОХЕ')} />
          <LiveTile art="telemetry" label={t('ПОЛЯ КОШЕЛЬКА')} value={String(game.fields.length)} unit={t('ШТ')}
            detail={readyCount > 0 ? t('ГОТОВЫ К СБОРУ: {n}', { n: readyCount }) : t('ЛИМИТ БАТЧА: {n} ПОЛЕЙ', { n: game.batchLimit })}
            tone={readyCount > 0 ? 'ok' : undefined} />
          <LiveTile art="water" label={t('ВОДА КОЛОНИИ')} value={number(colony.state.waterLitres)} unit={t('Л')}
            detail={`${t('РАСХОД')} −${number(budget.waterUsedLitres, 1)} ${t('Л')} / ${t('ДЕНЬ')}`}
            tone={budget.waterShortfallLitres > 0.01 ? 'danger' : undefined} />
          <LiveTile art="battery" label={t('ЭНЕРГИЯ КОЛОНИИ')} value={`${number(budget.generationKwh)} / ${number(budget.demandKwh)}`} unit="kWh"
            detail={budget.unmetKwh > 0.01 ? t('ДЕФИЦИТ: {n} КВТ·Ч', { n: number(budget.unmetKwh, 1) }) : t('ИЗЛИШЕК: {n} КВТ·Ч', { n: number(budget.curtailedKwh, 1) })}
            tone={budget.unmetKwh > 0.01 ? 'danger' : 'ok'} />
        </div>

        <div className="lab-workspace">
          <section className="lab-fields" aria-label={t('ПОЛЯ И СТЕНДЫ')}>
            {!ready && <p className="lab-note" role="status">{rpcError ? t('Нет связи с блокчейном') : t('Инициализация игры…')}</p>}
            {ready && !connected && <p className="lab-note">{t('Стенды ниже работают без кошелька. Настоящие поля и действия появятся после авторизации в агро-отсеке.')}</p>}
            {ready && connected && game.fieldsError && <p className="lab-note lab-note--warning">{game.fieldsError} · <button type="button" className="lab-key lab-key--small" onClick={() => void game.reload()}>{t('ПОВТОРИТЬ')}</button></p>}
            <FieldsPanel
              fields={panelFields}
              language={lang}
              demo={!live}
              initialLayer="chain"
              renderCards={live ? () => game.fields.map((field, index) => (
                <FieldCardVice key={field.publicKey.toString()} field={field} index={index}
                  onHarvest={game.harvest} onUpgrade={game.upgradeField} onRepair={game.repairField}
                  onPayTax={game.payTax} onApplyFertilizer={game.applyFertilizer} />
              )) : undefined}
              renderInspector={selected => {
                if (isBenchId(selected.id)) return <BenchInspector tier={selected.tier} priceMicro={tiers[selected.tier]?.priceMicro ?? 0} />
                const index = game.fields.findIndex(field => field.publicKey.toString() === selected.id)
                const field = game.fields[index]
                if (!field) return null
                return <FieldCardVice key={selected.id} field={field} index={index}
                  onHarvest={game.harvest} onUpgrade={game.upgradeField} onRepair={game.repairField}
                  onPayTax={game.payTax} onApplyFertilizer={game.applyFertilizer} />
              }}
              renderLabSupply={(field, sim, dispatch) => (
                <ColonySupply fieldId={field.id} bench={isBenchId(field.id)} sim={sim} dispatch={dispatch}
                  colonyState={colony.state} running={colony.running} freeStorageKg={freeStorageKg}
                  onColonyChange={colony.setState} onReport={setReport} />
              )}
            />
          </section>

          <aside className="lab-side">
            <ColonyPanel state={colony.state} budget={budget} running={colony.running} ended={colony.ended}
              link={link} onAdvance={colony.advance} onRunning={colony.setRunning} onReset={colony.reset} />
            {connected && <MarketBook />}
            <MarketPanel tiers={tiers} micro={micro} link={link} balanceMicro={game.stats.potatoBalance}
              connected={connected} purchasing={game.purchasing} onBuy={tier => void game.purchaseField(tier)} />
          </aside>
        </div>

        <p className="lab-report" role="status" aria-live="polite" data-testid="lab-report">{report}</p>
        <footer className="lab-footer">
          <span className="lab-footer-mark">ARES / FIELD LAB — 002</span>
          <p>{t('Полевая лаборатория читает настоящие поля, балансы и ордера, но SIM-партии еды и ресурсы колонии остаются локальным учётом: они не конвертируются в POTATO и не создают транзакций.')}</p>
        </footer>
      </div>
    </div>
  )
}

function LiveTile({ art, label, value, unit, detail, tone }: {
  art: ResourceArt; label: string; value: string; unit: string; detail: string; tone?: 'ok' | 'danger'
}): JSX.Element {
  return (
    <div className={`lab-tile${tone ? ` lab-tile--${tone}` : ''}`}>
      <div className="lab-tile-label"><ResourceIcon kind={art} size={22} />{label}</div>
      <div className="lab-tile-value">{value}<small>{unit}</small></div>
      <p>{detail}</p>
    </div>
  )
}

/** Учебный стенд: ресурсы и масштаб тира для тренировки, без on-chain действий. */
function BenchInspector({ tier, priceMicro }: { tier: 0 | 1 | 2; priceMicro: number }): JSX.Element {
  const { t } = useI18n()
  const scale = labScale(tier)
  return (
    <div className="lab-bench" data-testid="lab-bench" data-tier={tier}>
      <p className="lab-eyebrow">{t('УЧЕБНЫЙ СТЕНД · НЕ АККАУНТ КОШЕЛЬКА')}</p>
      <h2>{t('СТЕНД {tier} · {name}', { tier: String(tier + 1).padStart(2, '0'), name: TIER_NAMES[tier] })}</h2>
      <p>{t('Стенд повторяет ресурсы и масштаб тира для тренировки. Он не принадлежит кошельку, не начисляет POTATO и не появляется в блокчейне.')}</p>
      <ul className="lab-bench-list">
        <li><span>{t('МАСШТАБ РЕСУРСОВ')}</span><b>×{number(scale, 2)}</b></li>
        <li><span>{t('РЕЗЕРВ ВОДЫ')}</span><b>{number(LAB.supplyInitialL * scale)} {t('Л')}</b></li>
        <li><span>{t('ПИТАНИЕ')}</span><b>{number(LAB.nutrientsInitialKg * scale, 2)} {t('кг')}</b></li>
        <li><span>{t('ЦЕНА ТИРА')}</span><b>{fmtPotato(priceMicro, 0)} POTATO</b></li>
      </ul>
      <a className="lab-key" href="/">{t('ПОДКЛЮЧИТЬ КОШЕЛЁК В АГРО-ОТСЕКЕ')}<ArrowRight size={14} /></a>
    </div>
  )
}

/**
 * Снабжение стенда из общего стока колонии и приём партий обратно.
 * Клавиши выключены, пока часы колонии идут: дневной тик может изменить сток
 * между расчётом и записью, и два реестра разойдутся.
 */
function ColonySupply({ fieldId, bench, sim, dispatch, colonyState, running, freeStorageKg, onColonyChange, onReport }: {
  fieldId: string
  bench: boolean
  sim: EngineeringState
  dispatch: (action: EngineeringAction) => void
  colonyState: ColonyState
  running: boolean
  freeStorageKg: number
  onColonyChange: (action: (state: ColonyState) => ColonyState) => void
  onReport: (message: string) => void
}): JSX.Element {
  const { t } = useI18n()
  const lots = shippableLots(sim)

  const draw = (resource: LabSupplyResource): void => {
    const grant = supplyGrant(colonyState, sim, resource)
    if (grant <= 0) {
      onReport(colonyStock(colonyState, resource) <= 0 ? t('КОЛОНИЯ НЕ МОЖЕТ ВЫДАТЬ РЕСУРС') : t('НА СТЕНДЕ НЕТ СВОБОДНОГО МЕСТА'))
      return
    }
    dispatch({ type: 'supply', resource, amount: grant })
    onColonyChange(state => drawFromColony(state, resource, grant).state)
    onReport(t('ПЕРЕДАНО ИЗ КОЛОНИИ: {amount} {unit}', {
      amount: resource === 'spares' ? String(grant) : number(grant, 2),
      unit: resource === 'water' ? t('Л') : resource === 'nutrients' ? t('кг') : t('ШТ'),
    }))
  }

  const ship = (lotId: number): void => {
    const kg = shippableKg(sim, lotId, colonyState)
    if (kg <= 0) { onReport(t('ХРАНИЛИЩЕ БАЗЫ ЗАПОЛНЕНО')); return }
    const kind = sim.lots.find(lot => lot.id === lotId)?.kind ?? 'raw'
    dispatch({ type: 'ship', lotId, kg })
    onColonyChange(state => receiveLabFood(state, kg, kind).state)
    onReport(t('ПАРТИЯ {kg} КГ ПРИНЯТА В ХРАНИЛИЩЕ БАЗЫ', { kg: number(kg, 2) }))
  }

  const rows: Array<{ resource: LabSupplyResource; art: ResourceArt; label: string; unit: string; places: number }> = [
    { resource: 'water', art: 'water', label: t('ВОДА'), unit: t('Л'), places: 0 },
    { resource: 'nutrients', art: 'nutrients', label: t('ПИТАНИЕ'), unit: t('кг'), places: 2 },
    { resource: 'spares', art: 'service', label: t('ЗАПАСНЫЕ ЧАСТИ'), unit: t('ШТ'), places: 0 },
  ]

  return (
    <section className="lab-supply" data-testid="lab-supply" data-field-id={fieldId} aria-label={t('СНАБЖЕНИЕ СТЕНДА ИЗ КОЛОНИИ')}>
      <p className="lab-eyebrow"><Truck size={15} aria-hidden="true" />{t('СНАБЖЕНИЕ СТЕНДА ИЗ КОЛОНИИ')}</p>
      <p className="lab-fineprint">{t('Один сток на секции: сколько забрал стенд, столько списано у базы. Партии еды возвращаются в её хранилище.')}</p>
      {running && <p className="lab-warning" role="status">{t('ОСТАНОВИ ЧАСЫ КОЛОНИИ, ЧТОБЫ ПЕРЕДАТЬ СНАБЖЕНИЕ')}</p>}
      <div className="lab-supply-rows">
        {rows.map(row => {
          const stock = colonyStock(colonyState, row.resource)
          const room = supplyRoom(sim, row.resource)
          const grant = supplyGrant(colonyState, sim, row.resource)
          const step = SUPPLY_STEP[row.resource]
          return (
            <div className="lab-supply-row" key={row.resource} data-resource={row.resource}>
              <ResourceIcon kind={row.art} size={30} />
              <div className="lab-supply-text">
                <b>{row.label}</b>
                <span className="ares-mono">{t('СТОК КОЛОНИИ: {value} {unit}', { value: number(stock, row.places), unit: row.unit })}</span>
                <span className="ares-mono">{t('СВОБОДНО НА СТЕНДЕ: {value} {unit}', { value: number(room, row.places), unit: row.unit })}</span>
              </div>
              <button type="button" className="lab-key" disabled={running || grant <= 0} onClick={() => draw(row.resource)}>
                {t('ПЕРЕДАТЬ {amount} {unit}', { amount: row.resource === 'spares' ? String(step) : number(step, row.places), unit: row.unit })}
              </button>
            </div>
          )
        })}
      </div>
      <div className="lab-ship" data-testid="lab-ship">
        <div className="lab-ship-head">
          <p className="lab-eyebrow"><FlaskConical size={15} aria-hidden="true" />{t('ОТПРАВИТЬ ПАРТИЮ В ХРАНИЛИЩЕ')}</p>
          <span className="ares-mono">{t('СВОБОДНО В ХРАНИЛИЩЕ: {kg} КГ ИЗ {cap} КГ', { kg: number(freeStorageKg, 1), cap: String(colonyState.ledger.storageCapKg) })}</span>
        </div>
        {lots.length === 0
          ? <p className="lab-fineprint">{t('Партий нет. Собери еду в SIM-слое стенда, затем верни её в хранилище базы.')}</p>
          : <ul>{lots.map(lot => (
            <li key={lot.id} data-lot-id={lot.id}>
              <span>#{String(lot.id).padStart(2, '0')} · {lot.kind === 'raw' ? t('СВЕЖАЯ') : t('ПЕРЕРАБОТАННАЯ')}</span>
              <b>{number(lot.kg, 2)} {t('кг')}</b>
              <button type="button" className="lab-key" disabled={running || shippableKg(sim, lot.id, colonyState) <= 0} onClick={() => ship(lot.id)}>
                {t('ОТПРАВИТЬ {kg} КГ', { kg: number(shippableKg(sim, lot.id, colonyState), 2) })}
              </button>
            </li>
          ))}</ul>}
        <p className="lab-fineprint">{t('ПРИНЯТО БАЗОЙ ЗА СЕАНС: {kg} КГ', { kg: number(sim.totals.shippedKg, 2) })} · {t('ПОЛУЧЕНО ОТ БАЗЫ: {litres} {unit} / {nutrients} {nutrientUnit}', { litres: number(sim.totals.inflowLitres, 1), unit: t('Л'), nutrients: number(sim.totals.inflowNutrientsKg, 3), nutrientUnit: t('кг') })}</p>
        {bench && <p className="lab-fineprint">{t('Стенд учебный: партии и передачи остаются локальным учётом и не влияют на баланс POTATO.')}</p>}
      </div>
      <p className="lab-fineprint">{t('МАСШТАБ СТЕНДА: ×{scale} · ПОТОЛОК РЕЗЕРВА {cap} {unit}', { scale: number(labScale(sim.tier), 2), cap: String(LAB.supplyCapacityL), unit: t('Л') })}</p>
    </section>
  )
}

/** Общий сток колонии: те же числа, что во вкладке КОЛОНИЯ, плюс связь с полями. */
function ColonyPanel({ state, budget, running, ended, link, onAdvance, onRunning, onReset }: {
  state: ColonyState
  budget: DayBudget
  running: boolean
  ended: boolean
  link: ColonyLink
  onAdvance: (days: number) => void
  onRunning: (value: boolean | ((previous: boolean) => boolean)) => void
  onReset: () => void
}): JSX.Element {
  const { t } = useI18n()
  const foodDays = state.foodKg / Math.max(foodDemand(state), 0.001)
  return (
    <section className="lab-card" data-testid="lab-colony-link" aria-label={t('СВЯЗЬ С КОЛОНИЕЙ')}>
      <p className="lab-eyebrow"><Sprout size={15} aria-hidden="true" />{t('СВЯЗЬ С КОЛОНИЕЙ')}</p>
      <div className="lab-card-head">
        <h2>{t('ДЕНЬ {day} ИЗ {total}', { day: String(state.day).padStart(3, '0'), total: String(PARAMETERS.maxDays) })}</h2>
        <a className="lab-key" href="/base">{t('ОТКРЫТЬ КОЛОНИЮ')}<ArrowRight size={14} /></a>
      </div>
      <dl className="lab-figures">
        <div><dt>{t('ВОДА КОЛОНИИ')}</dt><dd>{number(state.waterLitres)} {t('Л')}</dd></div>
        <div><dt>{t('ПИТАНИЕ КОЛОНИИ')}</dt><dd>{number(state.nutrientsKg, 2)} {t('кг')}</dd></div>
        <div><dt>{t('ЗАПАСНЫЕ ЧАСТИ')}</dt><dd>{number(state.sparesKg, 1)} {t('кг')}</dd></div>
        <div><dt>{t('ЕДА В ХРАНИЛИЩЕ')}</dt><dd>{number(state.foodKg, 1)} {t('кг')} · {number(foodDays, 1)} {t('ДНЕЙ')}</dd></div>
        <div><dt>{t('КИСЛОРОД')}</dt><dd>{number(state.oxygenKg, 1)} {t('кг')}</dd></div>
        <div><dt>{t('ПЛОЩАДКИ БАЗЫ')}</dt><dd>{state.modules.length} / {link.pads}</dd></div>
        <div><dt>{t('ПОЛЯ, СВЯЗАННЫЕ С БАЗОЙ')}</dt><dd>{link.linkedFields} / {link.cap}</dd></div>
        <div><dt>{t('БЮДЖЕТ КОЛОНИИ')}</dt><dd>{number(state.credits)} CR</dd></div>
      </dl>
      <p className="lab-fineprint">{link.hasRoom
        ? t('Есть свободная площадка: следующее поле можно связать с базой.')
        : t('Предел связи с базой достигнут: освободи площадку или построй новый модуль.')}</p>
      <div className="lab-card-actions">
        <button type="button" className="lab-key" disabled={ended} onClick={() => onRunning(value => !value)}>
          {running ? <Pause size={14} /> : <Play size={14} />}{running ? t('ОСТАНОВИТЬ') : t('ЗАПУСТИТЬ')}
        </button>
        <button type="button" className="lab-key" disabled={running || ended} onClick={() => onAdvance(1)}>{t('+1 ДЕНЬ')}</button>
        <button type="button" className="lab-key" disabled={running || ended} onClick={() => onAdvance(7)}>{t('+7 ДНЕЙ')}</button>
        <button type="button" className="lab-key lab-key--ghost" onClick={onReset}><RotateCcw size={14} />{t('НОВАЯ ЭКСПЕДИЦИЯ')}</button>
      </div>
      <p className="lab-fineprint lab-inline-figures">
        <span><BatteryMedium size={13} aria-hidden="true" />{t('БАТАРЕЯ: {value} КВТ·Ч', { value: number(state.batteryKwh, 1) })}</span>
        <span><Droplets size={13} aria-hidden="true" />{t('РАСХОД ВОДЫ: {value} {unit} В ДЕНЬ', { value: number(budget.waterUsedLitres, 1), unit: t('Л') })}</span>
        <span><Hammer size={13} aria-hidden="true" />{t('РОСТ ПОСЕВОВ: {value}%', { value: number(budget.growthFraction * 100) })}</span>
      </p>
    </section>
  )
}

/** Живой стакан POTATO/SOL: монтируется только с подключённым кошельком. */
function MarketBook(): JSX.Element {
  const { t } = useI18n()
  const { orders, stats, loading, error } = useMarketplace()
  const book = orders.filter(order => !order.isOwn)
  const best = book.reduce<number | null>((min, order) => (min === null || order.priceLamportsPerPotato < min ? order.priceLamportsPerPotato : min), null)
  const bookPotato = book.reduce((sum, order) => sum + order.amountMicro, 0) / MICRO
  return (
    <section className="lab-card" data-testid="lab-market-book" aria-label={t('СТАКАН СНАБЖЕНИЯ')}>
      <p className="lab-eyebrow"><Leaf size={15} aria-hidden="true" />{t('СТАКАН СНАБЖЕНИЯ')}</p>
      {error
        ? <p className="lab-fineprint lab-warning">{error}</p>
        : <dl className="lab-figures">
          <div><dt>{t('ЛУЧШАЯ ЦЕНА ПОКУПКИ')}</dt><dd>{best === null ? '—' : `${fmtSol(best, 4)} SOL`}</dd></div>
          <div><dt>{t('ОРДЕРОВ В СТАКАНЕ')}</dt><dd>{String(book.length)}</dd></div>
          <div><dt>{t('POTATO В СТАКАНЕ')}</dt><dd>{number(bookPotato, 0)}</dd></div>
          <div><dt>{t('ГРУЗООБОРОТ ЗА СОЛ')}</dt><dd>{number(stats.sellVolume24h, 0)} POTATO</dd></div>
          <div><dt>{t('Оборот рынка')}</dt><dd>{number(stats.totalSolVolume, 2)} SOL</dd></div>
          <div><dt>{t('Всего операций')}</dt><dd>{String(stats.totalTrades)}</dd></div>
        </dl>}
      {loading && book.length === 0 && !error && <p className="lab-fineprint" role="status">{t('РЫНОК ЗАГРУЖАЕТСЯ…')}</p>}
      <a className="lab-key" href="/market">{t('ОТКРЫТЬ СНАБЖЕНИЕ')}<ArrowRight size={14} /></a>
    </section>
  )
}

/** Правила рынка и экономики: цены тиров, окупаемость, микро-поле, связь с базой. */
function MarketPanel({ tiers, micro, link, balanceMicro, connected, purchasing, onBuy }: {
  tiers: TierEconomics[]
  micro: MicroFieldEconomics
  link: ColonyLink
  balanceMicro: number
  connected: boolean
  purchasing: boolean
  onBuy: (tier: number) => void
}): JSX.Element {
  const { t } = useI18n()
  return (
    <section className="lab-card" data-testid="lab-market" aria-label={t('РЫНОК И ЭКОНОМИКА')}>
      <p className="lab-eyebrow"><Truck size={15} aria-hidden="true" />{t('РЫНОК И ЭКОНОМИКА')}</p>
      <div className="lab-table-scroll">
        <table className="lab-table">
          <thead><tr><th>{t('ТИР')}</th><th>{t('ЦЕНА')}</th><th>{t('ВЫХОД В ДЕНЬ')}</th><th>{t('НАЛОГ В ДЕНЬ')}</th><th>{t('ОКУПАЕМОСТЬ')}</th><th /></tr></thead>
          <tbody>
            {tiers.map(row => (
              <tr key={row.tier} data-tier={row.tier}>
                <th scope="row">{row.name}</th>
                <td>{fmtPotato(row.priceMicro, 0)}</td>
                <td>{fmtPotato(row.yieldPerDayMicro, 2)}</td>
                <td>{fmtPotato(row.taxPerDayMicro, 2)}</td>
                <td>{Number.isFinite(row.payback) ? `${number(row.payback, 1)} ${t('ДНЕЙ')}` : '—'}</td>
                <td><button type="button" className="lab-key lab-key--small" disabled={!connected || purchasing || !row.affordable} onClick={() => onBuy(row.tier)}>
                  {purchasing ? t('Монтаж…') : row.affordable ? t('Развернуть') : t('Нехватка пайка')}
                </button></td>
              </tr>
            ))}
            <tr data-tier="micro">
              <th scope="row">{t('МИКРО-ПОЛЕ')}</th>
              <td>{fmtPotato(micro.priceMicro, 0)}</td>
              <td>{fmtPotato(micro.yieldPerDayMicro, 2)}</td>
              <td>{fmtPotato(micro.taxPerDayMicro, 2)}</td>
              <td>{Number.isFinite(micro.payback) ? `${number(micro.payback, 1)} ${t('ДНЕЙ')}` : '—'}</td>
              <td><span className="lab-tag">{t('ВХОД')}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="lab-fineprint">{t('БАЛАНС: {amount} POTATO', { amount: fmtPotato(balanceMicro, 0) })} · {t('ЦЕНЫ И ВЫХОД — ЗЕРКАЛО ON-CHAIN КОНФИГУРАЦИИ')}</p>
      <p className="lab-fineprint">{t('СВЯЗЬ С БАЗОЙ: {linked} ИЗ {cap} ПОЛЕЙ ПРИ {free} СВОБОДНЫХ ПЛОЩАДКАХ', { linked: String(link.linkedFields), cap: String(link.cap), free: String(link.freePads) })}</p>
      <a className="lab-key" href="/market">{t('ОТКРЫТЬ СНАБЖЕНИЕ')}<ArrowRight size={14} /></a>
    </section>
  )
}
