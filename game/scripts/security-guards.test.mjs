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

// ══════════════════════════════════════════════════════════════════════════
// Часть 1 / 2 чек-листа (аудит 2026-09-26): docs/SECURITY_CHECKLIST_AUDIT_2026-09-26.md
// Трипваер закрепляет защиты, добавленные этой проверкой. Удаление любой из
// них ломает CI — сдвигать пин можно только осознанным diff с описанием why.
// ══════════════════════════════════════════════════════════════════════════

const webPkg = JSON.parse(read('../apps/web/package.json'));
const backendPkg = JSON.parse(read('../apps/backend/package.json'));
const rootPkg = JSON.parse(read('../package.json'));
const landingPkg = JSON.parse(read('../../landing/package.json'));
const landingLock = JSON.parse(read('../../landing/package-lock.json'));

test('П.40: SKR decimals проверяются на каждом рельсе, где цена задана в атомах', () => {
  assert.ok(libRs.includes('pub const SKR_DECIMALS: u8 = 6;'));
  assert.ok(libRs.includes('fn require_skr_mint(mint: &Account<\'_, Mint>)'));
  // 1 объявление + 5 вызовов: presale(SKR), license, withdraw SKR, propose, apply.
  // 4 рельса с существующим config.skr_mint + 1 шаг предложения (new_skr_mint).
  assert.equal(count(libRs, 'require_skr_mint(&ctx.accounts.skr_mint)'), 4);
  assert.equal(count(libRs, 'require_skr_mint(&ctx.accounts.new_skr_mint)'), 1);
  // Обе инструкции миграции минта получают сам минт аккаунтом (проверка до записи).
  for (const name of ['update_skr_mint', 'apply_pending_skr_mint']) {
    const ix = idl.instructions.find((i) => i.name === name);
    assert.ok(ix, `IDL: нет инструкции ${name}`);
    assert.ok(
      ix.accounts.some((a) => a.name === (name === 'update_skr_mint' ? 'new_skr_mint' : 'skr_mint')),
      `${name}: минт не передан аккаунтом — decimals нечем проверить`,
    );
  }
});

test('П.11/R2: bootstrap-минт обязан иметь нулевой supply', () => {
  assert.ok(libRs.includes('require!(mint.supply == 0, GameError::InvalidMintSupply);'));
  const last = idl.errors.at(-1);
  assert.equal(idl.errors.find((e) => e.code === 6047)?.name, 'InvalidMintSupply');
  assert.equal(idl.errors.find((e) => e.code === 6048)?.name, 'InvalidSkrDecimals');
  assert.ok(last && last.code >= 6047, 'коды ошибок дописываются только в конец (клиенты матчатся на них)');
});

test('Пп. 50/51: клиент подписывает только разрешённые программы и сверяет подписанное', () => {
  const ctx = read('../apps/web/src/contexts/SolanaContext.tsx');
  assert.ok(ctx.includes("from '../utils/txSafety'"));
  assert.ok(ctx.includes('assertInstructionsAllowed(priorityIxs, PROGRAM_ID)'), 'нет pre-sign allowlist');
  assert.ok(ctx.includes('assertSignedInstructionsMatch(signed, priorityIxs, PROGRAM_ID)'), 'нет post-sign сверки V0');
  assert.ok(
    ctx.includes('assertSignedLegacyInstructionsMatch(signed, priorityIxs, PROGRAM_ID)'),
    'нет post-sign сверки legacy-пути',
  );
  const safety = read('../apps/web/src/utils/txSafety.ts');
  assert.ok(safety.includes('TOKEN_PROGRAM_ID'), 'SPL Token должен быть в allowlist');
  assert.ok(!/TOKEN_2022_PROGRAM_ID,\s*$/m.test(safety.split('export const ALLOWED_PROGRAMS')[1].split(']')[0]), 'Token-2022 не должен быть в allowlist (transfer hook/permanent delegate)');
});

test('Пп. 55/56: никакого повторного исполнения после отправленной транзакции', () => {
  const ctx = read('../apps/web/src/contexts/SolanaContext.tsx');
  assert.ok(ctx.includes('let v0Sent = false'));
  assert.ok(ctx.includes('v0Sent = true'));
  assert.ok(ctx.includes('if (v0Sent) {'), 'legacy-фолбэк после sendTransaction = двойное действие');
  // Fail-closed симуляция: любая ошибка preflight останавливает отправку.
  assert.equal(count(ctx, 'sim.value.err'), 2); // V0: условие + текст ошибки
  assert.equal(count(ctx, 'sim2.value.err'), 2); // legacy-путь: тот же fail-closed
});

test('П.66: solana-зависимости запинены точно, lockfile хранит integrity', () => {
  const pinned = ['@solana/web3.js', '@solana/spl-token'];
  for (const [label, pkg] of [['game', rootPkg], ['web', webPkg], ['backend', backendPkg], ['landing', landingPkg]]) {
    for (const dep of pinned) {
      const spec = pkg.dependencies?.[dep] ?? pkg.devDependencies?.[dep];
      assert.ok(spec, `${label}: нет зависимости ${dep}`);
      assert.match(spec, /^\d+\.\d+\.\d+$/, `${label}.${dep} = ${spec} — диапазон недопустим (supply chain, п. 66)`);
    }
  }
  // Известно скомпрометированные релизы web3.js (декабрь 2024).
  const compromised = new Set(['1.95.6', '1.95.7']);
  const yarnLock = read('../yarn.lock');
  const entry = parseYarnEntry(yarnLock, '@solana/web3.js@1.98.4');
  assert.ok(entry, 'yarn.lock не содержит точный pin @solana/web3.js');
  assert.ok(!compromised.has(entry.version), `скомпрометированная версия web3.js ${entry.version}`);
  assert.match(entry.version, /^1\.(9[6-9]|\d{2,})\./, `web3.js ${entry.version} старше 1.95.8`);
  assert.ok(entry.integrity?.startsWith('sha512-'), 'нет integrity-хеша для web3.js');
  assert.ok(entry.resolved?.startsWith('https://registry.npmjs.org/'), 'неожидаемый реестр');
  // Landing (npm): точный pin + integrity в lockfile v3.
  for (const dep of pinned) {
    const pkg = landingLock.packages[`node_modules/${dep}`];
    assert.ok(pkg, `landing lock: нет ${dep}`);
    assert.equal(pkg.version, landingPkg.dependencies[dep]);
    assert.ok(pkg.integrity?.startsWith('sha512-'), `landing lock: нет integrity для ${dep}`);
    assert.ok(!compromised.has(pkg.version));
  }
});

test('П.66: CI ставит зависимости только из lockfile (--frozen-lockfile / npm ci)', () => {
  const ciLocal = read('./ci-local.sh');
  assert.ok(ciLocal.includes('yarn install --frozen-lockfile'), 'CI должен падать на рассинхроне lockfile');
  assert.ok(ciLocal.includes('npm ci'), 'landing должен ставиться через npm ci');
  const audit = read('../../.github/workflows/ci.yml');
  assert.ok(audit.includes('yarn install --frozen-lockfile'));
  assert.ok(audit.includes('yarn audit'), ' advisory-аудит зависимостей должен оставаться в CI');
});

test('F-18: advisory-гейты fmt/clippy не могут «проходить» без установленных компонентов', () => {
  const ci = read('../../.github/workflows/ci.yml');
  // Шаги fmt/clippy идут с continue-on-error, поэтому отсутствие компонента
  // давало `error: 'cargo-clippy' is not installed` и зелёный шаг: гейта нет,
  // а выглядит как работающая проверка. Компоненты обязаны ставиться явно.
  assert.ok(/components:\s*clippy, rustfmt/.test(ci), 'dtolnay/rust-toolchain должен ставить clippy и rustfmt');
  const verify = ci.split('name: Verify toolchain')[1]?.split('\n      - name:')[0] ?? '';
  assert.ok(verify.includes('cargo fmt --version'), 'жёсткая проверка версии rustfmt');
  assert.ok(verify.includes('cargo clippy --version'), 'жёсткая проверка версии clippy');
});

/** Разбирает запись yarn.lock v1 по одному из её spec-шаблонов. */
function parseYarnEntry(lockText, spec) {
  const lines = lockText.split('\n');
  let current = null;
  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;
    if (!line.startsWith(' ')) {
      const patterns = line.replace(/:$/, '').split(', ').map((s) => s.replace(/^"|"$/g, ''));
      current = { patterns, version: null, resolved: null, integrity: null };
      if (patterns.includes(spec)) return finalize(lines, lines.indexOf(line), current);
    }
  }
  return null;
}

function finalize(lines, start, current) {
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith(' ')) break;
    const m = /^\s{2}(\w+)\s+"?([^"]+?)"?$/.exec(line);
    if (m) current[m[1]] = m[2];
  }
  return current;
}
