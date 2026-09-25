import { t } from '../i18n'
import type { GameStats } from '../contexts/GameContext'
import { MICRO } from './constants'

export interface Achievement {
 id: string
 title: string
 desc: string
 patch: string
 progress: number
 target: number
 reward: number
}

/**
 * Нашивки экипажа — on-chain квесты программы (claim_achievement).
 * Id a1–a6 = quest_id 0–5; условия верифицируются в программе (proof by ownership),
 * награды выдаются из квест-казны PDA (пул 550 POTATO, заправлен init-onchain).
 * Идентичность — кошелёк; backend и Telegram не участвуют.
 * Используется журналом (MissionLog) и задачами смены в каюте (ProfileScreen).
 */
export function getAchievements(stats: GameStats): Achievement[] {
 const potato = stats.potatoBalance / MICRO
 return [
  { id: 'a1', title: t('Первый росток'), desc: t('Создай первое поле'), patch: '/ares/patch-sprout.webp', progress: Math.min(stats.totalFields, 1), target: 1, reward: 50 },
  { id: 'a2', title: t('Первый урожай'), desc: t('Накопи на балансе 100 POTATO'), patch: '/ares/patch-harvest.webp', progress: Math.min(potato, 100), target: 100, reward: 50 },
  { id: 'a3', title: t('Тысячник'), desc: t('Накопи на балансе 1 000 POTATO'), patch: '/ares/patch-thousand.webp', progress: Math.min(potato, 1000), target: 1000, reward: 100 },
  { id: 'a4', title: t('Фермер-магнат'), desc: t('Владей 5 полями'), patch: '/ares/patch-magnat.webp', progress: Math.min(stats.totalFields, 5), target: 5, reward: 100 },
  { id: 'a5', title: t('Картофельный барон'), desc: t('Накопи на балансе 10 000 POTATO'), patch: '/ares/patch-baron.webp', progress: Math.min(potato, 10000), target: 10000, reward: 200 },
  { id: 'a6', title: t('Ветеран'), desc: t('Владей 6 полями, хотя бы одно 3-го уровня'), patch: '/ares/patch-veteran.webp', progress: Math.min(stats.totalFields, 6), target: 6, reward: 50 },
 ]
}
