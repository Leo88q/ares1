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
 return (
  <div className="mini-hydro-row">
   {TIERS.map((t) => (
    <div key={t.id} className={`mini-hydro mini-hydro--${t.id}`}>
     <div
      className="mini-hydro-img"
      role="img"
      aria-label={`Гидропонный модуль ${t.label}`}
     />
     <span className="mini-hydro-label" style={{ color: t.tint }}>{t.label}</span>
    </div>
   ))}
  </div>
 );
}
