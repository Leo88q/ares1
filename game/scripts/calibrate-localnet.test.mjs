// Тесты калибровки §5.7: чистые проверки дельт + сквозной прогон на заглушках
// команд `solana`/`solana-keygen` и RPC (в CI тот же скрипт идёт на настоящем
// solana-test-validator). Запуск: node --test scripts/calibrate-localnet.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSTANTS, base58 } from './deploy-budget.mjs';
import { checkDeploy, checkExtend, safeDiagnostic, verdict } from './calibrate-localnet.mjs';

/** Payload из stdout: строки ::notice режутся раннером, поэтому берём блок между маркерами. */
function payloadFrom(stdout) {
  const start = stdout.indexOf('--- ares-calibrate payload ---');
  const end = stdout.indexOf('--- конец payload ---');
  assert.notEqual(start, -1, 'маркер payload не найден');
  assert.notEqual(end, -1, 'маркер конца payload не найден');
  return JSON.parse(stdout.slice(stdout.indexOf('\n', start) + 1, end));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const RATE = 5080n; // ставка только в заглушке: живьём приходит из RPC (R3)
const rent = (n) => (CONSTANTS.RENT_OVERHEAD + n) * RATE;
const FAKE_FEES = 30000; // меньше оценки модели (computeFees покрывает)
const LOADER_V3 = 'BPFLoaderUpgradeab1e11111111111111111111111';
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
  const payerPub = base58(Buffer.alloc(32, 0x21));
  const programPub = base58(Buffer.alloc(32, 0x22));
  const pdPub = base58(Buffer.alloc(32, 0x33));
  writeFileSync(statePath, JSON.stringify({ payer: payerPub, payerBalance: 50_000_000_000, program: null }));

  const keygenStub = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const outIndex = args.indexOf('-o');
if (args[0] === 'new') { fs.writeFileSync(args[outIndex + 1], '[]'); process.exit(0); }
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
    // Буфер CLI создаёт ДО проверки размера, поэтому провал апгрейда оставляет
    // буфер висеть с залогом (как в CI 8fc8d25) — успех буфер закрывает.
    if (BigInt(state.program.pdSpace) < target) {
      const bufferLamports = Number(rent(target));
      // Каждая неудачная попытка — свой буфер (CLI создаёт новый ключ): они
      // остаются висеть до ручного закрытия, и все обязаны попасть в расчёт.
      state.buffers = [...(state.buffers ?? []), { address: process.env.FAKE_BUFFER_PUB + '/' + (state.buffers?.length ?? 0), lamports: bufferLamports }];
      state.payerBalance -= bufferLamports;
      save();
      console.error('Error: ProgramData account is too small to hold the program');
      process.exit(1);
    }
    if (state.buffers && state.buffers.length > 0) {
      state.payerBalance += state.buffers.reduce((sum, buffer) => sum + buffer.lamports, 0);
      state.buffers = [];
    }
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
  // Живой CLI на 4.2.2 расширяет ProgramData; чтения калибровки идут по
  // confirmed, и на localnet рост видно не мгновенно — заглушка это повторяет:
  // состояние обновится только через FAKE_EXTEND_SLOW_MS (проверка ожидания).
  const additional = BigInt(args[3]); // solana program extend <ID> <BYTES>
  if (process.env.FAKE_EXTEND_NOOP === '1') {
    // Как в прогоне 8fc8d25: команда отчитывается об успехе, аккаунт не растёт.
    console.log('Extended Program Id ' + state.program.id + ' by ' + args[3] + ' bytes');
    process.exit(0);
  }
  const pdSpace = BigInt(state.program.pdSpace) + additional;
  const lamports = rent(pdSpace);
  state.payerBalance -= Number(lamports) - state.program.pdLamports;
  state.pendingExtend = { pdSpace: Number(pdSpace), pdLamports: Number(lamports), visibleAt: Date.now() + Number(process.env.FAKE_EXTEND_SLOW_MS || 0) };
  save();
  console.log('Extended Program Id ' + state.program.id + ' by ' + args[3] + ' bytes');
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
      if (method === 'getBalance') {
        if (params[1]?.commitment !== 'confirmed') {
          response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: `getBalance без commitment=confirmed (получено: ${params[1]?.commitment ?? 'нет'})` } }));
          return;
        }
        return ok({ context: { slot: 1 }, value: state.payerBalance }); // форма Agave
      }
      if (method === 'getGenesisHash') return ok('stub-genesis');
      if (method === 'getSlot') return ok(1);
      // Рост от CLI-extend «проявляется» с задержкой (FAKE_EXTEND_SLOW_MS):
      // калибровка обязана дождаться состояния, а не читать сразу.
      if (state.pendingExtend && Date.now() >= state.pendingExtend.visibleAt) {
        state.program.pdSpace = state.pendingExtend.pdSpace;
        state.program.pdLamports = state.pendingExtend.pdLamports + (activeEnv?.FAKE_EXTRA_LAMPORTS === '1' ? 1 : 0);
        delete state.pendingExtend;
        writeFileSync(statePath, JSON.stringify(state));
      }
      if (method === 'getProgramAccounts') {
        // Заглушка честно применяет memcmp-фильтр RPC: подходящими считаются
        // только буферы с authority по смещению 5 (tag u32 + Option-признак).
        // Так тест ловит ошибку в смещении (offset 4 → пустой список).
        const filter = params[1]?.filters?.[0]?.memcmp;
        const matches = filter && filter.offset === 5 && filter.bytes === activeEnv?.FAKE_PAYER_PUB;
        const buffers = (matches ? (state.buffers ?? []) : []).map((buffer) => ({
          pubkey: buffer.address,
          account: {
            lamports: buffer.lamports,
            // Layout Buffer: тег 1 (u32) + Option<Pubkey> (1 байт признака + 32)
            // = 37 Б; скрипт фильтрует по тегу и ищет authority по смещению 5.
            data: [Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from([1]), Buffer.alloc(32, 0x21)]).toString('base64'), 'base64'],
            owner: LOADER_V3,
            executable: false,
            space: 37 + 11240,
          },
        }));
        return ok(buffers);
      }
      if (method === 'getAccountInfo') {
        // Явный commitment обязателен (по умолчанию RPC — finalized: именно эта
        // ловушка дала «успех без эффекта» в прогоне 8fc8d25). Какие именно
        // уровни читаются, проверяется в ассертах payload.
        if (!['confirmed', 'finalized'].includes(params[1]?.commitment)) {
          response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: `getAccountInfo без явного commitment (получено: ${params[1]?.commitment ?? 'нет'})` } }));
          return;
        }
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
    FAKE_BUFFER_PUB: base58(Buffer.alloc(32, 0x44)),
    FAKE_FAIL_FIRST: '1',
    FAKE_NOISY: '1',
    FAKE_EXTEND_SLOW_MS: '800',
    FAKE_ATTEMPT_FILE: path.join(workdir, 'deploy-attempts'),
    ANNOTATE: '0',
  };
  activeEnv = env;
  const run = await promisify(execFile)(process.execPath, [
    path.join(here, 'calibrate-localnet.mjs'),
    '--so', soPath,
    '--so2', so2Path,
    '--wait-ms', '8000',
    '--rpc', `http://127.0.0.1:${server.address().port}`,
  ], { env, maxBuffer: 8 * 1024 * 1024 }).catch((error) => ({ failed: error }));
  server.close();
  if (run.failed) throw new Error(`скрипт упал: ${run.failed.stdout ?? ''} ${run.failed.stderr ?? run.failed.message}`);
  const payload = payloadFrom(run.stdout);
  assert.equal(payload.pass, true, JSON.stringify(payload.checks));
  assert.equal(payload.checks.every((check) => check.delta === '0'), true, JSON.stringify(payload.checks));
  // Апгрейд без extend обязан упасть (модель §5.3), затем extend и апгрейд — ок.
  assert.equal(payload.steps.find((step) => step.step === 'upgrade-no-extend').ok, false);
  assert.equal(payload.steps.find((step) => step.step === 'upgrade-no-extend').fitsInCurrent, false);
  assert.equal(payload.fees.buffers.count, 0, JSON.stringify(payload.fees)); // успешный апгрейд закрыл буфер
  assert.equal(payload.steps.some((step) => step.step === 'extend' && step.ok === true), true);
  assert.equal(payload.steps.find((step) => step.step === 'upgrade').ok, true);
  // Первая попытка деплоя упала (заглушка), скрипт продолжил на буфере.
  assert.equal(payload.steps.find((step) => step.step === 'new').attempt, 2, JSON.stringify(payload.notes));
  assert.equal(payload.notes.some((note) => note.includes('попытка 1 не прошла')), true);
  assert.equal(payload.notes.some((note) => note.includes('CLI напечатал seed-фразу')), true);
  assert.equal(payload.notes.some((note) => /[a-z]{3,8}( [a-z]{3,8}){11}/.test(note)), false, 'seed-фраза не должна попадать в заметки');
  // Комиссии: модель обязана не занижать измеренный расход (из расхода вычтен
  // залог программы; буферы успешный апгрейд закрывает — их залог 0).
  assert.equal(payload.fees.buffers.lamports, '0', JSON.stringify(payload.fees));
  assert.equal(typeof payload.fees.measured, 'string');
  assert.equal(payload.fees.modelCovers, true, JSON.stringify(payload.fees));
  assert.equal(payload.pass, true, JSON.stringify(payload.checks));

  // CLI extend расширяет ProgramData; рост проверяется по аккаунту (confirmed),
  // а не по отчёту команды: прогон 8fc8d25 показал «успех» без движения из-за
  // чтения по finalized.
  assert.equal(payload.extend.cli.ok, true, JSON.stringify(payload.extend));
  assert.match(payload.extend.cli.stdout, /Extended Program Id \S+ by 10240 bytes/);
  // Заглушка «проявляет» рост с задержкой 800 мс: без ожидания по confirmed
  // space остался бы прежним (как в прогоне 8fc8d25 с finalized-чтениями).
  assert.equal(payload.extend.grew, '10240', JSON.stringify(payload.extend));
  assert.equal(payload.extend.ok, true, JSON.stringify(payload.extend));
  assert.equal(payload.extend.slotAfter >= payload.extend.slotBefore, true);
  // Печатаются обе точки: расхождение confirmed/finalized видно, не сглажено.
  assert.equal(payload.states.afterNew.confirmed.space, String(CONSTANTS.PROGRAMDATA_META + 1000n));
  assert.equal(payload.states.afterExtend.before.confirmed.space, String(CONSTANTS.PROGRAMDATA_META + 1000n));
  assert.equal(payload.states.afterExtend.after.confirmed.space, String(CONSTANTS.PROGRAMDATA_META + 1000n + 10240n));
  assert.equal(payload.states.afterExtend.after.confirmed.space, payload.states.afterExtend.after.finalized.space);
  assert.equal(payload.states.afterUpgrade.confirmed.space, String(CONSTANTS.PROGRAMDATA_META + 1000n + 10240n));

  // Случай 8fc8d25: extend не вырастил аккаунт, финальный апгрейд не влез и
  // оставил буфер. Калибровка обязана (а) не пройти по чекам, (б) учесть залог
  // буфера — иначе ложный fees_underestimated, как в том прогоне.
  const stateNoExtend = path.join(workdir, 'state-noextend.json');
  writeFileSync(stateNoExtend, JSON.stringify({ payer: payerPub, payerBalance: 50_000_000_000, program: null }));
  statePath = stateNoExtend;
  const noExtendEnv = { ...env, FAKE_STATE: stateNoExtend, FAKE_EXTEND_NOOP: '1' };
  activeEnv = noExtendEnv;
  const server4 = createServer(handleRequest);
  await new Promise((resolve) => server4.listen(0, '127.0.0.1', resolve));
  const noExtend = await promisify(execFile)(process.execPath, [
    path.join(here, 'calibrate-localnet.mjs'),
    '--so', soPath,
    '--so2', so2Path,
    '--wait-ms', '2000',
    '--rpc', `http://127.0.0.1:${server4.address().port}`,
  ], { env: noExtendEnv, maxBuffer: 8 * 1024 * 1024 }).catch((error) => ({ failed: error }));
  server4.close();
  statePath = mainStatePath;
  activeEnv = env;
  assert.ok(noExtend.failed, 'без роста ProgramData калибровка обязана упасть');
  assert.equal(noExtend.failed.code, 2);
  const noExtendPayload = payloadFrom(String(noExtend.failed.stdout));
  assert.equal(noExtendPayload.extend.ok, false, JSON.stringify(noExtendPayload.extend));
  // 1 буфер от «upgrade-no-extend» + по одному на каждую из 3 попыток апгрейда.
  assert.equal(noExtendPayload.fees.buffers.count, 4, JSON.stringify(noExtendPayload.fees));
  const bufferUnit = (CONSTANTS.RENT_OVERHEAD + CONSTANTS.PROGRAMDATA_META + 1000n + 10240n) * RATE;
  assert.equal(noExtendPayload.fees.buffers.lamports, String(bufferUnit * 4n), JSON.stringify(noExtendPayload.fees));
  assert.equal(noExtendPayload.fees.modelCovers, true, JSON.stringify(noExtendPayload.fees));
  assert.match(String(noExtend.failed.stdout), /буферы плательщика/);

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
    '--wait-ms', '8000',
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
    '--wait-ms', '8000',
    '--rpc', `http://127.0.0.1:${server2.address().port}`,
  ], { env: negativeEnv, maxBuffer: 8 * 1024 * 1024 }).catch((error) => ({ failed: error }));
  server2.close();
  activeEnv = env;
  assert.ok(negative.failed, 'калибровка обязана упасть при расхождении на 1 лампорт');
  assert.equal(negative.failed.code, 2);
  assert.match(String(negative.failed.stderr), /РАСХОЖДЕНИЕ/);
  const negativePayload = payloadFrom(String(negative.failed.stdout));
  assert.equal(negativePayload.pass, false);
  assert.equal(negativePayload.checks.find((check) => check.name === 'extend_lamports').delta, '1');
});
