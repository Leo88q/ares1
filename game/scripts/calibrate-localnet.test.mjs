// Тесты калибровки §5.7: чистые проверки дельт + сквозной прогон на заглушках
// команд `solana`/`solana-keygen` и RPC (в CI тот же скрипт идёт на настоящем
// solana-test-validator). Запуск: node --test scripts/calibrate-localnet.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSTANTS, base58 } from './deploy-budget.mjs';
import { base58Decode, checkDeploy, checkExtend, safeDiagnostic, verdict } from './calibrate-localnet.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RATE = 5080n; // ставка только в заглушке: живьём приходит из RPC (R3)
const rent = (n) => (CONSTANTS.RENT_OVERHEAD + n) * RATE;
const FAKE_FEES = 30000; // меньше оценки модели (computeFees покрывает)
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const LOADER_V3 = 'BPFLoaderUpgradeab1e11111111111111111111111';

/** Ключевая пара Ed25519 из seed — той же схемой, что и заглушка solana-keygen. */
function keyFromSeed(seedByte) {
  const seed = Buffer.alloc(32, seedByte);
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
  return { seed, publicKey, publicKeyObject: createPublicKey({ key: Buffer.concat([SPKI_ED25519, publicKey]), format: 'der', type: 'spki' }) };
}

function u32le(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(Number(value));
  return buffer;
}

/** Разбор legacy-транзакции: подписи, заголовок, ключи и инструкции. */
function parseRawTransaction(tx) {
  let at = 1;
  const signatures = tx.subarray(at, at + 64 * tx[0]);
  at += 64 * tx[0];
  const messageStart = at;
  const header = tx.subarray(at, at + 3);
  at += 3;
  const readShortvec = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do { byte = tx[at++]; value |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
    return value;
  };
  const keys = [];
  for (let i = 0, n = readShortvec(); i < n; i++) { keys.push(tx.subarray(at, at + 32)); at += 32; }
  const blockhash = tx.subarray(at, at + 32); at += 32;
  const instructions = [];
  for (let i = 0, n = readShortvec(); i < n; i++) {
    const programIdIndex = tx[at++];
    const accounts = [];
    for (let j = 0, m = readShortvec(); j < m; j++) accounts.push(tx[at++]);
    const dataLength = readShortvec();
    instructions.push({ programIdIndex, accounts, data: tx.subarray(at, at + dataLength) });
    at += dataLength;
  }
  return { signatures, message: tx.subarray(messageStart), header, keys, blockhash, instructions };
}

test('safeDiagnostic: аннотация не уносит seed-фразу промежуточного буфера (R11)', () => {
  const noisy = [
    'solana program deploy --url http://127.0.0.1:8899 --max-len 971392 target/deploy/solana_potato.so: ============',
    "Recover the intermediate account's ephemeral keypair file with `solana-keygen recover` and the following 12-word seed phrase:",
    'abandon ability able about above absent absorb abstract absurd abuse access accident',
    'To resume a deploy, pass the recovered keypair as the [BUFFER_SIGNER]',
  ].join('\n');
  const safe = safeDiagnostic(noisy);
  assert.equal(/[a-z]{3,8}( [a-z]{3,8}){11}/.test(safe), false, safe);
  assert.equal(safe.includes('Recover the intermediate'), false, safe);
  assert.match(safe, /solana program deploy/);
  assert.equal(
    safeDiagnostic('Error: Max length specified not large enough to accommodate desired program\nnext line'),
    'Error: Max length specified not large enough to accommodate desired program | next line',
  );
  // Фраза в одну строку с текстом тоже вырезается.
  assert.equal(
    safeDiagnostic('seed: abandon ability able about above absent absorb abstract absurd abuse access accident ok').includes('abandon ability'),
    false,
  );
});

test('калибровка: дельты залога считаются на BigInt и не прячут расхождение', () => {
  const maxLen = 1000n;
  const good = checkDeploy({
    maxLen,
    pdSpace: CONSTANTS.PROGRAMDATA_META + maxLen,
    pdLamports: rent(CONSTANTS.PROGRAMDATA_META + maxLen),
    programLamports: rent(CONSTANTS.PROGRAM_ACC),
    rent,
  });
  assert.equal(verdict(good).ok, true);
  const bad = checkDeploy({
    maxLen,
    pdSpace: CONSTANTS.PROGRAMDATA_META + maxLen,
    pdLamports: rent(CONSTANTS.PROGRAMDATA_META + maxLen) + 1n, // +1 лампорт ломает калибровку
    programLamports: rent(CONSTANTS.PROGRAM_ACC),
    rent,
  });
  const result = verdict(bad);
  assert.equal(result.ok, false);
  assert.equal(result.failed[0].name, 'programdata_lamports');
  const ext = checkExtend({ spaceBefore: 100n, additional: 10240n, spaceAfter: 10340n, lamportsAfter: rent(10340n), rent });
  assert.equal(verdict(ext).ok, true);
});

test('калибровка: сквозной прогон (new → upgrade без extend → extend → upgrade)', async () => {
  const workdir = mkdtempSync(path.join(os.tmpdir(), 'calib-test-'));
  const bindir = path.join(workdir, 'bin');
  mkdirSync(bindir);
  const mainStatePath = path.join(workdir, 'state.json');
  let statePath = mainStatePath;
  const payer = keyFromSeed(0x21);      // seed фиксирован: pubkey выводится той же схемой в заглушке
  const program = keyFromSeed(0x22);
  const payerPub = base58(payer.publicKey);
  const programPub = base58(program.publicKey);
  const pdPub = base58(Buffer.alloc(32, 0x33));
  const blockhash = base58(Buffer.alloc(32, 0x11));
  writeFileSync(statePath, JSON.stringify({ payer: payerPub, payerBalance: 50_000_000_000, program: null }));

  const keygenStub = `#!/usr/bin/env node
const fs = require('node:fs');
const { createPrivateKey, createPublicKey } = require('node:crypto');
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const args = process.argv.slice(2);
const outIndex = args.indexOf('-o');
// Ключи настоящие (Ed25519 из фиксированного seed): сырая ExtendProgram-транзакция
// подписывается ими же, и подпись проверяется в тесте.
if (args[0] === 'new') {
  const file = args[outIndex + 1];
  const seed = Buffer.alloc(32, file.includes('program') ? 0x22 : 0x21);
  const key = createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: 'der', type: 'pkcs8' });
  const pub = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
  fs.writeFileSync(file, JSON.stringify([...seed, ...pub]));
  process.exit(0);
}
if (args[0] === 'recover') { fs.writeFileSync(args[outIndex + 1], fs.readFileSync(0, 'utf8')); process.exit(0); }
if (args[0] === 'pubkey') {
  const file = args[1];
  console.log(file.includes('program') ? process.env.FAKE_PROGRAM_PUB : process.env.FAKE_PAYER_PUB);
  process.exit(0);
}
process.exit(0);
`;
  const solanaStub = `#!/usr/bin/env node
const fs = require('node:fs');
const RATE = 5080n;
const rent = (n) => (128n + n) * RATE;
const state = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, 'utf8'));
const save = () => fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify(state));
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
if (args[0] === 'airdrop') {
  if (process.env.FAKE_AIRDROP_FAIL === '1') { console.error('airdrop: заглушка отказала'); process.exit(1); }
  state.payerBalance += 50_000_000_000; save(); console.log('Airdrop ok'); process.exit(0);
}
if (args[0] === 'program' && args[1] === 'deploy') {
  // Первая попытка падает и печатает 12 слов буфера — как CLI при исчерпании
  // попыток подписи; скрипт обязан восстановить ключ и продолжить на буфере.
  if (process.env.FAKE_FAIL_FIRST === '1' && process.env.FAKE_ATTEMPT_FILE) {
    const file = process.env.FAKE_ATTEMPT_FILE;
    let n = 0; try { n = Number(fs.readFileSync(file, 'utf8')); } catch {}
    n += 1; fs.writeFileSync(file, String(n));
    if (n === 1) { console.log('abandon ability able about above absent absorb abstract absurd abuse access accident'); process.exit(1); }
  }
  // Шумный прогресс (как у CLI на большом .so): проверяем, что буфер вывода
  // не переполняется и деплой не «падает» с пустой диагностикой.
  if (process.env.FAKE_NOISY === '1') {
    const filler = 'Writing buffer: '.padEnd(160, '.');
    for (let i = 0; i < 12000; i++) console.log(filler + ' ' + i);
  }
  const maxLen = BigInt(flag('--max-len'));
  const soLen = BigInt(fs.statSync(args[args.length - 1]).size);
  if (maxLen < soLen) { console.error('Error: Max length specified not large enough to accommodate desired program'); process.exit(1); }
  const target = 45n + maxLen;
  if (state.program) {
    // Апгрейд: loader-v3 (4.2.2) НЕ расширяет ProgramData сам — если новый
    // размер не влезает, ошибка; auto-extend выключен флагом --no-auto-extend.
    if (BigInt(state.program.pdSpace) < target) { console.error('Error: ProgramData account is too small to hold the program'); process.exit(1); }
    state.payerBalance -= ${FAKE_FEES}; save(); console.log('Program Id: ' + state.program.id); process.exit(0);
  }
  const pdSpace = Number(target);
  const pdLamports = Number(rent(target));
  const programLamports = Number(rent(36n));
  state.program = { id: process.env.FAKE_PROGRAM_PUB, pdAddress: process.env.FAKE_PD_PUB, pdSpace, pdLamports, programLamports, authority: state.payer };
  state.payerBalance -= pdLamports + programLamports + ${FAKE_FEES};
  save();
  console.log('Program Id: ' + state.program.id);
  process.exit(0);
}
if (args[0] === 'program' && args[1] === 'extend') {
  // Как измерено в CI 8fc8d25 (agave CLI 4.2.2): команда завершается кодом 0 и
  // печатает отчёт, но space ProgramData НЕ растёт. Заглушка это повторяет:
  // скрипт обязан проверять состояние, а не доверять сообщению CLI.
  state.cliExtend = { additional: args[3], space: state.program ? state.program.pdSpace : null };
  save();
  console.log('Program ' + (state.program ? state.program.id : '?') + ' extended by ' + args[3] + ' bytes');
  process.exit(0);
}
process.exit(0);
`;
  writeFileSync(path.join(bindir, 'solana'), solanaStub);
  writeFileSync(path.join(bindir, 'solana-keygen'), keygenStub);
  chmodSync(path.join(bindir, 'solana'), 0o755);
  chmodSync(path.join(bindir, 'solana-keygen'), 0o755);
  const soPath = path.join(workdir, 'program.so');
  writeFileSync(soPath, Buffer.alloc(1000));           // маленький: первый деплой
  const so2Path = path.join(workdir, 'program-lg.so');
  writeFileSync(so2Path, Buffer.alloc(1000 + 10240));  // большой: апгрейд требует extend

  let activeEnv = null; // окружение запускаемого сценария (нельзя читать process.env: RPC крутится в процессе теста)
  const pdBytes = Buffer.alloc(32, 0x33);
  const programDataBytes = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.alloc(8), Buffer.from([1]), Buffer.alloc(32, 0x44)]);
  const handleRequest = (request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      const { method, params } = JSON.parse(raw);
      const ok = (result) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      };
      if (method === 'getMinimumBalanceForRentExemption') return ok(Number(rent(BigInt(params[0]))));
      if (method === 'getBalance') return ok({ context: { slot: 1 }, value: state.payerBalance }); // форма Agave
      if (method === 'getGenesisHash') return ok('stub-genesis');
      if (method === 'getSlot') return ok(1);
      if (method === 'getLatestBlockhash') return ok({ context: { slot: 1 }, value: { blockhash, lastValidBlockHeight: 1000 } });
      if (method === 'getSignatureStatuses') return ok({ context: { slot: 1 }, value: [{ slot: 1, confirmations: null, confirmationStatus: 'finalized', err: null }] });
      if (method === 'simulateTransaction' || method === 'sendTransaction') {
        // Разбираем ровно то, что нужно: тег ExtendProgram и additional_bytes.
        const tx = Buffer.from(params[0], 'base64');
        let at = 1 + 64 * tx[0] + 3;
        const shortvec = () => { let value = 0, shift = 0, byte; do { byte = tx[at++]; value |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80); return value; };
        // Сдвиг читаем ОТДЕЛЬНЫМИ выражениями: `at += 32 * shortvec()` потерял бы
        // сдвиг самого счётчика (значение `at` берётся до вычисления правой части).
        const keyCount = shortvec();
        at += 32 * keyCount + 32; // ключи + blockhash
        const instructionCount = shortvec();
        if (instructionCount !== 1) { response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'ожидалась одна инструкция' } })); return; }
        const programIdIndex = tx[at++];
        const accountCount = shortvec();
        at += accountCount;
        const dataLength = shortvec();
        const data = tx.subarray(at, at + dataLength);
        if (data[0] !== 6) {
          response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Transaction simulation failed: Error processing Instruction 0: invalid instruction data' } }));
          return;
        }
        if (programIdIndex !== 4) { response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'programIdIndex != loader-v3' } })); return; }
        if (method === 'simulateTransaction') {
          return ok({
            context: { slot: 1 },
            value: {
              err: null,
              logs: [
                'Program ' + LOADER_V3 + ' invoke [1]',
                'Extended ProgramData account by ' + data.readUInt32LE(1) + ' bytes',
              ],
            },
          });
        }
        // sendTransaction: рост делаем только здесь — как на живом валидаторе.
        const additional = BigInt(data.readUInt32LE(1));
        const pdSpace = BigInt(state.program.pdSpace) + additional;
        const lamports = rent(pdSpace) + (activeEnv?.FAKE_EXTRA_LAMPORTS === '1' ? 1n : 0n);
        state.payerBalance -= Number(lamports) - state.program.pdLamports;
        state.program.pdSpace = Number(pdSpace);
        state.program.pdLamports = Number(lamports);
        state.lastRawTx = params[0];
        state.rawExtendCalls = (state.rawExtendCalls || 0) + 1;
        writeFileSync(statePath, JSON.stringify(state)); // заглушка-сервер пишет своё состояние сам
        // Настоящий RPC вернул бы подпись, посчитанную по этой же транзакции.
        return ok(base58(tx.subarray(1, 65)));
      }
      if (method === 'getAccountInfo') {
        const address = params[0];
        if (!state.program) return ok({ context: { slot: 1 }, value: null });
        if (address === state.program.id) {
          const data = Buffer.concat([Buffer.from([2, 0, 0, 0]), pdBytes]);
          return ok({ context: { slot: 1 }, value: { lamports: state.program.programLamports, data: [data.toString('base64'), 'base64'], owner: 'BPFLoaderUpgradeab1e11111111111111111111111', executable: true, space: 36 } });
        }
        if (address === state.program.pdAddress) {
          return ok({ context: { slot: 1 }, value: { lamports: state.program.pdLamports, data: [programDataBytes.toString('base64'), 'base64'], owner: 'BPFLoaderUpgradeab1e11111111111111111111111', executable: false, space: state.program.pdSpace } });
        }
        return ok({ context: { slot: 1 }, value: null });
      }
      return ok(null);
    });
  };
  const server = createServer(handleRequest);
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const env = {
    ...process.env,
    PATH: `${bindir}:${process.env.PATH}`,
    FAKE_STATE: statePath,
    FAKE_PROGRAM_PUB: programPub,
    FAKE_PAYER_PUB: payerPub,
    FAKE_PD_PUB: pdPub,
    FAKE_BLOCKHASH: blockhash,
    FAKE_FAIL_FIRST: '1',
    FAKE_NOISY: '1',
    FAKE_ATTEMPT_FILE: path.join(workdir, 'deploy-attempts'),
    ANNOTATE: '0',
  };
  activeEnv = env;
  const run = await promisify(execFile)(process.execPath, [
    path.join(here, 'calibrate-localnet.mjs'),
    '--so', soPath,
    '--so2', so2Path,
    '--rpc', `http://127.0.0.1:${server.address().port}`,
  ], { env, maxBuffer: 8 * 1024 * 1024 }).catch((error) => ({ failed: error }));
  server.close();
  if (run.failed) throw new Error(`скрипт упал: ${run.failed.stdout ?? ''} ${run.failed.stderr ?? run.failed.message}`);
  const payload = JSON.parse(run.stdout.slice(run.stdout.indexOf('\n{') + 1)); // пропускаем ::notice
  assert.equal(payload.pass, true, JSON.stringify(payload.checks));
  assert.equal(payload.checks.every((check) => check.delta === '0'), true, JSON.stringify(payload.checks));
  // Апгрейд без extend обязан упасть (модель §5.3), затем extend и апгрейд — ок.
  assert.equal(payload.steps.find((step) => step.step === 'upgrade-no-extend').ok, false);
  assert.equal(payload.steps.find((step) => step.step === 'upgrade-no-extend').fitsInCurrent, false);
  assert.equal(payload.steps.some((step) => step.step === 'extend' && step.ok === true), true);
  assert.equal(payload.steps.find((step) => step.step === 'upgrade').ok, true);
  // Первая попытка деплоя упала (заглушка), скрипт продолжил на буфере.
  assert.equal(payload.steps.find((step) => step.step === 'new').attempt, 2, JSON.stringify(payload.notes));
  assert.equal(payload.notes.some((note) => note.includes('попытка 1 не прошла')), true);
  assert.equal(payload.notes.some((note) => note.includes('CLI напечатал seed-фразу')), true);
  assert.equal(payload.notes.some((note) => /[a-z]{3,8}( [a-z]{3,8}){11}/.test(note)), false, 'seed-фраза не должна попадать в заметки');
  // Комиссии: модель обязана не занижать измеренный расход (залог вычтен).
  assert.equal(typeof payload.fees.measured, 'string');
  assert.equal(payload.fees.modelCovers, true, JSON.stringify(payload.fees));

  // CLI extend отчитался об успехе, но space не вырос (как измерено на 4.2.2,
  // CI 8fc8d25) — калибровка обязана смотреть на аккаунт, а рост делает сырая
  // ExtendProgram-транзакция; её формат и подпись проверяются разбором.
  assert.equal(payload.extend.cli.ok, true, JSON.stringify(payload.extend));
  assert.equal(payload.extend.cli.grew, '0', JSON.stringify(payload.extend));
  assert.match(payload.extend.cli.stdout, /extended by 10240 bytes/);
  assert.equal(payload.extend.via, 'raw');
  assert.equal(payload.extend.raw.ok, true, JSON.stringify(payload.extend.raw));
  assert.match(payload.extend.raw.logs.join(' | '), /Extended ProgramData account by 10240 bytes/);
  assert.equal(payload.notes.some((note) => note.includes('отчитался об успехе')), true, JSON.stringify(payload.notes));
  const finalState = JSON.parse(readFileSync(mainStatePath, 'utf8'));
  assert.equal(finalState.rawExtendCalls, 1, 'не ровно одна сырая транзакция');
  const parsed = parseRawTransaction(Buffer.from(finalState.lastRawTx, 'base64'));
  assert.deepEqual([...parsed.header], [1, 0, 2]);                       // 1 подпись, readonly-без-подписи 2
  assert.equal(parsed.keys.length, 5);
  assert.equal(base58(parsed.keys[0]), payerPub);                       // плательщик = подписант
  assert.equal(base58(parsed.keys[1]), pdPub);                          // ProgramData
  assert.equal(base58(parsed.keys[2]), programPub);                     // Program
  assert.equal(base58(parsed.keys[4]), LOADER_V3);
  assert.deepEqual(parsed.instructions.map((instruction) => instruction.programIdIndex), [4]);
  assert.deepEqual(parsed.instructions[0].accounts, [1, 2, 3, 0]);      // pd, program, system, payer
  assert.deepEqual(parsed.instructions[0].data, Buffer.concat([Buffer.from([6]), u32le(10240n)]));
  assert.equal(parsed.blockhash.equals(base58Decode(blockhash)), true);
  assert.equal(parsed.signatures.length, 64);
  // Подпись настоящая: Ed25519 по тому же сообщению (иначе валидатор отклонил бы транзакцию).
  assert.equal(verify(null, parsed.message, payer.publicKeyObject, parsed.signatures), true);

  // Провал airdrop обязан дать аннотацию ares-calibrate-error и код 2, а не
  // молчаливый ReferenceError в catch (аннотации — единственный канал из CI).
  const stateEmpty = path.join(workdir, 'state-empty.json');
  writeFileSync(stateEmpty, JSON.stringify({ payer: payerPub, payerBalance: 0, program: null }));
  statePath = stateEmpty; // заглушка-сервер читает файл из этой переменной
  const server3 = createServer(handleRequest);
  await new Promise((resolve) => server3.listen(0, '127.0.0.1', resolve));
  const noFunds = await promisify(execFile)(process.execPath, [
    path.join(here, 'calibrate-localnet.mjs'),
    '--so', soPath,
    '--so2', so2Path,
    '--rpc', `http://127.0.0.1:${server3.address().port}`,
  ], { env: { ...env, FAKE_STATE: stateEmpty, FAKE_AIRDROP_FAIL: '1' }, maxBuffer: 8 * 1024 * 1024 }).catch((error) => ({ failed: error }));
  server3.close();
  assert.ok(noFunds.failed, 'без средств калибровка обязана упасть');
  assert.equal(noFunds.failed.code, 2);
  assert.match(String(noFunds.failed.stdout), /ares-calibrate-error::/);
  assert.match(String(noFunds.failed.stdout), /airdrop не пополнил плательщика/);
  statePath = mainStatePath; // возвращаем сервер к основному состоянию

  // Негативный контроль: +1 лампорт на extend обязан провалить калибровку
  writeFileSync(statePath, JSON.stringify({ payer: payerPub, payerBalance: 50_000_000_000, program: null }));
  const server2 = createServer(handleRequest);
  await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve));
  const negativeEnv = { ...env, FAKE_EXTRA_LAMPORTS: '1' };
  activeEnv = negativeEnv;
  const negative = await promisify(execFile)(process.execPath, [
    path.join(here, 'calibrate-localnet.mjs'),
    '--so', soPath,
    '--so2', so2Path,
    '--rpc', `http://127.0.0.1:${server2.address().port}`,
  ], { env: negativeEnv, maxBuffer: 8 * 1024 * 1024 }).catch((error) => ({ failed: error }));
  server2.close();
  activeEnv = env;
  assert.ok(negative.failed, 'калибровка обязана упасть при расхождении на 1 лампорт');
  assert.equal(negative.failed.code, 2);
  assert.match(String(negative.failed.stderr), /РАСХОЖДЕНИЕ/);
});
