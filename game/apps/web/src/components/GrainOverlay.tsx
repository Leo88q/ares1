/**
 * SVG-шум поверх всего приложения для текстуры.
 * Opacity низкий (5%), не мешает взаимодействию (pointer-events: none).
 */
export default function GrainOverlay() {
 return (
  <svg
   className="pf-grain"
   aria-hidden="true"
   style={{
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: 1,
    opacity: 0.05,
    mixBlendMode: 'overlay',
   }}
  >
   <filter id="grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="42" />
    <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" />
   </filter>
   <rect width="100%" height="100%" filter="url(#grain)" />
  </svg>
 )
}

/**
 * SVG-фильтры «рваного края» для штампов (MK) и трафарет-спрея (Поход).
 * Рендерится один раз рядом с зерном; сами элементы ссылаются url(#...).
 */
export function MkRoughFilters() {
 return (
  <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }}>
   <defs>
    <filter id="mk-rough" x="-5%" y="-5%" width="110%" height="110%">
     <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3" result="n" />
     <feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" />
    </filter>
    <filter id="po-spray" x="-8%" y="-8%" width="116%" height="116%">
     <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="14" result="n" />
     <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" />
    </filter>
   </defs>
  </svg>
 )
}
