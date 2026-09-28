/**
 * Зернистая текстура поверх всего приложения (сгенерированный шумовой тайл).
 * Opacity низкий (5%), не мешает взаимодействию (pointer-events: none).
 */
export default function GrainOverlay() {
 return (
  <div
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
    backgroundImage: 'url(/ares/grain.png)',
    backgroundRepeat: 'repeat',
   }}
  />
 )
}
