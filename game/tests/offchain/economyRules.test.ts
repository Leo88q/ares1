import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Source-level regression guards, not a substitute for localnet execution.
// The owner's confirmed denomination split must not be changed incidentally.
const rust = fs.readFileSync('programs/solana_potato/src/lib.rs', 'utf8');
function handler(name: string): string {
  const start = rust.indexOf(`    pub fn ${name}(`);
  assert(start >= 0, `Missing handler ${name}`);
  const next = rust.indexOf('    pub fn ', start + 12);
  return rust.slice(start, next < 0 ? undefined : next);
}
function constant(name: string): bigint {
  const match = new RegExp(`pub const ${name}: u64 = ([0-9_]+);`).exec(rust);
  assert(match, `Missing constant ${name}`);
  return BigInt(match[1].replaceAll('_', ''));
}

test('confirmed SKR prices: presale 1053 and export license 500', () => {
  assert.equal(constant('PRESALE_PRICE_SKR_ATOMS'), 1053n * 1_000_000n);
  assert.equal(constant('EXPORT_LICENSE_PRICE_SKR_ATOMS'), 500n * 1_000_000n);
  assert.match(handler('buy_field_skr'), /PRESALE_PRICE_SKR_ATOMS/);
  assert.match(handler('buy_export_license'), /EXPORT_LICENSE_PRICE_SKR_ATOMS/);
});

test('ordinary field purchase and upkeep remain POTATO burns', () => {
  for (const name of ['create_field', 'repair_field', 'upgrade_field', 'pay_tax', 'apply_fertilizer']) {
    const body = handler(name);
    assert.match(body, /burn_from_user\(/, name);
    assert.match(body, /&ctx\.accounts\.potato_mint/, name);
    assert.match(body, /total_burned_micro/, name);
    assert.doesNotMatch(body, /skr_mint|SkrPrice|LegacyPaymentDisabled/, name);
  }
  assert.match(handler('register_referrer'), /token::burn\(/);
  assert.match(handler('register_referrer'), /ctx\.accounts\.potato_mint/);
});

test('unapproved SKR service pricing rail is absent from contract and active client', () => {
  assert.doesNotMatch(rust, /pub fn (configure_skr_pricing|create_field_skr|service_field_skr|register_referrer_skr)\b/);
  const client = fs.readFileSync('apps/web/src/contexts/GameContext.tsx', 'utf8');
  assert.match(client, /requireBalance\(fieldPriceMicro\(fieldType\)\)/);
  assert.match(client, /ixCreateField\(programId/);
  assert.doesNotMatch(client, /ixCreateFieldSkr|ixServiceFieldSkr|skrPricing/);
});


test('owner-confirmed referral registration costs 5 POTATO, matching the UI', () => {
  assert.equal(constant('REFERRAL_REGISTRATION_COST_MICRO'), 5n * 1_000_000n);
  assert.match(handler('register_referrer'), /token::burn\(/);
  assert.match(handler('register_referrer'), /REFERRAL_REGISTRATION_COST_MICRO/);
  assert.doesNotMatch(handler('register_referrer'), /50_000_000/);
  const ui = fs.readFileSync('apps/web/src/components/ReferralSection.tsx', 'utf8');
  assert.match(ui, /Антиспам: 5 🥔 сгорает с баланса приглашённого, разово/);
});
