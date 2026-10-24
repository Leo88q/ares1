// W2.1 + W2.2: экран пресейла показывает то, что лежит в цепи, а не константы.
//
// Раскладка PresaleState живёт в трёх местах (Rust-структура, landing-хук,
// web-компонент) — как GameConfig в F-16 layoutParity. Здесь копии сшиваются:
// «поправили только одну» перестаёт быть незамеченным.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  PRESALE_STATE_CAP_OFFSET,
  PRESALE_STATE_MIN_LENGTH,
  PRESALE_STATE_SOLD_OFFSET,
  decodePresaleState,
} from '../../apps/web/src/utils/presaleState';

// Пути — от game/: так же читают lib.rs остальные offchain-тесты (mirrorParity,
// upkeepCosts), а tsconfig.tools.json собирается в CommonJS и import.meta не даёт.
const gameRoot = process.cwd();
const libRs = fs.readFileSync('programs/solana_potato/src/lib.rs', 'utf8');
const landingHook = fs.readFileSync('../landing/hooks/useLiveChain.ts', 'utf8');

interface StructField { name: string; type: string }

function structFields(name: string): StructField[] {
  const body = libRs.match(new RegExp(`pub struct ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1];
  assert.ok(body, `в lib.rs не найдена структура ${name}`);
  return [...body.matchAll(/pub (\w+): (\w+)/g)].map(([, field, type]) => ({ name: field, type }));
}

/** Смещения полей Borsh-структуры от конца 8-байтного discriminator'а. */
function fieldOffsets(fields: readonly StructField[], sizes: Record<string, number>): Record<string, number> {
  const at: Record<string, number> = {};
  let offset = 8;
  for (const field of fields) {
    // Неизвестный тип — падаем, а не считаем его нулевым: иначе новое поле
    // молча сдвинет field_type/sold, а тест останется зелёным.
    if (sizes[field.type] === undefined) assert.fail(`в раскладке не учтён тип ${field.type}`);
    at[field.name] = offset;
    offset += sizes[field.type];
  }
  return at;
}

test('PresaleState: порядок и размер полей в lib.rs дают sold@40 и cap@44', () => {
  const fields = structFields('PresaleState');
  assert.deepEqual(fields.map(f => f.name), ['authority', 'sold', 'cap', 'price_lamports', 'bump']);
  assert.deepEqual(fields.map(f => f.type), ['Pubkey', 'u32', 'u32', 'u64', 'u8']);

  const at = fieldOffsets(fields, { Pubkey: 32, u32: 4, u64: 8, u8: 1 });
  assert.equal(at.sold, PRESALE_STATE_SOLD_OFFSET);
  assert.equal(at.cap, PRESALE_STATE_CAP_OFFSET);
  // Полный размер — 57 байт, как в таблице аккаунтов game/docs/API.md.
  assert.equal(at.bump + 1, 57);
});

test('decodePresaleState читает sold/cap (u32 LE) и честно молчит на коротком буфере', () => {
  const data = Buffer.alloc(57);
  data.writeUInt32LE(17, PRESALE_STATE_SOLD_OFFSET);
  data.writeUInt32LE(500, PRESALE_STATE_CAP_OFFSET);
  assert.deepEqual(decodePresaleState(data), { sold: 17, cap: 500 });

  assert.equal(PRESALE_STATE_MIN_LENGTH, 48);
  assert.equal(decodePresaleState(Buffer.alloc(PRESALE_STATE_MIN_LENGTH - 1)), null);
  assert.equal(decodePresaleState(new Uint8Array()), null);
});

test('landing читает те же sold@40 / cap@44 — копии раскладки не разошлись', () => {
  assert.equal(PRESALE_STATE_SOLD_OFFSET, 40);
  assert.equal(PRESALE_STATE_CAP_OFFSET, 44);
  assert.match(landingHook, /readUInt32LE\(40\)/, 'landing: sold должен читаться с @40');
  assert.match(landingHook, /readUInt32LE\(44\)/, 'landing: cap должен читаться с @44');
});

test('PresaleSection: sold/cap приходят из цепи, константа — только фолбэк загрузки', () => {
  const src = fs.readFileSync(path.join(gameRoot, 'apps/web/src/components/PresaleSection.tsx'), 'utf8');
  assert.match(src, /import \{ decodePresaleState \} from '\.\.\/utils\/presaleState'/);

  // Оба пути — первичная загрузка и подписка на изменения — обязаны читать цепь.
  const reads = src.match(/decodePresaleState\(/g) ?? [];
  assert.ok(reads.length >= 2, 'sold/cap должны читаться и в load(), и в onAccountChange()');

  assert.match(src, /const \[cap, setCap\] = useState\(PRESALE_CAP_FALLBACK\)/);
  assert.match(src, /const remaining = Math\.max\(0, cap - sold\)/);
  assert.doesNotMatch(src, /PRESALE_CAP\s*-/, 'вычитание хардкода из sold вернулось в UI');
});

test('Field.field_type@67 — тир раскрытия тоже берётся из цепи (W2.2)', () => {
  const fields = structFields('Field');
  const at = fieldOffsets(fields, { Pubkey: 32, u8: 1, i64: 8, bool: 1 });
  assert.equal(at.field_type, 67, 'field_type сместился: UI читает data[67]');

  const gameContext = fs.readFileSync(path.join(gameRoot, 'apps/web/src/contexts/GameContext.tsx'), 'utf8');
  assert.match(gameContext, /info\.data\[67\]/, 'тир после покупки обязан читаться из аккаунта поля');
});
