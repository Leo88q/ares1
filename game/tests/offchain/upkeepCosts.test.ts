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
  assert.match(body('repair_field'), /let base_cost = scaled_cost\(BASE_REPAIR_MICRO, ctx\.accounts\.field\.field_type\);/);
  assert.match(body('repair_field'), /let level_mult = \(\(ctx\.accounts\.field\.level as u64\) \/ 3\)\.max\(1\);/);
  assert.match(body('pay_tax'), /let base_cost = scaled_cost\(BASE_TAX_MICRO, field\.field_type\);/);
  // Do not follow the old fractional-multiplier comment: Rust divides integers.
  assert.match(body('pay_tax'), /let level_mult = \(field\.level as u64\)\.saturating_add\(1\) \/ 2;/);
  for (const handler of ['repair_field', 'pay_tax']) {
    assert.match(body(handler), /let cost = base_cost\s*\.checked_mul\(level_mult\)/);
  }
});

test('repair price matches integer reference for all 50 levels and 3 rarities', () => {
  for (let level = 1; level <= MAX_FIELD_LEVEL; level++) {
    for (const type of [0, 1, 2]) {
      const quotient = BigInt(level) / 3n;
      const multiplier = quotient > 1n ? quotient : 1n;
      assert.equal(BigInt(repairCostMicro(level, type)), scaled('BASE_REPAIR_MICRO', type) * multiplier, `L${level}, type ${type}`);
    }
  }
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
  for (const [level, repair, tax] of [
    [1, 15, 6], [2, 15, 6], [3, 15, 12], [4, 15, 12], [5, 15, 18],
    [6, 30, 18], [8, 30, 24], [9, 45, 30], [10, 45, 30],
    [30, 150, 90], [49, 240, 150], [50, 240, 150],
  ]) {
    assert.equal(repairCostMicro(level, 1), repair * MICRO, `repair L${level}`);
    assert.equal(taxCostMicro(level, 1), tax * MICRO, `tax L${level}`);
  }
  assert.equal(fmtPotatoExact(taxCostMicro(1, 0)), '2.4');
  assert.equal(fmtPotatoExact(taxCostMicro(3, 0)), '4.8');
});

test('purchase, fertilizer and upgrade base prices remain unchanged', () => {
  for (const type of [0, 1, 2]) {
    assert.equal(BigInt(fieldPriceMicro(type)), scaled('BASE_FIELD_PRICE_MICRO', type));
    assert.equal(BigInt(fertilizerCostMicro(type)), scaled('BASE_FERTILIZER_MICRO', type));
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
  for (const [builder, cost] of [['ixRepairField', 'repairCostMicro'], ['ixPayTax', 'taxCostMicro']]) {
    assert(client.includes(`fieldSpend(${builder}, (f) => ${cost}(f.level, f.fieldType)`));
  }
  assert.match(client, /if \(potatoBalance >= costMicro\) return true/);
  assert.match(client, /need: fmtPotatoExact\(costMicro\), have: fmtPotatoExact\(potatoBalance\)/);
  assert.match(client, /if \(!requireBalance\(cost\(f\)\)\) return false\s+return runTx/);
});

test('both field card implementations display exact prices from shared helpers', () => {
  for (const card of ['FieldCard', 'FieldCardVice']) {
    const source = fs.readFileSync(`apps/web/src/components/${card}.tsx`, 'utf8');
    for (const helper of ['upgradeCostMicro', 'repairCostMicro', 'taxCostMicro']) {
      assert(source.includes(`fmtPotatoExact(${helper}(field.level, field.fieldType))`), `${card}: ${helper}`);
    }
    assert(source.includes('fmtPotatoExact(fertilizerCostMicro(field.fieldType))'), card);
  }
});
