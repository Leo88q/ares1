import { useMemo } from 'react'
import { ArrowRight, FlaskConical, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useGame } from '../contexts/GameContext'
import { useSolana } from '../contexts/SolanaContext'
import FieldsPanel from '../fields/FieldsPanel'
import { fieldVisual } from '../fields/model'
import FieldCardVice from '../components/FieldCardVice'
import ResourceIcon from '../fields/ResourceIcon'
import type { ResourceArt } from '../fields/visualAssets'
import { useMarketplace } from '../hooks/useMarketplace'
import { dailyYieldMicro, fmtPotato, fmtSol, HARVEST_THRESHOLD_MICRO } from '../utils/constants'
import './lab.css'

const number = (value: number, decimals = 0): string => (Number.isFinite(value) ? value.toFixed(decimals) : '—')

/** Live-only field console. It never invents accounts, resources, or local cycles. */
export default function FieldLabScreen(): JSX.Element {
  const { t, lang } = useI18n()
  const game = useGame()
  const { connected, ready, config, rpcError, publicKey } = useSolana()
  const nowSec = Math.floor(Date.now() / 1000)

  const ownedFields = useMemo(() => game.fields.map(field => fieldVisual(field, nowSec)), [game.fields, nowSec])
  const cfg = config ? { baseYieldMicroPerDay: Number(config.baseYieldMicroPerDay), globalMultiplierBps: config.globalMultiplierBps } : null
  const epochId = config ? Number(config.epochId) : undefined
  const totalYield = cfg
    ? game.fields.reduce((sum, field) => sum + dailyYieldMicro({ ...field, epochId }, cfg, nowSec), 0)
    : null
  const readyCount = game.fields.filter(field => field.accumulated >= HARVEST_THRESHOLD_MICRO).length
  const walletTag = publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : ''

  return (
    <div className="lab-app" data-testid="field-lab">
      <div className="lab-main">
        <section className="lab-hero" data-testid="lab-hero">
          <img className="lab-hero-image" src="/ares/art/mars-sector.webp" alt="" aria-hidden="true" draggable={false} />
          <div className="lab-hero-copy">
            <p className="lab-eyebrow">ARES—1 / FIELD LAB · {t('ON-CHAIN ACCOUNT CONSOLE')}</p>
            <h1>{t('ПОЛЕВАЯ ЛАБОРАТОРИЯ')}</h1>
            <p className="lab-lead">{t('Только реальные поля этого кошелька: состояние, урожай и действия контракта. Поле работает по времени блокчейна — без учебного режима, локальных ресурсов и кнопки паузы.')}</p>
          </div>
          <div className="lab-hero-chip" data-testid="lab-wallet">
            <Wallet size={14} aria-hidden="true" />
            {connected && publicKey
              ? <span className="ares-mono">{t('ЭКИПАЖ: {wallet}', { wallet: walletTag })}</span>
              : <span className="ares-mono">{t('НЕТ КОШЕЛЬКА')} · <Link to="/">{t('ПОДКЛЮЧИТЬ В АГРО-ОТСЕКЕ')}</Link></span>}
          </div>
        </section>

        <div className="lab-live" data-testid="lab-live">
          <LiveTile art="crop" label={t('БАЛАНС POTATO')} value={fmtPotato(game.stats.potatoBalance, 0)} unit="POTATO"
            detail={t('ДОСТУПНЫЙ БАЛАНС КОШЕЛЬКА')} />
          <LiveTile art="budget" label={t('БАЛАНС SKR')} value={number(game.stats.skrBalance, 2)} unit="SKR"
            detail={t('БАЛАНС ТОКЕНА КОШЕЛЬКА')} />
          <LiveTile art="solar" label={t('РАСЧЁТНЫЙ ВЫХОД ПОЛЕЙ В ДЕНЬ')} value={totalYield === null ? '—' : fmtPotato(totalYield, 2)} unit="POTATO"
            detail={t('РАСЧЁТ ПО КОНФИГУРАЦИИ И ЭПОХЕ ON-CHAIN')} />
          <LiveTile art="telemetry" label={t('ПОЛЯ КОШЕЛЬКА')} value={String(game.fields.length)} unit={t('ШТ')}
            detail={readyCount > 0 ? t('ГОТОВЫ К СБОРУ: {n}', { n: readyCount }) : t('ОЖИДАНИЕ ПОРОГА СБОРА')}
            tone={readyCount > 0 ? 'ok' : undefined} />
        </div>

        <div className="lab-workspace">
          <section className="lab-fields" aria-label={t('РЕАЛЬНЫЕ ПОЛЯ КОШЕЛЬКА')}>
            {!ready && <p className="lab-note" role="status">{rpcError ? t('Нет связи с блокчейном') : t('Инициализация игры…')}</p>}
            {ready && !connected && <EmptyFields
              title={t('ПОДКЛЮЧИ КОШЕЛЁК')}
              description={t('Лаборатория не создаёт пробные аккаунты. После подключения здесь появятся только поля, записанные в блокчейне на этот адрес.')}
              linkLabel={t('ОТКРЫТЬ АГРО-ОТСЕК')}
            />}
            {ready && connected && game.fieldsError && <p className="lab-note lab-note--warning" role="alert">
              {game.fieldsError} · <button type="button" className="lab-key lab-key--small" onClick={() => void game.reload()}>{t('ПОВТОРИТЬ')}</button>
            </p>}
            {ready && connected && !game.fieldsError && game.fields.length === 0 && <EmptyFields
              title={t('ON-CHAIN ПОЛЕЙ НЕТ')}
              description={t('Покупка за 1053 SKR закрыта. Для создания первого поля нужны 100 тестовых POTATO и SOL на rent и комиссию; стартовый набор на первое поле участникам devnet-беты вручную выдаёт оператор по адресу кошелька.')}
              linkLabel={t('ПЕРЕЙТИ В АГРО')}
            />}
            {ready && connected && game.fields.length > 0 && <FieldsPanel
              fields={ownedFields}
              language={lang}
              renderCards={() => game.fields.map((field, index) => (
                <FieldCardVice key={field.publicKey.toString()} field={field} index={index}
                  onHarvest={game.harvest} onUpgrade={game.upgradeField} onRepair={game.repairField}
                  onPayTax={game.payTax} onApplyFertilizer={game.applyFertilizer} />
              ))}
              renderInspector={selected => {
                const index = game.fields.findIndex(field => field.publicKey.toString() === selected.id)
                const field = game.fields[index]
                return field ? <FieldCardVice key={selected.id} field={field} index={index}
                  onHarvest={game.harvest} onUpgrade={game.upgradeField} onRepair={game.repairField}
                  onPayTax={game.payTax} onApplyFertilizer={game.applyFertilizer} /> : null
              }}
            />}
          </section>

          <aside className="lab-side">
            <section className="lab-card" data-testid="lab-live-path">
              <p className="lab-eyebrow"><FlaskConical size={15} aria-hidden="true" />{t('КАК РАБОТАЕТ ЛАБ')}</p>
              <h2 className="lab-card-title">{t('ОДИН АККАУНТ — ОДИН ИСТОЧНИК ДАННЫХ')}</h2>
              <p className="lab-copy">{t('ЛАБ читает те же on-chain поля, что и АГРО. Сбор, ремонт, налог и удобрение используют существующие игровые транзакции; отдельного учебного поля или локального урожая нет.')}</p>
              <Link className="lab-key" to="/">{t('ОТКРЫТЬ АГРО')}<ArrowRight size={14} /></Link>
              <p className="lab-fineprint">{t('Реальное строительство колонии пока не входит в on-chain-протокол. Вкладка КОЛОНИЯ показывает статус разработки, а не фиктивные ресурсы.')}</p>
            </section>
            {connected && <MarketBook />}
          </aside>
        </div>

        <footer className="lab-footer">
          <span className="lab-footer-mark">ARES / FIELD LAB — LIVE ACCOUNT VIEW</span>
          <p>{t('Все показанные поля и балансы читаются для подключённого кошелька. Предварительные расчёты не являются начислением; изменения поля происходят только после подтверждения соответствующей on-chain-транзакции.')}</p>
        </footer>
      </div>
    </div>
  )
}

function EmptyFields({ title, description, linkLabel }: { title: string; description: string; linkLabel: string }): JSX.Element {
  return <section className="lab-card lab-empty" data-testid="lab-empty-state" role="status">
    <p className="lab-eyebrow">ARES—1 / FIELD LAB</p>
    <h2 className="lab-card-title">{title}</h2>
    <p className="lab-copy">{description}</p>
    <Link className="lab-key" to="/">{linkLabel}<ArrowRight size={14} /></Link>
  </section>
}

function LiveTile({ art, label, value, unit, detail, tone }: {
  art: ResourceArt; label: string; value: string; unit: string; detail: string; tone?: 'ok' | 'danger'
}): JSX.Element {
  return <div className={`lab-tile${tone ? ` lab-tile--${tone}` : ''}`}>
    <div className="lab-tile-label"><ResourceIcon kind={art} size={22} /><span>{label}</span></div>
    <div className="lab-tile-value">{value}<small>{unit}</small></div>
    <p>{detail}</p>
  </div>
}

/** Live order-book data; this view is mounted only for an authenticated wallet. */
function MarketBook(): JSX.Element {
  const { t } = useI18n()
  const { orders, stats, loading, error } = useMarketplace()
  const book = orders.filter(order => !order.isOwn)
  const best = book.reduce<number | null>((min, order) => (min === null || order.priceLamportsPerPotato < min ? order.priceLamportsPerPotato : min), null)
  const bookPotato = book.reduce((sum, order) => sum + order.amountMicro, 0) / 1_000_000
  return <section className="lab-card" data-testid="lab-market-book" aria-label={t('СТАКАН РЫНКА')}>
    <p className="lab-eyebrow">{t('СТАКАН РЫНКА')}</p>
    {error
      ? <p className="lab-fineprint lab-warning" role="alert">{error}</p>
      : <dl className="lab-figures">
        <div><dt>{t('ЛУЧШАЯ ЦЕНА')}</dt><dd>{best === null ? '—' : `${fmtSol(best, 4)} SOL`}</dd></div>
        <div><dt>{t('ОРДЕРОВ')}</dt><dd>{String(book.length)}</dd></div>
        <div><dt>{t('POTATO В СТАКАНЕ')}</dt><dd>{number(bookPotato, 0)}</dd></div>
        <div><dt>{t('ОБОРОТ ЗА 24 ЧАСА')}</dt><dd>{number(stats.sellVolume24h, 0)} POTATO</dd></div>
        <div><dt>{t('ОБОРОТ РЫНКА')}</dt><dd>{number(stats.totalSolVolume, 2)} SOL</dd></div>
        <div><dt>{t('ВСЕГО СДЕЛОК')}</dt><dd>{String(stats.totalTrades)}</dd></div>
      </dl>}
    {loading && book.length === 0 && !error && <p className="lab-fineprint" role="status">{t('РЫНОК ЗАГРУЖАЕТСЯ…')}</p>}
    <Link className="lab-key" to="/market">{t('ОТКРЫТЬ РЫНОК')}<ArrowRight size={14} /></Link>
  </section>
}
