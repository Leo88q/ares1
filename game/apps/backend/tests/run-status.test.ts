/**
 * Публичный контракт статуса тиража: GET /api/presale/runs/:runId отдаёт
 * camelCase (`publicRunStatus`), а баннер лендинга читает именно его.
 *
 * Один раз этот контракт разошёлся: route отдавал доменную snake_case-структуру,
 * а фронт читал camelCase — счётчик показывал NaN, цена была undefined, и
 * заметить это было некому. Тест держит форму на уровне схемы, а не глазами.
 *
 * Тест чистый: publicRunStatus не трогает ни БД, ни RPC.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { publicRunStatus } from '../src/presale/orders.js';
import type { RunStatus } from '../src/presale/orders.js';

const domain: RunStatus = {
  run_id: 'wave1',
  pack_id: 'meadow-4',
  currency: 'skr',
  cap: 500,
  reserved_count: 3,
  remaining: 497,
  is_open: true,
  sold_out: false,
  price_units: '888000000',
  units_per_whole: '1000000',
  pack_potato_micro: '1000000000',
};

test('publicRunStatus: camelCase-поля совпадают с RunStatus баннера лендинга', () => {
  assert.deepEqual(publicRunStatus(domain), {
    runId: 'wave1',
    packId: 'meadow-4',
    currency: 'skr',
    cap: 500,
    reservedCount: 3,
    remaining: 497,
    isOpen: true,
    soldOut: false,
    priceUnits: '888000000',
    unitsPerWhole: '1000000',
    packPotatoMicro: '1000000000',
  });
});

test('publicRunStatus: служебные поля и snake_case не протекают в публичный ответ', () => {
  const keys = Object.keys(publicRunStatus(domain));
  assert.equal(keys.some(k => k.includes('_')), false, `snake_case в публичном контракте: ${keys.join(',')}`);
  assert.equal(keys.includes('sold_out'), false);
  assert.equal(keys.includes('reserved_count'), false);
});
