import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FIELD_TYPES, MAX_FIELD_LEVEL, MICRO,
  fieldPriceMicro, fertilizerCostMicro, upgradeCostMicro,
  repairCostMicro, taxCostMicro, fmtPotatoExact,
} from '../../apps/web/src/utils/constants';

// These are frontend unit tests with source-level contract drift guards, not
// execution of Rust/localnet. Reference arithmetic uses integer division like Rust.
const rust = fs.readFileSync('programs/solana_potato/src/lib.rs', 'utf8');
function constant(name: string): bigint {
  const match = new RegExp(`pub const ${name}: u(?:8|64|128) = ([0-9_]+);`).exec(rust);
  assert(match, `Missing Rust constant ${name}`);
  return BigInt(match[1].replaceAll('_', ''));
}
function body(name: string): string {
  const start = rust.indexOf(`pub fn ${name}(`);
  assert(start >= 0, `Missing Rust function ${name}`);
  const next = rust.indexOf('pub fn ', start + 7);
  return rust.slice(start, next < 0 ? undefined : next);
}
function typeBps(type: number): bigint {
  const match = new RegExp(`${type === 2 ? '_' : type} => ([0-9_]+),`).exec(body('type_cost_bps'));
  assert(match, `Missing Rust type multiplier ${type}`);
  return BigInt(match[1].replaceAll('_', ''));
}
function scaled(base: string, type: number): bigint {
  return constant(base) * typeBps(type) / constant('BPS');
}

test('reference upkeep arithmetic matches the actual Rust handler expressions', () => {
  assert.equal(BigInt(MAX_FIELD_LEVEL), constant('MAX_FIELD_LEVEL'));
  assert.deepEqual(FIELD_TYPES.map(t => BigInt(t.costBps)), [0, 1, 2].map(typeBps));
  assert.match(body('scaled_cost'), /\(\(base_micro as u128\) \* type_cost_bps\(field_type\) \/ BPS\) as u64/);
  // P2-4: цена ремонта/удобрения вынесена в отдельные хелперы и зависит от
  // прочности (и уровня), а не от одного типа поля.
  assert.match(body('repair_field'), /let cost = repair_cost_micro\(/);
  assert.ok(!body('repair_field').includes('scaled_cost(BASE_REPAIR_MICRO'), 'repair price must live in repair_cost_micro');
  assert.match(body('repair_cost_micro'), /let level_mult = \(\(level as u128\) \/ 3\)\.max\(1\);/);
  assert.match(body('repair_cost_micro'), /MAX_DURABILITY\.saturating_sub\(durability\.min\(MAX_DURABILITY\)\)/);
  assert.match(body('repair_cost_micro'), /checked_mul\(missing\)[\s\S]*\/ max_durability/);
  assert.match(body('apply_fertilizer'), /fertilizer_cost_micro\(\s*BASE_FERTILIZER_MICRO,\s*field\.field_type,\s*field\.level,\s*field\.durability,\s*\)/);
  assert.match(body('fertilizer_cost_micro'), /type_yield_bps\(field_type\)/);
  assert.match(body('fertilizer_cost_micro'), /get_level_mult\(level\)/);
  assert.match(body('fertilizer_cost_micro'), /durability_mult_bps\(durability\)/);
  assert.match(body('pay_tax'), /let base_cost = scaled_cost\(BASE_TAX_MICRO, field\.field_type\);/);
  // Do not follow the old fractional-multiplier comment: Rust divides integers.
  assert.match(body('pay_tax'), /let level_mult = \(field\.level as u64\)\.saturating_add\(1\) \/ 2;/);
  // pay_tax по-прежнему считает цену инлайном; ремонт — через хелпер (P2-4).
  assert.match(body('pay_tax'), /let cost = base_cost\s*\.checked_mul\(level_mult\)/);
});

test('repair price is proportional to the missing durability for all levels and rarities', () => {
  for (let level = 1; level <= MAX_FIELD_LEVEL; level++) {
    for (const type of [0, 1, 2]) {
      const quotient = BigInt(level) / 3n;
      const multiplier = quotient > 1n ? quotient : 1n;
      const full = scaled('BASE_REPAIR_MICRO', type) * multiplier;
      for (const durability of [0, 1, 25, 50, 96, 99, 100]) {
        const missing = BigInt(100 - durability);
        const expected = full * missing / 100n;
        // Минимум 1 микро-атом: бесплатного ремонта нет.
        const pinned = expected > 1n ? expected : 1n;
        assert.equal(
          BigInt(repairCostMicro(level, type, durability)),
          pinned,
          `L${level}, type ${type}, durability ${durability}`,
        );
      }
      // Ремонт с полной прочностью невозможен на цепи, но цена не должна врать.
      assert.equal(repairCostMicro(level, type, 100), 1);
    }
  }
});

test('fertilizer price tracks the field yield it multiplies (level and durability)', () => {
  const yieldBps = (type: number): bigint => {
    const match = new RegExp(`${type === 2 ? '_' : type} => ([0-9_]+),`).exec(body('type_yield_bps'));
    assert(match, `Missing Rust type yield ${type}`);
    return BigInt(match[1].replaceAll('_', ''));
  };
  const levelMult = (level: number): bigint => level <= 5
    ? [10_000n, 10_000n, 15_700n, 20_400n, 24_600n, 28_600n][level]
    : 28_600n + BigInt(level - 5) * 4_000n;
  const durabilityMult = (durability: number): bigint => 2_000n + BigInt(Math.min(durability, 100)) * 80n;
  for (const level of [1, 2, 5, 6, 30, 50]) {
    for (const type of [0, 1, 2]) {
      for (const durability of [0, 20, 100]) {
        const expected = constant('BASE_FERTILIZER_MICRO') * yieldBps(type) / constant('BPS')
          * levelMult(level) / constant('BPS')
          * durabilityMult(durability) / constant('BPS');
        assert.equal(
          BigInt(fertilizerCostMicro(level, type, durability)),
          expected > 1n ? expected : 1n,
          `L${level}, type ${type}, durability ${durability}`,
        );
      }
    }
  }
  // Golden: грядка L1 = 0.7, луг L1 = 2, поле L1 = 4.2 POTATO при полной прочности.
  assert.deepEqual([0, 1, 2].map(type => fertilizerCostMicro(1, type, 100)), [700_000, 2_000_000, 4_200_000]);
  // Golden: ремонт грядки L1 с нуля = 6 POTATO, с 96 = 0.24 POTATO.
  assert.equal(repairCostMicro(1, 0, 0), 6 * MICRO);
  assert.equal(repairCostMicro(1, 0, 96), 240_000);
});

test('tax price matches integer reference for all 50 levels and 3 rarities', () => {
  for (let level = 1; level <= MAX_FIELD_LEVEL; level++) {
    for (const type of [0, 1, 2]) {
      const multiplier = (BigInt(level) + 1n) / 2n;
      assert.equal(BigInt(taxCostMicro(level, type)), scaled('BASE_TAX_MICRO', type) * multiplier, `L${level}, type ${type}`);
    }
  }
});

test('upkeep boundary examples retain integer steps and fractional POTATO prices', () => {
  // Ремонт с нулевой прочности = прежняя «полная» цена (100 % восстановления).
  for (const [level, repair, tax] of [
    [1, 15, 6], [2, 15, 6], [3, 15, 12], [4, 15, 12], [5, 15, 18],
    [6, 30, 18], [8, 30, 24], [9, 45, 30], [10, 45, 30],
    [30, 150, 90], [49, 240, 150], [50, 240, 150],
  ]) {
    assert.equal(repairCostMicro(level, 1, 0), repair * MICRO, `repair L${level}`);
    assert.equal(taxCostMicro(level, 1), tax * MICRO, `tax L${level}`);
  }
  assert.equal(fmtPotatoExact(taxCostMicro(1, 0)), '2.4');
  assert.equal(fmtPotatoExact(taxCostMicro(3, 0)), '4.8');
});

test('purchase and upgrade base prices remain unchanged', () => {
  for (const type of [0, 1, 2]) {
    assert.equal(BigInt(fieldPriceMicro(type)), scaled('BASE_FIELD_PRICE_MICRO', type));
    for (let level = 1; level < MAX_FIELD_LEVEL; level++) {
      const expected = constant('BASE_UPGRADE_MICRO') * BigInt(level) * typeBps(type) / constant('BPS');
      assert.equal(BigInt(upgradeCostMicro(level, type)), expected);
    }
  }
});

test('price formatter preserves all six decimals without floating-point rounding', () => {
  for (const [amount, expected] of [
    [0n, '0'], [1n, '0.000001'], [10n, '0.00001'], [1_000_000n, '1'],
    [2_400_000n, '2.4'], [2_399_999n, '2.399999'], [4_999_999n, '4.999999'],
    [5_000_000n, '5'], [123_456_789n, '123.456789'], [-1n, '-0.000001'],
    [18_446_744_073_709_551_615n, '18446744073709.551615'],
  ] as const) {
    assert.equal(fmtPotatoExact(amount), expected);
    if (amount <= BigInt(Number.MAX_SAFE_INTEGER)) {
      assert.equal(fmtPotatoExact(Number(amount)), expected);
    }
  }
});

test('transaction preflight uses field level and shows exact need/available balance', () => {
  const client = fs.readFileSync('apps/web/src/contexts/GameContext.tsx', 'utf8');
  // P2-4: префлайт считает ту же цену, что спишет цепь — с прочностью.
  assert(client.includes('fieldSpend(ixRepairField, (f) => repairCostMicro(f.level, f.fieldType, f.durability)'));
  assert(client.includes('fieldSpend(ixApplyFertilizer, (f) => fertilizerCostMicro(f.level, f.fieldType, f.durability)'));
  assert(client.includes('fieldSpend(ixPayTax, (f) => taxCostMicro(f.level, f.fieldType)'));
  assert.match(client, /if \(potatoBalance >= costMicro\) return true/);
  assert.match(client, /need: fmtPotatoExact\(costMicro\), have: fmtPotatoExact\(potatoBalance\)/);
  assert.match(client, /if \(!requireBalance\(cost\(f\)\)\) return false\s+return runTx/);
});

// Раньше здесь было ДВЕ реализации карточки поля: FieldCard (легаси, никем не
// импортировался) и FieldCardVice (живая). Легаси удалён — тест держит цену на
// той карточке, которую действительно видит игрок.
test('field card displays exact prices from shared helpers', () => {
  const source = fs.readFileSync('apps/web/src/components/FieldCardVice.tsx', 'utf8');
  assert(source.includes('fmtPotatoExact(upgradeCostMicro(field.level, field.fieldType))'), 'upgradeCostMicro');
  assert(source.includes('fmtPotatoExact(taxCostMicro(field.level, field.fieldType))'), 'taxCostMicro');
  // P2-4: цена ремонта/удобрения зависит от прочности и уровня поля.
  assert(source.includes('repairCostMicro(field.level, field.fieldType, field.durability)'), 'repairCostMicro');
  assert(source.includes('fertilizerCostMicro(field.level, field.fieldType, field.durability)'), 'fertilizerCostMicro');
  // И карточка показывает окупаемость, а не только цену.
  assert(source.includes('repairReturnDays'), 'repair payback hint');
  assert(source.includes('fertilizerReturnDays'), 'fertilizer payback hint');
});
