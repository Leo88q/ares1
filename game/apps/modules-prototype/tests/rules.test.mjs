// Юнит-тесты правил M1 (связность + соседские бонусы).
// Запуск: node --test tests/rules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePowered, bonusMultiplier, neighborKeys, cellKey } from '../src/game/rules.js';

/** helper: { 'x,z': 'typeId' } → Map как в engine (entry = {def:{id}}) */
function field(spec) {
  const m = new Map();
  for (const [k, id] of Object.entries(spec)) m.set(k, { def: { id } });
  return m;
}

test('сетка соседей: 4 ортогональных направления', () => {
  assert.deepEqual(neighborKeys(cellKey(3, 3)).sort(), ['2,3', '3,2', '3,4', '4,3'].sort());
});

test('изолированный модуль не запитан; солнце — источник всегда', () => {
  const p = computePowered(field({ '1,1': 'greenhouse', '5,5': 'solar' }));
  assert.equal(p.has('1,1'), false);
  assert.equal(p.has('5,5'), true);
});

test('соседство с солнцем запитывает модуль', () => {
  const p = computePowered(field({ '0,0': 'solar', '1,0': 'greenhouse', '2,0': 'lab' }));
  assert.deepEqual([...p].sort(), ['0,0', '1,0', '2,0']);
});

test('разрыв в клетку обрывает сеть', () => {
  // solar и lab разделены пустой клеткой (1,0)
  const p = computePowered(field({ '0,0': 'solar', '2,0': 'lab' }));
  assert.equal(p.has('2,0'), false);
});

test('L-образный поворот продолжает сеть', () => {
  const p = computePowered(field({
    '0,0': 'solar', '1,0': 'node', '1,1': 'node', '1,2': 'greenhouse',
  }));
  assert.equal(p.has('1,2'), true);
});

test('энергоузел — мост: solar—node—lab работает', () => {
  const p = computePowered(field({ '0,0': 'solar', '1,0': 'node', '2,0': 'lab' }));
  assert.equal(p.has('2,0'), true);
});

test('две отдельные солнечные цепи — обе запитаны (два компонента)', () => {
  const p = computePowered(field({
    '0,0': 'solar', '1,0': 'habitat',
    '5,5': 'solar', '5,6': 'greenhouse',
  }));
  assert.equal(p.has('1,0'), true);
  assert.equal(p.has('5,6'), true);
  assert.equal(p.has('0,1'), false); // диагональ — не сосед
});

test('соседский бонус: теплица получает +25% за воду и +15% за жилой блок', () => {
  const placed = field({
    '1,1': 'greenhouse',
    '0,1': 'water',   // сосед по кабелю (в компоненте солнца) → бонус
    '1,2': 'habitat', // сосед по кабелю → бонус
    '0,0': 'water',   // диагональ к теплице: НЕ сосед, хоть и в сети → не считается
    '1,0': 'solar',
    '5,5': 'water',   // другой компонент (своё солнце5,6), не сосед → не считается
    '5,6': 'solar',
  });
  const power = computePowered(placed);
  assert.equal(power.has('0,1'), true);
  assert.equal(power.has('5,5'), true, 'отдельный остров тоже запитан своим солнцем');
  const { mult, matched } = bonusMultiplier('greenhouse', '1,1', placed, power);
  assert.equal(mult, 1 + 0.25 + 0.15);
  assert.deepEqual(matched.sort((a, b) => a.need.localeCompare(b.need)), [
    { need: 'habitat', n: 1 },
    { need: 'water', n: 1 },
  ]);
});

test('лаборатория: +30% за каждого запитанного соседа-узла', () => {
  const placed = field({
    '0,0': 'solar', '1,0': 'node', '0,1': 'node',
    '1,1': 'lab',
    '9,9': 'node', // изолированный узел — не сосед и не powered
  });
  const power = computePowered(placed);
  const { mult } = bonusMultiplier('lab', '1,1', placed, power);
  assert.equal(mult, 1 + 0.3 + 0.3); // node на (1,0) и (0,1)
});

test('модули без правил бонуса — множитель ровно1', () => {
  const placed = field({ '0,0': 'solar', '1,0': 'water' });
  const power = computePowered(placed);
  const { mult, matched } = bonusMultiplier('water', '1,0', placed, power);
  assert.equal(mult, 1);
  assert.deepEqual(matched, []);
});
