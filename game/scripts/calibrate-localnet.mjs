#!/usr/bin/env node
/**
 * calibrate-localnet — проверка модели §5 (reports/rent-audit/) на живом
 * `solana-test-validator`. Модель считается верной, если залог аккаунтов
 * loader-v3 совпадает С ТОЧНОСТЬЮ ДО ЛАМПОРТА (СТОП-условие 3):
 *
 *   первый деплой:  space(ProgramData) = 45 + max_len, lamports = rent(45 + max_len);
 *                   lamports(Program) = rent(36);
 *   апгрейд:        без extend новый размер не влезает (AccountDataTooSmall);
 *                   `extend` доводит space ровно до 45 + len(.so), lamports = rent(space);
 *                   финальный `deploy` не меняет ни space, ни залог.
 *
 * Проверяется на ДВУХ артефактах: `--so` (маленький, им же делается первый
 * деплой) и `--so2` (большой — апгрейд требует extend). Иначе рост не проверить:
 * на CLI 4.2.2 `--max-len` больше текущего ProgramData сам deploy не расширяет.
 *
 * Транзакции здесь — ТОЛЬКО localnet (R2: одноразовые ключи на
 * solana-test-validator). Скрипт отказывается работать с не-local RPC.
 * Комиссии измеряются отдельно и входят в бюджет как оценка сверху: модель
 * обязана их не занижать (measured ≤ model), иначе бюджет неполон.
 *
 * Запуск (в CI — job «Rent audit: calibrate localnet»):
 *   node scripts/calibrate-localnet.mjs --so target-small/solana_potato.so \
 *     --so2 target/deploy/solana_potato.so [--out report.json]
 *
 * Коды выхода: 0 — совпало; 2 — расхождение/ошибка измерения.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONSTANTS,
  computeFees,
  fetchBalance,
  fetchProgramState,
  fetchRate,
  rpcCall,
} from './deploy-budget.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
// Ход калибровки и заметки: их читает и `main()`, и верхнеуровневый `catch`
// (аннотация — единственный канал наружу из CI, R10).
const notes = [];
const steps = [];

/** Проверки залога деплоя: замер против модели (детерминированно, §5.1/§5.2). */
export function checkDeploy({ maxLen, pdSpace, pdLamports, programLamports, rent }) {
  return [
    { name: 'programdata_space', measured: pdSpace, expected: CONSTANTS.PROGRAMDATA_META + maxLen },
    { name: 'programdata_lamports', measured: pdLamports, expected: rent(CONSTANTS.PROGRAMDATA_META + maxLen) },
    { name: 'program_lamports', measured: programLamports, expected: rent(CONSTANTS.PROGRAM_ACC) },
  ].map((check) => ({ ...check, delta: check.measured - check.expected }));
}

/** Проверки шага `extend`: space растёт ровно на additional, lamports = rent(space). */
export function checkExtend({ spaceBefore, additional, spaceAfter, lamportsAfter, rent }) {
  return [
    { name: 'extend_space', measured: spaceAfter, expected: spaceBefore + additional },
    { name: 'extend_lamports', measured: lamportsAfter, expected: rent(spaceAfter) },
  ].map((check) => ({ ...check, delta: check.measured - check.expected }));
}

/** Свод: калибровка пройдена, если все дельты ровно нулевые. */
export function verdict(checks) {
  const failed = checks.filter((check) => check.delta !== 0n);
  return { ok: failed.length === 0, failed };
}

function sh(command, args, { allowFailure = false, input } = {}) {
  // Сборка/деплой ~1 МБ печатает прогресс по строке на транзакцию: дефолтный
  // maxBuffer (1 МиБ) переполняется и убивает дочерний процесс с пустой
  // диагностикой — увеличиваем буфер и всегда отдаём причину.
  const options = {
    encoding: 'utf8',
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
    input,
  };
  try {
    const stdout = execFileSync(command, args, options);
    return { ok: true, stdout, stderr: '' };
  } catch (error) {
    const detail = `${error.stderr ?? ''}\n${error.stdout ?? ''}\n${error.message ?? ''}`.trim();
    if (!allowFailure) throw new Error(`${command} ${args.join(' ')}: ${safeDiagnostic(detail)}`);
    return { ok: false, stdout: error.stdout ?? '', stderr: error.stderr ?? '', message: error.message ?? '', signal: error.signal ?? null, code: error.status ?? null, detail };
  }
}

/**
 * Диагностика CLI без секретов: блок восстановления буфера (`Recover the
 * intermediate account…`, 12 слов seed-фразы) в аннотации не попадает (R11) —
 * берём только первые безопасные строки ошибки.
 */
export function safeDiagnostic(text, limit = 400) {
  // Строки блока восстановления ВЫБРАСЫВАЕМ, а не обрываем на них вывод: CLI
  // печатает причину сбоя до блока, и обрыв прятал диагностику (см. коммиты
  // «диагностика пуста» в reports/rent-audit/00-baseline.md).
  const lines = String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^=+$/.test(line))
    .filter((line) => !/recover the intermediate|seed phrase|buffer_signer/i.test(line))
    .filter((line) => !/^[a-z]{3,8}( [a-z]{3,8}){11}$/.test(line) && !/\b[a-z]{3,8}(?: [a-z]{3,8}){11,}\b/.test(line));
  const kept = [];
  let used = 0;
  for (const line of lines) {
    kept.push(line);
    used += line.length;
    if (kept.length >= 12 || used >= limit) break;
  }
  const joined = kept.join(' | ') || 'диагностика пуста';
  // Страховка: любая последовательность из 12+ слов подряд — потенциальная
  // seed-фраза буфера, в аннотацию она не попадает.
  return joined.replace(/\b[a-z]{3,8}(?: [a-z]{3,8}){11,}\b/g, '[seed-фраза скрыта]').slice(0, limit);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--so') args.so = argv[++i];
    else if (key === '--so2') args.so2 = argv[++i];
    else if (key === '--rpc') args.rpc = argv[++i];
    else if (key === '--out') args.out = argv[++i];
    else throw new Error(`Неизвестный аргумент: ${key}`);
  }
  return args;
}

/** BigInt → строка только при печати: сравнения и вердикт остаются целыми. */
const jsonReplacer = (key, value) => (typeof value === 'bigint' ? value.toString() : value);
const row = (name, measured, expected) => ({ name, measured, expected, delta: measured - expected });

async function readProgram(rpc, programId) {
  // Чтение может опережать видимость аккаунта в finalized-состоянии сразу
  // после деплоя — ждём (до ~15 с), а не падаем с «не найден».
  for (let attempt = 1; attempt <= 10; attempt++) {
    const [program, pd] = await Promise.all([
      rpcCall(rpc, 'getAccountInfo', [programId, { encoding: 'base64', dataSlice: { offset: 0, length: 36 } }]),
      fetchProgramState(rpc, programId),
    ]);
    if (program?.value) {
      return { programLamports: BigInt(program.value.lamports), pd, space: pd.dataLen + CONSTANTS.PROGRAMDATA_META };
    }
    if (attempt < 10) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('program-аккаунт не найден после 10 попыток чтения (деплой не состоялся?)');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rpc = args.rpc ?? process.env.LOCALNET_RPC ?? 'http://127.0.0.1:8899';
  const soPath = args.so ?? 'target/deploy/solana_potato.so';

  if (!LOCAL_HOSTS.has(new URL(rpc).hostname)) {
    throw new Error(`калибровка разрешена только на localnet, получен RPC ${rpc} (R2)`);
  }
  const soLen = BigInt(readFileSync(soPath).length);
  const so2Path = args.so2 ?? soPath;
  const soLen2 = BigInt(readFileSync(so2Path).length);
  if (soLen2 < soLen) {
    throw new Error(`--so2 (${soLen2} Б) меньше --so (${soLen} Б): апгрейд «на уменьшение» не проверяет extend`);
  }
  const workdir = mkdtempSync(path.join(os.tmpdir(), 'ares-calibrate-'));
  const payerKeypair = path.join(workdir, 'payer.json');
  const programKeypair = path.join(workdir, 'program.json');

  const { rate, rent0 } = await fetchRate(rpc);
  const rent = (n) => rent0 + rate * n; // rent(0) уже включает 128 байт оверхеда
  const checks = [];

  sh('solana-keygen', ['new', '--no-bip39-passphrase', '--silent', '-o', payerKeypair]);
  sh('solana-keygen', ['new', '--no-bip39-passphrase', '--silent', '-o', programKeypair]);
  const payer = sh('solana-keygen', ['pubkey', payerKeypair]).stdout.trim();
  const programId = sh('solana-keygen', ['pubkey', programKeypair]).stdout.trim();
  // Некоторые валидаторы ограничивают разовый airdrop — просим по 2 SOL и
  // проверяем, что баланс действительно вырос (иначе деплой упадёт мгновенно).
  // Разовый airdrop ограничен (и провайдером, и валидатором): просим по 1 SOL,
  // цель — 40 SOL, но жёстко требуем лишь залог деплоя + запас на повтор.
  const airdropTarget = 40n * 1_000_000_000n;
  const required = rent(CONSTANTS.PROGRAMDATA_META + soLen) + rent(CONSTANTS.PROGRAM_ACC) + 1_000_000_000n;
  let airdropError = null;
  for (let i = 0; i < 60; i++) {
    if ((await fetchBalance(rpc, payer)) >= airdropTarget) break;
    const run = sh('solana', ['airdrop', '1', payer, '--url', rpc], { allowFailure: true });
    if (!run.ok) {
      airdropError = safeDiagnostic(run.detail ?? `${run.stderr}\n${run.stdout}`);
      break;
    }
  }
  const startBalance = await fetchBalance(rpc, payer);
  if (startBalance < required) {
    throw new Error(`airdrop не пополнил плательщика: баланс ${startBalance} < требуемого ${required} лампортов${airdropError ? `, ошибка: ${airdropError}` : ''}`);
  }
  notes.push(`плательщик: стартовый баланс ${startBalance} лампортов (залог деплоя ${required})`);
  // Буфер создаёт сам CLI (эфемерный ключ), как в обычном `program deploy`.
  // Попытка `--buffer <свой ключ>` в CI 4.2.2 детерминированно упиралась в
  // `invalid account data` на create/final — см. reports/rent-audit/00-baseline.md.
  // Ретраи — свежими попытками (каждая создаёт свой буфер), пока хватает баланса.
  const deployArgs = (so, maxLen, extra) => [
    'program', 'deploy', '--url', rpc, '--keypair', payerKeypair, '--program-id', programKeypair,
    '--max-len', maxLen.toString(), '--max-sign-attempts', '60', '--use-rpc', ...extra, so,
  ];
  const deploy = (so, maxLen, { attempts = 3, extra = [] } = {}) => {
    let last = { ok: false, stdout: '', stderr: 'попыток не было', detail: 'попыток не было', code: null };
    let attempt = 0;
    for (attempt = 1; attempt <= attempts; attempt++) {
      last = sh('solana', deployArgs(so, maxLen, extra), { allowFailure: true });
      if (last.ok) return { ...last, attempt };
      const raw = `${last.stderr ?? ''}${last.stdout ?? ''}`;
      const detail = safeDiagnostic(last.detail ?? raw, 2500);
      notes.push(`деплой: попытка ${attempt} не прошла (код ${last.code}, вывод ${raw.length} Б): ${detail}`);
      if (attempt === attempts) break;
      const words = `${last.stderr}\n${last.stdout}`
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /^[a-z]{3,8}( [a-z]{3,8}){11}$/.test(line));
      if (words) notes.push('CLI напечатал seed-фразу буфера (не сохраняем, R11) — попытка заново');
    }
    return { ...last, attempt };
  };

  // ── Шаг 1: первый деплой, max_len = размер .so ─────────────────────────────
  const before1 = await fetchBalance(rpc, payer);
  const deploy1 = deploy(soPath, soLen);
  if (!deploy1.ok) {
    throw new Error(`деплой .so (${soLen} Б) не прошёл за ${deploy1.attempt} попыт(ок): ${safeDiagnostic(deploy1.detail ?? `${deploy1.stderr}\n${deploy1.stdout}`, 2500)}`);
  }
  const state1 = await readProgram(rpc, programId);
  for (const check of checkDeploy({
    maxLen: soLen,
    pdSpace: state1.space,
    pdLamports: state1.pd.lamports,
    programLamports: state1.programLamports,
    rent,
  })) checks.push(row(check.name, check.measured, check.expected));
  steps.push({ step: 'new', attempt: deploy1.attempt, soLen, maxLen: soLen, programData: state1.pd.programDataAddress });
  notes.push(`первый деплой: space=${state1.space} lamports=${state1.pd.lamports}`);

  // ── Шаг 2: апгрейд на больший .so БЕЗ extend (`--no-auto-extend`) ──────────
  // Модель §5 утверждает: если новый размер не влезает в текущий ProgramData,
  // апгрейд обязан упереться в AccountDataTooSmall. Проверяем это как негатив.
  const fitsInCurrent = state1.space >= CONSTANTS.PROGRAMDATA_META + soLen2;
  const deploy2 = deploy(so2Path, soLen2, { attempts: 1, extra: ['--no-auto-extend'] });
  const state2 = await readProgram(rpc, programId);
  steps.push({
    step: 'upgrade-no-extend',
    ok: deploy2.ok,
    fitsInCurrent,
    error: safeDiagnostic(deploy2.detail ?? `${deploy2.stderr}\n${deploy2.stdout}`, 2000),
  });
  if (!fitsInCurrent && deploy2.ok) {
    checks.push(row('upgrade_without_extend_must_fail', 1n, 0n));
    notes.push('апгрейд без extend прошёл, хотя места не хватало — модель §5 опровергнута');
  } else if (!fitsInCurrent) {
    notes.push('апгрейд без extend отклонён — как и требует модель §5');
  }

  // ── Шаг 3: явный extend ровно на недостающее (модель §5.3) ─────────────────
  const needed = CONSTANTS.PROGRAMDATA_META + soLen2 - state2.space; // сколько не хватает до 45 + soLen2
  let extend = null;
  if (needed > 0n) {
    const before3 = await readProgram(rpc, programId);
    const extendRun = sh('solana', ['program', 'extend', programId, needed.toString(), '--url', rpc, '--keypair', payerKeypair], { allowFailure: true });
    const after3 = await readProgram(rpc, programId);
    extend = {
      additional: needed,
      ok: extendRun.ok,
      spaceBefore: before3.space,
      spaceAfter: after3.space,
      error: extendRun.ok ? null : safeDiagnostic(`${extendRun.stderr}\n${extendRun.stdout}`, 2000),
    };
    if (extendRun.ok) {
      for (const check of checkExtend({ spaceBefore: before3.space, additional: needed, spaceAfter: after3.space, lamportsAfter: after3.pd.lamports, rent })) {
        checks.push(row(check.name, check.measured, check.expected));
      }
    } else {
      checks.push(row('extend_command_failed', 1n, 0n));
    }
    steps.push({ step: 'extend', additional: needed, ok: extend.ok, spaceAfter: extend.spaceAfter });
  } else {
    notes.push('extend не нужен: ProgramData уже вмещает новый размер (модель §5.3)');
  }

  // ── Шаг 4: апгрейд с auto-extend на новый .so ─────────────────────────────
  const before4 = await fetchBalance(rpc, payer);
  const deploy4 = deploy(so2Path, soLen2);
  const state4 = await readProgram(rpc, programId);
  const expectedSpace = CONSTANTS.PROGRAMDATA_META + soLen2;
  for (const check of [
    { name: 'final_programdata_space', measured: state4.space, expected: expectedSpace },
    { name: 'final_programdata_lamports', measured: state4.pd.lamports, expected: rent(expectedSpace) },
    { name: 'final_program_lamports', measured: state4.programLamports, expected: rent(CONSTANTS.PROGRAM_ACC) },
  ]) checks.push(row(check.name, check.measured, check.expected));
  steps.push({
    step: 'upgrade',
    ok: deploy4.ok,
    attempt: deploy4.attempt,
    soLen: soLen2,
    maxLen: soLen2,
    error: safeDiagnostic(deploy4.detail ?? `${deploy4.stderr}\n${deploy4.stdout}`, 2000),
  });
  notes.push(`апгрейд: space=${state4.space}, lamports=${state4.pd.lamports}, deploy.ok=${deploy4.ok}`);

  // ── Комиссии: модель обязана не занижать расход всего потока ──────────────
  // Поток = деплой + неудачная попытка апгрейда + extend + апгрейд. Модель
  // оценивает стоимость одной операции, поэтому сверяем с её запасом на три операции.
  const spentTotal = before1 - (await fetchBalance(rpc, payer));
  const lockedFinal = state4.pd.lamports + state4.programLamports;
  // Из общего расхода вычитаем залог (он остаётся на аккаунтах, не «сгорает»).
  const feesMeasured = spentTotal - lockedFinal;
  const modelFees = computeFees(soLen2, {}) * 3n + computeFees(soLen, {});
  // null — расход не сошёлся с залогом (баланс двигался помимо наших шагов):
  // честно помечаем «не измерено», а не подгоняем вердикт.
  const feesWithinModel = feesMeasured >= 0n ? feesMeasured <= modelFees : null;

  const { ok: locksOk, failed } = verdict(checks);
  const stepProblems = [];
  if (feesWithinModel === false) stepProblems.push('fees_underestimated');
  if (feesWithinModel === null) notes.push('комиссии не измерены: расход не сошёлся с залогом (баланс двигался вне шагов)');
  if (extend !== null && !extend.ok) stepProblems.push('extend_failed');
  if (!deploy4.ok) stepProblems.push('upgrade_failed');
  const pass = locksOk && stepProblems.length === 0;
  const payload = {
    rpc,
    rate,
    rent0,
    soLen,
    soLen2,
    payerBalanceBeforeDeploy: startBalance,
    programId,
    programData: state1.pd.programDataAddress,
    authority: state1.pd.authority,
    checks,
    pass,
    fees: { measured: feesMeasured, lockedFinal, modelAllowance: modelFees, modelCovers: feesWithinModel },
    extend,
    notes,
    steps,
  };
  console.log(`::notice title=ares-calibrate::${JSON.stringify(payload, jsonReplacer)}`);
  console.log(JSON.stringify(payload, jsonReplacer, 2));
  if (args.out) writeFileSync(args.out, JSON.stringify(payload, jsonReplacer, 2));
  if (!pass) {
    // Расхождение чеков тоже обязано быть видно аннотацией: логи джоб недоступны.
    const problems = [...failed.map((check) => check.name), ...stepProblems];
    const detail = [
      ...failed.map((check) => `${check.name}: ${check.measured} vs ${check.expected} (Δ${check.delta})`),
      ...stepProblems,
      `steps: ${steps.map((step) => `${step.step}${step.ok === undefined ? '' : `=${step.ok}`}${step.attempt ? `#${step.attempt}` : ''}${step.error ? ` (${step.error})` : ''}`).join('; ')}`,
      `notes: ${notes.join(' | ')}`,
    ].join(' | ');
    console.log(`::error title=ares-calibrate-error::${safeDiagnostic(detail, 900).replace(/[\r\n]+/g, ' ')}`);
    console.error(`calibrate-localnet: РАСХОЖДЕНИЕ: ${problems.join(', ')}`);
    process.exit(2);
  }
  return 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      // Аннотация — единственный канал наружу из CI: логи джоб недоступны.
      const context = notes.length > 0 ? ` | ход: ${notes.join(' | ')}` : '';
      const message = `${String(error.message)}${context}`;
      console.log(`::error title=ares-calibrate-error::${safeDiagnostic(message, 3000).replace(/[\r\n]+/g, ' ')}`);
      console.error(`calibrate-localnet: ошибка: ${error.message}`);
      process.exit(2);
    });
}
