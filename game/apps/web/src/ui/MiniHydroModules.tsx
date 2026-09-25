import { t, useI18n } from '../i18n'
import { FIELD_TYPES } from '../utils/constants'

const TIERS = [
 { id: 'common', typeId: 0, tint: '#BBD4E8', label: 'COMMON' },
 { id: 'rare', typeId: 1, tint: '#C36CFF', label: 'RARE' },
 { id: 'epic', typeId: 2, tint: '#FFD278', label: 'EPIC' },
] as const;

/**
 * Три отдельные лёгкие WebP-кассеты (раньше — один тяжёлый спрайт modules.png).
 */
export function MiniHydroModules(): JSX.Element {
 useI18n()
 return (
  <div className="mini-hydro-row">
   {TIERS.map((tier) => (
    <div key={tier.id} className={`mini-hydro mini-hydro--${tier.id}`}>
     <img
      className="mini-hydro-img"
      src={FIELD_TYPES[tier.typeId].image}
      alt={t('Гидропонный модуль {id}', { id: tier.label })}
      loading="lazy"
     />
     <span className="mini-hydro-label" style={{ color: tier.tint }}>{tier.label}</span>
    </div>
   ))}
  </div>
 );
}
