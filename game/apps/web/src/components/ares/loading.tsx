import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { motion } from 'framer-motion';
import { usePrefersReducedMotion } from './effects';

export type LandingStage =
 | 'space'
 | 'descent'
 | 'dome'
 | 'wipe'
 | 'telemetry'
 | 'ready';

export interface LandingSequenceProps {
 onLanded: () => void;
}

const STAGE_ORDER: LandingStage[] = ['space', 'descent', 'dome', 'wipe', 'telemetry', 'ready'];

const STAGE_DURATIONS_MS: Record<Exclude<LandingStage, 'ready'>, number> = {
 space: 1000,
 descent: 1200,
 dome: 900,
 wipe: 700,
 telemetry: 1400,
};

const STAGE_TITLES: Record<LandingStage, string> = {
 space: 'СИНХРОНИЗАЦИЯ ОРБИТАЛЬНОГО МОДУЛЯ...',
 descent: 'ВХОД В АТМОСФЕРУ МАРСА...',
 dome: 'РАСПАКОВКА ГИДРОПОНИКИ...',
 wipe: 'ТЕСТИРОВАНИЕ ДАВЛЕНИЯ КУПОЛА...',
 telemetry: 'КАЛИБРОВКА БИО-РЕАКТОРА...',
 ready: 'СИСТЕМЫ В НОРМЕ · ДОБРО ПОЖАЛОВАТЬ',
};

function useTypedLines(lines: string[], active: boolean, charIntervalMs = 12): string[] {
 const [revealed, setRevealed] = useState<string[]>(() => lines.map(() => ''));
 const timerRef = useRef<number | null>(null);

 useEffect(() => {
  if (!active) return undefined;

  let lineIndex = 0;
  let charIndex = 0;

  const step = (): void => {
   setRevealed((prev) => {
    const next = [...prev];
    const targetLine = lines[lineIndex];
    if (targetLine === undefined) return prev;
    charIndex += 1;
    next[lineIndex] = targetLine.slice(0, charIndex);
    return next;
   });

   if (charIndex >= (lines[lineIndex]?.length ?? 0)) {
    lineIndex += 1;
    charIndex = 0;
    if (lineIndex >= lines.length) {
     if (timerRef.current !== null) window.clearInterval(timerRef.current);
     return;
    }
   }
  };

  timerRef.current = window.setInterval(step, charIntervalMs);
  return () => {
   if (timerRef.current !== null) window.clearInterval(timerRef.current);
  };
 }, [active, lines, charIntervalMs]);

 return revealed;
}

export const LandingSequence = memo(function LandingSequence({
 onLanded,
}: LandingSequenceProps): JSX.Element {
 const reducedMotion = usePrefersReducedMotion();
 const { t, lang } = useI18n();
 const [stageIndex, setStageIndex] = useState(0);
 const stage = STAGE_ORDER[stageIndex] ?? 'ready';

 const telemetryLines = useMemo(
  () => [
   `O2 .................. 98.4% (${t('НОРМА')})`,
   `H2O ................. 76.2% (${t('РЕЦИРКУЛЯЦИЯ')})`,
   `${t('ДАВЛЕНИЕ')} ............ 0.6 ${t('кПа (МАРС)')}`,
   `${t('ТЕМПЕРАТУРА')} ......... -62°C`,
   `${t('БИО-ПАЁК')} ............ ${t('ГОТОВ К КУЛЬТИВАЦИИ')}`,
   'SOLANA .............. DEVNET SYNCED',
  ],
  [t, lang],
 );

 useEffect(() => {
  if (stage === 'ready') {
   const landId = window.setTimeout(onLanded, reducedMotion ? 100 : 600);
   return () => window.clearTimeout(landId);
  }
  const duration = reducedMotion ? 200 : STAGE_DURATIONS_MS[stage];
  const timeoutId = window.setTimeout(() => {
   setStageIndex((prev) => Math.min(prev + 1, STAGE_ORDER.length - 1));
  }, duration);
  return () => window.clearTimeout(timeoutId);
 }, [stage, reducedMotion, onLanded]);

 const loadPct = [12, 35, 58, 76, 92, 100][stageIndex] ?? 100;
 const telemetryActive = stage === 'telemetry' || stage === 'ready';
 const typedLines = useTypedLines(telemetryLines, telemetryActive, reducedMotion ? 2 : 12);

 return (
  <div
   style={{
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: '#070406',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
   }}
  >
   {/* Главная художественная сцена с марсианским пейзажем и Тюбером-9 */}
   <div
    style={{
     position: 'absolute',
     inset: 0,
     display: 'flex',
     alignItems: 'center',
     justifyContent: 'center',
     overflow: 'hidden',
     pointerEvents: 'none',
    }}
   >
    <img
     src="/ares/loading-martian-hero.webp"
     alt="Ares-1 Martian Expedition"
     style={{
      width: '100%',
      height: '100%',
      maxWidth: 680,
      objectFit: 'cover',
      objectPosition: 'center 42%',
      filter: 'brightness(0.95) contrast(1.05)',
     }}
    />

    {/* Мягкие градиентные виньетки для бесшовного слияния с тёмным космосом */}
    <div
     style={{
      position: 'absolute',
      inset: 0,
      background: `
        linear-gradient(180deg, #070406 0%, rgba(7,4,6,0.3) 15%, transparent 40%, rgba(7,4,6,0.5) 75%, #070406 100%),
        radial-gradient(ellipse at 50% 50%, transparent 40%, #070406 95%)
      `,
     }}
    />
   </div>

   {/* Верхняя панель HUD телеметрии */}
   <div
    style={{
     position: 'relative',
     zIndex: 2,
     width: '100%',
     maxWidth: 520,
     padding: '24px 20px 12px',
     display: 'flex',
     justifyContent: 'space-between',
     alignItems: 'center',
    }}
   >
    <div>
     <div
      style={{
       fontFamily: 'var(--ares-font-stencil)',
       fontSize: 13,
       letterSpacing: '0.22em',
       color: '#E5A86E',
       textTransform: 'uppercase',
       textShadow: '0 0 10px rgba(229,168,110,0.5)',
      }}
     >
      ARES-1 // {t('ЭКСПЕДИЦИЯ МАРС')}
     </div>
     <div
      className="ares-mono"
      style={{ fontSize: 10, color: 'rgba(255,179,71,0.65)', letterSpacing: '0.1em', marginTop: 2 }}
     >
      {t('КУПОЛ-01')} · {t('СОЛ')} 0272 · {t('ТЕМПЕРАТУРА')}: -62°C
     </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
     <span className="mk-lamp" style={{ width: 8, height: 8 }} />
     <span className="ares-mono" style={{ fontSize: 9, color: '#9FBE7A', letterSpacing: '0.12em' }}>
      ONLINE
     </span>
    </div>
   </div>

   {/* Промежуточная телеметрия (появляется на этапе финализации) */}
   <div
    className="ares-mono"
    style={{
     position: 'relative',
     zIndex: 2,
     width: '100%',
     maxWidth: 480,
     padding: '0 24px',
     color: '#E0A183',
     fontSize: 11,
     lineHeight: '18px',
     textShadow: '0 0 6px rgba(224,161,131,0.4)',
     minHeight: 90,
    }}
   >
    {telemetryActive &&
     typedLines.map((line, idx) => (
      <div key={idx}>{line || ' '}</div>
     ))}
   </div>

   {/* Нижняя консоль загрузки с индикатором прогресса */}
   <div
    style={{
     position: 'relative',
     zIndex: 2,
     width: '100%',
     maxWidth: 460,
     padding: '0 20px 32px',
    }}
   >
    <div
     style={{
      borderRadius: 12,
      background: 'linear-gradient(180deg, rgba(36,24,16,0.92) 0%, rgba(20,13,8,0.96) 100%)',
      border: '1px solid #5A3920',
      padding: '16px 20px',
      boxShadow: '0 12px 32px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,214,170,0.15)',
      backdropFilter: 'blur(8px)',
     }}
    >
     <div
      style={{
       display: 'flex',
       justifyContent: 'space-between',
       alignItems: 'baseline',
       marginBottom: 10,
      }}
     >
      <span
       style={{
        fontFamily: 'var(--ares-font-stencil)',
        fontSize: 12,
        letterSpacing: '0.16em',
        color: '#FFB347',
        textTransform: 'uppercase',
       }}
      >
       {t(STAGE_TITLES[stage] ?? STAGE_TITLES.space)}
      </span>
      <span
       className="ares-mono"
       style={{
        fontSize: 16,
        fontWeight: 700,
        color: '#FFD166',
        textShadow: '0 0 10px rgba(255,209,102,0.4)',
       }}
      >
       {loadPct}%
      </span>
     </div>

     <div
      style={{
       height: 10,
       borderRadius: 5,
       background: 'rgba(0,0,0,0.7)',
       border: '1px solid #3E2413',
       overflow: 'hidden',
       boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.8)',
      }}
     >
      <motion.div
       style={{
        height: '100%',
        borderRadius: 'inherit',
        background: 'linear-gradient(90deg, #C1440E 0%, #E8A03C 50%, #FFD166 100%)',
        boxShadow: '0 0 12px rgba(232,160,60,0.7)',
       }}
       initial={{ width: '12%' }}
       animate={{ width: `${loadPct}%` }}
       transition={{ duration: 0.35, ease: 'easeOut' }}
      />
     </div>

     <div
      style={{
       display: 'flex',
       justifyContent: 'space-between',
       marginTop: 10,
       fontSize: 9,
       color: 'rgba(255,179,71,0.5)',
       letterSpacing: '0.1em',
      }}
      className="ares-mono"
     >
      <span>ПРОТОКОЛ: SOLANA ON-CHAIN</span>
      <span>ARES OS v3.2</span>
     </div>
    </div>
   </div>
  </div>
 );
});
