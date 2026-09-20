/** Finite, isolated localnet test. Never reads a real key or talks to a public RPC.
 * Each run boots the built SBF program with exact legacy genesis fixtures.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Connection, Keypair, PublicKey, ComputeBudgetProgram, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { anchorDiscriminator, decodeGameConfig, decodeEpoch } from '../apps/backend/src/anchorRaw';
import { migrationInstruction, type MigrationKind } from './migrationClient';

const programId = new PublicKey('DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf');
const program = path.resolve('target/deploy/solana_potato.so');
const port = 18899;
const rpc = `http://127.0.0.1:${port}`;
const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
const u64 = (value: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(value); return b; };
const epochPda = (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from('epoch'), u64(id)], programId)[0];
const fieldPda = (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from('field'), u64(id)], programId)[0];
const rent = (size: number) => (128 + size) * 6960; // default validator rent; verified against RPC below

async function requireFreePort(value: number) {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(value, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()));
  });
}

async function run(configSize: 156 | 164) {
  await requireFreePort(port);
  await requireFreePort(port + 1);
  await requireFreePort(port + 101);
  const admin = Keypair.generate();
  const intruder = Keypair.generate();
  const pending = Keypair.generate().publicKey;
  const potato = Keypair.generate().publicKey;
  const config = Buffer.alloc(configSize);
  anchorDiscriminator('account', 'GameConfig').copy(config);
  admin.publicKey.toBuffer().copy(config, 8);
  pending.toBuffer().copy(config, 40); potato.toBuffer().copy(config, 72);
  config.writeBigUInt64LE(1_000_000_000_000_000n, 104);
  config.writeBigUInt64LE(250_000_000_000n, 112);
  config.writeBigUInt64LE(6_000_000n, 120);
  config.writeUInt16LE(10_000, 128); config.writeBigUInt64LE(7n, 130);
  config.writeBigUInt64LE(42n, 138); config.writeBigUInt64LE(123_456n, 146);
  if (configSize === 164) config.writeBigUInt64LE(9876n, 154);
  config[configSize - 2] = 1; // PAUSED must survive migration
  config[configSize - 1] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[1];
  const field = Buffer.alloc(69);
  anchorDiscriminator('account', 'Field').copy(field); intruder.publicKey.toBuffer().copy(field, 8);
  field[40] = 3; field[41] = 74;
  field.writeBigInt64LE(100n, 42); field.writeBigInt64LE(200n, 50); field.writeBigInt64LE(150n, 58);
  field[66] = 1; field[67] = 2;
  field[68] = PublicKey.findProgramAddressSync([Buffer.from('field'), u64(100n)], programId)[1];
  const currentField = Buffer.concat([field, Buffer.from([2])]);
  currentField[68] = PublicKey.findProgramAddressSync([Buffer.from('field'), u64(101n)], programId)[1];
  const epoch = Buffer.alloc(41);
  anchorDiscriminator('account', 'Epoch').copy(epoch);
  epoch.writeBigUInt64LE(42n, 8); epoch.writeBigUInt64LE(250_000_000_000n, 16);
  epoch.writeBigUInt64LE(9n, 24); epoch.writeBigInt64LE(123n, 32);
  epoch[40] = PublicKey.findProgramAddressSync([Buffer.from('epoch'), u64(42n)], programId)[1];
  const currentEpoch = Buffer.concat([epoch, u64(17n)]);
  currentEpoch.writeBigUInt64LE(43n, 8);
  currentEpoch[40] = PublicKey.findProgramAddressSync([Buffer.from('epoch'), u64(43n)], programId)[1];
  const fakeConfig = Keypair.generate().publicKey;
  const foreignField = Keypair.generate().publicKey;
  const wrongEpochAddress = Keypair.generate().publicKey;
  const fixtures = [
    { key: configPda, data: config, owner: programId },
    { key: fakeConfig, data: config, owner: programId },
    { key: fieldPda(100n), data: field, owner: programId },
    { key: fieldPda(101n), data: currentField, owner: programId },
    { key: foreignField, data: field, owner: SystemProgram.programId },
    { key: epochPda(42n), data: epoch, owner: programId },
    { key: epochPda(43n), data: currentEpoch, owner: programId },
    { key: wrongEpochAddress, data: epoch, owner: programId },
  ];
  fs.mkdirSync('.anchor', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('.anchor/migration-'));
  const args = ['--reset', '--quiet', '--ledger', path.join(dir, 'ledger'),
    '--bind-address', '127.0.0.1', '--rpc-port', String(port), '--faucet-port', String(port + 101),
    '--bpf-program', programId.toBase58(), program];
  for (const [i, fixture] of fixtures.entries()) {
    const file = path.join(dir, `${i}.json`);
    fs.writeFileSync(file, JSON.stringify({ pubkey: fixture.key.toBase58(), account: {
      lamports: rent(fixture.data.length), data: [fixture.data.toString('base64'), 'base64'],
      owner: fixture.owner.toBase58(), executable: false, rentEpoch: 0,
    } }));
    args.push('--account', fixture.key.toBase58(), file);
  }
  const child = spawn('solana-test-validator', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let launchError: Error | undefined;
  child.once('error', error => { launchError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-12000); });
  const connection = new Connection(rpc, { commitment: 'confirmed', disableRetryOnRateLimit: true,
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(3000) }) });
  try {
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Validator exited: ${output}`);
      try { await connection.getVersion(); break; } catch { /* startup only */ }
      if (Date.now() > deadline) throw new Error(`Validator did not start: ${output}`);
      await delay(500);
    }
    // Prevent connecting to another process on this test port.
    assert.deepEqual((await connection.getAccountInfo(configPda))!.data, config);
    const airdrop = await connection.requestAirdrop(admin.publicKey, 2_000_000_000);
    await connection.confirmTransaction(airdrop, 'confirmed');
    let nonce = 0;
    const send = (kind: MigrationKind, target: PublicKey, signer = admin) => {
      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 + nonce++ }), migrationInstruction(kind, programId, target, signer.publicKey));
      tx.feePayer = admin.publicKey;
      return sendAndConfirmTransaction(connection, tx, signer === admin ? [admin] : [admin, signer]);
    };
    const reject = async (action: () => Promise<unknown>, code: string, target: PublicKey) => {
      const before = await connection.getAccountInfo(target);
      await assert.rejects(action, error => (String(error) + ((error as { logs?: string[] }).logs ?? []).join('\n')).includes(code));
      const after = await connection.getAccountInfo(target);
      assert.deepEqual(after!.data, before!.data);
      assert.equal(after!.lamports, before!.lamports);
    };
    await reject(() => send('config', configPda, intruder), 'Unauthorized', configPda);
    await reject(() => send('field', foreignField), 'ConstraintOwner', foreignField);
    await reject(() => send('field', configPda), 'BadProof', configPda);
    await reject(() => send('epoch', wrongEpochAddress), 'BadProof', wrongEpochAddress);
    const fakeIx = migrationInstruction('field', programId, fieldPda(100n), admin.publicKey);
    fakeIx.keys[1].pubkey = fakeConfig;
    await reject(() => sendAndConfirmTransaction(connection, new Transaction().add(fakeIx), [admin]), 'ConstraintSeeds', fieldPda(100n));

    // Migrate a Field while config is still legacy, then normalize the config.
    await send('field', fieldPda(100n));
    await send('config', configPda);
    await send('epoch', epochPda(42n));
    const migrated = (await connection.getAccountInfo(configPda))!.data;
    const c = decodeGameConfig(migrated);
    assert.equal(c.paused, true); assert.equal(c.bump, config.at(-1));
    assert.equal(c.pendingAuthority.toBase58(), pending.toBase58());
    assert.equal(c.potatoMint.toBase58(), potato.toBase58());
    assert.equal(c.rewardSigner.toBase58(), admin.publicKey.toBase58());
    assert.equal(c.epochId, 42n); assert.equal(c.totalBurnedMicro, 123_456n);
    assert.equal(c.lastTotalBurnedMicro, configSize === 156 ? 0n : 9876n);
    assert.deepEqual(migrated.subarray(168, 218), config.subarray(104, 154));
    assert.deepEqual((await connection.getAccountInfo(fieldPda(100n)))!.data, Buffer.concat([field, Buffer.from([0])]));
    assert.equal(decodeEpoch((await connection.getAccountInfo(epochPda(42n)))!.data).burnedMicro, 0n);

    for (const [kind, key, size] of [['config', configPda, 228], ['field', fieldPda(100n), 70],
      ['field', fieldPda(101n), 70], ['epoch', epochPda(42n), 49], ['epoch', epochPda(43n), 49]] as const) {
      const before = (await connection.getAccountInfo(key))!;
      assert.equal(before.lamports, await connection.getMinimumBalanceForRentExemption(size));
      await send(kind, key);
      const after = (await connection.getAccountInfo(key))!;
      assert.deepEqual(after.data, before.data); assert.equal(after.lamports, before.lamports);
    }
    assert.deepEqual((await connection.getAccountInfo(fieldPda(101n)))!.data, currentField);
    assert.deepEqual((await connection.getAccountInfo(epochPda(43n)))!.data, currentEpoch);
    console.log(`PASS: Config ${configSize}->228, Field 69->70, Epoch 41->49; rent, flags, idempotency and negative cases`);
  } finally {
    if (child.exitCode === null && !launchError) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await new Promise<void>(resolve => child.once('exit', () => resolve()));
      clearTimeout(timer);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
async function main() {
  if (!fs.existsSync(program)) throw new Error('Run anchor build before migration localnet tests');
  await run(156);
  await run(164);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
