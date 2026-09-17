import { t, useI18n } from '../i18n'

const TIERS = [
 { id: 'common', tint: '#BBD4E8', label: 'COMMON' },
 { id: 'rare', tint: '#C36CFF', label: 'RARE' },
 { id: 'epic', tint: '#FFD278', label: 'EPIC' },
] as const;

/**
 * Одно фото с тремя капсулами нарезается на три независимых модуля:
 * каждая капсула занимает свою треть кадра (background-position 0/50/100%).
 */
export function MiniHydroModules(): JSX.Element {
 useI18n()
 return (
  <div className="mini-hydro-row">
   {TIERS.map((tier) => (
    <div key={tier.id} className={`mini-hydro mini-hydro--${tier.id}`}>
     <div
      className="mini-hydro-img"
      role="img"
      aria-label={t('Гидропонный модуль {id}', { id: tier.label })}
     />
     <span className="mini-hydro-label" style={{ color: tier.tint }}>{tier.label}</span>
    </div>
   ))}
  </div>
 );
}
