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
