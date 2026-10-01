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
import { checkDeploy, checkExtend, verdict } from './calibrate-localnet.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RATE = 5080n; // ставка только в заглушке: живьём приходит из RPC (R3)
const rent = (n) => (CONSTANTS.RENT_OVERHEAD + n) * RATE;
const FAKE_FEES = 30000; // меньше оценки модели (computeFees покрывает)

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

test('калибровка: сквозной прогон (new → рост без extend → extend → deploy)', async () => {
  const workdir = mkdtempSync(path.join(os.tmpdir(), 'calib-test-'));
  const bindir = path.join(workdir, 'bin');
  mkdirSync(bindir);
  const statePath = path.join(workdir, 'state.json');
  const payerPub = base58(Buffer.alloc(32, 0x21));
  const programPub = base58(Buffer.alloc(32, 0x22));
  const pdPub = base58(Buffer.alloc(32, 0x33));
  writeFileSync(statePath, JSON.stringify({ payer: payerPub, payerBalance: 50_000_000_000, program: null }));

  const keygenStub = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'new') { fs.writeFileSync(args[args.indexOf('-o') + 1], '[]'); process.exit(0); }
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
if (args[0] === 'airdrop') { state.payerBalance += 50_000_000_000; save(); console.log('Airdrop ok'); process.exit(0); }
if (args[0] === 'program' && args[1] === 'deploy') {
  const maxLen = BigInt(flag('--max-len'));
  const soLen = BigInt(fs.statSync(args[args.length - 1]).size);
  if (maxLen < soLen) { console.error('Error: Max length specified not large enough to accommodate desired program'); process.exit(1); }
  const target = 45n + maxLen;
  if (state.program) {
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
  const additional = BigInt(args[3]); // solana program extend <ID> <BYTES>
  const pdSpace = BigInt(state.program.pdSpace) + additional;
  const lamports = rent(pdSpace) + (process.env.FAKE_EXTRA_LAMPORTS === '1' ? 1n : 0n);
  state.payerBalance -= Number(lamports) - state.program.pdLamports;
  state.program.pdSpace = Number(pdSpace);
  state.program.pdLamports = Number(lamports);
  save();
  console.log('Extend ok');
  process.exit(0);
}
process.exit(0);
`;
  writeFileSync(path.join(bindir, 'solana'), solanaStub);
  writeFileSync(path.join(bindir, 'solana-keygen'), keygenStub);
  chmodSync(path.join(bindir, 'solana'), 0o755);
  chmodSync(path.join(bindir, 'solana-keygen'), 0o755);
  const soPath = path.join(workdir, 'program.so');
  writeFileSync(soPath, Buffer.alloc(1000));

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
      if (method === 'getBalance') return ok(state.payerBalance);
      if (method === 'getGenesisHash') return ok('stub-genesis');
      if (method === 'getSlot') return ok(1);
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
    ANNOTATE: '0',
  };
  const run = await promisify(execFile)(process.execPath, [
    path.join(here, 'calibrate-localnet.mjs'),
    '--so', soPath,
    '--rpc', `http://127.0.0.1:${server.address().port}`,
  ], { env, maxBuffer: 8 * 1024 * 1024 }).catch((error) => ({ failed: error }));
  server.close();
  if (run.failed) throw new Error(`скрипт упал: ${run.failed.stdout ?? ''} ${run.failed.stderr ?? run.failed.message}`);
  const payload = JSON.parse(run.stdout.slice(run.stdout.indexOf('\n{') + 1)); // пропускаем ::notice
  assert.equal(payload.pass, true, JSON.stringify(payload.checks));
  assert.equal(payload.autoExtended, false); // без extend рост отклоняется (SIMD-0433 выключена)
  assert.equal(payload.checks.every((check) => check.delta === '0'), true, JSON.stringify(payload.checks));
  assert.equal(payload.steps.some((step) => step.step === 'extend' && step.ok === true), true);

  // Негативный контроль: +1 лампорт на extend обязан провалить калибровку
  writeFileSync(statePath, JSON.stringify({ payer: payerPub, payerBalance: 50_000_000_000, program: null }));
  const server2 = createServer(handleRequest);
  await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve));
  const negative = await promisify(execFile)(process.execPath, [
    path.join(here, 'calibrate-localnet.mjs'),
    '--so', soPath,
    '--rpc', `http://127.0.0.1:${server2.address().port}`,
  ], { env: { ...env, FAKE_EXTRA_LAMPORTS: '1' }, maxBuffer: 8 * 1024 * 1024 }).catch((error) => ({ failed: error }));
  server2.close();
  assert.ok(negative.failed, 'калибровка обязана упасть при расхождении на 1 лампорт');
  assert.equal(negative.failed.code, 2);
  assert.match(String(negative.failed.stderr), /РАСХОЖДЕНИЕ/);
});
