#!/usr/bin/env node
/**
 * Курируемый мутационный прогон (security checklist items 52/53, отчёт 2026-09-27).
 *
 * Зачем: полный фреймворк мутационного тестирования (Stryker / cargo-mutants)
 * в проекте не подключён, а обычное покрытие строк ничего не говорит о том,
 * поймают ли тесты ошибку в константе или формуле. Этот скрипт вносит
 * заранее отобранные мутации в критичные места (цены, комиссии, множители,
 * защиты подписи, редактирование логов) и проверяет, что набор тестов падает.
 * Мутация, которая «выжила», — это дыра в тестах, а не в коде.
 *
 * Правила безопасности:
 *   - работает только на чистом рабочем дереве для изменяемого файла;
 *   - после каждой мутации файл восстанавливается из git (`git checkout --`);
 *   - проверка в конце: рабочее дерево вернулось в исходное состояние.
 *
 * Запуск:
 *   node scripts/mutation-probe.mjs            # все мутации, сводка + exit 1 при выживших
 *   node scripts/mutation-probe.mjs --list     # только список
 *   node scripts/mutation-probe.mjs --only 3   # одна мутация по id
 *   node scripts/mutation-probe.mjs --json     # машиночитаемый отчёт
 *
 * Ограничение: покрывает офчейн-слой (TS/JS). Ончейн-ядро
 * (`programs/solana_potato/src/lib.rs`) здесь не мутируется — для него нужен
 * `cargo-mutants` и Rust/Solana-тулчейн, см. docs/MUTATION_TESTING.md.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : null;
const asJson = args.includes('--json');
const list = args.includes('--list');

const CONST = 'apps/web/src/utils/constants.ts';
const MARKET = 'apps/web/src/utils/marketUnits.ts';
const TXSAFETY = 'apps/web/src/utils/txSafety.ts';
const SECURITY = 'apps/backend/src/security.ts';
const INVARIANTS = 'scripts/check-invariants.ts';

/** Тестовые команды, которые должны «убить» мутацию. */
const SUITES = {
  offchain: ['tsx', '--test', 'tests/offchain/*.test.ts'],
  guards: ['node', '--test', 'scripts/security-guards.test.mjs'],
  economy: ['python3', 'economy/simulate.py', '--check'],
};

const MUTATIONS = [
  // --- экономика: константы ---
  { id: 1, file: CONST, why: 'MICRO: 1 POTATO ≠ 1e6 атомов (все цены в микро)',
    find: 'export const MICRO = 1_000_000', replace: 'export const MICRO = 1_000' },
  { id: 2, file: CONST, why: 'штраф за неуплаченный налог (50% → 45%)',
    find: 'export const UNPAID_TAX_YIELD_BPS = 5_000', replace: 'export const UNPAID_TAX_YIELD_BPS = 4_500' },
  { id: 3, file: CONST, why: 'бонус удобрения (×1.5 → ×1.2)',
    find: 'export const FERTILIZER_YIELD_BPS = 15_000', replace: 'export const FERTILIZER_YIELD_BPS = 12_000' },
  { id: 4, file: CONST, why: 'доля сжигания комиссии рынка (60% → 50%)',
    find: 'export const FEE_BURN_PERCENT = 60', replace: 'export const FEE_BURN_PERCENT = 50' },
  { id: 5, file: CONST, why: 'минимальный интервал сбора (60 с → 30 с)',
    find: 'export const MIN_HARVEST_INTERVAL = 60', replace: 'export const MIN_HARVEST_INTERVAL = 30' },
  { id: 6, file: CONST, why: 'максимальный уровень поля (50 → 60)',
    find: 'export const MAX_FIELD_LEVEL = 50', replace: 'export const MAX_FIELD_LEVEL = 60' },
  { id: 7, file: CONST, why: 'цена лицензии экспорта (500 SKR → 50 SKR)',
    find: 'export const EXPORT_LICENSE_PRICE_SKR_ATOMS = 500_000_000n',
    replace: 'export const EXPORT_LICENSE_PRICE_SKR_ATOMS = 50_000_000n' },
  { id: 8, file: CONST, why: 'самый низкий тир комиссии рынка (9% → 8%)',
    find: 'if (amountMicro < 1_000 * MICRO) return 900', replace: 'if (amountMicro < 1_000 * MICRO) return 800' },
  { id: 9, file: CONST, why: 'самый высокий тир комиссии рынка (12% → 11%)',
    find: 'return 1_200                                    // >= 100k: 12%',
    replace: 'return 1_100                                    // >= 100k: 12%' },
  { id: 10, file: CONST, why: 'доходность редкого поля (×1.0 → ×1.2)',
    find: "{ id: 1, name: 'Rare', image: '/ares/cassette-rare.webp', yieldBps: 10_000, costBps: 10_000 }",
    replace: "{ id: 1, name: 'Rare', image: '/ares/cassette-rare.webp', yieldBps: 12_000, costBps: 10_000 }" },
  { id: 11, file: CONST, why: 'множитель уровня >5 (шаг 4000 → 3000 bps)',
    find: 'return 28_600 + (level - 5) * 4_000', replace: 'return 28_600 + (level - 5) * 3_000' },
  { id: 12, file: CONST, why: 'влияние целостности (80 bps → 70 bps за пункт)',
    find: 'return 2_000 + Math.min(durability, MAX_DURABILITY) * 80',
    replace: 'return 2_000 + Math.min(durability, MAX_DURABILITY) * 70' },
  { id: 13, file: CONST, why: 'порог кнопки сбора (0.1 → 0.2 POTATO)',
    find: 'export const HARVEST_THRESHOLD_MICRO = 100_000', replace: 'export const HARVEST_THRESHOLD_MICRO = 200_000' },
  { id: 14, file: CONST, why: 'лунный множитель в новолуние (1.0 → 1.05)',
    find: ' 10_000, 10_334, 10_651, 10_935', replace: ' 10_500, 10_334, 10_651, 10_935' },
  { id: 15, file: CONST, why: 'формула налога: округление уровня (÷2 → ÷3)',
    find: 'scaledCostMicro(BASE_COST_MICRO.tax, fieldType) * Math.floor((level + 1) / 2)',
    replace: 'scaledCostMicro(BASE_COST_MICRO.tax, fieldType) * Math.floor((level + 1) / 3)' },
  { id: 16, file: CONST, why: 'формула ремонта: округление уровня (÷3 → ÷4)',
    find: 'scaledCostMicro(BASE_COST_MICRO.repair, fieldType) * Math.max(Math.floor(level / 3), 1)',
    replace: 'scaledCostMicro(BASE_COST_MICRO.repair, fieldType) * Math.max(Math.floor(level / 4), 1)' },

  // --- единицы рынка ---
  { id: 17, file: MARKET, why: 'минимальная сумма ордера в SOL (0.001 → 0.0001)',
    find: 'export const MARKET_MIN_TOTAL_LAMPORTS = 1_000_000', replace: 'export const MARKET_MIN_TOTAL_LAMPORTS = 100_000' },
  { id: 18, file: MARKET, why: 'перевод lamports → SOL (деление → умножение)',
    find: 'Number(value) / LAMPORTS_PER_SOL', replace: 'Number(value) * LAMPORTS_PER_SOL' },
  { id: 19, file: MARKET, why: 'итог ордера: 6 знаков → 3 знака',
    find: 'const total = amountMicro * priceLamports / 1_000_000n',
    replace: 'const total = amountMicro * priceLamports / 1_000n' },

  // --- клиентские защиты подписи ---
  { id: 20, file: TXSAFETY, why: 'allowlist программ: разрешить всё',
    find: 'return ALLOWED_PROGRAMS.some(allowed => allowed.equals(programId))', replace: 'return true' },
  { id: 21, file: TXSAFETY, why: 'не сверять payload подписанной legacy-транзакции',
    find: 'if (!Buffer.from(ix.data).equals(Buffer.from(expected[i].data))) {', replace: 'if (false) {' },
  { id: 22, file: TXSAFETY, why: 'не сверять payload versioned-транзакции',
    find: 'if (!Buffer.from(ci.data).equals(Buffer.from(expected[i].data))) {', replace: 'if (false) {' },
  { id: 23, file: TXSAFETY, why: 'разрешить program id через lookup table',
    find: 'if (ci.programIdIndex >= statics.length) {', replace: 'if (false) {' },
  { id: 24, file: TXSAFETY, why: 'не проверять число инструкций',
    find: 'if (actual.length !== expected.length) {', replace: 'if (false) {' },

  // --- бэкенд ---
  { id: 25, file: SECURITY, why: 'выделенный payer: отключить проверку ролей',
    find: 'if ([config.authority, config.pendingAuthority, config.rewardSigner].some(key => key.equals(payer))) {',
    replace: 'if (false) {' },
  { id: 26, file: SECURITY, why: 'редактирование ключей в логах отключено',
    find: '.replace(/((?:api[-_]?key|token|secret|password)\\s*[=:]\\s*)[^\\s&,;]+/gi, "$1[REDACTED]")',
    replace: '.replace(/NEVER_MATCHES/, "$1[REDACTED]")' },
  { id: 27, file: SECURITY, why: 'редактирование keypair-массивов в логах ослаблено',
    find: '\\[(?:\\s*\\d{1,3}\\s*,){31,}\\s*\\d{1,3}\\s*\\]', replace: '\\[(?:\\s*\\d{1,3}\\s*,){99,}\\s*\\d{1,3}\\s*\\]' },

  // --- инварианты монитора ---
  { id: 28, file: INVARIANTS, why: 'supply ≤ max_supply (строгое ≤ → <)',
    find: 'input.supply <= input.maxSupplyMicro', replace: 'input.supply < input.maxSupplyMicro' },
  { id: 29, file: INVARIANTS, why: 'казна внутри supply (≤ → <)',
    find: 'input.treasuryBalanceMicro + input.questPoolBalanceMicro <= input.supply',
    replace: 'input.treasuryBalanceMicro + input.questPoolBalanceMicro < input.supply' },
  { id: 30, file: INVARIANTS, why: 'mint authority = config PDA (отключить проверку)',
    find: '!!input.mintAuthority && input.mintAuthority.equals(input.configPda)', replace: 'true' },
];

function git(...cmd) {
  return execFileSync('git', cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function assertClean(file) {
  const dirty = git('status', '--porcelain', '--', file);
  if (dirty) throw new Error(`Отказ: ${file} имеет незакоммиченные изменения — мутировать небезопасно`);
}

function applyMutation(m) {
  const abs = path.join(ROOT, m.file);
  const source = readFileSync(abs, 'utf8');
  const occurrences = source.split(m.find).length - 1;
  if (occurrences !== 1) throw new Error(`Отказ: шаблон мутации #${m.id} найден ${occurrences} раз в ${m.file}`);
  execFileSync('git', ['checkout', '--', m.file], { cwd: ROOT });
  const mutated = source.replace(m.find, m.replace);
  execFileSync('node', ['-e', 'require("fs").writeFileSync(process.argv[1], process.argv[2])', abs, mutated], { cwd: ROOT });
}

function restore(file) {
  execFileSync('git', ['checkout', '--', file], { cwd: ROOT });
}

function runSuite(name) {
  const [cmd, ...rest] = SUITES[name];
  // shell нужен для раскрытия glob'а tests/offchain/*.test.ts (как в yarn-скрипте).
  // PATH: локальные бинарники game/node_modules/.bin (tsx ставится воркспейсом).
  const env = { ...process.env, PATH: `${ROOT}/node_modules/.bin:${process.env.PATH ?? ''}` };
  const result = spawnSync([cmd, ...rest].join(' '), { cwd: ROOT, encoding: 'utf8', timeout: 300_000, shell: true, env });
  return { code: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const selected = only ? MUTATIONS.filter(m => m.id === only) : MUTATIONS;
if (only && selected.length === 0) {
  console.error(`Нет мутации с id=${only}`);
  process.exit(2);
}
if (args.includes('--verify')) {
  let bad = 0;
  for (const m of selected) {
    const source = readFileSync(path.join(ROOT, m.file), 'utf8');
    const n = source.split(m.find).length - 1;
    if (n !== 1) { bad += 1; console.log(`ПРОБЛЕМА #${m.id} ${m.file}: шаблон найден ${n} раз`); }
  }
  console.log(bad ? `проблемных шаблонов: ${bad}` : `все ${selected.length} шаблонов уникальны`);
  process.exit(bad ? 1 : 0);
}
if (list) {
  for (const m of selected) console.log(`#${m.id} ${m.file} — ${m.why}`);
  process.exit(0);
}

// Базовая линия: без мутаций все выбранные наборы тестов обязаны быть зелёными.
for (const suite of ['offchain', 'guards', 'economy']) {
  const baseline = runSuite(suite);
  if (baseline.code !== 0) {
    console.error(`Отказ: набор "${suite}" не зелёный до мутаций — прогон бессмысленен.\n${baseline.output.slice(-1500)}`);
    process.exit(2);
  }
}

const results = [];
let dirtyAtExit = false;
try {
  for (const m of selected) {
    assertClean(m.file);
    applyMutation(m);
    const suites = Object.keys(SUITES).map(name => ({ name, ...runSuite(name) }));
    // Мутация убита, если упал ХОТЯ БЫ один набор. missedBy — те наборы,
    // которые дефект не заметили (информативнее для расширения тестов).
    const missedBy = suites.filter(s => s.code === 0).map(s => s.name);
    const killed = missedBy.length < suites.length;
    results.push({ id: m.id, file: m.file, why: m.why, killed, missedBy });
    if (!asJson) {
      const verdict = killed ? `УБИТА (мимо: ${missedBy.join(', ') || '—'})` : 'ВЫЖИЛА';
      console.log(`#${String(m.id).padStart(2)} ${verdict.padEnd(34)} ${m.file} — ${m.why}`);
    }
    // Откат сразу после мутации: следующая мутация того же файла обязана
    // начинаться с чистого исходника, а не с предыдущей правки.
    restore(m.file);
  }
} finally {
  for (const file of new Set(selected.map(m => m.file))) {
    restore(file);
    if (git('status', '--porcelain', '--', file)) dirtyAtExit = true;
  }
}

const killed = results.filter(r => r.killed).length;
const survived = results.filter(r => !r.killed);
const score = results.length ? Math.round((killed / results.length) * 1000) / 10 : 0;

if (asJson) {
  console.log(JSON.stringify({ total: results.length, killed, survived: survived.length, mutationScore: score, dirtyAtExit, results }, null, 2));
} else {
  console.log('');
  console.log(`Мутационный счёт: ${score}% (${killed}/${results.length} убито)`);
  if (survived.length) {
    console.log('Выжившие мутации — пробелы в тестах:');
    for (const s of survived) console.log(`  #${s.id} ${s.file} — ${s.why} (не поймал: ${s.survivedIn.join(', ')})`);
  }
  if (dirtyAtExit) console.log('ВНИМАНИЕ: рабочее дерево не восстановлено — проверь git status');
}
process.exit(survived.length === 0 && !dirtyAtExit ? 0 : 1);
