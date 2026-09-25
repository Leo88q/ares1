#!/usr/bin/env node
// Security-guard tripwire по чек-листу аудита 2026-09-25
// (docs/SECURITY_CHECKLIST_AUDIT_2026-09-25.md).
//
// Это НЕ заменa AST-аудиту: тест парсит исходники программы (lib.rs,
// migrations.rs) и конфиги, и валидирует ИНВАРИАНТЫ ЗАЩИТ — каждый `init`
// с payer/space, каждый seeds с bump, пины has_one/close/подписантов,
// тимлоки, капы, overflow-гигиену и паритет program-id. Удаление или
// ослабление любой защиты ломает этот тест; НАРОЧНОЕ изменение счётчика —
// осознанное решение, зафиксированное в diff (сдвиньте пин и опишите why).
//
// Zero-dependency: запускается `node --test scripts/security-guards.test.mjs`
// (CI watchtower) и `yarn test:guards`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), 'utf8');

/** Убирает построчные комментарии (slash-slash и doc-вариант; блочных в сорсах нет). */
function stripComments(source) {
  return source.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}

/** Достаёт все сбалансированные `#[account( ... )]`-блоки (в т.ч. многострочные). */
export function accountAttrBlocks(source) {
  const blocks = [];
  let idx = 0;
  while ((idx = source.indexOf('#[account(', idx)) !== -1) {
    let depth = 1;
    let end = idx + '#[account('.length;
    while (end < source.length && depth > 0) {
      const ch = source[end];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      end += 1;
    }
    blocks.push(source.slice(idx + '#[account('.length, end - 1));
    idx = end;
  }
  return blocks;
}

const libRs = stripComments(read('../programs/solana_potato/src/lib.rs'));
const migrationsRs = stripComments(read('../programs/solana_potato/src/migrations.rs'));
const anchorToml = read('../Anchor.toml');
const cargoToml = read('../Cargo.toml');
const idl = JSON.parse(read('../apps/web/src/idl.json'));
const blocks = accountAttrBlocks(libRs);
const count = (src, needle) => src.split(needle).length - 1;

test('A1/A5/A6/D21-D22: каждый init платит ренту; data-аккаунт декларирует space', () => {
  const inits = blocks.filter((b) => /\binit,/.test(b) || /\binit_if_needed,/.test(b));
  // 29 блоков init/init_if_needed: 9 init + 20 init_if_needed в коде
  // (SW016-инвентарь насчитывает 21 сырой токен — 2 из них в комментариях).
  assert.equal(inits.length, 29, `init-блоков: ${inits.length}, ожидалось 29`);
  for (const b of inits) {
    assert.ok(/payer\s*=/.test(b), `init без payer: ${b.slice(0, 120)}`);
    const isTokenAccount = /token::|associated_token::/.test(b);
    if (!isTokenAccount) {
      assert.ok(/space\s*=/.test(b), `data-init без space: ${b.slice(0, 120)}`);
      assert.ok(/8\s*\+\s*\w+::INIT_SPACE/.test(b), `space не 8 + INIT_SPACE: ${b.slice(0, 120)}`);
    }
  }
});

test('A1: каждый seeds-констрейнт спарен с bump', () => {
  const seeded = blocks.filter((b) => /seeds\s*=/.test(b));
  assert.equal(seeded.length, 82, `seeds-блоков: ${seeded.length}, ожидалось 82`);
  for (const b of seeded) {
    assert.ok(/\bbump\b/.test(b), `seeds без bump: ${b.slice(0, 120)}`);
  }
});

test('A2: пины has_one (10×potato_mint, 18×authority, 4×owner, 3×seller)', () => {
  // Нарочно зафиксированные счётчики: новый контекст = осознанный diff пина.
  assert.equal(count(libRs, 'has_one = potato_mint'), 10);
  assert.equal(count(libRs, 'has_one = authority'), 17); // 18-й — в doc-комментарии, срезан
  assert.equal(count(libRs, 'has_one = owner'), 4);
  assert.equal(count(libRs, 'has_one = seller'), 3);
});

test('E28: close-назначения pinned (3×seller, 1×owner, 1×payer)', () => {
  assert.equal(count(libRs, 'close = seller'), 3);
  assert.equal(count(libRs, 'close = owner'), 1);
  assert.equal(count(libRs, 'close = payer'), 1);
});

test('A2: платежные ATA привязаны к подписанту (token::mint/authority)', () => {
  assert.equal(count(libRs, 'token::mint = potato_mint, token::authority = owner'), 6);
  assert.equal(count(libRs, 'token::authority = seller'), 4);
  assert.ok(count(libRs, 'token::authority = buyer') >= 1);
});

test('B7/B8/F-01: платный RNG только на верхнем уровне (assert_no_cpi_grind ×2)', () => {
  assert.equal(count(libRs, 'assert_no_cpi_grind()?;'), 2);
  assert.ok(libRs.includes('fn assert_no_cpi_grind()'));
  // Обе платно-рандомные инструкции вызывают guard ДО перевода средств.
  for (const fn of ['pub fn buy_field_skr', 'pub fn upgrade_field']) {
    const at = libRs.indexOf(fn);
    assert.ok(at > 0, `${fn} отсутствует`);
    const guard = libRs.indexOf('assert_no_cpi_grind()?;', at);
    const transfer = libRs.indexOf('token::transfer(', at);
    assert.ok(guard > at && guard < transfer, `guard в ${fn} должен стоять до CPI`);
  }
});

test('C: пауза-гейт на всех расходных инструкциях (15 пинов)', () => {
  assert.equal(count(libRs, 'require!(!ctx.accounts.config.paused, GameError::Paused)'), 14);
  assert.equal(count(libRs, 'require!(!config.paused, GameError::Paused)'), 1);
  assert.ok(libRs.includes('pub fn set_paused'));
  // guardian может только ставить паузу, не снимать.
  assert.ok(libRs.includes('require!(paused, GameError::Unauthorized)'));
  assert.ok(libRs.includes('pub guardian: Pubkey'));
});

test('C11: POTATO-mint заперт за config PDA без freeze authority', () => {
  assert.ok(libRs.includes('mint.mint_authority == COption::Some(config_key)'));
  assert.ok(libRs.includes('mint.decimals == 6'));
  assert.ok(libRs.includes('mint.freeze_authority.is_none()'));
});

test('C13/C14: overflow-гигиена (checked/saturating полы + overflow-checks = true)', () => {
  const release = cargoToml.split('[profile.release]')[1] ?? '';
  assert.ok(release.includes('overflow-checks = true'), 'в [profile.release] нет overflow-checks');
  assert.ok(count(libRs, 'checked_add') + count(libRs, 'checked_sub') + count(libRs, 'checked_mul') >= 40);
  assert.ok(count(libRs, 'saturating_') >= 50);
});

test('C15: комиссия считается floor-формулой с потолком скидок', () => {
  assert.ok(/checked_mul\(calculate_fee_bps\(amount_micro\)\s*as u128\)/.test(libRs));
  assert.ok(libRs.includes('.min(fee_listed)'), 'скидки не ограничены комиссией');
  assert.ok(libRs.includes('MIN_ORDER_TOTAL_LAMPORTS, GameError::OrderTotalTooSmall'));
  assert.ok(libRs.includes('MIN_ORDER_AMOUNT_MICRO, GameError::OrderTooSmall'));
  assert.ok(libRs.includes('GameError::SelfTradeBlocked'));
  assert.ok(libRs.includes('GameError::CancelCooldown'));
});

test('C16/F-02: вывод казны — двухшаговый, с пином назначения и лимитами окна', () => {
  assert.equal(count(libRs, 'seeds = [b"treasury_sol"]'), 5);
  // назначение прибито к ATA authority (POTATO, SKR) — кошелёк-посредник невозможен
  assert.equal(count(libRs, 'associated_token::authority = authority'), 3);
  assert.equal(count(libRs, 'GameError::WithdrawTimelockNotExpired'), 3);
  assert.equal(count(libRs, 'GameError::WithdrawAmountMismatch'), 3);
  assert.equal(count(libRs, 'GameError::WithdrawWindowLimitExceeded'), 1);
  assert.ok(libRs.includes('WITHDRAW_TIMELOCK_SECONDS: i64 = 30'));
  assert.ok(libRs.includes('WITHDRAW_WINDOW_SECONDS: i64 = 86_400'));
});

test('C20: админ-рычаги под тимлоком/потолками/двухшаговостью', () => {
  assert.ok(libRs.includes('ADMIN_UPDATE_TIMELOCK_SECONDS: i64 = 86_400'));
  assert.equal(count(libRs, 'GameError::TimelockNotExpired'), 2); // skr_mint + presale price
  assert.ok(libRs.includes('pub fn propose_authority') && libRs.includes('pub fn accept_authority'));
  assert.ok(libRs.includes('MAX_DAILY_CAP_MICRO, GameError::CapTooHigh'));
  assert.ok(libRs.includes('MAX_BASE_YIELD_MICRO_PER_DAY') && libRs.includes('GameError::BaseYieldTooHigh'));
  assert.ok(libRs.includes('MAX_GLOBAL_MULTIPLIER_BPS, GameError::MultiplierTooHigh'));
  assert.ok(libRs.includes('GameError::GrantQuotaExceeded'));
  assert.ok(libRs.includes('GRANT_QUOTA_SHARE_BPS: u64 = 1_000'));
  assert.ok(libRs.includes('MAX_REWARD_MICRO: u64 = 1_000_000_000'));
});

test('C18/E29: капы циклов и дубликаты', () => {
  assert.ok(libRs.includes('remaining_accounts.len() <= 10'));
  assert.ok(libRs.includes('accs.len() <= MAX_CLAIM_PROOFS'));
  assert.ok(libRs.includes('MAX_CLAIM_PROOFS: usize = 12'));
});

test('C17/D30: энтропия SlotHashes спинована по адресу и смешивается с keccak', () => {
  assert.equal(count(libRs, 'SysvarS1otHashes111111111111111111111111111'), 2);
  assert.equal(count(libRs, 'keccak::hashv'), 4);
  assert.ok(libRs.includes('fn parse_slot_hash(data: &[u8])'));
});

test('D24: миграции валидируют раскладки и authority', () => {
  assert.equal(count(libRs, 'migrations::authority('), 4);
  for (const whitelist of ['&[156, 164, 228, 260]', '&[97, 145]', '&[69, 70]', '&[41, 49]']) {
    assert.ok(migrationsRs.includes(whitelist), `белый список размеров ${whitelist} отсутствует`);
  }
  assert.ok(migrationsRs.includes('fn check_layout('));
  assert.ok(migrationsRs.includes('require_keys_eq!(config.authority, *signer'));
});

test('D26: program-id паритет declare_id == Anchor.toml == IDL клиента', () => {
  const declared = libRs.match(/declare_id!\("([^"]+)"\)/)?.[1];
  assert.ok(declared, 'declare_id! не найден');
  const tomlIds = [...anchorToml.matchAll(/solana_potato\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(tomlIds.length >= 3);
  for (const id of tomlIds) assert.equal(id, declared);
  assert.equal(idl.address, declared);
});

test('гигиена: без unsafe, дискриминаторное запись поля остаётся честной', () => {
  assert.equal(count(libRs, 'unsafe'), 0);
  assert.equal(count(migrationsRs, 'unsafe'), 0);
  assert.ok(libRs.includes('fn write_field_account(field: &Field, data: &mut [u8])'));
  assert.ok(libRs.includes('data.len() == 8 + Field::INIT_SPACE'));
});

test('SW016-инвентарь: init_if_needed по-прежнему 21 и совпадает с reports', () => {
  const report = JSON.parse(read('../../reports/ares1-audit.json'));
  // Инвентарь SW016 считает сырые токены ВКЛЮЧАЯ комментарии — сверяем с raw-сорсом.
  const raw = read('../programs/solana_potato/src/lib.rs');
  const live = count(raw, 'init_if_needed');
  assert.equal(live, 21);
  assert.equal(report.findings.length, live, 'reports/ares1-audit.json разошёлся с сорцами');
});
