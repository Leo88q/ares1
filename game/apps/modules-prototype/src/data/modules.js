// Арт-контракт и правила механики (см. docs/DESIGN_MODULES_COLONY_v1.md)
// 1 клетка = 1 юнит. Все footprint'ы = 1x1 на пилоте. Snap-шаг 0.5.

export const PALETTE = {
  hull: '#ece7de',
  rust: '#c86a3e',
  panel: '#2f4157',
  tank: '#b8c4c9',
  accent: '#ff8a4c',
  teal: '#4fd1c5',
  tile: '#6d655e',
  ground: '#4a443f',
  bg: '#2b2724'
};

export const MODULES = [
  {
    id: 'solar',
    name: 'Солнечная панель',
    cost: 80,
    color: PALETTE.panel,
    tag: 'Энергия',
    effect: '+6 ⚡/сек',
    desc: 'Даёт энергию станции. Без неё всё остальное стоит.'
  },
  {
    id: 'water',
    name: 'Водный процессор',
    cost: 120,
    color: PALETTE.tank,
    tag: 'Вода',
    effect: '+4 💧/сек',
    desc: 'Добывает воду из марсианского льда. Питает теплицу.'
  },
  {
    id: 'greenhouse',
    name: 'Теплица',
    cost: 200,
    color: '#e8a25c',
    tag: 'Еда',
    effect: '+3 🍠/сек · −2⚡ −2💧',
    desc: 'Выращивает картофель колонии. Работает только при наличии энергии и воды.'
  },
  {
    id: 'habitat',
    name: 'Жилой блок',
    cost: 150,
    color: PALETTE.hull,
    tag: 'Люди',
    effect: '+2 🌬/сек · жильё ×4',
    desc: 'Дом колонистов. Население дышит — нужен воздух.'
  },
  {
    id: 'node',
    name: 'Энергоузел',
    cost: 60,
    color: PALETTE.teal,
    tag: 'Связь',
    effect: '+40 к лимиту ⚡',
    desc: 'Узел сети: расширяет ёмкость энергии и тянет кабели к соседям.'
  },
  {
    id: 'lab',
    name: 'Лаборатория',
    cost: 300,
    color: PALETTE.rust,
    tag: 'Прогресс',
    effect: '+1 ⭐/сек науки',
    desc: 'Исследования колонии — вклад в науку, рост уровня станции.'
  }
];

export const START = {
  balance: 600, // 🥔 бумажный баланс пилота (реальный — devnet-кошелёк на M2)
  energy: 10,
  water: 5,
  food: 0,
  air: 5,
  science: 0
};

export const CAPS = { energy: 140, water: 60, food: 60, air: 40 };
