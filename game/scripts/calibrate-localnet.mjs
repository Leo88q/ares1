#!/usr/bin/env node
/**
 * calibrate-localnet — проверка модели §5 (reports/rent-audit/) на живом
 * `solana-test-validator`. Модель считается верной, если залог аккаунтов
 * loader-v3 совпадает С ТОЧНОСТЬЮ ДО ЛАМПОРТА (СТОП-условие 3):
 *
 *   первый деплой:  space(ProgramData) = 45 + max_len, lamports = rent(45 + max_len);
 *                   lamports(Program) = rent(36);
 *   рост:           `extend` доводит space до текущего + additional, lamports = rent(space);
 *                   финальный `deploy` платит ровно rent(45 + max_len).
 *
 * Транзакции здесь — ТОЛЬКО localnet (R2: одноразовые ключи на
 * solana-test-validator). Скрипт отказывается работать с не-local RPC.
 * Комиссии измеряются отдельно и входят в бюджет как оценка сверху: модель
 * обязана их не занижать (measured ≤ model), иначе бюджет неполон.
 *
 * Запуск (в CI — job «Rent audit: calibrate localnet»):
 *   node scripts/calibrate-localnet.mjs --so target/deploy/solana_potato.so [--out report.json]
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
    else if (key === '--rpc') args.rpc = argv[++i];
    else if (key === '--growth') args.growth = BigInt(argv[++i]);
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
  const growth = args.growth ?? CONSTANTS.MIN_EXTEND;

  if (!LOCAL_HOSTS.has(new URL(rpc).hostname)) {
    throw new Error(`калибровка разрешена только на localnet, получен RPC ${rpc} (R2)`);
  }
  const soLen = BigInt(readFileSync(soPath).length);
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
  const deployArgs = (maxLen) => [
    'program', 'deploy', '--url', rpc, '--keypair', payerKeypair, '--program-id', programKeypair,
    '--max-len', maxLen.toString(), '--max-sign-attempts', '60', '--use-rpc', soPath,
  ];
  const deploy = (maxLen, { attempts = 3 } = {}) => {
    let last = { ok: false, stdout: '', stderr: 'попыток не было', detail: 'попыток не было', code: null };
    let attempt = 0;
    for (attempt = 1; attempt <= attempts; attempt++) {
      last = sh('solana', deployArgs(maxLen), { allowFailure: true });
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
  const deploy1 = deploy(soLen);
  if (!deploy1.ok) {
    throw new Error(`деплой .so (${soLen} Б) не прошёл за ${deploy1.attempt} попыт(ок): ${safeDiagnostic(deploy1.detail ?? `${deploy1.stderr}\n${deploy1.stdout}`, 2500)}`);
  }
  const state1 = await readProgram(rpc, programId);
  const modelFees = computeFees(soLen, {});
  const locked = rent(CONSTANTS.PROGRAMDATA_META + soLen) + rent(CONSTANTS.PROGRAM_ACC);
  const spent1 = before1 - (await fetchBalance(rpc, payer));
  for (const check of checkDeploy({
    maxLen: soLen,
    pdSpace: state1.space,
    pdLamports: state1.pd.lamports,
    programLamports: state1.programLamports,
    rent,
  })) checks.push(row(check.name, check.measured, check.expected));
  steps.push({ step: 'new', attempt: deploy1.attempt, maxLen: soLen, programData: state1.pd.programDataAddress, spent: spent1 });

  // ── Шаг 2: попытка роста без extend (активна ли SIMD-0433 на кластере) ────
  const maxLen2 = soLen + growth;
  const growAttempt = deploy(maxLen2, { attempts: 1 });
  let autoExtended = false;
  if (growAttempt.ok) {
    const state2 = await readProgram(rpc, programId);
    autoExtended = state2.space >= CONSTANTS.PROGRAMDATA_META + maxLen2;
    notes.push(`рост без extend: команда прошла, space=${state2.space.toString()}${autoExtended ? ' (SIMD-0433 расширил сам)' : ''}`);
  } else {
    notes.push(`рост без extend: команда отклонена — ${safeDiagnostic(`${growAttempt.stderr}\n${growAttempt.stdout}`)}`);
  }
  steps.push({ step: 'grow-attempt', maxLen: maxLen2, ok: growAttempt.ok, autoExtended, error: safeDiagnostic(`${growAttempt.stderr}\n${growAttempt.stdout}`) });

  // ── Шаг 3: явный extend и финальный деплой с новым max_len ────────────────
  let extend = null;
  let final = null;
  if (!autoExtended) {
    const before = await readProgram(rpc, programId);
    const extendRun = sh('solana', ['program', 'extend', programId, growth.toString(), '--url', rpc, '--keypair', payerKeypair], { allowFailure: true });
    const after = await readProgram(rpc, programId);
    if (!extendRun.ok && after.space === before.space) {
      extend = { ok: false, error: safeDiagnostic(`${extendRun.stderr}\n${extendRun.stdout}`) };
      notes.push('extend не выполнился — продолжать апгрейд нельзя');
    } else {
      extend = { ok: true, spaceBefore: before.space, spaceAfter: after.space };
      for (const check of checkExtend({ spaceBefore: before.space, additional: growth, spaceAfter: after.space, lamportsAfter: after.pd.lamports, rent })) {
        checks.push(row(check.name, check.measured, check.expected));
      }
    }
    steps.push({ step: 'extend', additional: growth, ...extend });
  } else {
    notes.push('extend пропущен: кластер сам расширил ProgramData (SIMD-0433)');
  }

  if (autoExtended || extend?.ok) {
    const before4 = await fetchBalance(rpc, payer);
    const deploy4 = deploy(maxLen2);
    const state4 = await readProgram(rpc, programId);
    const spent4 = before4 - (await fetchBalance(rpc, payer));
    final = { ok: deploy4.ok, spent: spent4 };
    for (const check of checkDeploy({
      maxLen: maxLen2,
      pdSpace: state4.space,
      pdLamports: state4.pd.lamports,
      programLamports: state4.programLamports,
      rent,
    })) checks.push(row(`final_${check.name}`, check.measured, check.expected));
    steps.push({ step: 'final-deploy', maxLen: maxLen2, ...final, error: safeDiagnostic(`${deploy4.stderr}\n${deploy4.stdout}`) });
  }

  // ── Комиссии: модель обязана их не занижать ───────────────────────────────
  const measuredFees = spent1 - locked;
  const modelCoversFees = measuredFees >= 0n && measuredFees <= modelFees;

  const { ok: locksOk, failed } = verdict(checks);
  const stepProblems = [];
  if (!modelCoversFees) stepProblems.push('fees_underestimated');
  if (extend !== null && !extend.ok && !autoExtended) stepProblems.push('extend_failed');
  if (final !== null && !final.ok) stepProblems.push('final_deploy_failed');
  const pass = locksOk && stepProblems.length === 0;
  const payload = {
    rpc,
    rate,
    rent0,
    soLen,
    growth,
    payerBalanceBeforeDeploy: startBalance,
    programId,
    programData: state1.pd.programDataAddress,
    authority: state1.pd.authority,
    checks,
    pass,
    fees: { measured: measuredFees, model: modelFees, modelCovers: modelCoversFees },
    autoExtended,
    notes,
    steps,
  };
  console.log(`::notice title=ares-calibrate::${JSON.stringify({ ...payload, steps: undefined }, jsonReplacer)}`);
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
