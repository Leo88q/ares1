/**
 * Чтение платежа с цепи в снимок, который понимает чистая верификация
 * (`verify.ts`). Единственное место, где «сырой» ответ RPC превращается в
 * типизированный вид — всё остальное проверяется без ноды.
 *
 * Почему отдельно: ответ getTransaction громоздкий и versioned-транзакции
 * отдают ключи через getAccountKeys(), а токен-балансы — строками в
 * uiTokenAmount.amount. Если разбирать это в обработчике запроса, каждая
 * ветка становится непроверяемой. Здесь мы нормализуем один раз.
 */
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import type { Confirmation, ChainTransferView, ChainTokenTransferView, TokenBalanceView } from './verify.js';

export type { Confirmation };

export async function fetchConfirmation(connection: Connection, signature: string): Promise<Confirmation> {
  const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const status = statuses.value[0];
  if (!status) return 'processed';
  if (status.confirmationStatus === 'finalized') return 'finalized';
  if (status.confirmationStatus === 'confirmed') return 'confirmed';
  return 'processed';
}

interface KeyLike { toBase58: () => string }
interface LoadedAddressesLike { writable?: KeyLike[]; readonly?: KeyLike[] }
interface MessageKeysLike {
  staticAccountKeys?: KeyLike[];
  accountKeysFromLookups?: LoadedAddressesLike;
  keySegments?: () => KeyLike[][];
  get?: (index: number) => KeyLike | undefined;
  length?: number;
}
interface MessageLike {
  getAccountKeys?: (args?: { accountKeysFromLookups?: LoadedAddressesLike }) => MessageKeysLike;
  staticAccountKeys?: KeyLike[];
  accountKeys?: KeyLike[];
}
function accountKeysOf(tx: unknown): string[] {
  const raw = tx as {
    transaction?: { message?: unknown };
    meta?: { loadedAddresses?: LoadedAddressesLike | null };
  };
  const message = raw.transaction?.message as MessageLike | undefined;
  if (!message) return [];

  const loaded = raw.meta?.loadedAddresses ?? undefined;
  if (message.getAccountKeys) {
    try {
      const resolved = message.getAccountKeys(loaded ? { accountKeysFromLookups: loaded } : undefined);
      if (resolved.keySegments) return resolved.keySegments().flat().map(key => key.toBase58());
      if (resolved.get && resolved.length !== undefined) {
        return Array.from({ length: resolved.length }, (_, index) => resolved.get!(index)?.toBase58() ?? '');
      }
      return [
        ...(resolved.staticAccountKeys ?? []),
        ...(resolved.accountKeysFromLookups?.writable ?? []),
        ...(resolved.accountKeysFromLookups?.readonly ?? []),
      ].map(key => key.toBase58());
    } catch {
      // Older response shapes may not expose lookup addresses through Message;
      // the raw meta.loadedAddresses fallback below preserves balance indexes.
    }
  }
  if (message.accountKeys) return message.accountKeys.map(key => key.toBase58());
  return [
    ...(message.staticAccountKeys ?? []),
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ].map(key => key.toBase58());
}

export async function fetchPaymentView(
  connection: Connection,
  signature: string,
): Promise<ChainTransferView | null> {
  // Типовые декларации web3.js в этом воркспейсе не содержат maxSupportedVersion,
  // но RPC его поддерживает; каст обязателен, иначе versioned-транзакция = null.
  const tx = await connection.getTransaction(signature, { maxSupportedVersion: 0 } as never);
  if (!tx) return null;
  return {
    signature,
    slot: BigInt(tx.slot),
    blockTime: tx.blockTime === null || tx.blockTime === undefined ? null : BigInt(tx.blockTime),
    err: tx.meta?.err ?? null,
    accountKeys: accountKeysOf(tx),
    preBalances: (tx.meta?.preBalances ?? []).map(BigInt),
    postBalances: (tx.meta?.postBalances ?? []).map(BigInt),
    confirmation: await fetchConfirmation(connection, signature),
  };
}

function tokenBalancesOf(raw: unknown): TokenBalanceView[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: {
    accountIndex?: number;
    mint?: string;
    owner?: string;
    uiTokenAmount?: { amount?: string };
  }) => ({
    accountIndex: entry.accountIndex ?? -1,
    mint: entry.mint ?? '',
    owner: entry.owner ?? '',
    amount: BigInt(entry.uiTokenAmount?.amount ?? '0'),
  }));
}

export async function fetchTokenPaymentView(
  connection: Connection,
  signature: string,
): Promise<ChainTokenTransferView | null> {
  // Типовые декларации web3.js в этом воркспейсе не содержат maxSupportedVersion,
  // но RPC его поддерживает; каст обязателен, иначе versioned-транзакция = null.
  const tx = await connection.getTransaction(signature, { maxSupportedVersion: 0 } as never);
  if (!tx) return null;
  return {
    signature,
    slot: BigInt(tx.slot),
    blockTime: tx.blockTime === null || tx.blockTime === undefined ? null : BigInt(tx.blockTime),
    err: tx.meta?.err ?? null,
    accountKeys: accountKeysOf(tx),
    preTokenBalances: tokenBalancesOf(tx.meta?.preTokenBalances),
    postTokenBalances: tokenBalancesOf(tx.meta?.postTokenBalances),
    confirmation: await fetchConfirmation(connection, signature),
  };
}

/**
 * История притоков к кошельку-казначейству для сверки. Строится ТОЛЬКО из
 * истории кошелька — из неё же восстанавливается список плательщиков, поэтому
 * сверка не зависит от БД.
 */
const SIGNATURE_PAGE_SIZE = 1_000;
const MAX_SIGNATURE_PAGES = 1_000;

export async function fetchTreasuryTransfers(
  connection: Connection,
  treasury: string,
  minSlot = 0n,
): Promise<Array<{ signature: string; fromWallet: string; units: bigint; slot: bigint; blockTime: bigint | null }>> {
  const address = new PublicKey(treasury);
  const transfers: Array<{ signature: string; fromWallet: string; units: bigint; slot: bigint; blockTime: bigint | null }> = [];
  let before: string | undefined;

  // Signatures are newest-first. Page backwards until the run's starting slot
  // (or the beginning of history); a one-page response silently misses older
  // payments as soon as a treasury has more than 1,000 transactions.
  for (let page = 0; page < MAX_SIGNATURE_PAGES; page += 1) {
    const signatures = await connection.getSignaturesForAddress(
      address,
      { limit: SIGNATURE_PAGE_SIZE, ...(before ? { before } : {}) },
      'finalized',
    );
    if (signatures.length === 0) return transfers;

    let reachedMinSlot = false;
    for (const signature of signatures) {
      const slot = BigInt(signature.slot);
      if (slot < minSlot) {
        reachedMinSlot = true;
        break;
      }
      if (signature.err !== null) continue;
      const view = await fetchPaymentView(connection, signature.signature);
      if (!view) {
        throw new Error(`Finalized treasury transaction ${signature.signature} is unavailable from this RPC; refusing partial reconciliation`);
      }
      if (view.confirmation !== 'finalized' || view.slot !== BigInt(signature.slot)) {
        throw new Error(`RPC history/status mismatch for treasury transaction ${signature.signature}; refusing partial reconciliation`);
      }
      if (view.err !== null) continue;
      const index = view.accountKeys.findIndex(key => key === treasury);
      if (index < 0) continue;
      const received = view.postBalances[index] - view.preBalances[index];
      if (received <= 0n) continue;
      transfers.push({
        signature: signature.signature,
        fromWallet: view.accountKeys[0] ?? '',
        units: received,
        slot: view.slot,
        blockTime: view.blockTime,
      });
    }

    if (reachedMinSlot || signatures.length < SIGNATURE_PAGE_SIZE) return transfers;
    const lastSignature = signatures[signatures.length - 1]?.signature;
    if (!lastSignature || lastSignature === before) {
      throw new Error('RPC returned a non-advancing finalized signature page; refusing incomplete presale reconciliation');
    }
    before = lastSignature;
  }

  throw new Error(`Treasury history exceeds ${MAX_SIGNATURE_PAGES * SIGNATURE_PAGE_SIZE} signatures; refusing partial reconciliation`);
}
