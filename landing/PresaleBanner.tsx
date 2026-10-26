import { t } from './i18n'
import './presale-banner.css'

/** Public SKR purchasing stays closed until a separately approved launch release. */
export function PresaleBanner(): JSX.Element {
  return (
    <section className="ps-banner" id="launch-status" data-testid="skr-presale-closed" role="status">
      <div className="ps-art" aria-hidden="true">
        <div className="ps-seal"><span>ARES—1</span><strong>NO SALE</strong></div>
      </div>
      <div className="ps-body">
        <span className="ps-eyebrow">{t('ПРЕСЕЙЛ SKR ЗАКРЫТ')}</span>
        <h2 className="ps-title">{t('ПОКУПКА ПАКОВ ОТКЛЮЧЕНА')}</h2>
        <p className="ps-sub">{t('Пресейл mainnet пока закрыт: не отправляйте средства.')}</p>
        <p className="ps-err">{t('Фаза 1 — отдельный пресейл mainnet. Devnet-бета бесплатна, прогресс не переносится, тестовые SOL/SKR не имеют реальной стоимости.')}</p>
        <p className="ps-legal">{t('До официального запуска здесь нет подключения кошелька, резерва, адреса оплаты или формы подтверждения.')}</p>
      </div>
    </section>
  )
}
