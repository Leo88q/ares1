// Маршрут /base: живая колония. Кошелёк и игровые провайдеры подключаются только здесь,
// а не в ColonyScreen (он остаётся локальным прототипом и не трогает кошелёк сам).
//
// POTATO-оплата подключается только вместе с серверной симуляцией: без неё состояние
// колонии не защищено сервером, и списание POTATO ничего бы не защищало.
import { useGame } from '../contexts/GameContext'
import ColonyScreen from './ColonyScreen'
import { COLONY_POTATO_SPEND_ENABLED } from './potatoSpend'
import { COLONY_SIM_ENABLED } from './simFlag'

export default function ColonyBaseRoute(): JSX.Element {
  const { spendColonyPotato } = useGame()
  const spendEnabled = COLONY_SIM_ENABLED && COLONY_POTATO_SPEND_ENABLED
  return <ColonyScreen embedded potatoSpend={spendEnabled ? spendColonyPotato : undefined} />
}
