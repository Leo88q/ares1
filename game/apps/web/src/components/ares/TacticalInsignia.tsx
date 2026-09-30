import { memo } from 'react'

interface Props {
 id: string
 code: string
 earned?: boolean
 size?: number
}

/**
 * Тактический шеврон нашивки экипажа.
 * Чистая векторная геометрия в стилистике пультов ARES-1:
 * без растровых катушек/бобин и без эмодзи.
 */
export const TacticalInsignia = memo(function TacticalInsignia({ id, code, earned = false, size = 46 }: Props) {
 const strokeColor = earned ? '#FFB347' : 'rgba(255, 179, 71, 0.4)'
 const bgColor = earned
  ? 'linear-gradient(180deg, rgba(42, 28, 16, 0.95) 0%, rgba(22, 14, 8, 0.95) 100%)'
  : 'linear-gradient(180deg, rgba(20, 14, 9, 0.8) 0%, rgba(12, 8, 5, 0.9) 100%)'
 const borderColor = earned ? 'rgba(255, 179, 71, 0.55)' : 'rgba(255, 179, 71, 0.18)'

 return (
  <div
   style={{
    width: size,
    height: size,
    borderRadius: 8,
    border: `1px solid ${borderColor}`,
    background: bgColor,
    boxShadow: earned
     ? '0 0 14px -2px rgba(255, 179, 71, 0.3), inset 0 1px 0 rgba(255, 224, 170, 0.22)'
     : 'inset 0 1px 0 rgba(255, 214, 170, 0.06)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    position: 'relative',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
   }}
  >
   <svg
    width={Math.round(size * 0.5)}
    height={Math.round(size * 0.5)}
    viewBox="0 0 24 24"
    fill="none"
    stroke={strokeColor}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
   >
    {id === 'a1' && (
     /* Первый росток: прорастающий побег */
     <>
      <path d="M4 20h16" />
      <path d="M12 20v-9" />
      <path d="M12 11a5 5 0 0 1 5-5h2v2a5 5 0 0 1-5 5h-2z" />
     </>
    )}
    {id === 'a2' && (
     /* Первый урожай: зрелый колос */
     <>
      <path d="M12 3v18" />
      <path d="M8 8c0 2 2 3 4 3 2 0 4-1 4-3" />
      <path d="M8 13c0 2 2 3 4 3 2 0 4-1 4-3" />
     </>
    )}
    {id === 'a3' && (
     /* Тысячник: 1K лимит хранилища */
     <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 9v6" />
      <path d="M13 9v6M16 9l-3 3 3 3" />
     </>
    )}
    {id === 'a4' && (
     /* Фермер-магнат: 5 секторов делянок */
     <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <circle cx="12" cy="12" r="1.5" fill={strokeColor} />
     </>
    )}
    {id === 'a5' && (
     /* Картофельный барон: звёздный шеврон */
     <polygon points="12 2 15 8.5 22 9.3 17 14.1 18.2 21 12 17.5 5.8 21 7 14.1 2 9.3 9 8.5 12 2" />
    )}
    {id === 'a6' && (
     /* Ветеран: трилистник с тремя шевронами ранга 3 */
     <>
      <path d="M12 2l7 3.5v6c0 5-3.5 9.5-7 10.5-3.5-1-7-5.5-7-10.5v-6l7-3.5z" />
      <path d="M9 10l3-2 3 2" />
      <path d="M9 13l3-2 3 2" />
      <path d="M9 16l3-2 3 2" />
     </>
    )}
   </svg>
   <span
    className="ares-mono"
    style={{
     fontSize: 8,
     fontWeight: 800,
     letterSpacing: '0.08em',
     color: strokeColor,
     marginTop: 2,
     lineHeight: 1,
    }}
   >
    {code}
   </span>
  </div>
 )
})
