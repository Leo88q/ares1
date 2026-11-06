import { useEffect, useState } from 'react';

export type SolPhase = 'dawn' | 'day' | 'blueset' | 'night';

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

