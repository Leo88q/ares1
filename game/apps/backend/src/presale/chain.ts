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
  const statuses = await connection.getSignatureStatuses([signature]);
  const status = statuses.value[0];
  if (!status) return 'processed';
  if (status.confirmationStatus === 'finalized') return 'finalized';
  if (status.confirmationStatus === 'confirmed') return 'confirmed';
  return 'processed';
}

interface MessageLike {
  getAccountKeys?: () => { staticAccountKeys?: Array<{ toBase58: () => string }> };
  accountKeys?: Array<{ toBase58: () => string }>;
}
function accountKeysOf(tx: unknown): string[] {
  const message = (tx as { transaction?: { message?: unknown } }).transaction?.message as MessageLike | undefined;
  if (!message) return [];
  const keys = message.getAccountKeys?.().staticAccountKeys ?? message.accountKeys ?? [];
  return keys.map((k: { toBase58: () => string }) => k.toBase58());
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
export async function fetchTreasuryTransfers(
  connection: Connection,
  treasury: string,
  minSlot = 0n,
): Promise<Array<{ signature: string; fromWallet: string; units: bigint; slot: bigint; blockTime: bigint | null }>> {
  const sigs = await connection.getSignaturesForAddress(
    new PublicKey(treasury),
    { limit: 1000 },
    'confirmed',
  );
  void minSlot;
  const transfers = [];
  for (const sig of sigs) {
    const view = await fetchPaymentView(connection, sig.signature);
    if (!view || view.err !== null) continue;
    const index = view.accountKeys.findIndex(k => k === treasury);
    if (index < 0) continue;
    const received = view.postBalances[index] - view.preBalances[index];
    if (received <= 0n) continue;
    transfers.push({
      signature: sig.signature,
      fromWallet: view.accountKeys[0] ?? '',
      units: received,
      slot: view.slot,
      blockTime: view.blockTime,
    });
  }
  return transfers;
}
