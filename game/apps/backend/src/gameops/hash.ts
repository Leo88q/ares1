/**
 * Хэш-цепочка журнала наград.
 *
 * Контракт (его проверяют: триггер БД на связность, `verifyChain` на содержимое
 * и внешний Merkle-якорь):
 *   canonical(row) = chainId|recipientAta|amountMicro|signature|slot|blockTime|intentId
 *   row_hash       = sha256(prevHash + '|' + canonical(row))
 *
 * Канонизация намеренно простая и детерминированная между языками: bigint —
 * десятичной строкой, время — ISO-8601 в UTC с миллисекундами, пустое значение —
 * пустая строка. Любое изменение формата = новая версия цепочки (chain_id),
 * иначе старые и новые записи нельзя проверить одним правилом.
 */
import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface LedgerRowPayload {
  chainId: string;
  recipientAta: string;
  amountMicro: bigint;
  signature: string;
  slot: bigint;
  blockTime: Date;
  intentId?: bigint | string | null;
}

export interface LedgerRow {
  id: bigint | string;
  chain_id: string;
  recipient_ata: string;
  amount_micro: bigint | string;
  signature: string;
  slot: bigint | string;
  block_time: Date | string;
  intent_id: bigint | string | null;
  prev_hash: string;
  row_hash: string;
}

export interface ChainHead {
  lastHash: string;
  lastId: bigint;
  rowCount: bigint;
}

const asBigIntString = (value: bigint | string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

/** ISO-8601 в UTC с миллисекундами — одинаковая строка для Date и для строки из БД. */
export function canonicalTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid blockTime');
  return date.toISOString();
}

export function canonicalLedgerRow(row: LedgerRowPayload): string {
  return [
    row.chainId,
    row.recipientAta,
    asBigIntString(row.amountMicro),
    row.signature,
    asBigIntString(row.slot),
    canonicalTime(row.blockTime),
    asBigIntString(row.intentId),
  ].join('|');
}

export function computeRowHash(prevHash: string, row: LedgerRowPayload): string {
  return createHash('sha256').update(`${prevHash}|${canonicalLedgerRow(row)}`).digest('hex');
}

/** Хэш строки, уже лежащей в БД (пересчёт из колонок). */
export function hashStoredRow(prevHash: string, row: LedgerRow): string {
  return computeRowHash(prevHash, {
    chainId: row.chain_id,
    recipientAta: row.recipient_ata,
    amountMicro: BigInt(row.amount_micro),
    signature: row.signature,
    slot: BigInt(row.slot),
    blockTime: row.block_time instanceof Date ? row.block_time : new Date(row.block_time),
    intentId: row.intent_id,
  });
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAt?: string;
  reason?: 'content_mismatch' | 'link_broken' | 'head_mismatch' | 'row_count_mismatch';
}

export interface VerifyChainOptions {
  /** Цепочка, к которой обязаны принадлежать все проверяемые строки. */
  expectedChainId?: string;
  /**
   * prev_hash, на который обязана ссылаться первая строка окна. Для полной
   * проверки — GENESIS_HASH (по умолчанию), для проверки хвоста — row_hash
   * строки, стоящей непосредственно перед окном: тогда «окно» тоже связно.
   */
  startPrevHash?: string;
  /** Голова цепочки: сверяется с последней строкой окна. */
  head?: ChainHead | null;
  /** true — окно покрывает всю цепочку, поэтому сверяется ещё и row_count. */
  full?: boolean;
}

/**
 * Проверка целостности: (1) содержимое каждой строки даёт её row_hash,
 * (2) ссылки prev_hash образуют цепочку от startPrevHash, (3) при full —
 * голова совпадает с последней строкой и числом записей. Любое расхождение —
 * признак подмены или сбоя, и сервис обязан уходить в fail-closed (readiness.ts).
 */
export function verifyChain(rows: LedgerRow[], options: VerifyChainOptions = {}): ChainVerification {
  const { expectedChainId, startPrevHash = GENESIS_HASH, head = null, full = false } = options;
  // Начало окна неизвестно (усечённый хвост без якоря) — честно сказать об этом
  // нельзя, но и «зелёный» отдавать нельзя: окно без предыдущего хэша недоказуемо.
  if (!full && rows.length && !startPrevHash) {
    return { ok: false, checked: 0, brokenAt: String(rows[0]!.id), reason: 'link_broken' };
  }
  let prev = startPrevHash;
  for (const [index, row] of rows.entries()) {
    if (expectedChainId && row.chain_id !== expectedChainId) {
      return { ok: false, checked: index, brokenAt: String(row.id), reason: 'content_mismatch' };
    }
    if (row.prev_hash !== prev) {
      return { ok: false, checked: index, brokenAt: String(row.id), reason: 'link_broken' };
    }
    if (hashStoredRow(row.prev_hash, row) !== row.row_hash) {
      return { ok: false, checked: index, brokenAt: String(row.id), reason: 'content_mismatch' };
    }
    prev = row.row_hash;
  }
  if (head) {
    if (rows.length && rows[rows.length - 1]!.row_hash !== head.lastHash) {
      return { ok: false, checked: rows.length, brokenAt: String(head.lastId), reason: 'head_mismatch' };
    }
    if (full && head.rowCount !== BigInt(rows.length)) {
      return { ok: false, checked: rows.length, brokenAt: String(head.lastId), reason: 'row_count_mismatch' };
    }
  }
  return { ok: true, checked: rows.length };
}

/** Merkle-корень суток (листья — row_hash): то, что печётся ончейн-якорем. */
export function merkleRoot(leaves: readonly string[]): string {
  if (!leaves.length) return createHash('sha256').update('').digest('hex');
  let level = [...leaves].sort();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = Buffer.from(level[i]!, 'hex');
      const right = Buffer.from(level[i + 1] ?? level[i]!, 'hex');
      next.push(createHash('sha256').update(left).update(right).digest('hex'));
    }
    level = next;
  }
  return level[0]!;
}

/** Детерминированный «nonce» из бизнес-события — для идемпотентных офчейн-операций. */
export function deriveNonce(parts: readonly (string | number | bigint)[]): bigint {
  const digest = createHash('sha256').update(parts.map(String).join('|')).digest();
  return digest.readBigUInt64BE(0) & 0x7fffffffffffffffn;
}
