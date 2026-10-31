import { t } from '../i18n'
import type { GameStats } from '../contexts/GameContext'

export interface Achievement {
 id: string
 code: string
 title: string
 desc: string
 patch: string
 progress: number
 target: number
 reward: number
 customProgressText?: string
}

/**
 * Нашивки экипажа — on-chain квесты программы (claim_achievement).
 * Id a1–a6 = quest_id 0–5; условия верифицируются в программе (proof by ownership),
 * награды выдаются из квест-казны PDA (пул 550 POTATO, заправлен init-onchain).
 * Идентичность — кошелёк; backend и Telegram не участвуют.
 * Используется журналом (MissionLog) и задачами смены в каюте (ProfileScreen).
 */
export function getAchievements(stats: GameStats): Achievement[] {
 const maxLevel = stats.maxFieldLevel ?? 1
 const hasLevel3 = maxLevel >= 3
 const isVeteranDone = stats.totalFields >= 6 && hasLevel3

 return [
  { id: 'a1', code: 'Q-01', title: t('Первый росток'), desc: t('Создай первое поле'), patch: '/ares/patch-sprout.webp', progress: Math.min(stats.totalFields, 1), target: 1, reward: 50 },
  // Условия ниже — ТОЧНОЕ зеркало claim_achievement (lib.rs): программа
  // проверяет владение полями, а не баланс. Пока в тексте было «накопи N
  // POTATO», игрок видел цель, которую цепь не принимает, и не понимал, почему
  // награда не выдаётся. Прогресс тоже считается по полям.
  { id: 'a2', code: 'Q-02', title: t('Первый урожай'), desc: t('Владей 2 полями'), patch: '/ares/patch-harvest.webp', progress: Math.min(stats.totalFields, 2), target: 2, reward: 50 },
  { id: 'a3', code: 'Q-03', title: t('Тысячник'), desc: t('Владей 3 полями'), patch: '/ares/patch-thousand.webp', progress: Math.min(stats.totalFields, 3), target: 3, reward: 100 },
  { id: 'a4', code: 'Q-04', title: t('Фермер-магнат'), desc: t('Владей 5 полями'), patch: '/ares/patch-magnat.webp', progress: Math.min(stats.totalFields, 5), target: 5, reward: 100 },
  { id: 'a5', code: 'Q-05', title: t('Картофельный барон'), desc: t('Владей 8 полями'), patch: '/ares/patch-baron.webp', progress: Math.min(stats.totalFields, 8), target: 8, reward: 200 },
  {
   id: 'a6',
   code: 'Q-06',
   title: t('Ветеран'),
   desc: t('Владей 6 полями, хотя бы одно 3-го уровня'),
   patch: '/ares/patch-veteran.webp',
   progress: isVeteranDone ? 6 : Math.min(stats.totalFields, 5),
   target: 6,
   reward: 50,
   customProgressText: stats.totalFields >= 6 && !hasLevel3
    ? `${stats.totalFields}/6 · ${t('нужен ур. 3 (сейчас {n})', { n: maxLevel })}`
    : undefined,
  },
 ]
}
