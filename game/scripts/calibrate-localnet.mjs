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
 * Штатный путь роста — `solana program extend` (тот же, что в runbook для
 * человека). Если команда отчиталась об успехе, а space НЕ вырос (наблюдено в
 * CI 8fc8d25: exit 0, но space и слот ProgramData без изменений), скрипт
 * отправляет ExtendProgram сам — сырой транзакцией с логированием симуляции.
 * Так измерение не зависит от того, что CLI напечатал, а инструмент один и тот
 * же: содержимое аккаунта до/после.
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
import { createPrivateKey, createPublicKey, sign as ed25519Sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONSTANTS,
  base58,
  computeFees,
  fetchBalance,
  fetchProgramState,
  fetchRate,
  rpcCall,
} from './deploy-budget.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
// Раннер обрезает одно сообщение аннотации (~4 КБ), а измерений много (R10):
// печатаем их несколькими ::notice/::error, каждый со своей нумерацией.
const ANNOTATION_CHUNK = 1800;

function annotate(level, title, text) {
  const chunks = [];
  for (let index = 0; index < text.length; index += ANNOTATION_CHUNK) {
    chunks.push(text.slice(index, index + ANNOTATION_CHUNK));
  }
  chunks.forEach((chunk, index) => {
    const label = index === 0 ? title : `${title} ${index + 1}/${chunks.length}`;
    console.log(`::${level} title=${label}::${index === 0 ? '' : '…'}${chunk}`);
  });
}
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

// ── Сырой ExtendProgram: страховка от «успеха без эффекта» у CLI ──────────────
// loader-v3 (agave v4.2.2, svm/loader-v3-interface): UpgradeableLoaderInstruction
// с `#[repr(u8)]` сериализуется bincode как тег-байт + fixed-int поля, поэтому
// ExtendProgram = [6, additional: u32 LE], аккаунты [ProgramData, Program,
// SystemProgram, payer]; пейер обязан подписать (check_authority = false — по
// SIMD-0431 authority не требуется, но плательщик нужен для доплаты за rent).
const LOADER_V3 = 'BPFLoaderUpgradeab1e11111111111111111111111';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

/** base58 → байты (нужен для blockhash и адресов внутри сырой транзакции). */
export function base58Decode(text) {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) throw new Error(`base58: недопустимый символ «${char}»`);
    value = value * 58n + BigInt(digit);
  }
  const leading = text.length - text.replace(/^1+/, '').length;
  const hex = value.toString(16);
  const body = value === 0n ? Buffer.alloc(0) : Buffer.from(hex.padStart(hex.length + (hex.length % 2), '0'), 'hex');
  return Buffer.concat([Buffer.alloc(leading), body]);
}

/** u32 LE — формат fixed-int полей bincode. */
function u32le(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(Number(value));
  return buffer;
}

/** shortvec (compact-u16) — длина массивов в сообщении транзакции. */
function shortvec(value) {
  const out = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest >>= 7;
    if (rest > 0) byte |= 0x80;
    out.push(byte);
  } while (rest > 0);
  return Buffer.from(out);
}

/**
 * Ключ Ed25519 из файла solana-keygen (64 Б: seed || pubkey). Публичный ключ,
 * выведенный из seed, обязан совпасть с записанным — иначе подпись была бы
 * сделана «не тем» ключом, и это лучше поймать до отправки транзакции.
 */
export function ed25519Signer(keypairPath) {
  const bytes = Buffer.from(JSON.parse(readFileSync(keypairPath, 'utf8')));
  if (bytes.length !== 64) {
    throw new Error(`ключ ${path.basename(keypairPath)}: ожидалось 64 байта (seed||pubkey), получено ${bytes.length}`);
  }
  const seed = bytes.subarray(0, 32);
  const publicKey = bytes.subarray(32, 64);
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  const derived = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
  if (!derived.equals(publicKey)) {
    throw new Error(`ключ ${path.basename(keypairPath)}: публичный ключ не выводится из seed`);
  }
  return { publicKey, sign: (message) => ed25519Sign(null, message, key) };
}

/** Сырая legacy-транзакция с одной инструкцией ExtendProgram (без compute budget). */
export function buildExtendTransaction({ signer, programId, programData, additional, blockhash }) {
  const keys = [
    signer.publicKey,                 // 0: плательщик (signer, writable, fee payer)
    base58Decode(programData),        // 1: ProgramData (writable)
    base58Decode(programId),          // 2: Program (writable)
    base58Decode(SYSTEM_PROGRAM),     // 3: SystemProgram (readonly)
    base58Decode(LOADER_V3),          // 4: loader-v3 (readonly, program id инструкции)
  ];
  for (const [index, key] of keys.entries()) {
    if (key.length !== 32) throw new Error(`ключ #${index} в транзакции: ${key.length} байт вместо 32`);
  }
  const data = Buffer.concat([Buffer.from([6]), u32le(additional)]);
  const message = Buffer.concat([
    Buffer.from([1, 0, 2]),           // подписей 1, readonly-подписантов 0, readonly без подписи 2
    shortvec(keys.length),
    ...keys,
    base58Decode(blockhash),
    shortvec(1),
    Buffer.from([4]),                 // programIdIndex: loader-v3
    shortvec(4),
    Buffer.from([1, 2, 3, 0]),        // ProgramData, Program, SystemProgram, payer
    shortvec(data.length),
    data,
  ]);
  const signature = signer.sign(message);
  return { signature, transaction: Buffer.concat([shortvec(1), signature, message]) };
}

/**
 * Отправка ExtendProgram и подтверждение. Логи симуляции возвращаются всегда:
 * при отказе они объясняют причину (единственный публичный след в CI, R10).
 */
export async function sendRawExtend({ rpc, signer, programId, programData, additional }) {
  const latest = await rpcCall(rpc, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const blockhash = latest?.value?.blockhash;
  if (!blockhash) throw new Error('getLatestBlockhash не вернул blockhash');
  const { signature: expected, transaction } = buildExtendTransaction({ signer, programId, programData, additional, blockhash });
  const base64 = transaction.toString('base64');
  const simulation = await rpcCall(rpc, 'simulateTransaction', [base64, { encoding: 'base64', sigVerify: false, commitment: 'confirmed' }]);
  const logs = (simulation?.value?.logs ?? []).map((line) => safeDiagnostic(String(line), 200));
  if (simulation?.value?.err) {
    return { ok: false, signature: null, logs, error: safeDiagnostic(JSON.stringify(simulation.value.err), 300) };
  }
  const signature = await rpcCall(rpc, 'sendTransaction', [base64, { encoding: 'base64', skipPreflight: false }]);
  if (signature !== base58(expected)) {
    // Возвращённая подпись обязана совпадать с посчитанной: иначе это не наша транзакция.
    return { ok: false, signature, logs, error: `RPC вернул другую подпись: ${signature}` };
  }
  let status = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = await rpcCall(rpc, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
    status = result?.value?.[0] ?? null;
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!status) return { ok: false, signature, logs, error: 'транзакция не подтвердилась за 20 с' };
  return { ok: !status.err, signature, logs, error: status.err ? safeDiagnostic(JSON.stringify(status.err), 300) : null };
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
      return { programLamports: BigInt(program.value.lamports), pd, space: pd.dataLen + CONSTANTS.PROGRAMDATA_META, slot: pd.slot };
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
  // Сначала штатная команда (её же выполнит человек по runbook), затем проверка
  // ФАКТА: вырос ли аккаунт. Отчёт CLI «успех» без роста — не измерение, а
  // повод отправить ExtendProgram самим и посмотреть логи/ошибку RPC.
  const needed = CONSTANTS.PROGRAMDATA_META + soLen2 - state2.space; // сколько не хватает до 45 + soLen2
  let extend = null;
  if (needed > 0n) {
    const before3 = await readProgram(rpc, programId);
    const cli = sh('solana', ['program', 'extend', programId, needed.toString(), '--url', rpc, '--keypair', payerKeypair], { allowFailure: true });
    const afterCli = await readProgram(rpc, programId);
    const cliGrew = afterCli.space - before3.space;
    extend = {
      additional: needed,
      spaceBefore: before3.space,
      spaceAfter: afterCli.space,
      slotBefore: before3.slot,
      slotAfter: afterCli.slot,
      cli: {
        ok: cli.ok,
        exitCode: cli.code ?? 0,
        grew: cliGrew,
        stdout: safeDiagnostic(cli.stdout ?? '', 300),
        error: cli.ok ? null : safeDiagnostic(`${cli.stderr}\n${cli.stdout}`, 1500),
      },
      raw: null,
    };
    let final = afterCli;
    if (cliGrew !== needed) {
      notes.push(`extend: CLI ${cli.ok ? 'отчитался об успехе' : 'завершился ошибкой'}, но space ${before3.space}→${afterCli.space} (слот ${before3.slot}→${afterCli.slot}) — отправляем ExtendProgram сами`);
      const raw = await sendRawExtend({
        rpc,
        signer: ed25519Signer(payerKeypair),
        programId,
        programData: before3.pd.programDataAddress,
        additional: needed,
      });
      final = await readProgram(rpc, programId);
      extend.raw = {
        ok: raw.ok,
        signature: raw.signature,
        error: raw.error,
        logs: raw.logs,
        grew: final.space - afterCli.space,
      };
      notes.push(`extend: raw-транзакция ${raw.ok ? 'прошла' : 'не прошла'}: space ${afterCli.space}→${final.space}${raw.error ? ` (${raw.error})` : ''}`);
    }
    extend.spaceAfter = final.space;
    extend.slotAfter = final.slot;
    extend.via = cliGrew === needed ? 'cli' : 'raw';
    extend.ok = final.space - before3.space === needed;
    const expectedSpace = before3.space + needed;
    checks.push(row('extend_space', final.space, expectedSpace));
    checks.push(row('extend_lamports', final.pd.lamports, rent(expectedSpace)));
    if (!extend.ok) checks.push(row('extend_failed', 1n, 0n));
    steps.push({ step: 'extend', additional: needed, ok: extend.ok, via: extend.via, spaceAfter: final.space, slotAfter: final.slot });
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
  annotate('notice', 'ares-calibrate', JSON.stringify(payload, jsonReplacer));
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
    annotate('error', 'ares-calibrate-error', safeDiagnostic(detail, 6000).replace(/[\r\n]+/g, ' '));
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
      annotate('error', 'ares-calibrate-error', safeDiagnostic(message, 6000).replace(/[\r\n]+/g, ' '));
      console.error(`calibrate-localnet: ошибка: ${error.message}`);
      process.exit(2);
    });
}
