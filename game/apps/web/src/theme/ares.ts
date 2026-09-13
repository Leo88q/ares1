import { useEffect, useState } from 'react';

export type SolPhase = 'dawn' | 'day' | 'blueset' | 'night';

export const ARES_COLORS = {
 rust: '#C1440E',
 rustDark: '#8A2E08',
 dust: '#E0A183',
 sky: '#D9A06B',
 blueset: '#6B93D6',
 space: '#050308',
 growPink: '#FF2E93',
 growViolet: '#B85CFF',
 bioGreen: '#7CFF6B',
 bioCyan: '#12E7C4',
 hudAmber: '#FFB347',
 hudOrange: '#FF7A1A',
 metalDark: '#2A2D34',
 metalLight: '#4A4F5A',
 glass: 'rgba(180, 220, 255, 0.10)',
} as const;

export type AresColorKey = keyof typeof ARES_COLORS;

const PHASE_CHECK_INTERVAL_MS = 60_000;

function getSolPhase(date: Date): SolPhase {
 const hour = date.getHours() + date.getMinutes() / 60;
 if (hour >= 5 && hour < 8) return 'dawn';
 if (hour >= 8 && hour < 17) return 'day';
 if (hour >= 17 && hour < 20) return 'blueset';
 return 'night';
}

export function useSeekerPhase(): SolPhase {
 const [phase, setPhase] = useState<SolPhase>(() => getSolPhase(new Date()));

 useEffect(() => {
  const tick = (): void => {
   const next = getSolPhase(new Date());
   setPhase((prev) => (prev === next ? prev : next));
  };
  tick();
  const id = window.setInterval(tick, PHASE_CHECK_INTERVAL_MS);
  return () => window.clearInterval(id);
 }, []);

 return phase;
}

export const SEEKER_PHASE_LABELS_RU: Record<SolPhase, string> = {
 dawn: 'Рассвет',
 day: 'День',
 blueset: 'Синий закат',
 night: 'Ночь',
};
