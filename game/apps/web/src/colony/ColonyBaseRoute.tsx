// Маршрут /base: живая колония с оплатой POTATO. Кошелёк и игровые провайдеры
// подключаются только здесь, а не в ColonyScreen (он остаётся локальным прототипом).
import { useGame } from '../contexts/GameContext'
import ColonyScreen from './ColonyScreen'
import { COLONY_POTATO_SPEND_ENABLED } from './potatoSpend'

export default function ColonyBaseRoute(): JSX.Element {
  const { spendColonyPotato } = useGame()
  return <ColonyScreen embedded potatoSpend={COLONY_POTATO_SPEND_ENABLED ? spendColonyPotato : undefined} />
}
