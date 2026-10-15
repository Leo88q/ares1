import type { ReactNode } from 'react'
import './section-art.css'

export type ShipSection = 'supply' | 'journal' | 'cabin'
export const SECTION_ART = {
  supply: { image: '/ares/art/market-background.webp', icon: '/ares/icons/crate.webp', code: 'ARES / SUPPLY DECK', href: '/market' },
  journal: { image: '/ares/art/journal-background.webp', icon: '/ares/icons/clipboard.webp', code: 'ARES / MISSION LOG', href: '/stats' },
  cabin: { image: '/ares/art/cabin-background.webp', icon: '/ares/icons/bunk.webp', code: 'ARES / CREW QUARTERS', href: '/profile' },
} as const

/** Asset-only section shell. Children are the unchanged functional screens. */
export function SectionFrame({ section, label, hud, children }: { section: ShipSection; label: string; hud?: ReactNode; children: ReactNode }): JSX.Element {
  const art = SECTION_ART[section]
  return <div className={`ship-section ship-section--${section}`} data-testid="ship-section" data-section={section}>
    <header className="ship-section-hero">
      <img className="ship-section-image" src={art.image} alt="" aria-hidden="true" draggable={false} />
      <div className="ship-section-title"><img src={art.icon} alt="" aria-hidden="true" /><div><span>{art.code}</span><h2>{label}</h2></div></div>
      {hud && <div className="ship-section-hud">{hud}</div>}
    </header>
    <div className="ship-section-body">{children}</div>
  </div>
}
