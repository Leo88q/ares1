import { ArrowRight, CircleAlert, Factory, FlaskConical, Sprout, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useGame } from '../contexts/GameContext'
import { useSolana } from '../contexts/SolanaContext'
import { useI18n } from '../i18n'
import PersistentColonyPanel from './PersistentColonyPanel'
import './colony-status.css'
import './persistent-colony.css'

/** Public, truthful product state for colony construction; no local simulation is mounted. */
export default function ColonyStatusScreen(): JSX.Element {
  const { t } = useI18n()
  const game = useGame()
  const { connected, ready, rpcError, publicKey } = useSolana()
  const wallet = publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : null

  return <div className="colony-status" data-testid="colony-status">
    <header className="colony-status-hero">
      <img src="/ares/art/mars-sector.webp" alt="" aria-hidden="true" draggable={false} />
      <div className="colony-status-hero__copy">
        <p className="colony-status-eyebrow">ARES—1 / SETTLEMENT · {t('СТАТУС ПРОТОКОЛА')}</p>
        <h1>{t('КОЛОНИЯ')}</h1>
        <p>{t('Backend-колония хранит здания и исследования на сервере, но в текущем игровом окружении feature выключена. Экран не подменяет её локальной симуляцией.')}</p>
      </div>
      <div className="colony-status-badge" role="status"><CircleAlert size={16} />{t('СТРОИТЕЛЬСТВО НЕ АКТИВНО')}</div>
    </header>

    <section className="colony-status-wallet" aria-label={t('СОСТОЯНИЕ КОШЕЛЬКА')}>
      <div className="colony-status-wallet__label"><Wallet size={16} />{t('КОШЕЛЁК')}</div>
      <strong>{connected && wallet ? wallet : t('НЕ ПОДКЛЮЧЁН')}</strong>
      <span>{!ready ? (rpcError || t('Подключаемся к сети…')) : connected ? t('ПОЛЯ ЧИТАЮТСЯ ИЗ ON-CHAIN АККАУНТОВ') : t('Подключи кошелёк в АГРО, чтобы увидеть свои поля.')}</span>
    </section>

    <PersistentColonyPanel />

    {connected && <section className="colony-status-metrics" aria-label={t('ТЕКУЩЕЕ СОСТОЯНИЕ')}>
      <div><span>{t('ПОЛЯ КОШЕЛЬКА')}</span><strong>{game.fields.length}</strong></div>
      <div><span>{t('ДОСТУПНО К СБОРУ')}</span><strong>{game.fields.filter(field => field.accumulated >= 1_000_000).length}</strong></div>
      <div><span>{t('POTATO НА КОШЕЛЬКЕ')}</span><strong>{Math.floor(game.stats.potatoBalance / 1_000_000).toLocaleString()}</strong></div>
    </section>}

    <section className="colony-status-flow" aria-label={t('СТАТУС ПОСЛЕ СОЗДАНИЯ ПОЛЯ')}>
      <div className="colony-status-section-title">
        <p className="colony-status-eyebrow">{t('РЕАЛЬНЫЙ ИГРОВОЙ ПУТЬ')}</p>
        <h2>{t('ПОСЛЕ ПОДТВЕРЖДЕНИЯ ПОЛЯ')}</h2>
        <p>{t('Модуль поля — это один on-chain аккаунт. Он не создаёт готовую колонию и сам по себе не открывает отдельные строительные ресурсы.')}</p>
      </div>

      <ol className="colony-status-steps">
        <li>
          <span className="colony-status-step-icon"><Sprout size={18} /></span>
          <div><b>{t('АГРО · ПОЛЕ ПОЯВЛЯЕТСЯ ПОСЛЕ ПОДТВЕРЖДЕНИЯ')}</b>
            <p>{t('Подключи тот же кошелёк. Подтверждённый Field account появится в АГРО автоматически; там доступны реальные сбор, ремонт, налог и удобрение.')}</p>
            <Link to="/">{t('ОТКРЫТЬ АГРО')}<ArrowRight size={14} /></Link>
          </div>
        </li>
        <li>
          <span className="colony-status-step-icon"><FlaskConical size={18} /></span>
          <div><b>{t('ЛАБ · ТЕ ЖЕ ON-CHAIN ПОЛЯ')}</b>
            <p>{t('ЛАБ показывает данные тех же аккаунтов и использует те же транзакции. Отдельной лабораторной симуляции или тестового аккаунта в игровом пути нет.')}</p>
            <Link to="/lab">{t('ОТКРЫТЬ ЛАБ')}<ArrowRight size={14} /></Link>
          </div>
        </li>
        <li>
          <span className="colony-status-step-icon"><Factory size={18} /></span>
          <div><b>{t('COLONY BACKEND · ДОСТУП ЗАКРЫТ')}</b>
            <p>{t('В backend реализованы постоянное состояние и серверные действия Colony, но миграция не применена, правила экономики проходят внутреннюю проверку, а entitlement пока не выдаётся. Продажа Starter за 1053 SKR закрыта; это поле не превращается автоматически в колонию.')}</p>
          </div>
        </li>
      </ol>
    </section>

    {connected && game.fieldsError && <p className="colony-status-error" role="alert">{game.fieldsError}</p>}
    <p className="colony-status-footnote">{t('Публичный релиз не опубликован. Devnet используется только для внутреннего QA; SOL и SKR в devnet — тестовые активы без денежной стоимости. Экран не управляет игровыми часами.')}</p>
  </div>
}
