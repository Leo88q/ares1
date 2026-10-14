// ── M1: связность сети и соседские бонусы ────────────────────────────────────
// Чистая логика без THREE — чтобы правила проверялись тестами, а не глазами
// (docs/DESIGN_MODULES_COLONY_v1.md §M1: «модуль работает только в сети»).
//
// Правила пилота (одно предложение каждое):
//  1. Сеть: ортогональная связность ПОСТАВЛЕННЫХ модулей; источник — солнечная
//     панель. «Запитан» = есть путь из соседних клеток до любого солнца.
//  2. Работают только запитанные модули (idle-состояние — с значком ⚠);
//     солнце — источник, работает всегда.
//  3. Соседский бонус: множитель производства за каждого ортогонального
//     соседа нужного ТИПА — но только если этот сосед сам запитан
//     (изолированная станция воды не поливает).

export const NEIGHBOR_BONUSES = {
  greenhouse: [
    { need: 'water', per: 0.25 },
    { need: 'habitat', per: 0.15 },
  ],
  lab: [
    { need: 'node', per: 0.3 },
  ],
};

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function cellKey(x, z) {
  return `${x},${z}`;
}

/** Ключи4 ортогональных соседей (клетки вне сетки просто отсутствуют в map). */
export function neighborKeys(key) {
  const [x, z] = key.split(',').map(Number);
  return DIRS.map(([dx, dz]) => cellKey(x + dx, z + dz));
}

/**
 * Запитанные клетки: BFS-затопление от всех солнц по соседям.
 * @param {Map<string, {def: {id: string}}>} placed key -> entry
 * @returns {Set<string>} ключи клеток, чей компонент содержит солнце
 */
export function computePowered(placed) {
  const power = new Set();
  const queue = [];
  placed.forEach((entry, key) => {
    if (entry.def.id === 'solar') {
      power.add(key);
      queue.push(key);
    }
  });
  while (queue.length) {
    const key = queue.pop();
    for (const nk of neighborKeys(key)) {
      if (placed.has(nk) && !power.has(nk)) {
        power.add(nk);
        queue.push(nk);
      }
    }
  }
  return power;
}

/**
 * Множитель производства от соседей: 1 + Σ per × (число запитанных соседей
 * нужного типа). Считаются только соседи, попавшие в powerSet.
 * @returns {{ mult: number, matched: Array<{ need: string, n: number }> }}
 */
export function bonusMultiplier(defId, key, placed, powerSet) {
  const rules = NEIGHBOR_BONUSES[defId];
  if (!rules || !rules.length) return { mult: 1, matched: [] };
  const nks = neighborKeys(key);
  const matched = [];
  let mult = 1;
  for (const rule of rules) {
    let n = 0;
    for (const nk of nks) {
      const e = placed.get(nk);
      if (e && e.def.id === rule.need && powerSet.has(nk)) n++;
    }
    if (n > 0) {
      mult += rule.per * n;
      matched.push({ need: rule.need, n });
    }
  }
  return { mult, matched };
}

/** Суммарный множитель группы (для HUD-диагностики: «бонус соседей +30%»). */
export function summarizeBonus(defId, key, placed, powerSet) {
  const { mult } = bonusMultiplier(defId, key, placed, powerSet);
  return mult - 1;
}
