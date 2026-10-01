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

function sh(command, args, { allowFailure = false } = {}) {
  try {
    const stdout = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stdout, stderr: '' };
  } catch (error) {
    const stderr = `${error.stderr ?? ''}${error.stdout ?? ''}`.trim();
    if (!allowFailure) throw new Error(`${command} ${args.join(' ')}: ${stderr || error.message}`);
    return { ok: false, stdout: error.stdout ?? '', stderr, code: error.status };
  }
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
const firstLine = (text) => (text.split('\n').find((line) => line.trim().length > 0) ?? '').trim().slice(0, 200);

async function readProgram(rpc, programId) {
  const [program, pd] = await Promise.all([
    rpcCall(rpc, 'getAccountInfo', [programId, { encoding: 'base64', dataSlice: { offset: 0, length: 36 } }]),
    fetchProgramState(rpc, programId),
  ]);
  if (!program?.value) throw new Error('program-аккаунт не найден');
  return { programLamports: BigInt(program.value.lamports), pd, space: pd.dataLen + CONSTANTS.PROGRAMDATA_META };
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
  const notes = [];
  const steps = [];

  sh('solana-keygen', ['new', '--no-bip39-passphrase', '--silent', '-o', payerKeypair]);
  sh('solana-keygen', ['new', '--no-bip39-passphrase', '--silent', '-o', programKeypair]);
  const payer = sh('solana-keygen', ['pubkey', payerKeypair]).stdout.trim();
  const programId = sh('solana-keygen', ['pubkey', programKeypair]).stdout.trim();
  sh('solana', ['airdrop', '50', payer, '--url', rpc]);
  const deploy = (maxLen, options = {}) =>
    sh('solana', ['program', 'deploy', '--url', rpc, '--keypair', payerKeypair, '--program-id', programKeypair, '--max-len', maxLen.toString(), soPath], options);

  // ── Шаг 1: первый деплой, max_len = размер .so ─────────────────────────────
  const before1 = await fetchBalance(rpc, payer);
  const deploy1 = deploy(soLen);
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
  steps.push({ step: 'new', maxLen: soLen, programData: state1.pd.programDataAddress, spent: spent1, output: deploy1.stdout.trim().slice(-300) });

  // ── Шаг 2: попытка роста без extend (активна ли SIMD-0433 на кластере) ────
  const maxLen2 = soLen + growth;
  const growAttempt = deploy(maxLen2, { allowFailure: true });
  let autoExtended = false;
  if (growAttempt.ok) {
    const state2 = await readProgram(rpc, programId);
    autoExtended = state2.space >= CONSTANTS.PROGRAMDATA_META + maxLen2;
    notes.push(`рост без extend: команда прошла, space=${state2.space.toString()}${autoExtended ? ' (SIMD-0433 расширил сам)' : ''}`);
  } else {
    notes.push(`рост без extend: команда отклонена — ${firstLine(growAttempt.stderr)}`);
  }
  steps.push({ step: 'grow-attempt', maxLen: maxLen2, ok: growAttempt.ok, autoExtended, error: growAttempt.stderr.slice(-300) });

  // ── Шаг 3: явный extend и финальный деплой с новым max_len ────────────────
  let extend = null;
  let final = null;
  if (!autoExtended) {
    const before = await readProgram(rpc, programId);
    const extendRun = sh('solana', ['program', 'extend', programId, growth.toString(), '--url', rpc, '--keypair', payerKeypair], { allowFailure: true });
    const after = await readProgram(rpc, programId);
    if (!extendRun.ok && after.space === before.space) {
      extend = { ok: false, error: extendRun.stderr.slice(-300) };
      notes.push('extend не выполнился — продолжать апгрейд нельзя');
    } else {
      extend = { ok: true, spaceBefore: before.space, spaceAfter: after.space };
      for (const check of checkExtend({ spaceBefore: before.space, additional: growth, spaceAfter: after.space, lamportsAfter: after.pd.lamports, rent })) {
        checks.push(row(check.name, check.measured, check.expected));
      }
    }
    steps.push({ step: 'extend', additional: growth, ...extend, output: extendRun.stdout.trim().slice(-200) });
  } else {
    notes.push('extend пропущен: кластер сам расширил ProgramData (SIMD-0433)');
  }

  if (autoExtended || extend?.ok) {
    const before4 = await fetchBalance(rpc, payer);
    const deploy4 = deploy(maxLen2, { allowFailure: true });
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
    steps.push({ step: 'final-deploy', maxLen: maxLen2, ...final, output: deploy4.stdout.trim().slice(-200), error: deploy4.stderr.slice(-300) });
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
    const problems = [...failed.map((check) => check.name), ...stepProblems];
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
      console.log(`::error title=ares-calibrate-error::${String(error.message).replace(/[\r\n]+/g, ' ').slice(0, 800)}`);
      console.error(`calibrate-localnet: ошибка: ${error.message}`);
      process.exit(2);
    });
}
