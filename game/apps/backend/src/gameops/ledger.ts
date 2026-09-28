/**
 * Журнал наград: append-only зеркало финализированных ончейн-событий.
 *
 * Как обеспечивается целостность (три независимых уровня):
 *   1) права: роль-писатель не имеет UPDATE/DELETE на эту таблицу;
 *   2) триггер: statement-level проверка связности батча + блокировка головы
 *      цепочки (`FOR UPDATE`) — конкурентные писатели сериализуются;
 *   3) содержимое: row_hash = sha256(prev_hash|canonical(row)), проверяется
 *      `verifyChainTail`; суточный Merkle-корень печётся ончейн (anchor).
 *
 * Производительность: вставка пачкой через `unnest` (один round-trip на пачку),
 * хэши считаются в приложении (в БД нет зависимости от pgcrypto). Нагрузочный
 * прогон и сравнение «по одной строке vs пачками» — scripts/bench-db.ts.
 */
import { GameOpsError } from './errors.js';
import { computeRowHash, GENESIS_HASH, merkleRoot, verifyChain, type ChainHead, type LedgerRow, type ChainVerification } from './hash.js';
import { query, withTransaction, type Client, type Pool } from './pool.js';

export interface LedgerAppendInput {
  recipientAta: string;
  amountMicro: bigint;
  signature: string;
  slot: bigint;
  blockTime: Date;
  intentId?: string | bigint | null;
  chainId?: string;
}

export interface AppendResult {
  inserted: number;
  skipped: number;
  lastHash: string;
  headId: string;
}

const DEFAULT_CHAIN = 'reward';
const INSERT_CHUNK = 1_000;

async function lockHead(client: Client, chainId: string): Promise<ChainHead> {
  await client.query(
    'INSERT INTO game_ops.ledger_chain_head (chain_id, last_hash) VALUES ($1, $2) ON CONFLICT (chain_id) DO NOTHING',
    [chainId, GENESIS_HASH],
  );
  const result = await client.query<{ last_hash: string; last_id: string; row_count: string }>(
    'SELECT last_hash, last_id, row_count FROM game_ops.ledger_chain_head WHERE chain_id = $1 FOR UPDATE',
    [chainId],
  );
  const row = result.rows[0];
  if (!row) throw new GameOpsError('UNEXPECTED', 'Голова цепочки недоступна', undefined, 500);
  return { lastHash: row.last_hash, lastId: BigInt(row.last_id), rowCount: BigInt(row.row_count) };
}

/**
 * Добавление пачки в журнал.
 *
 * Уже существующие (signature, recipient_ata) отбрасываются ДО расчёта хэшей:
 * иначе пропущенная строка разорвала бы цепочку и триггер справедливо отклонил
 * бы весь батч. Фильтр выполняется под блокировкой головы, поэтому гонки нет.
 */
export async function appendBatch(
  pool: Pool,
  rows: readonly LedgerAppendInput[],
  actor: string,
  chainId = DEFAULT_CHAIN,
): Promise<AppendResult> {
  if (!rows.length) {
    const head = await query<{ last_hash: string; last_id: string }>(pool, 'SELECT last_hash, last_id FROM game_ops.ledger_chain_head WHERE chain_id = $1', [chainId]);
    return { inserted: 0, skipped: 0, lastHash: head[0]?.last_hash ?? GENESIS_HASH, headId: head[0]?.last_id ?? '0' };
  }
  rows.forEach(row => {
    if (row.amountMicro <= 0n) throw new GameOpsError('VALIDATION', 'amountMicro должен быть больше нуля');
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature)) throw new GameOpsError('VALIDATION', 'signature не похожа на base58-подпись');
    if (row.slot < 0n) throw new GameOpsError('VALIDATION', 'slot не может быть отрицательным');
    if (Number.isNaN(row.blockTime.getTime())) throw new GameOpsError('VALIDATION', 'blockTime некорректен');
  });

  return withTransaction(pool, actor, async client => {
    const head = await lockHead(client, chainId);
    const signatures = rows.map(row => row.signature);
    const existing = await client.query<{ signature: string }>(
      'SELECT signature FROM game_ops.reward_ledger WHERE signature = ANY($1::text[])',
      [signatures],
    );
    const known = new Set(existing.rows.map(row => row.signature));
    const fresh = rows.filter(row => !known.has(row.signature));
    if (!fresh.length) return { inserted: 0, skipped: rows.length, lastHash: head.lastHash, headId: String(head.lastId) };

    // Хэши считаются последовательно по всей пачке до её отправки; внутри
    // каждого чанка отдельно храним prev_hash каждой строки — так батч любой
    // длины остаётся связным и не требует пересчёта предыдущих чанков.
    let prev = head.lastHash;
    let inserted = 0;
    for (let offset = 0; offset < fresh.length; offset += INSERT_CHUNK) {
      const chunk = fresh.slice(offset, offset + INSERT_CHUNK);
      const prevHashes: string[] = [];
      const hashes: string[] = [];
      for (const row of chunk) {
        prevHashes.push(prev);
        const hash = computeRowHash(prev, {
          chainId: row.chainId ?? chainId,
          recipientAta: row.recipientAta,
          amountMicro: row.amountMicro,
          signature: row.signature,
          slot: row.slot,
          blockTime: row.blockTime,
          intentId: row.intentId ?? null,
        });
        hashes.push(hash);
        prev = hash;
      }
      const insertedRows = await client.query<{ id: string; row_hash: string }>(
        `INSERT INTO game_ops.reward_ledger
           (chain_id, intent_id, recipient_ata, amount_micro, signature, slot, block_time, prev_hash, row_hash)
         SELECT $1, b.intent_id::bigint, b.recipient, b.amount::bigint, b.signature, b.slot::bigint, b.block_time::timestamptz,
                b.prev_hash, b.row_hash
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::timestamptz[], $8::text[], $9::text[])
              AS b(intent_id, recipient, amount, signature, slot, block_time, prev_hash, row_hash)
         RETURNING id, row_hash`,
        [
          chainId,
          chunk.map(row => (row.intentId == null ? null : String(row.intentId))),
          chunk.map(row => row.recipientAta),
          chunk.map(row => row.amountMicro.toString()),
          chunk.map(row => row.signature),
          chunk.map(row => row.slot.toString()),
          chunk.map(row => row.blockTime.toISOString()),
          prevHashes,
          hashes,
        ],
      );
      inserted += insertedRows.rowCount ?? 0;
    }
    // Голову двигает триггер: читаем её обратно, чтобы вернуть не «своё
    // представление о состоянии», а факт из БД.
    const updatedHead = await client.query<{ last_hash: string; last_id: string }>(
      'SELECT last_hash, last_id FROM game_ops.ledger_chain_head WHERE chain_id = $1',
      [chainId],
    );
    const finalHead = updatedHead.rows[0];
    return {
      inserted,
      skipped: rows.length - inserted,
      lastHash: finalHead?.last_hash ?? prev,
      headId: finalHead?.last_id ?? String(head.lastId),
    };
  });
}

/** Одна строка — тонкая обёртка (используется индексатором событий). */
export async function appendOne(pool: Pool, row: LedgerAppendInput, actor: string, chainId = DEFAULT_CHAIN): Promise<AppendResult> {
  return appendBatch(pool, [row], actor, chainId);
}

export interface ChainReport extends ChainVerification {
  mode: 'full' | 'tail';
  headRowCount: string;
}

/**
 * Проверка целостности. `full` — вся цепочка с генезиса (аудит, ночь/CI),
 * `tail` — последние N записей (быстрая проверка readiness): содержимое каждой
 * строки + связность внутри окна (якорь — row_hash строки перед окном) +
 * совпадение последней строки с головой.
 */
export async function verifyChainTail(pool: Pool, options: { chainId?: string; limit?: number; full?: boolean } = {}): Promise<ChainReport> {
  const chainId = options.chainId ?? DEFAULT_CHAIN;
  const limit = Math.min(Math.max(options.limit ?? 1_000, 1), 100_000);
  const headRows = await query<{ last_hash: string; last_id: string; row_count: string }>(
    pool, 'SELECT last_hash, last_id, row_count FROM game_ops.ledger_chain_head WHERE chain_id = $1', [chainId],
  );
  const head = headRows[0];
  const total = head ? BigInt(head.row_count) : 0n;
  const full = options.full === true || total <= BigInt(limit);
  if (full) {
    const rows = await query<LedgerRow>(pool, 'SELECT * FROM game_ops.reward_ledger WHERE chain_id = $1 ORDER BY id ASC', [chainId]);
    const verification = verifyChain(rows, {
      expectedChainId: chainId,
      head: head ? { lastHash: head.last_hash, lastId: BigInt(head.last_id), rowCount: total } : null,
      full: true,
    });
    return { ...verification, mode: 'full', headRowCount: String(total) };
  }
  const rows = await query<LedgerRow>(
    pool, 'SELECT * FROM (SELECT * FROM game_ops.reward_ledger WHERE chain_id = $1 ORDER BY id DESC LIMIT $2) AS t ORDER BY id ASC',
    [chainId, limit],
  );
  // Якорь окна: хэш строки, непосредственно предшествующей первой проверяемой.
  // Без него окно недоказуемо (в него можно вклеить «свою» цепочку).
  const anchorRows = rows.length
    ? await query<{ row_hash: string }>(
        pool, 'SELECT row_hash FROM game_ops.reward_ledger WHERE chain_id = $1 AND id < $2 ORDER BY id DESC LIMIT 1',
        [chainId, String(rows[0]!.id)],
      )
    : [];
  const startPrevHash = rows.length ? (anchorRows[0]?.row_hash ?? GENESIS_HASH) : GENESIS_HASH;
  const verification = verifyChain(rows, {
    expectedChainId: chainId,
    startPrevHash,
    head: head ? { lastHash: head.last_hash, lastId: BigInt(head.last_id), rowCount: total } : null,
    full: false,
  });
  return { ...verification, mode: 'tail', headRowCount: String(total) };
}

export async function tail(pool: Pool, chainId = DEFAULT_CHAIN, limit = 100): Promise<LedgerRow[]> {
  return query<LedgerRow>(
    pool,
    'SELECT * FROM (SELECT * FROM game_ops.reward_ledger WHERE chain_id = $1 ORDER BY id DESC LIMIT $2) AS t ORDER BY id ASC',
    [chainId, limit],
  );
}

/**
 * Merkle-якорь окна: листья — row_hash. Корень уходит ончейн (или в подписанный
 * чекпойнт), а прогресс «до какого id запечатано» живёт в курсоре
 * `anchor:<chainId>` таблицы service_cursors.
 *
 * Функция НЕ двигает курсор сама: якорь нельзя считать записанным, пока
 * транзакция якоря не подтверждена ончейн. Порядок такой: `merkleAnchor` →
 * отправка/подтверждение якоря → `advanceCursor` (CAS-версия не даст двум
 * пакетам запечатать одно и то же окно дважды).
 */
export async function merkleAnchor(
  pool: Pool,
  input: { chainId?: string; limit?: number; toId?: string; actor: string },
): Promise<{ root: string; leaves: number; fromId: string; toId: string }> {
  const chainId = input.chainId ?? DEFAULT_CHAIN;
  const limit = Math.min(Math.max(input.limit ?? 10_000, 1), 100_000);
  const cursorStream = `anchor:${chainId}`;
  const cursor = await query<{ state: { anchoredTo?: string } }>(
    pool, 'SELECT state FROM game_ops.service_cursors WHERE stream_id = $1', [cursorStream],
  );
  const anchoredTo = cursor[0]?.state?.anchoredTo ? BigInt(cursor[0].state.anchoredTo) : 0n;
  const rows = await query<{ id: string; row_hash: string }>(
    pool,
    `SELECT id, row_hash FROM game_ops.reward_ledger
     WHERE chain_id = $1 AND id > $2 AND ($3::bigint IS NULL OR id <= $3::bigint)
     ORDER BY id LIMIT $4`,
    [chainId, anchoredTo.toString(), input.toId ?? null, limit],
  );
  const root = merkleRoot(rows.map(row => row.row_hash));
  const lastId = rows.length ? BigInt(rows[rows.length - 1]!.id) : anchoredTo;
  return { root, leaves: rows.length, fromId: (anchoredTo + 1n).toString(), toId: lastId.toString() };
}
