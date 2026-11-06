// Серверная симуляция колонии (F4, вариант 2). Включается только явно: VITE_COLONY_SIM=true.
// По умолчанию выключено: /base работает локальной песочницей, как до F4.
// Пока флаг выключен, оплата POTATO на /base не подключается (см. ColonyBaseRoute).
export const COLONY_SIM_ENABLED: boolean = (import.meta.env?.VITE_COLONY_SIM ?? '') === 'true'
