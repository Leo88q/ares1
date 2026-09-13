import { BubblingFlask } from './BubblingFlask'

interface AlchemyLoadingProps {
 message?: string
 color?: string
 glowColor?: string
}

/** Загрузочный экран с бурлящей колбой — для ожидания транзакций и данных. */
export function AlchemyLoading({
 message = 'Варим зелье...',
 color = '#450001',
 glowColor = '#C1440E',
}: AlchemyLoadingProps) {
 return (
  <div
   style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    padding: 32,
   }}
  >
   <BubblingFlask color={color} glowColor={glowColor} size="lg" />
   <div
    className="ares-stencil"
    style={{
     fontSize: 14,
     color: 'var(--ares-parchment, #F2E8DA)',
     animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
    }}
   >
    {message}
   </div>
  </div>
 )
}
