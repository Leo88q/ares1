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
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
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
  // 30 блоков init/init_if_needed: 10 init + 20 init_if_needed в коде
  // (SW016-инвентарь насчитывает 21 сырой токен — 2 из них в комментариях).
  // +1 init к 29: reward_claim в GrantRewardOnce (гейт G-1, защита от replay).
  assert.equal(inits.length, 30, `init-блоков: ${inits.length}, ожидалось 30`);
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
  // 82 + 3: config / epoch / reward_claim в GrantRewardOnce.
  assert.equal(seeded.length, 85, `seeds-блоков: ${seeded.length}, ожидалось 85`);
  for (const b of seeded) {
    assert.ok(/\bbump\b/.test(b), `seeds без bump: ${b.slice(0, 120)}`);
  }
});

test('A2: пины has_one (11×potato_mint, 18×authority, 4×owner, 3×seller)', () => {
  // Нарочно зафиксированные счётчики: новый контекст = осознанный diff пина.
  assert.equal(count(libRs, 'has_one = potato_mint'), 11); // +1: GrantRewardOnce
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

test('C: пауза-гейт на всех расходных инструкциях (16 пинов)', () => {
  assert.equal(count(libRs, 'require!(!ctx.accounts.config.paused, GameError::Paused)'), 15); // +1: grant_reward_once
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
  // Батч-лимит теперь зависит от лицензии, но remain-условие обязано остаться:
  // `fields.len() <= limit`, где limit — 10 без лицензии и 30 с активной.
  assert.ok(libRs.includes('fields.len() <= limit'));
  assert.ok(libRs.includes('BATCH_LIMIT_BASE: usize = 10'));
  assert.ok(libRs.includes('BATCH_LIMIT_LICENSED: usize = 30'));
  // Тир выдаётся только по проверенному PDA лицензии: совпадение с выведенным
  // адресом, владелец — наша программа, данные не пусты. Без любого из трёх
  // условий поддельный аккаунт выдал бы себе премиум-лимит.
  assert.ok(libRs.includes('&[b"license", ctx.accounts.owner.key().as_ref()]'));
  assert.ok(libRs.includes('if first.key() == expected_lic'));
  assert.ok(libRs.includes('if first.owner == ctx.program_id && !first.data_is_empty()'));
  assert.ok(libRs.includes('licensed = lic.expires_at > now'));
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

test('initialize: опциональный SKR-минт проверяется не слабее типизированного рельса', () => {
  // Деплоер может передать свой SKR-минт через remaining_accounts (это нужно для
  // localnet, где константный devnet-минт не существует). Проверка обязана быть
  // не слабее `require_skr_mint`: владелец — SPL Token, данные не пусты,
  // decimals == SKR_DECIMALS. Иначе подобранные байты переоценили бы лицензию
  // (500 SKR) и модуль (1053 SKR) на 10^k.
  assert.ok(libRs.includes('fn require_skr_mint_info(acc: &AccountInfo)'));
  assert.ok(libRs.includes('require!(*acc.owner == SPL_TOKEN_PROGRAM, GameError::InvalidMint);'));
  assert.ok(libRs.includes('require!(!acc.data_is_empty(), GameError::InvalidMint);'));
  assert.ok(libRs.includes('pub const SPL_TOKEN_PROGRAM: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");'));
  assert.ok(libRs.includes('require_skr_mint_info(acc)?;'));
  // Фолбэк на пиновую константу: вызов без remaining_accounts обязан вести себя
  // побайтово как раньше, иначе меняется поведение уже задеплоенных скриптов.
  assert.ok(libRs.includes('None => SKR_MINT,'));
  assert.ok(libRs.includes('config.skr_mint = skr_mint;'));
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
  assert.ok(ctx.includes('const expectedMessageV0 = snapshotVersionedMessage(vtx)'), 'V0 message must be snapshotted before wallet signing');
  assert.ok(ctx.includes('assertSignedInstructionsMatch(signed, expectedMessageV0)'), 'нет post-sign сверки полного V0 message');
  assert.ok(ctx.includes('const expectedLegacyMessage = snapshotLegacyMessage(tx)'), 'legacy message must be snapshotted before wallet signing');
  assert.ok(
    ctx.includes('assertSignedLegacyInstructionsMatch(signed, expectedLegacyMessage)'),
    'нет post-sign сверки полного legacy message',
  );
  const safety = read('../apps/web/src/utils/txSafety.ts');
  assert.ok(safety.includes('signed.message.serialize()'), 'V0 проверка должна сравнивать полное сериализованное message');
  assert.ok(safety.includes('signed.serializeMessage()'), 'legacy проверка должна сравнивать полное serialized message');
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

test('2026-10-02: GHSA-3gc7-fjrx-p6mg removed from both runtime dependency trees', () => {
  const vendorPackage = JSON.parse(read('../../vendor/solana-buffer-layout-utils/package.json'));
  assert.equal(vendorPackage.name, '@solana/buffer-layout-utils');
  assert.equal(vendorPackage.version, '0.3.1+ares1');
  const localSpec = 'file:../vendor/solana-buffer-layout-utils';
  assert.equal(rootPkg.resolutions?.['@solana/buffer-layout-utils'], localSpec, 'Yarn must force the vendored package for transitive consumers');
  assert.equal(rootPkg.devDependencies?.['@solana/buffer-layout-utils'], localSpec, 'Yarn must link the local package from the root');
  assert.equal(landingPkg.dependencies?.['@solana/buffer-layout-utils'], localSpec, 'npm must use the same local package');
  assert.equal(read('../../landing/.npmrc').trim(), 'install-links=true', 'npm must copy the file dependency under node_modules so Vite resolves its runtime deps');

  const yarnLock = read('../yarn.lock');
  assert.doesNotMatch(yarnLock, /bigint-buffer/, 'vulnerable native package must not be in Yarn lockfile');
  assert.doesNotMatch(yarnLock, /bigint-buffer@/);
  assert.ok(yarnLock.includes('@solana/buffer-layout-utils@^0.3.0'), 'transitive SPL Token request must resolve through the local Yarn resolution');
  assert.equal(landingLock.packages['node_modules/bigint-buffer'], undefined, 'vulnerable native package must not be in npm lockfile');
  const npmVendor = landingLock.packages['node_modules/@solana/buffer-layout-utils'];
  assert.equal(npmVendor?.resolved, localSpec, 'npm lock must install the local package copy, not an upstream release');
  assert.equal(npmVendor?.version, vendorPackage.version);

  const source = read('../../vendor/solana-buffer-layout-utils/src/bigint.ts');
  assert.doesNotMatch(source, /from ['"]bigint-buffer['"]|require\(['"]bigint-buffer['"]\)/, 'integer conversion must remain pure JavaScript');
  assert.doesNotMatch(read('../../vendor/solana-buffer-layout-utils/lib/cjs/bigint.js'), /require\(['"]bigint-buffer['"]\)/);
  assert.doesNotMatch(read('../../vendor/solana-buffer-layout-utils/lib/esm/bigint.mjs'), /from ['"]bigint-buffer['"]/);
  assert.match(read('../../scripts/check-release-artifacts.mjs'), /artifact-vulnerable-bigint-buffer/, 'release artifact gate must reject the vulnerable package marker');
});

test('2026-10-02: Jayson 5 removes the vulnerable stream-json/uuid RPC parser tree', () => {
  assert.equal(rootPkg.resolutions?.jayson, '5.0.0', 'web3.js RPC client must resolve to the patched Jayson release');
  assert.equal(landingPkg.overrides?.jayson, '5.0.0', 'npm must apply the same Jayson compatibility override');

  const yarnLock = read('../yarn.lock');
  const jayson = parseYarnEntry(yarnLock, 'jayson@^4.1.1');
  assert.equal(jayson?.version, '5.0.0');
  assert.match(jayson?.resolved ?? '', /jayson-5\.0\.0\.tgz/);
  assert.doesNotMatch(yarnLock, /stream-json@|stream-chain@|eyes@/);

  const npmJayson = landingLock.packages['node_modules/jayson'];
  assert.equal(npmJayson?.version, '5.0.0');
  assert.equal(npmJayson?.dependencies?.['stream-json'], undefined);
  assert.equal(npmJayson?.dependencies?.uuid, undefined);
  assert.equal(landingLock.packages['node_modules/stream-json'], undefined);

  for (const pattern of [
    '**/node-cron/uuid',
    '**/uuidv4/uuid',
    '**/@keystonehq/bc-ur-registry-sol/uuid',
    '**/@keystonehq/sol-keyring/uuid',
    '**/@solflare-wallet/sdk/uuid',
  ]) {
    assert.equal(rootPkg.resolutions?.[pattern], '11.1.1', `vulnerable uuid consumer must be patched: ${pattern}`);
  }
  assert.equal(parseYarnEntry(yarnLock, 'uuid@^8.3.2')?.version, '11.1.1');
  assert.equal(parseYarnEntry(yarnLock, 'uuid@^9.0.0')?.version, '11.1.1');
  assert.doesNotMatch(yarnLock, /^uuid@\^9\.0\.0:/m, 'do not keep an unused, vulnerable uuid 9 lock entry');
  assert.equal(parseYarnEntry(yarnLock, 'uuid@^14.0.0')?.version, '14.0.2', 'rpc-websockets keeps its supported uuid major');

  const npmUuidNodes = Object.entries(landingLock.packages).filter(([path]) => /(^|\/)node_modules\/uuid$/.test(path));
  assert.ok(npmUuidNodes.length > 0, 'landing lock must include the Solana RPC uuid package');
  assert.ok(npmUuidNodes.every(([, pkg]) => Number(pkg.version.split('.')[0]) >= 11), 'landing must not lock an advisory-affected uuid version');
  assert.equal(landingLock.packages['node_modules/stream-json'], undefined);
});

test('2026-10-02: landing keeps vendors/locales split under Vite default chunk limit', () => {
  const vite = read('../../landing/vite.config.ts');
  assert.ok(vite.includes('manualChunks'), 'landing must split the large vendor modules');
  assert.ok(vite.includes('locales:'), 'locale dictionaries must not inflate the application entry chunk');
  assert.doesNotMatch(vite, /chunkSizeWarningLimit\s*:/, 'do not suppress the warning by raising its threshold');
});

test('П.66: CI ставит зависимости только из lockfile (--frozen-lockfile / npm ci)', () => {
  const ciLocal = read('./ci-local.sh');
  assert.ok(ciLocal.includes('yarn install --frozen-lockfile'), 'CI должен падать на рассинхроне lockfile');
  assert.ok(ciLocal.includes('npm ci'), 'landing должен ставиться через npm ci');
  const audit = read('../../.github/workflows/ci.yml');
  assert.ok(audit.includes('yarn install --frozen-lockfile'));
  assert.ok(audit.includes('audit-blocking.sh') && audit.includes('npm audit'), 'blocking Yarn and npm dependency audits must remain in CI');
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

// ============================================================================
// Аудит 2026-09-28: машинные гейты по инцидентам 94–130 (часть 5–6 каталога).
// Каждый тест ниже — «предохранитель» против тихого отката защиты, закрытой
// в этой проверке. Формат: инцидент → что закрепляем.
// ============================================================================

test('П.115 (Truebit): overflow-checks остаётся включённым в release-сборке', () => {
  const profile = cargoToml.split('[profile.release]')[1] ?? '';
  assert.ok(profile.length > 0, 'в workspace Cargo.toml должен быть [profile.release]');
  assert.match(profile, /overflow-checks\s*=\s*true/, 'release-профиль без overflow-checks молча заворачивает арифметику');
});

test('П.116 (Rain card): anchor-крейты запинены точно (=), а не диапазоном', () => {
  const pkg = read('../programs/solana_potato/Cargo.toml');
  assert.match(pkg, /anchor-lang\s*=\s*\{\s*version\s*=\s*"=0\.31\.2"/, 'anchor-lang должен быть запинен точно');
  assert.match(pkg, /anchor-spl\s*=\s*\{\s*version\s*=\s*"=0\.31\.2"/, 'anchor-spl должен быть запинен точно');
});

test('П.107 (JetBrains/ChainDrop): ни один package.json не запускает lifecycle-скрипты', () => {
  const manifests = [
    '../package.json',
    '../apps/web/package.json',
    '../apps/backend/package.json',
    '../../landing/package.json',
    '../../watchtower/package.json',
  ];
  const LIFECYCLE = ['preinstall', 'postinstall', 'prepare'];
  for (const rel of manifests) {
    let raw;
    try {
      raw = JSON.parse(read(rel));
    } catch (e) {
      // watchtower/landing обязаны существовать; отсутствие — ошибка конфигурации
      throw new Error(`Не удалось прочитать ${rel}: ${e.message}`);
    }
    const scripts = raw.scripts ?? {};
    for (const hook of LIFECYCLE) {
      assert.ok(
        !(hook in scripts),
        `${rel}: найден lifecycle-скрипт "${hook}" — прием new-версий с авто-скриптами запрещён (ChainDrop). Если он ОЧЕНЬ нужен, добавь пакет в allowlist этого теста с записью why в diff`,
      );
    }
  }
});

test('П.100 (Taiko): gitignore не пропускает keypair/.env, сканеры секретов на месте', () => {
  const gitignore = read('../../.gitignore');
  for (const pattern of [/\.env/, /keypair/, /id\.json/, /secret/i]) {
    assert.ok(pattern.test(gitignore), `.gitignore не содержит паттерн ${pattern}`);
  }
  assert.ok(read('../../.gitleaks.toml').length > 50, 'конфиг gitleaks не должен быть пустым');
});

test('П.104 (Polymarket): CSP «script-src self» на лендинге; внешних <script> нет', () => {
  const headers = read('../../landing/public/_headers');
  const cspLine = headers.split('\n').find((l) => l.includes('Content-Security-Policy:'));
  assert.ok(cspLine, 'в _headers должна быть CSP-строка');
  assert.match(cspLine, /script-src 'self'/, 'script-src обязан быть только self');
  const html = read('../../landing/index.html');
  for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
    assert.ok(
      m[1].startsWith('/') || m[1].startsWith('#'),
      `внешний скрипт на лендинге запрещён: ${m[1]} (CSP script-src 'self' — SRI не спасёт от вендора, п. 104)`,
    );
  }
});

test('Пп. 103/108/114/127 (Kelp/jaredfromsubway): policy-слой подписанта подключён', () => {
  const solana = read('../apps/backend/src/solana.ts');
  assert.match(solana, /assertPayerInstructionsAllowed\(instructions, programId\)/, 'sendVersionedTx обязан проверять allowlist инструкций перед подписью');
  assert.match(solana, /import \{ assertPayerInstructionsAllowed \} from "\.\/policy\.js"/);
  const roller = read('../apps/backend/src/epochRoller.ts');
  assert.match(roller, /fetchSigningSnapshot/, 'решение о подписи — только по снапшоту');
  assert.match(roller, /verifySnapshotConsistency/, 'снапшот обязан сверяться со вторым источником');
  assert.match(roller, /DataSourceMismatchError/, 'расхождение источников — инцидент, не ретрай');
  assert.match(roller, /"finalized"/, 'решение о подписи — только по finalized');
  const env = read('../apps/backend/src/env.ts');
  assert.match(env, /RPC_URL_SECONDARY/, 'в env должен быть второй независимый RPC-источник');
  assert.match(env, /requireSecondaryRpc/, 'прод-окружение обязано требовать второй источник');
});

test('П.98 (Raydium legacy): реестр ончейн-программ существует и валиден', () => {
  const inventory = JSON.parse(read('../program-inventory.json'));
  assert.equal(inventory.schemaVersion, 1);
  assert.ok(Array.isArray(inventory.programs) && inventory.programs.length >= 1, 'в реестре должна быть минимум одна запись');
  const known = new Set(JSON.parse(read('../../watchtower/address-registry.json')).programs ? Object.values(JSON.parse(read('../../watchtower/address-registry.json')).programs) : []);
  for (const p of inventory.programs) {
    assert.match(p.id, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, `id не похож на base58 pubkey: ${p.id}`);
    assert.ok(['active', 'deprecated', 'retired'].includes(p.status), `неизвестный статус: ${p.status}`);
    assert.ok(typeof p.role === 'string' && p.role.length > 0, 'у записи должен быть role');
    if (p.status === 'deprecated') {
      assert.ok(p.expectedUpgradeAuthority === null, 'deprecated-программа обязана быть immutable (upgrade authority = None)');
    }
    if (p.expectedUpgradeAuthority !== null && p.expectedUpgradeAuthority !== undefined) {
      assert.match(p.expectedUpgradeAuthority, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    }
  }
  // Программа из address-registry (если проставлена) должна быть в реестре.
  const mainId = JSON.parse(read('../../watchtower/address-registry.json')).programs?.solana_potato;
  if (typeof mainId === 'string') {
    assert.ok(
      inventory.programs.some((p) => p.id === mainId),
      'программа solana_potato из address-registry отсутствует в program-inventory.json',
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-02 audit hardening. Every test below locks in a fix that until now
// existed only as a document promise; weakening any of them requires an
// explicit, reviewed change to this file.
// ─────────────────────────────────────────────────────────────────────────────

test('2026-10-02: все GitHub Actions запинены по commit SHA', () => {
  const dir = path.join(here, '../../.github/workflows');
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml'));
  assert.ok(files.length >= 6, 'workflow-файлы не найдены');
  for (const f of files) {
    const text = readFileSync(path.join(dir, f), 'utf8');
    for (const line of text.split('\n')) {
      const m = /^\s*-?\s*uses:\s*(\S+)/.exec(line);
      if (!m) continue;
      if (m[1].startsWith('./')) continue;
      assert.match(m[1], /@[0-9a-f]{40}$/, `${f}: "${m[1]}" не запинен по commit SHA (плавающий тег = supply-chain риск)`);
    }
  }
});

test('2026-10-02: скан истории секретов — настоящий гейт, а не advisory', () => {
  const sec = read('../../.github/workflows/security.yml');
  assert.ok(sec.includes('fetch-depth: 0'), 'скан истории требует полной истории (иначе он честно падает с exit 2)');
  assert.ok(sec.includes('Enforce the history gate'), 'нужен шаг, который валит job при находке в истории');
  const enforcer = sec.split('Enforce the history gate')[1]?.split('- name:')[0] ?? '';
  assert.ok(/\bexit 1\b/.test(enforcer), 'шаг-энфорсер обязан завершаться exit 1 (иначе гейт снова станет advisory)');
});

test('2026-10-02: mainnet-деплой не обходит preflight', () => {
  const deploy = read('./deploy-mainnet.sh');
  assert.match(deploy, /preflight-mainnet\.sh/, 'deploy-mainnet.sh обязан вызывать preflight');
  assert.match(deploy, /EXPECTED_SO_SHA256/, 'хеш артефакта обязателен (воспроизводимая сборка)');
  assert.match(deploy, /MAINNET_AUTHORITY/, 'ожидаемый Squads-адрес обязателен');
  assert.match(deploy, /DEPLOY_KEYPAIR/, 'кошелёк деплоя задаётся явно, без дефолта');
  assert.match(deploy, /ALLOW_DEFAULT_KEYPAIR/, 'дефолтный CLI-кошелёк требует осознанного обхода');
  assert.match(read('./preflight-mainnet.sh'), /--allow-first-deploy/);
});

test('2026-10-02: у мониторинга есть расписание, а не только обещание', () => {
  const mon = read('../../.github/workflows/monitoring.yml');
  assert.match(mon, /cron: '\*\/15 \* \* \* \*'/, 'DNS-проверка должна идти по расписанию');
  assert.match(mon, /check-dns\.mjs/);
  assert.match(mon, /inventory-programs\.mjs/);
  assert.match(mon, /check:invariants/);
  assert.match(mon, /issues: write/, 'алерт должен уметь открыть issue');
});

test('2026-10-02: devnet genesis hash полный и совпадает в двух независимых файлах', () => {
  const m = /DEVNET_GENESIS = '([^']+)'/.exec(read('../../watchtower/src/rpc.ts'));
  assert.ok(m, 'константа DEVNET_GENESIS не найдена');
  assert.equal(m[1].length, 44, `devnet genesis должен быть 44 символа, получено ${m[1].length} (обрезанный хеш = RPC_CLUSTER_MISMATCH на каждом вызове)`);
  const legacy = /EXPECTED_DEVNET_GENESIS = '([^']+)'/.exec(read('./legacy-recovery-audit.mjs'));
  assert.ok(legacy, 'EXPECTED_DEVNET_GENESIS не найдена в legacy-recovery-audit.mjs');
  assert.equal(m[1], legacy[1], 'источники devnet genesis расходятся — один из них неверен');
});

test('2026-10-02: high/critical dependency findings block both CI audits', () => {
  const ci = read('../../.github/workflows/ci.yml');
  assert.match(ci, /name: Dependency audit — high\/critical \(blocking\)/);
  assert.match(ci, /run: \.\/scripts\/audit-blocking\.sh/, 'Yarn audit must use a bitmask-aware blocking gate');
  assert.match(ci, /npm audit --omit=dev --audit-level=high/, 'landing production high/critical audit must block');
});

test('2026-10-02: backend-контейнер по умолчанию не публикуется в интернет', () => {
  const compose = read('../docker-compose.yml');
  assert.match(compose, /GAME_OPS_BACKEND_BIND:-127\.0\.0\.1/, 'bind по умолчанию — loopback');
  assert.match(read('../apps/backend/.env.example'), /TRUST_PROXY=1/, 'TRUST_PROXY должен быть описан в .env.example');
});

test('2026-10-02: мёртвый Token-2022 и клиентский RNG пресейла не вернулись', () => {
  assert.throws(() => read('../apps/web/src/utils/token2022.ts'), /ENOENT/, 'utils/token2022.ts должен быть удалён: он противоречит SPL-only дизайну');
  const client = read('../apps/web/src/utils/anchorClient.ts').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/token2022Ata/.test(client), 'token2022Ata — мёртвый код (программа пинует классический SPL Token)');
  // Урок собственной ошибки: re-export TOKEN_2022_PROGRAM_ID удалять нельзя —
  // его паритет с SDK пинует tests/offchain/decoders.test.ts, и «чистка мёртвого
  // кода» ломала offchain-набор (поймано прогоном 2026-10-02).
  assert.match(client, /export \{ TOKEN_2022_PROGRAM_ID \}/, 're-export SDK-константы нужен raw-client тесту, это не мёртвый код');
  const landing = read('../../landing/utils/constants.ts').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/rollPresaleDrop/.test(landing), 'клиентский RNG тира пресейла не должен вернуться: тир решает программа');
});

test('2026-10-02: duress-протокол существует (п.125 wrench-атаки)', () => {
  const ir = read('../docs/INCIDENT_RESPONSE.md');
  assert.match(ir, /## 9\. Duress-протокол/, 'документы ссылались на duress-протокол, которого не было');
  assert.match(ir, /3-of-N|3 из N/, 'порог мультисига — ключевая часть протокола');
});

test('2026-10-02: одна версия @solana/web3.js на весь репозиторий (F-29)', () => {
  const manifests = [
    '../package.json',
    '../apps/web/package.json',
    '../apps/backend/package.json',
    '../../landing/package.json',
  ];
  const versions = manifests.map((rel) => {
    const pkg = JSON.parse(read(rel));
    const v = pkg.dependencies?.['@solana/web3.js'] ?? pkg.devDependencies?.['@solana/web3.js'];
    assert.ok(v, `${rel}: нет @solana/web3.js`);
    assert.match(v, /^\d+\.\d+\.\d+$/, `${rel}: нужен точный пин без диапазона, получено «${v}»`);
    return v;
  });
  assert.equal(new Set(versions).size, 1, `версии разъехались: ${manifests.map((m, i) => `${m}=${versions[i]}`).join(', ')}`);
});

test('2026-10-02: lint-гейты блокируют, а исключение для deprecated узкое (F-22)', () => {
  const ci = read('../../.github/workflows/ci.yml');
  const clippy = ci.split('name: cargo clippy strict')[1]?.split('\n      - name:')[0] ?? '';
  assert.ok(clippy, 'шаг cargo clippy strict не найден');
  assert.ok(clippy.includes('-D warnings'), 'clippy должен идти со strict-флагами');
  assert.ok(clippy.includes('-A deprecated'), 'шум кодогена Anchor снимается явным -A deprecated');
  assert.ok(!clippy.includes('continue-on-error'), 'clippy-гейт обязан быть блокирующим');
  // Источник исключения должен быть назван прямо над шагом: без этого `-A
  // deprecated` через полгода выглядит как «кто-то отключил lint непонятно почему».
  assert.match(
    ci,
    /Anchor 0\.31\.2[\s\S]{0,1500}?name: cargo clippy strict/,
    'исключение должно ссылаться на источник шума (кодоген Anchor)',
  );
  const fmt = ci.split('name: cargo fmt check')[1]?.split('\n      - name:')[0] ?? '';
  assert.ok(fmt, 'шаг cargo fmt check не найден');
  assert.match(fmt, /--max-hunks=\d+/, 'fmt-долг должен быть запинен baseline-числом');
  assert.ok(!fmt.includes('continue-on-error'), 'рост fmt-долга обязан валить шаг');
  // Компенсация за -A deprecated: сам вызов, который lint скрыл бы, запрещён
  // tripwire'ом — иначе исключение превратилось бы в дыру.
  for (const rel of ['../programs/solana_potato/src/lib.rs', '../programs/solana_potato/src/migrations.rs']) {
    assert.ok(
      !/\.realloc\(/.test(read(rel)),
      `${rel}: AccountInfo::realloc deprecated в solana-program 2.x — используйте resize()`,
    );
  }
});

test('2026-10-02: shellcheck-гейт существует и покрывает все отслеживаемые .sh', () => {
  const ci = read('../../.github/workflows/ci.yml');
  // Job добавлен в конец ci.yml (2026-10-02); если его перенесут, срез до
  // следующего ключа на двух пробелах сохранит проверку осмысленной.
  const tail = ci.split('  shell-scripts:')[1];
  assert.ok(tail, 'job shell-scripts не найден в ci.yml');
  const job = tail.split(/\n  [a-z][\w-]*:/)[0];
  assert.match(job, /shellcheck -S warning \S*git ls-files/, 'должны проверяться все отслеживаемые .sh');
  assert.match(job, /working-directory: \./, 'workflow-дефолт game/ — нужен корень репозитория, иначе scripts/ не виден');
  // Linux-раннеры ubuntu-24.04 несут shellcheck 0.9.0; в этом файле нет
  // собственных disable-директив, которые могли бы спрятать предупреждение.
  const scripts = execSync("git ls-files '*.sh'", { cwd: path.join(here, '..', '..'), encoding: 'utf8' })
    .trim().split('\n');
  assert.ok(scripts.length >= 16, `ожидалось ≥16 скриптов, найдено ${scripts.length}`);
});

test('2026-10-02: high/critical audit parses Yarn severity bitmask and fails closed', () => {
  const ci = read('../../.github/workflows/ci.yml');
  assert.match(ci, /audit-blocking\.sh/, 'Yarn audit must use a bitmask-aware blocking gate');
  const gate = read('./audit-blocking.sh');
  assert.match(gate, /&\s*24/, 'high/critical bits (8|16) must be checked explicitly');
  assert.match(gate, /auditSummary/, 'no registry response (exit 2) must differ from findings (exit 1)');

  const dir = mkdtempSync(path.join(os.tmpdir(), 'audit-gate-'));
  const fake = path.join(dir, 'yarn');
  writeFileSync(fake, `#!/usr/bin/env bash
case "$FAKE_CASE" in
  clean) printf '{"type":"auditSummary","data":{"vulnerabilities":{"high":0,"critical":0,"total":0}}}\\n'; exit 0 ;;
  moderate) printf '{"type":"auditSummary","data":{"vulnerabilities":{"moderate":3,"high":0,"critical":0,"total":3}}}\\n'; exit 4 ;;
  high)
    cat <<'JSON'
{"type":"auditSummary","data":{"vulnerabilities":{"high":1,"critical":0,"total":1}}}
{"type":"auditAdvisory","data":{"resolution":{"id":1,"path":"a>b>node-fetch@3.3.0","dev":false,"optional":false,"bundled":false},"advisory":{"module_name":"node-fetch","severity":"high","title":"Header injection","url":"https://example.invalid/GHSA","findings":[{"version":"3.3.0","paths":["a>b>node-fetch@3.3.0"],"dev":false,"optional":false,"bundled":false}]}}}
JSON
    exit 8 ;;
  critical)
    cat <<'JSON'
{"type":"auditSummary","data":{"vulnerabilities":{"high":1,"critical":1,"total":7}}}
{"type":"auditAdvisory","data":{"resolution":{"id":2,"path":"a>b>protobufjs@7.4.0","dev":false,"optional":false,"bundled":false},"advisory":{"module_name":"protobufjs","severity":"critical","title":"RCE","url":"https://example.invalid/GHSA","findings":[{"version":"7.4.0","paths":["a>b>protobufjs@7.4.0"],"dev":false,"optional":false,"bundled":false}]}}}
JSON
    exit 30 ;;
  broken) echo 'error: registry unreachable'; exit 1 ;;
esac
`);
  chmodSync(fake, 0o755);
  const run = (fakeCase) =>
    spawnSync('bash', [path.join(here, 'audit-blocking.sh')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_CASE: fakeCase, AUDIT_BLOCKING_RETRY_SLEEP: '0' },
    });
  try {
    assert.equal(run('clean').status, 0, 'clean tree must pass');
    assert.equal(run('moderate').status, 0, 'moderate findings remain advisory');
    const high = run('high');
    assert.equal(high.status, 1, 'high finding must block');
    assert.match(high.stdout, /HIGH: node-fetch@3\.3\.0/, 'report must identify the high package and version');
    assert.match(high.stdout, /::error title=High or critical dependency advisory::HIGH:/, 'GitHub check annotation must carry the precise advisory');
    const critical = run('critical');
    assert.equal(critical.status, 1, 'critical finding must block');
    assert.match(critical.stdout, /CRITICAL: protobufjs@7\.4\.0/, 'report must identify the critical package and version');
    assert.equal(run('broken').status, 2, 'unavailable audit registry must fail closed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('2026-10-02: protobufjs не возвращается в уязвимый диапазон (F-09)', () => {
  const pkg = JSON.parse(read('../package.json'));
  const enforced = pkg.resolutions?.protobufjs;
  assert.ok(enforced, 'resolutions.protobufjs должен фиксировать безопасную версию');
  const [maj, min, patch] = enforced.split('.').map(Number);
  assert.ok(
    maj > 7 || (maj === 7 && (min > 6 || (min === 6 && patch >= 1))),
    `protobufjs ${enforced} всё ещё попадает в GHSA-wcpc-wj8m-hjx6 (<=7.6.0); нужен >=7.6.1`,
  );
  const lock = read('../yarn.lock');
  const entry = /^protobufjs@[^:]*:\n\s+version "([^"]+)"/m.exec(lock);
  assert.ok(entry, 'protobufjs не найден в yarn.lock');
  assert.equal(entry[1], enforced, 'lock и resolutions разошлись: критический advisory вернётся по lockfile');
});

test('2026-10-02: фиксирует production advisories в lodash, viem/ws и toml', () => {
  const pkg = JSON.parse(read('../package.json'));
  const lock = read('../yarn.lock');
  assert.equal(pkg.resolutions?.lodash, '4.18.1', 'GHSA-r5fr-rjxr-66jc требует lodash >=4.18.0; 4.18.0 отозван');
  assert.equal(pkg.resolutions?.['**/viem/ws'], '8.21.3', 'GHSA-96hv-2xvq-fx4p требует ws >=8.21.0');
  assert.equal(pkg.resolutions?.toml, '4.2.0', 'GHSA-82x6-q7mm-w9cf требует toml >=4.2.0');
  assert.equal(parseYarnEntry(lock, 'lodash@4.18.1')?.version, '4.18.1');
  assert.equal(parseYarnEntry(lock, 'ws@8.21.3')?.version, '8.21.3');
  assert.equal(parseYarnEntry(lock, 'toml@^3.0.0')?.version, '4.2.0');
  assert.doesNotMatch(lock, /^lodash@4\.17\.21:/m, 'уязвимый lodash lock-entry вернулся');
  assert.doesNotMatch(lock, /^lodash@4\.18\.0:/m, 'отозванный lodash 4.18.0 lock-entry вернулся');
  assert.doesNotMatch(lock, /^ws@8\.18\.0:/m, 'уязвимый ws lock-entry вернулся');
  assert.doesNotMatch(lock, /^toml@\^3\.0\.0:\n\s+version "3\.0\.0"/m, 'уязвимый toml lock-entry вернулся');
});

test('2026-10-02: рабочее дерево проходит secret-scan (гейт §1.1 не красный)', () => {
  // Поймано на себе: пример DSN с паролем в .env.example выглядит для сканера
  // ровно как утечка. Тот же сканер, что и в CI, запускается здесь как
  // подпроцесс — регрессия «документация положила credential-shaped строку»
  // ломает тест локально, а не только job в Actions.
  const repoRoot = path.join(here, '..', '..');
  const res = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'secret-scan.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `secret-scan.mjs вышел с кодом ${res.status}:\n${res.stdout}\n${res.stderr}`);
});
