/** Finite, isolated localnet test. Never reads a real key or talks to a public RPC.
 * Each run boots the built SBF program with exact legacy genesis fixtures.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Connection, Keypair, PublicKey, ComputeBudgetProgram, SystemProgram, Transaction, TransactionInstruction, type Signer } from '@solana/web3.js';
import { anchorDiscriminator, decodeGameConfig, decodeEpoch } from '../apps/backend/src/anchorRaw';
import { migrationInstruction, type MigrationKind } from './migrationClient';

const programId = new PublicKey('DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf');
const program = path.resolve('target/deploy/solana_potato.so');
const port = 18899;
const rpc = `http://127.0.0.1:${port}`;
const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
const adminStatePda = PublicKey.findProgramAddressSync([Buffer.from('admin_state')], programId)[0];
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
  // P1-3: текущая раскладка Field — v3 (78 байт): 69 байт v1 + mutation_type
  // в 69 + field_id u64 в 70..78. Id обязан совпадать с адресом PDA.
  const currentField = Buffer.concat([field, Buffer.from([2]), u64(101n)]);
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
  // F-02: legacy AdminState (97 bytes) at the canonical PDA + a copy at a
  // non-canonical address to prove the seeds check.
  const adminState = Buffer.alloc(97);
  anchorDiscriminator('account', 'AdminState').copy(adminState);
  adminState.writeBigInt64LE(1_700_000_000n, 8);
  adminState.writeBigUInt64LE(11n, 16);
  const wrongAdminStateAddress = Keypair.generate().publicKey;
  const fixtures = [
    { key: configPda, data: config, owner: programId },
    { key: fakeConfig, data: config, owner: programId },
    { key: fieldPda(100n), data: field, owner: programId },
    { key: fieldPda(101n), data: currentField, owner: programId },
    { key: foreignField, data: field, owner: SystemProgram.programId },
    { key: epochPda(42n), data: epoch, owner: programId },
    { key: epochPda(43n), data: currentEpoch, owner: programId },
    { key: wrongEpochAddress, data: epoch, owner: programId },
    { key: adminStatePda, data: adminState, owner: programId },
    { key: wrongAdminStateAddress, data: adminState, owner: programId },
  ];
  fs.mkdirSync('.anchor', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('.anchor/migration-'));
  const args = ['--reset', '--quiet', '--ledger', path.join(dir, 'ledger'),
    '--gossip-port', '19010', '--dynamic-port-range', '19011-19040',
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
  const connection = new Connection(rpc, { commitment: 'confirmed', confirmTransactionInitialTimeout: 30_000, disableRetryOnRateLimit: true,
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(3000) }) });
  try {
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Validator exited: ${output}`);
      try { await connection.getVersion(); break; } catch { /* startup only */ }
      if (Date.now() > deadline) throw new Error(`Validator did not start: ${output}`);
      await delay(500);
    }
    // Prevent connecting to another process on this test port.
    assert.deepEqual((await connection.getAccountInfo(configPda))!.data, config);
    // HTTP-only confirmation: do not leave SDK websocket reconnect timers alive
    // after the isolated validator shuts down. Every wait is bounded.
    const confirm = async (signature: string) => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Validator exited during confirmation');
        const status = (await connection.getSignatureStatuses([signature])).value[0];
        if (status?.err) throw new Error(`Localnet transaction failed: ${JSON.stringify(status.err)}`);
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature;
        await delay(250);
      }
      throw new Error('Localnet confirmation timed out after 30 seconds');
    };
    const sendTx = async (tx: Transaction, signers: Signer[]) => {
      tx.feePayer = admin.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
      tx.sign(...signers);
      return confirm(await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed', maxRetries: 2 }));
    };
    await confirm(await connection.requestAirdrop(admin.publicKey, 2_000_000_000));
    let nonce = 0;
    // P7: migrate_field accepts only the canonical [b"field", field_id] PDA, so
    // every field migration has to name the id the account was created with.
    // P7 negative cases must reach the program, but `migrationInstruction`
    // refuses to build a non-canonical field migration at all. That refusal is
    // the operator safeguard (asserted separately); to prove the on-chain check
    // still bites, build the same bytes without the client-side guard.
    const rawFieldIx = (target: PublicKey, fieldId: bigint) => new TransactionInstruction({
      programId,
      data: Buffer.concat([anchorDiscriminator('global', 'migrate_field'), u64(fieldId)]),
      keys: [
        { pubkey: target, isSigner: false, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
    });
    const sendRawField = (target: PublicKey, fieldId: bigint) =>
      sendTx(new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 + nonce++ }), rawFieldIx(target, fieldId)), [admin]);
    const send = (kind: MigrationKind, target: PublicKey, signer = admin, fieldId?: bigint) => {
      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 + nonce++ }), migrationInstruction(kind, programId, target, signer.publicKey, fieldId));
      tx.feePayer = admin.publicKey;
      return sendTx(tx, signer === admin ? [admin] : [admin, signer]);
    };
    const reject = async (action: () => Promise<unknown>, code: string, target: PublicKey) => {
      const before = await connection.getAccountInfo(target);
      await assert.rejects(action, error => (String(error) + ((error as { logs?: string[] }).logs ?? []).join('\n')).includes(code));
      const after = await connection.getAccountInfo(target);
      assert.deepEqual(after!.data, before!.data);
      assert.equal(after!.lamports, before!.lamports);
    };
    await reject(() => send('config', configPda, intruder), 'Unauthorized', configPda);
    // Клиент отказывается подписывать не-каноническую миграцию поля — это
    // первая линия защиты оператора, ещё до RPC.
    assert.throws(() => migrationInstruction('field', programId, foreignField, admin.publicKey, 100n),
      /Field must be the canonical/);
    assert.throws(() => migrationInstruction('field', programId, fieldPda(101n), admin.publicKey, 100n),
      /Field must be the canonical/);
    assert.throws(() => migrationInstruction('field', programId, fieldPda(100n), admin.publicKey),
      /Field migration requires the field id/);
    await reject(() => sendRawField(foreignField, 100n), 'ConstraintOwner', foreignField);
    // 100n относится к fieldPda(100n): чужой адрес с валидной раскладкой
    // отклоняется до записи — это и есть проверка P7 на цепи.
    await reject(() => sendRawField(fieldPda(101n), 100n), 'BadProof', fieldPda(101n));
    await reject(() => sendRawField(configPda, 100n), 'BadProof', configPda);
    await reject(() => send('epoch', wrongEpochAddress), 'BadProof', wrongEpochAddress);
    await reject(() => send('admin_state', wrongAdminStateAddress), 'ConstraintSeeds', wrongAdminStateAddress);
    const fakeIx = migrationInstruction('field', programId, fieldPda(100n), admin.publicKey, 100n);
    fakeIx.keys[1].pubkey = fakeConfig;
    await reject(() => sendTx(new Transaction().add(fakeIx), [admin]), 'ConstraintSeeds', fieldPda(100n));

    // Migrate a Field while config is still legacy, then normalize the config.
    await send('field', fieldPda(100n), admin, 100n);
    // P1-3: у уже-мигрированного (78 байт) поля id лежит внутри аккаунта, и
    // повторная миграция с другим id обязана быть отвергнута в migrations::field —
    // иначе authority «переименовало» бы поле, не меняя адреса.
    await reject(() => sendRawField(fieldPda(100n), 101n), 'BadProof', fieldPda(100n));
    await send('config', configPda);
    await send('epoch', epochPda(42n));
    await send('admin_state', adminStatePda);
    const migrated = (await connection.getAccountInfo(configPda))!.data;
    const c = decodeGameConfig(migrated);
    assert.equal(c.paused, true); assert.equal(c.bump, config.at(-1));
    assert.equal(c.pendingAuthority.toBase58(), pending.toBase58());
    assert.equal(c.potatoMint.toBase58(), potato.toBase58());
    assert.equal(c.rewardSigner.toBase58(), admin.publicKey.toBase58());
    assert.equal(c.epochId, 42n); assert.equal(c.totalBurnedMicro, 123_456n);
    assert.equal(c.lastTotalBurnedMicro, configSize === 156 ? 0n : 9876n);
    assert.equal(c.guardian.toBase58(), PublicKey.default.toBase58()); // F-02 default = disabled
    assert.equal(migrated.length, 260);
    assert.deepEqual(migrated.subarray(168, 218), config.subarray(104, 154));
    // v1 (69) → v3 (78): байты v1 не двигаются, mutation_type = 0, id дописан.
    assert.deepEqual(
      (await connection.getAccountInfo(fieldPda(100n)))!.data,
      Buffer.concat([field, Buffer.from([0]), u64(100n)]),
    );
    assert.equal(decodeEpoch((await connection.getAccountInfo(epochPda(42n)))!.data).grantedMicro, 0n);
    const migratedAdmin = (await connection.getAccountInfo(adminStatePda))!.data;
    assert.equal(migratedAdmin.length, 145);
    assert.equal(migratedAdmin.readBigInt64LE(8), 1_700_000_000n); // legacy fields preserved
    assert.equal(migratedAdmin.readBigUInt64LE(16), 11n);

    for (const [kind, key, size, fieldId] of [['config', configPda, 260, undefined], ['field', fieldPda(100n), 78, 100n],
      ['field', fieldPda(101n), 78, 101n], ['epoch', epochPda(42n), 49, undefined], ['epoch', epochPda(43n), 49, undefined],
      ['admin_state', adminStatePda, 145, undefined]] as const) {
      const before = (await connection.getAccountInfo(key))!;
      assert.equal(before.lamports, await connection.getMinimumBalanceForRentExemption(size));
      await send(kind, key, admin, fieldId);
      const after = (await connection.getAccountInfo(key))!;
      assert.deepEqual(after.data, before.data); assert.equal(after.lamports, before.lamports);
    }
    assert.deepEqual((await connection.getAccountInfo(fieldPda(101n)))!.data, currentField);
    assert.deepEqual((await connection.getAccountInfo(epochPda(43n)))!.data, currentEpoch);
    console.log(`PASS: Config ${configSize}->260, Field 69->78, Epoch 41->49, AdminState 97->145; rent, flags, idempotency and negative cases`);
  } catch (error) {
    console.error(`Migration fixture ${configSize} failed:`, error);
    console.error('Validator output:', output);
    const log = path.join(dir, 'ledger', 'validator.log');
    if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8').slice(-10000));
    throw error;
  } finally {
    if (child.exitCode === null && child.signalCode === null && !launchError) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), delay(6000).then(() => { throw new Error('Validator did not stop'); })]);
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
