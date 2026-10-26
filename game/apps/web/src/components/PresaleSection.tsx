import { t } from '../i18n'

/** Closed status notice. No wallet connection, price quote, or transaction path. */
export default function PresaleSection(): JSX.Element {
 return (
  <section
   className="po-plate po-plate--presale ares-presale"
   data-testid="skr-presale-closed"
   role="status"
   style={{ gridColumn: '1 / -1', padding: '20px 18px', marginBottom: 12, position: 'relative', overflow: 'hidden' }}
  >
   <span className="po-screw po-screw--tl" aria-hidden="true" />
   <span className="po-screw po-screw--tr" aria-hidden="true" />
   <span className="po-screw po-screw--bl" aria-hidden="true" />
   <span className="po-screw po-screw--br" aria-hidden="true" />
   <p style={{ margin: 0, color: '#C8AA78', font: '9px/1.6 var(--ares-font-mono, monospace)', letterSpacing: '.13em' }}>ARES-1 / {t('ПРЕСЕЙЛ SKR ЗАКРЫТ')}</p>
   <h2 className="pf-h2" style={{ margin: '6px 0 8px', color: '#EFD9AC' }}>{t('ПОКУПКА ЗА SKR ОТКЛЮЧЕНА')}</h2>
   <p style={{ margin: 0, maxWidth: 720, color: '#CDB693', fontSize: 11, lineHeight: 1.6 }}>
    {t('Открытого одобренного SKR-пресейла сейчас нет. Не отправляй SKR: прежние 1053 SKR были devnet-путём покупки одного поля, а не целой колонии и не действующим предложением.')}
   </p>
   <p style={{ margin: '8px 0 0', color: '#A89578', fontSize: 9, lineHeight: 1.55 }}>
    {t('Devnet — тестовая сеть; её SOL и SKR не имеют денежной стоимости. Повторное открытие покупки требует отдельного одобрения запуска.')}
   </p>
  </section>
 )
}
