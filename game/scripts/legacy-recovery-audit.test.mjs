import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPGRADEABLE_LOADER_ID,
  base58Encode,
  findRepositoryRecordedDeploySignature,
  parseBufferAccounts,
  parseProgramAccount,
  parseProgramDataAccount,
  runLegacyRecoveryAudit,
  solFromLamports,
} from './legacy-recovery-audit.mjs';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

function programAccount(programDataKey, { lamports = 1_234_567, space = 36 } = {}) {
  const data = Buffer.alloc(36);
  data.writeUInt32LE(2, 0);
  Buffer.from(programDataKey).copy(data, 4);
  return { owner: UPGRADEABLE_LOADER_ID, executable: true, lamports, space, data: [b64(data), 'base64'] };
}

function programDataAccount(authorityKey, { lamports = 5_678_901_234, dataLen = 12_345, slot = 99 } = {}) {
  const data = Buffer.alloc(45);
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(BigInt(slot), 4);
  data[12] = 1;
  Buffer.from(authorityKey).copy(data, 13);
  return {
    owner: UPGRADEABLE_LOADER_ID,
    executable: false,
    lamports,
    space: 45 + dataLen,
    data: [b64(data), 'base64'],
  };
}

function bufferRow(address, authorityKey, { lamports = 2_000_000_000, space = 100_037, tag = 1 } = {}) {
  const data = Buffer.alloc(37);
  data.writeUInt32LE(tag, 0);
  data[4] = 1;
  Buffer.from(authorityKey).copy(data, 5);
  return {
    pubkey: address,
    account: {
      owner: UPGRADEABLE_LOADER_ID,
      executable: false,
      lamports,
      space,
      data: [b64(data), 'base64'],
    },
  };
}

test('base58 encoder preserves leading zero bytes and encodes 32-byte public keys', () => {
  assert.equal(base58Encode(Buffer.from([0, 0, 1])), '112');
  const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
  assert.equal(base58Encode(key).length > 32, true);
});

test('deployment signature is read from the README record instead of hardcoded as secret-shaped text', () => {
  const signature = '1'.repeat(87);
  assert.equal(findRepositoryRecordedDeploySignature(`| Redeploy devnet | slot 1, tx \`${signature}\` |`), signature);
  assert.equal(findRepositoryRecordedDeploySignature('| no deployment receipt |'), null);
});

test('SOL rendering is exact to one lamport', () => {
  assert.equal(solFromLamports('33572795440'), '33.572795440');
  assert.equal(solFromLamports(1), '0.000000001');
  assert.equal(solFromLamports(0), '0.000000000');
});

test('Program and ProgramData headers expose balances, address, slot, and authority', () => {
  const programDataKey = Buffer.from(Array.from({ length: 32 }, (_, i) => 255 - i));
  const authorityKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
  const authority = base58Encode(authorityKey);
  const program = parseProgramAccount('legacy-id', programAccount(programDataKey));
  assert.equal(program.valid, true);
  assert.equal(program.programDataAddress, base58Encode(programDataKey));
  assert.equal(program.lamports, 1_234_567);
  assert.equal(program.sol, '0.001234567');

  const programData = parseProgramDataAccount(program.programDataAddress, programDataAccount(authorityKey));
  assert.equal(programData.valid, true);
  assert.equal(programData.authority, authority);
  assert.equal(programData.slot, 99);
  assert.equal(programData.space, 12_390);
  assert.equal(programData.dataLen, 12_345);
  assert.equal(programData.lamports, 5_678_901_234);
});

test('missing program account is an explicit measured absence, not a zero-filled fake account', () => {
  const program = parseProgramAccount('legacy-id', null);
  assert.equal(program.exists, false);
  assert.equal(program.valid, false);
  assert.match(program.reason, /null/);
});

test('buffer parser includes only loader Buffer accounts whose embedded authority matches', () => {
  const authorityKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 10));
  const otherAuthority = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 11));
  const authority = base58Encode(authorityKey);
  const result = parseBufferAccounts([
    bufferRow('buffer-A', authorityKey, { lamports: 3_000_000_000 }),
    bufferRow('buffer-B', otherAuthority, { lamports: 4_000_000_000 }),
    bufferRow('not-buffer', authorityKey, { lamports: 5_000_000_000, tag: 2 }),
  ], authority);
  assert.equal(result.measured, true);
  assert.equal(result.count, 1);
  assert.equal(result.lamports, '3000000000');
  assert.equal(result.sol, '3.000000000');
  assert.equal(result.buffers[0].address, 'buffer-A');
  assert.equal(result.unexpectedMatches.length, 2);
  assert.match(result.relationNote, /potential recovery only/);
});

test('RPC audit stays read-only and reports absence separately from authority-owned buffers', async () => {
  const legacyId = 'legacy-public-key';
  const currentId = 'current-public-key';
  const authorityBytes = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 20));
  const authority = base58Encode(authorityBytes);
  const programDataBytes = Buffer.from(Array.from({ length: 32 }, (_, i) => 200 - i));
  const programDataAddress = base58Encode(programDataBytes);
  const programDataRaw = Buffer.alloc(45);
  programDataRaw.writeUInt32LE(3, 0);
  programDataRaw.writeBigUInt64LE(123n, 4);
  programDataRaw[12] = 1;
  authorityBytes.copy(programDataRaw, 13);
  const currentProgramRaw = Buffer.alloc(36);
  currentProgramRaw.writeUInt32LE(2, 0);
  programDataBytes.copy(currentProgramRaw, 4);
  const bufferBytes = Buffer.alloc(37);
  bufferBytes.writeUInt32LE(1, 0);
  bufferBytes[4] = 1;
  authorityBytes.copy(bufferBytes, 5);
  const methods = [];
  let bufferQueryConfig;

  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    methods.push(request.method);
    let result;
    switch (request.method) {
      case 'getGenesisHash': result = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'; break;
      case 'getVersion': result = { 'solana-core': '4.3.0' }; break;
      case 'getSlot': result = 100; break;
      case 'getAccountInfo': {
        const [address, options] = request.params;
        if (address === legacyId) result = { context: { slot: 100 }, value: null };
        else if (address === currentId) result = { context: { slot: 100 }, value: {
          owner: UPGRADEABLE_LOADER_ID, executable: true, lamports: 1_000_000,
          space: 36, data: [b64(currentProgramRaw), 'base64'],
        } };
        else if (address === programDataAddress && options.dataSlice.length === 45) result = { context: { slot: 100 }, value: {
          owner: UPGRADEABLE_LOADER_ID, executable: false, lamports: 9_000_000,
          space: 145, data: [b64(programDataRaw), 'base64'],
        } };
        else throw new Error(`unexpected account ${address}`);
        break;
      }
      case 'getSignaturesForAddress': {
        const [address] = request.params;
        result = address === legacyId ? [] : [{ signature: `${address}-latest`, slot: 99, blockTime: 1_800_000_000, err: null }];
        break;
      }
      case 'getBalance': result = { context: { slot: 100 }, value: 24_000_000 }; break;
      case 'getProgramAccounts': {
        bufferQueryConfig = request.params[1];
        result = { context: { slot: 100 }, value: [{
          pubkey: 'owned-buffer', account: {
            owner: UPGRADEABLE_LOADER_ID, executable: false, lamports: 3_000_000_000,
            space: 50_037, data: [b64(bufferBytes), 'base64'],
          },
        }] };
        break;
      }
      case 'getTransaction': result = {
        slot: 80, blockTime: 1_799_000_000, meta: { err: null },
        transaction: { message: {
          accountKeys: [{ pubkey: authority, signer: true }, { pubkey: currentId, signer: false }],
          instructions: [{ programId: currentId }],
        } },
      }; break;
      default: throw new Error(`unexpected RPC method ${request.method}`);
    }
    return { ok: true, async json() { return { jsonrpc: '2.0', id: request.id, result }; } };
  };

  const audit = await runLegacyRecoveryAudit({
    rpcUrl: 'https://api.devnet.solana.com', legacyProgramId: legacyId,
    currentProgramId: currentId, authority, knownDeploySignature: 'known-deploy', fetchImpl,
  });
  assert.equal(audit.readOnly, true);
  assert.equal(audit.cluster.isExpectedDevnet, true);
  assert.equal(audit.legacyProgram.exists, false);
  assert.equal(audit.legacyHistory.countReturned, 0);
  assert.equal(audit.currentProgramAuthorityMatchesOperator, true);
  assert.equal(audit.operatorWallet.balance.lamports, 24_000_000);
  assert.equal(audit.buffers.count, 1);
  assert.equal(audit.buffers.lamports, '3000000000');
  assert.equal(audit.buffers.contextSlot, 100);
  assert.equal(bufferQueryConfig.withContext, true);
  assert.deepEqual(bufferQueryConfig.filters, [{ memcmp: { offset: 5, bytes: authority } }]);
  assert.equal(audit.recovery.programAndProgramDataLamports, '0');
  assert.equal(audit.recovery.totalPotentialLamports, '3000000000');
  assert.equal(audit.recovery.exactRecipientCandidate, authority);
  assert.equal(audit.operatorWallet.repositoryRecordedTransaction.signers[0], authority);
  assert.equal(methods.every((method) => !/send|airdrop|close/i.test(method)), true);
});
