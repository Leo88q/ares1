import { useI18n } from '../../i18n'
import { SectionFrame, SECTION_ART } from './SectionFrame'
import type { ShipSection } from './SectionFrame'

/** Art-only preview, not a fake wallet, trade order book or mission ledger. */
export default function SectionArtPreview({ section }: { section: ShipSection }): JSX.Element {
  const { lang, t } = useI18n()
  const ru = lang === 'ru'
  const label = section === 'supply' ? t('СНАБЖЕНИЕ') : section === 'journal' ? t('ЖУРНАЛ МИССИИ') : t('КАЮТА')
  const art = SECTION_ART[section]
  const titles = section === 'supply' ? [ru ? 'Приём грузов' : 'Incoming cargo', ru ? 'Отгрузка' : 'Dispatch']
    : section === 'journal' ? [ru ? 'Журнал событий' : 'Event log', ru ? 'Текущий снимок' : 'Current snapshot']
      : [ru ? 'Личный отсек' : 'Crew quarters', ru ? 'Нашивки и прогресс' : 'Patches and progress']
  return <div className="ship-preview" data-testid="section-art-preview">
    <SectionFrame section={section} label={label}>
      <div className="ship-preview-content">
        <span className="ship-preview-badge">{ru ? 'АРТ-ПРОСМОТР · БЕЗ АККАУНТОВ И ТРАНЗАКЦИЙ' : 'ART PREVIEW · NO ACCOUNTS OR TRANSACTIONS'}</span>
        <p>{ru ? 'Это оформление того же раздела основной игры. Здесь не показаны вымышленные балансы, ордера или награды.' : 'This is the same section art used in the actual game. No invented balances, orders or rewards are displayed here.'}</p>
        <div className="ship-preview-cards">
          {titles.map((title, index) => <article key={title}><img src={index === 0 ? art.icon : section === 'supply' ? '/ares/icons/bank.webp' : section === 'journal' ? '/ares/icons/gauge.webp' : '/ares/patch-sprout.webp'} alt="" aria-hidden="true" /><h3>{title}</h3><span>{ru ? 'Данные доступны в основной игре' : 'Data available in the actual game'}</span></article>)}
        </div>
        <a className="ship-preview-open" href={art.href}>{ru ? 'Открыть настоящий раздел' : 'Open the actual section'} →</a>
        <small>{ru ? 'Фон — созданная для ARES иллюстрация. Это не фото реального отсека или данные NASA.' : 'The background is an illustration created for ARES, not a real room photo or NASA data.'}</small>
      </div>
    </SectionFrame>
  </div>
}
