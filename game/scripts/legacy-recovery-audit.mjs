#!/usr/bin/env node
/**
 * Read-only inventory for the historical 48D2… program and all loader-v3 buffers
 * owned by the configured operator wallet. This script never loads key files
 * and only calls Solana JSON-RPC read methods; it has no transaction builder.
 *
 * Output is JSON so CI can archive the complete snapshot and publish a compact
 * GitHub annotation. Lamports are kept as decimal strings in derived totals.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const UPGRADEABLE_LOADER_ID = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const EXPECTED_DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const LAMPORTS_PER_SOL = 1_000_000_000n;

const CONFIG_PATH = fileURLToPath(new URL('./rent-audit.config.json', import.meta.url));
const RPC_TIMEOUT_MS = 20_000;
const RPC_ATTEMPTS = 3;

export function base58Encode(input) {
  const bytes = Buffer.from(input);
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value /= 58n;
    encoded = alphabet[remainder] + encoded;
  }
  return '1'.repeat(zeros) + encoded || '1';
}

export function solFromLamports(value) {
  const lamports = BigInt(value ?? 0);
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, '0');
  return `${whole}.${fraction}`;
}

/** Read the public transaction id from the repo's own deployment record. */
export function findRepositoryRecordedDeploySignature(readmeText) {
  const deployRow = String(readmeText).split(/\r?\n/).find((line) => /Redeploy devnet/i.test(line));
  return deployRow?.match(/\btx\s+`([1-9A-HJ-NP-Za-km-z]{87,88})`/)?.[1] ?? null;
}

function numeric(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function accountData(account) {
  const data = account?.data;
  if (Array.isArray(data) && typeof data[0] === 'string') {
    return Buffer.from(data[0], data[1] === 'base64' || !data[1] ? 'base64' : data[1]);
  }
  if (typeof data === 'string') return Buffer.from(data, 'base64');
  return Buffer.alloc(0);
}

function accountMoney(account) {
  const lamports = numeric(account?.lamports);
  return {
    lamports,
    sol: lamports === null ? null : solFromLamports(lamports),
  };
}

/** Decode only the 36-byte UpgradeableLoaderState::Program header. */
export function parseProgramAccount(programId, account) {
  if (!account) return { exists: false, programId, valid: false, reason: 'getAccountInfo returned null' };
  const raw = accountData(account);
  const stateTag = raw.length >= 4 ? raw.readUInt32LE(0) : null;
  const programDataAddress = raw.length >= 36 && stateTag === 2
    ? base58Encode(raw.subarray(4, 36))
    : null;
  const valid = account.owner === UPGRADEABLE_LOADER_ID
    && account.executable === true
    && numeric(account.space) === 36
    && stateTag === 2
    && programDataAddress !== null;
  return {
    exists: true,
    programId,
    valid,
    ...(valid ? {} : { reason: 'account owner/executable/space/loader tag did not match UpgradeableLoaderState::Program' }),
    owner: account.owner ?? null,
    executable: account.executable ?? null,
    space: numeric(account.space),
    stateTag,
    programDataAddress,
    ...accountMoney(account),
  };
}

/** Decode the 13- or 45-byte ProgramData header; ELF bytes are never fetched. */
export function parseProgramDataAccount(address, account) {
  if (!account) return { exists: false, address, valid: false, reason: 'getAccountInfo returned null' };
  const raw = accountData(account);
  const stateTag = raw.length >= 4 ? raw.readUInt32LE(0) : null;
  const option = raw.length >= 13 ? raw[12] : null;
  const hasAuthority = option === 1;
  const headerBytes = hasAuthority ? 45 : 13;
  const authority = hasAuthority && raw.length >= 45 ? base58Encode(raw.subarray(13, 45)) : null;
  const valid = account.owner === UPGRADEABLE_LOADER_ID
    && stateTag === 3
    && (option === 0 || (hasAuthority && raw.length >= 45))
    && numeric(account.space) !== null
    && numeric(account.space) >= headerBytes;
  const slot = raw.length >= 12 && stateTag === 3 ? Number(raw.readBigUInt64LE(4)) : null;
  const space = numeric(account.space);
  const dataLen = valid && space !== null ? space - headerBytes : null;
  return {
    exists: true,
    address,
    valid,
    ...(valid ? {} : { reason: 'account owner/loader tag/authority header did not match UpgradeableLoaderState::ProgramData' }),
    owner: account.owner ?? null,
    executable: account.executable ?? null,
    stateTag,
    authorityOption: option,
    authority,
    slot: Number.isSafeInteger(slot) ? slot : null,
    headerBytes: valid ? headerBytes : null,
    space,
    dataLen,
    ...accountMoney(account),
  };
}

/** Validate each authority-filtered RPC result instead of trusting memcmp alone. */
export function parseBufferAccounts(rows, expectedAuthority) {
  const expected = String(expectedAuthority);
  const buffers = [];
  const unexpected = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const account = row?.account;
    const raw = accountData(account);
    const stateTag = raw.length >= 4 ? raw.readUInt32LE(0) : null;
    const authorityOption = raw.length >= 5 ? raw[4] : null;
    const authority = authorityOption === 1 && raw.length >= 37 ? base58Encode(raw.subarray(5, 37)) : null;
    const record = {
      address: row?.pubkey ?? null,
      ...accountMoney(account),
      space: numeric(account?.space),
      owner: account?.owner ?? null,
      stateTag,
      authorityOption,
      authority,
    };
    if (stateTag === 1 && authorityOption === 1 && authority === expected && account?.owner === UPGRADEABLE_LOADER_ID) {
      buffers.push(record);
    } else {
      unexpected.push(record);
    }
  }
  buffers.sort((a, b) => String(a.address).localeCompare(String(b.address)));
  const lamports = buffers.reduce((sum, item) => sum + BigInt(item.lamports ?? 0), 0n);
  return {
    measured: true,
    authority: expected,
    count: buffers.length,
    lamports: lamports.toString(),
    sol: solFromLamports(lamports),
    buffers,
    unexpectedMatches: unexpected,
    relationNote: 'Loader Buffer accounts are authority-owned, not program-linked; inventory is potential recovery only, not authorization to close.',
  };
}

function historySummary(value) {
  if (!Array.isArray(value)) return { measured: false, recent: [], reason: 'RPC result was not an array' };
  const recent = value.map((entry) => ({
    signature: entry.signature ?? null,
    slot: numeric(entry.slot),
    blockTime: numeric(entry.blockTime),
    err: entry.err ?? null,
  }));
  return {
    measured: true,
    countReturned: recent.length,
    latest: recent[0] ?? null,
    oldestInPage: recent.at(-1) ?? null,
    recent,
  };
}

function transactionSummary(signature, tx, focusIds) {
  if (!tx) return { signature, found: false };
  const message = tx.transaction?.message ?? {};
  const keys = Array.isArray(message.accountKeys) ? message.accountKeys : [];
  const keyRecords = keys.map((entry) => typeof entry === 'string'
    ? { pubkey: entry, signer: null }
    : { pubkey: entry?.pubkey ?? null, signer: entry?.signer ?? null });
  const accountKeys = keyRecords.map((entry) => entry.pubkey).filter(Boolean);
  const instructions = Array.isArray(message.instructions) ? message.instructions : [];
  const programIds = [...new Set(instructions.map((ix) => ix?.programId).filter((id) => typeof id === 'string'))];
  const innerInstructions = Array.isArray(tx.meta?.innerInstructions) ? tx.meta.innerInstructions.flatMap((group) => group.instructions ?? []) : [];
  const innerProgramIds = [...new Set(innerInstructions.map((ix) => ix?.programId).filter((id) => typeof id === 'string'))];
  return {
    signature,
    found: true,
    slot: numeric(tx.slot),
    blockTime: numeric(tx.blockTime),
    success: tx.meta?.err === null,
    signers: keyRecords.filter((entry) => entry.signer === true).map((entry) => entry.pubkey),
    mentions: Object.fromEntries(focusIds.map((id) => [id, accountKeys.includes(id)])),
    topLevelProgramIds: programIds,
    innerProgramIds,
    accountKeyCount: accountKeys.length,
  };
}

async function rpcCall(endpoint, method, params, fetchImpl = globalThis.fetch) {
  let lastError;
  for (let attempt = 0; attempt < RPC_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: `${method}-${attempt}`, method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`RPC ${body.error.code ?? ''}: ${String(body.error.message ?? 'unknown error').slice(0, 180)}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < RPC_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
  throw lastError ?? new Error(`${method} failed`);
}

async function safeRpc(endpoint, method, params, fetchImpl) {
  try {
    return { measured: true, result: await rpcCall(endpoint, method, params, fetchImpl) };
  } catch (error) {
    return { measured: false, reason: `${method}: ${String(error?.message ?? error).slice(0, 220)}` };
  }
}

function accountInfoConfig(dataSliceLength) {
  return {
    encoding: 'base64',
    commitment: 'confirmed',
    dataSlice: { offset: 0, length: dataSliceLength },
  };
}

export async function runLegacyRecoveryAudit({
  rpcUrl,
  legacyProgramId,
  currentProgramId,
  authority,
  knownDeploySignature = null,
  fetchImpl = globalThis.fetch,
}) {
  const host = (() => {
    try {
      const parsed = new URL(rpcUrl);
      return parsed.hostname === 'api.devnet.solana.com' ? parsed.hostname : 'custom endpoint (redacted)';
    } catch {
      return 'invalid-rpc-url';
    }
  })();
  const readOnlyMethods = [
    'getGenesisHash', 'getVersion', 'getSlot', 'getAccountInfo',
    'getSignaturesForAddress', 'getTransaction', 'getBalance', 'getProgramAccounts',
  ];
  const commitment = 'confirmed';
  const clusterGenesis = await safeRpc(rpcUrl, 'getGenesisHash', [], fetchImpl);
  const clusterVersion = await safeRpc(rpcUrl, 'getVersion', [], fetchImpl);
  const clusterSlot = await safeRpc(rpcUrl, 'getSlot', [{ commitment }], fetchImpl);

  const legacyProgramInfo = await safeRpc(rpcUrl, 'getAccountInfo', [legacyProgramId, accountInfoConfig(36)], fetchImpl);
  const legacyProgramValue = legacyProgramInfo.measured ? legacyProgramInfo.result?.value ?? null : null;
  const legacyProgram = legacyProgramInfo.measured
    ? parseProgramAccount(legacyProgramId, legacyProgramValue)
    : { exists: null, programId: legacyProgramId, valid: false, reason: legacyProgramInfo.reason };
  const legacyHistoryRaw = await safeRpc(rpcUrl, 'getSignaturesForAddress', [legacyProgramId, { commitment, limit: 20 }], fetchImpl);
  const legacyHistory = legacyHistoryRaw.measured
    ? historySummary(legacyHistoryRaw.result)
    : { measured: false, recent: [], reason: legacyHistoryRaw.reason };

  let legacyProgramDataInfo = { measured: true, result: { value: null, context: null } };
  if (legacyProgram.valid && legacyProgram.programDataAddress) {
    legacyProgramDataInfo = await safeRpc(rpcUrl, 'getAccountInfo', [legacyProgram.programDataAddress, accountInfoConfig(45)], fetchImpl);
  }
  const legacyProgramDataValue = legacyProgramDataInfo.measured
    ? legacyProgramDataInfo.result?.value ?? null
    : null;
  const legacyProgramData = legacyProgramDataInfo.measured
    ? parseProgramDataAccount(legacyProgram.programDataAddress, legacyProgramDataValue)
    : { exists: null, address: legacyProgram.programDataAddress, valid: false, reason: legacyProgramDataInfo.reason };

  const currentProgramInfo = await safeRpc(rpcUrl, 'getAccountInfo', [currentProgramId, accountInfoConfig(36)], fetchImpl);
  const currentProgramValue = currentProgramInfo.measured ? currentProgramInfo.result?.value ?? null : null;
  const currentProgram = currentProgramInfo.measured
    ? parseProgramAccount(currentProgramId, currentProgramValue)
    : { exists: null, programId: currentProgramId, valid: false, reason: currentProgramInfo.reason };
  let currentProgramDataInfo = { measured: true, result: { value: null, context: null } };
  if (currentProgram.valid && currentProgram.programDataAddress) {
    currentProgramDataInfo = await safeRpc(rpcUrl, 'getAccountInfo', [currentProgram.programDataAddress, accountInfoConfig(45)], fetchImpl);
  }
  const currentProgramData = currentProgramDataInfo.measured
    ? parseProgramDataAccount(currentProgram.programDataAddress, currentProgramDataInfo.result?.value ?? null)
    : { exists: null, address: currentProgram.programDataAddress, valid: false, reason: currentProgramDataInfo.reason };

  const legacyProgramDataHistoryRaw = legacyProgramData.valid
    ? await safeRpc(rpcUrl, 'getSignaturesForAddress', [legacyProgramData.address, { commitment, limit: 20 }], fetchImpl)
    : { measured: true, result: [] };
  const legacyProgramDataHistory = legacyProgramDataHistoryRaw.measured
    ? historySummary(legacyProgramDataHistoryRaw.result)
    : { measured: false, recent: [], reason: legacyProgramDataHistoryRaw.reason };
  const currentProgramDataHistoryRaw = currentProgramData.valid
    ? await safeRpc(rpcUrl, 'getSignaturesForAddress', [currentProgramData.address, { commitment, limit: 20 }], fetchImpl)
    : { measured: true, result: [] };
  const currentProgramDataHistory = currentProgramDataHistoryRaw.measured
    ? historySummary(currentProgramDataHistoryRaw.result)
    : { measured: false, recent: [], reason: currentProgramDataHistoryRaw.reason };
  const currentHistoryRaw = await safeRpc(rpcUrl, 'getSignaturesForAddress', [currentProgramId, { commitment, limit: 5 }], fetchImpl);
  const currentHistory = currentHistoryRaw.measured
    ? historySummary(currentHistoryRaw.result)
    : { measured: false, recent: [], reason: currentHistoryRaw.reason };
  const walletHistoryRaw = await safeRpc(rpcUrl, 'getSignaturesForAddress', [authority, { commitment, limit: 20 }], fetchImpl);
  const walletHistory = walletHistoryRaw.measured
    ? historySummary(walletHistoryRaw.result)
    : { measured: false, recent: [], reason: walletHistoryRaw.reason };
  const walletBalanceRaw = await safeRpc(rpcUrl, 'getBalance', [authority, { commitment }], fetchImpl);
  const walletBalanceLamports = walletBalanceRaw.measured ? numeric(walletBalanceRaw.result?.value) : null;
  const walletBalance = {
    measured: walletBalanceRaw.measured && walletBalanceLamports !== null,
    address: authority,
    lamports: walletBalanceLamports,
    sol: walletBalanceLamports === null ? null : solFromLamports(walletBalanceLamports),
    contextSlot: walletBalanceRaw.measured ? numeric(walletBalanceRaw.result?.context?.slot) : null,
    ...(walletBalanceRaw.measured && walletBalanceLamports === null ? { reason: 'getBalance returned a non-safe lamport value' } : {}),
    ...(!walletBalanceRaw.measured ? { reason: walletBalanceRaw.reason } : {}),
  };

  const buffersRaw = await safeRpc(rpcUrl, 'getProgramAccounts', [UPGRADEABLE_LOADER_ID, {
    commitment,
    encoding: 'base64',
    // Buffer layout is [tag:u32][Option<Pubkey>], authority at offset 5.
    // Filter only on authority, then validate loader tag + embedded authority
    // locally; this avoids false negatives from encoding enum/Option variants.
    filters: [{ memcmp: { offset: 5, bytes: authority } }],
    dataSlice: { offset: 0, length: 37 },
    withContext: true,
  }], fetchImpl);
  const bufferResult = buffersRaw.measured ? buffersRaw.result : null;
  const bufferRows = Array.isArray(bufferResult) ? bufferResult : bufferResult?.value;
  const buffers = buffersRaw.measured && Array.isArray(bufferRows)
    ? parseBufferAccounts(bufferRows, authority)
    : { measured: false, authority, count: null, lamports: null, sol: null, buffers: [], unexpectedMatches: [], reason: buffersRaw.measured ? 'getProgramAccounts result was not an array' : buffersRaw.reason };
  buffers.contextSlot = buffersRaw.measured ? numeric(bufferResult?.context?.slot) : null;
  buffers.query = 'getProgramAccounts(loader-v3) memcmp authority at offset 5; locally require Buffer tag=1 and Some(authority)';

  const oldLatestSignature = legacyHistory.measured ? legacyHistory.latest?.signature : null;
  const oldLatestTx = oldLatestSignature
    ? await safeRpc(rpcUrl, 'getTransaction', [oldLatestSignature, {
      encoding: 'jsonParsed', commitment, maxSupportedTransactionVersion: 0,
    }], fetchImpl)
    : { measured: true, result: null };
  const oldLatestTransaction = oldLatestTx.measured
    ? transactionSummary(oldLatestSignature, oldLatestTx.result, [legacyProgramId, currentProgramId, authority])
    : { signature: oldLatestSignature, found: false, reason: oldLatestTx.reason };

  const signatureAtDataSlot = (history, dataAccount) => dataAccount.valid
    ? history.recent.find((entry) => entry.slot === dataAccount.slot)?.signature ?? null
    : null;
  const legacyDeploySignature = signatureAtDataSlot(legacyProgramDataHistory, legacyProgramData);
  const currentDeploySignature = signatureAtDataSlot(currentProgramDataHistory, currentProgramData);
  const transactionAtSignature = async (signature) => {
    if (!signature) return { signature: null, found: false };
    const tx = await safeRpc(rpcUrl, 'getTransaction', [signature, {
      encoding: 'jsonParsed', commitment, maxSupportedTransactionVersion: 0,
    }], fetchImpl);
    return tx.measured
      ? transactionSummary(signature, tx.result, [legacyProgramId, currentProgramId, authority])
      : { signature, found: false, reason: tx.reason };
  };
  const legacyProgramDataDeployment = legacyDeploySignature === oldLatestSignature
    ? oldLatestTransaction
    : await transactionAtSignature(legacyDeploySignature);
  const currentProgramDataDeployment = await transactionAtSignature(currentDeploySignature);

  const repositoryRecordedTxRaw = knownDeploySignature
    ? await safeRpc(rpcUrl, 'getTransaction', [knownDeploySignature, {
      encoding: 'jsonParsed', commitment, maxSupportedTransactionVersion: 0,
    }], fetchImpl)
    : { measured: true, result: null };
  const repositoryRecordedTransaction = repositoryRecordedTxRaw.measured
    ? transactionSummary(knownDeploySignature, repositoryRecordedTxRaw.result, [legacyProgramId, currentProgramId, authority])
    : { signature: knownDeploySignature, found: false, reason: repositoryRecordedTxRaw.reason };

  const clusterGenesisHash = clusterGenesis.measured ? clusterGenesis.result : null;
  const isExpectedDevnet = clusterGenesisHash === EXPECTED_DEVNET_GENESIS;
  const programAuthorityMatchesRecipient = legacyProgramData.valid
    && legacyProgramData.authority === authority;
  const oldProgramLamports = legacyProgram.valid && programAuthorityMatchesRecipient
    ? BigInt(legacyProgram.lamports ?? 0) + BigInt(legacyProgramData.lamports ?? 0)
    : 0n;
  const bufferLamports = buffers.measured ? BigInt(buffers.lamports) : null;
  const totalPotential = bufferLamports === null ? null : oldProgramLamports + bufferLamports;
  const currentAuthorityMatchesWallet = currentProgramData.valid && currentProgramData.authority === authority;
  const latestLegacyReferenceSlot = legacyHistory.measured ? legacyHistory.latest?.slot ?? null : null;
  const legacyLastReferencePredatesCurrentDeployment = Number.isSafeInteger(latestLegacyReferenceSlot)
    && Number.isSafeInteger(currentProgramData.slot)
    ? latestLegacyReferenceSlot < currentProgramData.slot
    : null;

  return {
    schemaVersion: 1,
    readOnly: true,
    rpc: { host, commitment, readOnlyMethods },
    cluster: {
      genesisHash: clusterGenesisHash,
      expectedDevnetGenesisHash: EXPECTED_DEVNET_GENESIS,
      isExpectedDevnet,
      version: clusterVersion.measured ? clusterVersion.result?.['solana-core'] ?? null : null,
      versionMeasured: clusterVersion.measured,
      versionReason: clusterVersion.measured ? null : clusterVersion.reason,
      confirmedSlot: clusterSlot.measured ? numeric(clusterSlot.result) : null,
      slotMeasured: clusterSlot.measured,
      slotReason: clusterSlot.measured ? null : clusterSlot.reason,
    },
    ids: { legacyProgramId, currentProgramId, operatorWallet: authority },
    legacyProgram,
    legacyProgramData,
    legacyProgramDataHistory,
    legacyProgramDataDeployment,
    legacyHistory,
    legacyLatestTransaction: oldLatestTransaction,
    currentProgram,
    currentProgramData,
    currentProgramDataHistory,
    currentProgramDataDeployment,
    currentProgramAuthorityMatchesOperator: currentAuthorityMatchesWallet,
    currentProgramHistory: currentHistory,
    operatorWallet: {
      address: authority,
      balance: walletBalance,
      history: walletHistory,
      repositoryRecordedTransaction,
    },
    buffers,
    recovery: {
      programAndProgramDataLamports: oldProgramLamports.toString(),
      programAndProgramDataSol: solFromLamports(oldProgramLamports),
      programAuthorityMatchesOperator: programAuthorityMatchesRecipient,
      authorityBuffersLamports: buffers.measured ? buffers.lamports : null,
      authorityBuffersSol: buffers.measured ? buffers.sol : null,
      totalPotentialLamports: totalPotential === null ? null : totalPotential.toString(),
      totalPotentialSol: totalPotential === null ? null : solFromLamports(totalPotential),
      legacyLatestReferenceSlot: latestLegacyReferenceSlot,
      currentProgramDataDeploymentSlot: numeric(currentProgramData.slot),
      legacyLastReferencePredatesCurrentDeployment,
      grossBalancesBeforeTransactionFees: true,
      exactRecipientCandidate: authority,
      recipientBasis: currentAuthorityMatchesWallet
        ? 'configured operator wallet matches the current DUUBi… ProgramData upgrade authority; each buffer is separately validated against its embedded authority'
        : 'configured operator wallet is the buffer-owner query key; verify the signer public key independently before any close',
      approval: 'potential recovery only; no account is safe-to-close until individually reviewed and separately approved by the owner',
    },
    provenance: {
      repositoryRecordedSignature: knownDeploySignature,
      repositoryRecordedSource: 'game/README.md deployment record; decoded through getTransaction and not assumed to target the current program',
      secretKeyRead: false,
      transactionSent: false,
    },
  };
}

function configValue(name, fallback) {
  return process.env[name] || fallback;
}

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const knownDeploySignature = findRepositoryRecordedDeploySignature(readme);
  const result = await runLegacyRecoveryAudit({
    rpcUrl: configValue('RPC_URL', config.rpc),
    legacyProgramId: configValue('LEGACY_PROGRAM_ID', config.legacyProgramId),
    currentProgramId: configValue('PROGRAM_ID', config.programId),
    authority: configValue('DEPLOYER', config.deployer),
    knownDeploySignature,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    // Do not print the RPC URL (which could contain a provider token).
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, readOnly: true, measured: false, reason: String(error?.message ?? error).slice(0, 300) })}\n`);
  });
}
