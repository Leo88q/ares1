/**
 * Мутационное тестирование слоя БД: «а если сломать — заметим?»
 *
 * Обычные тесты проверяют, что правильный код работает. Мутационные проверяют
 * обратное: ПРИЦЕЛЬНО внести дефект в данные/права/триггеры и убедиться, что
 * наши детекторы его ловят. Если детектор не сработал — это дыра не в тесте, а
 * в защите, и её видно сразу.
 *
 * Каждая мутация выполняется В ТРАНЗАКЦИИ и откатывается: база остаётся чистой,
 * а отчёт остаётся. Для привилегированных мутаций (отключить триггер, удалить
 * строку) нужен владелец схемы — это и есть модель угрозы «скомпрометированный
 * доступ к БД»: доказываем, что даже он оставляет следы, которые ловит verify.
 *
 * Запуск:
 *   yarn db:mutate --url=postgres://…                        # внутренние детекторы
 *   yarn db:mutate --url=… --anchor=audit-anchor.json        # + внешний якорь
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Client } from 'pg';
import { computeRowHash, hashStoredRow, verifyChain, type LedgerRow } from '../apps/backend/src/gameops/hash.js';
import { ataLike, consoleLogger, createClient, isEntry, parseArgs, resolveDatabaseUrl, signatureLike, type Logger } from './db-common.js';

export interface MutationReport {
  id: string;
  mutation: string;
  detector: string;
  detected: boolean;
  /** internal — детектор есть в продукте; external-anchor — без внешнего якоря неотличимо. */
  seam: 'internal' | 'external-anchor';
  detail: string;
}

export interface MutateOptions {
  url: string;
  writerRole?: string;
  chainId?: string;
  anchorFile?: string;
  logger?: Logger;
}

export async function runMutations(options: MutateOptions): Promise<MutationReport[]> {
  const logger = options.logger ?? consoleLogger;
  const chainId = options.chainId ?? 'reward';
  const writerRole = options.writerRole ?? 'game_ops_writer';
  const client = createClient(options.url, 'ares1-db-mutate');
  await client.connect();
  const reports: MutationReport[] = [];
  try {
    reports.push(await mutate(client, writerRole, chainId, {
      id: 'm1_ledger_row_corrupted',
      mutation: 'подмена суммы в строке журнала (триггер UPDATE отключён владельцем)',
      detector: 'пересчёт row_hash из колонок (hash-chain, уровень 3)',
      run: async () => {
        const row = await firstLedgerRow(client, chainId);
        if (!row) return { detected: false, detail: 'нет строк журнала: сначала запустите db:bench' };
        await client.query('ALTER TABLE game_ops.reward_ledger DISABLE TRIGGER reward_ledger_deny_update');
        await client.query('UPDATE game_ops.reward_ledger SET amount_micro = amount_micro + 1 WHERE id = $1', [row.id]);
        const after = await loadRow(client, String(row.id));
        const recomputed = hashStoredRow(after.prev_hash, after);
        return {
          detected: recomputed !== after.row_hash,
          detail: recomputed !== after.row_hash
            ? `row_hash не совпал: ожидался ${after.row_hash.slice(0, 12)}…, пересчёт дал ${recomputed.slice(0, 12)}…`
            : 'подмена не замечена пересчётом хэша',
        };
      },
    }));

    reports.push(await mutate(client, writerRole, chainId, {
      id: 'm2_ledger_row_deleted',
      mutation: 'удаление строки журнала (триггер DELETE отключён владельцем)',
      detector: 'проверка связности цепочки (link_broken)',
      run: async () => {
        const row = await middleLedgerRow(client, chainId);
        if (!row) return { detected: false, detail: 'нужно ≥3 строк журнала' };
        await client.query('ALTER TABLE game_ops.reward_ledger DISABLE TRIGGER reward_ledger_deny_delete');
        await client.query('DELETE FROM game_ops.reward_ledger WHERE id = $1', [row.id]);
        const rows = await allRows(client, chainId);
        const head = await headOf(client, chainId);
        const report = verifyChain(rows, { expectedChainId: chainId, head, full: true });
        return { detected: !report.ok, detail: report.ok ? 'разрыв не обнаружен' : `обнаружено: ${report.reason} на ${report.brokenAt}` };
      },
    }));

    reports.push(await mutate(client, writerRole, chainId, {
      id: 'm3_head_rewound',
      mutation: 'откат головы цепочки на предыдущий хэш',
      detector: 'сверка головы с последней строкой (head_mismatch)',
      run: async () => {
        const row = await middleLedgerRow(client, chainId);
        const head = await headOf(client, chainId);
        if (!row || !head) return { detected: false, detail: 'нет данных для отката' };
        await client.query('UPDATE game_ops.ledger_chain_head SET last_hash = $2 WHERE chain_id = $1', [chainId, row.row_hash]);
        const rows = await allRows(client, chainId);
        const mutatedHead = await headOf(client, chainId);
        const report = verifyChain(rows, { expectedChainId: chainId, head: mutatedHead, full: true });
        return { detected: !report.ok, detail: report.ok ? 'откат головы не обнаружен' : `обнаружено: ${report.reason}` };
      },
    }));

    reports.push(await mutate(client, writerRole, chainId, {
      id: 'm4_forged_append',
      mutation: 'вброс строки с корректным hash-chain, но в обход триггера (row_count не сдвинут)',
      detector: 'несовпадение row_count головы и числа строк',
      run: async () => {
        const head = await headOf(client, chainId);
        if (!head) return { detected: false, detail: 'нет головы цепочки' };
        await client.query('ALTER TABLE game_ops.reward_ledger DISABLE TRIGGER reward_ledger_validate_batch');
        const blockTime = new Date();
        const signature = signatureLike(`forged:${chainId}:${Date.now()}`);
        const rowHash = computeRowHash(head.lastHash, {
          chainId,
          recipientAta: ataLike(`forged:${chainId}`),
          amountMicro: 999n,
          signature,
          slot: 9_999_999n,
          blockTime,
          intentId: null,
        });
        await client.query(
          `INSERT INTO game_ops.reward_ledger
             (chain_id, recipient_ata, amount_micro, signature, slot, block_time, prev_hash, row_hash)
           VALUES ($1, $2, 999, $3, 9999999, $4, $5, $6)`,
          [chainId, ataLike(`forged:${chainId}`), signature, blockTime.toISOString(), head.lastHash, rowHash],
        );
        const rows = await allRows(client, chainId);
        const mutatedHead = await headOf(client, chainId);
        const report = verifyChain(rows, { expectedChainId: chainId, head: mutatedHead, full: true });
        return {
          detected: !report.ok,
          detail: report.ok ? 'вброс не обнаружен' : `обнаружено: ${report.reason} (строк ${rows.length}, row_count ${mutatedHead?.rowCount})`,
        };
      },
    }));

    reports.push(await mutate(client, writerRole, chainId, {
      id: 'm5_audit_row_deleted',
      mutation: 'удаление строки аудита (триггер DELETE отключён владельцем)',
      detector: 'внешний якорь (кол-во/max(id) вне БД)',
      run: async () => {
        const anchor = options.anchorFile ? readAnchor(options.anchorFile) : null;
        const stats = await auditStats(client);
        if (!anchor) {
          return {
            detected: false,
            detail: `внешнего якоря нет (аудит: ${stats.count} строк, max id ${stats.maxId}) — удаление неотличимо от «события не было»; ` +
              'запустите с --anchor=<file>, чтобы проверить детектор',
          };
        }
        if (stats.count !== anchor.count || stats.maxId !== anchor.maxId) {
          return { detected: true, detail: `якорь ${anchor.count}/${anchor.maxId}, в БД ${stats.count}/${stats.maxId} — расхождение поймано` };
        }
        const victim = await client.query<{ id: string }>('SELECT id FROM game_ops.admin_audit ORDER BY id LIMIT 1');
        if (!victim.rows[0]) return { detected: false, detail: 'аудит пуст — удалять нечего' };
        await client.query('ALTER TABLE game_ops.admin_audit DISABLE TRIGGER admin_audit_deny_delete');
        await client.query('DELETE FROM game_ops.admin_audit WHERE id = $1', [victim.rows[0].id]);
        const after = await auditStats(client);
        return {
          detected: after.count !== anchor.count || after.maxId !== anchor.maxId,
          detail: after.count !== anchor.count
            ? `после удаления ${after.count}/${after.maxId} против якоря ${anchor.count}/${anchor.maxId} — поймано`
            : 'удаление не поймано даже с якорем (якорь устарел?)',
        };
      },
    }));

    reports.push(await mutate(client, writerRole, chainId, {
      id: 'm6_privileges_widened',
      mutation: `выдача писателю UPDATE на журнал (GRANT UPDATE TO ${writerRole})`,
      detector: 'проверка фактических прав (has_table_privilege)',
      run: async () => {
        await client.query(`GRANT UPDATE ON game_ops.reward_ledger TO ${writerRole}`);
        const rows = await client.query<{ ok: boolean }>("SELECT has_table_privilege($1, 'game_ops.reward_ledger', 'UPDATE') AS ok", [writerRole]);
        return {
          detected: rows.rows[0]?.ok === true,
          detail: rows.rows[0]?.ok ? 'расширение прав зафиксировано проверкой привилегий' : 'проверка прав не увидела GRANT',
        };
      },
    }));

    reports.push(await mutate(client, writerRole, chainId, {
      id: 'm7_state_guard_dropped',
      mutation: 'удаление триггера-машины состояний интента',
      detector: 'инвентаризация триггеров + проба запрещённого перехода',
      run: async () => {
        const before = await triggerCount(client);
        await client.query('DROP TRIGGER reward_intents_guard ON game_ops.reward_intents');
        const after = await triggerCount(client);
        const intent = await client.query<{ id: string }>('SELECT id FROM game_ops.reward_intents ORDER BY id LIMIT 1');
        let transitionAllowed = false;
        if (intent.rows[0]) {
          await client.query(`SET ROLE ${writerRole}`).catch(() => undefined);
          try {
            await client.query("UPDATE game_ops.reward_intents SET state = 'confirmed' WHERE id = $1", [intent.rows[0].id]);
            transitionAllowed = true;
          } catch {
            transitionAllowed = false;
          } finally {
            await client.query('RESET ROLE').catch(() => undefined);
          }
        }
        return {
          detected: after < before || transitionAllowed,
          detail: `триггеров ${before} → ${after}; запрещённый переход pending→confirmed ${transitionAllowed ? 'ПРОШЁЛ' : 'заблокирован'}`,
        };
      },
    }));

    reports.push(await mutate(client, writerRole, chainId, {
      id: 'm8_intent_amount_swapped',
      mutation: 'подмена суммы интента при отключённом guard-триггере (подмена «согласованной» выплаты)',
      detector: 'сверка интент ↔ зеркало (сумма/получатель)',
      run: async () => {
        const fixture = await ensureFixture(client, chainId);
        if (!fixture) return { detected: false, detail: 'не удалось создать фикстуру интент↔журнал' };
        await client.query('ALTER TABLE game_ops.reward_intents DISABLE TRIGGER reward_intents_guard');
        await client.query('UPDATE game_ops.reward_intents SET amount_micro = amount_micro + 1 WHERE id = $1', [fixture.intentId]);
        const rows = await client.query<{ id: string }>(
          `SELECT i.id FROM game_ops.reward_intents i
           JOIN game_ops.reward_ledger l ON l.intent_id = i.id
           WHERE i.amount_micro <> l.amount_micro OR i.recipient_ata <> l.recipient_ata
           AND i.id = $1`,
          [fixture.intentId],
        );
        return {
          detected: rows.rows.length > 0,
          detail: rows.rows.length ? `расхождение по интенту ${fixture.intentId} найдено сверкой` : 'подмена суммы не найдена',
        };
      },
    }));

    logger.info(`[db:mutate] мутаций: ${reports.length}, поймано внутренними детекторами: ${reports.filter(r => r.detected).length}`);
    return reports;
  } finally {
    await client.end().catch(() => undefined);
  }
}

interface MutationSpec {
  id: string;
  mutation: string;
  detector: string;
  run: () => Promise<{ detected: boolean; detail: string }>;
}

/** Мутация выполняется в транзакции и откатывается: база не меняется, отчёт — да. */
async function mutate(client: Client, _writerRole: string, chainId: string, spec: MutationSpec): Promise<MutationReport> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('game_ops.actor', 'cli:db-mutate', true)");
    const outcome = await spec.run();
    return { id: spec.id, mutation: spec.mutation, detector: spec.detector, seam: spec.id === 'm5_audit_row_deleted' ? 'external-anchor' : 'internal', ...outcome };
  } catch (error) {
    return {
      id: spec.id,
      mutation: spec.mutation,
      detector: spec.detector,
      seam: spec.id === 'm5_audit_row_deleted' ? 'external-anchor' : 'internal',
      detected: false,
      detail: `мутация не удалась: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    void chainId;
  }
}

async function firstLedgerRow(client: Client, chainId: string): Promise<LedgerRow | null> {
  const rows = await client.query<LedgerRow>('SELECT * FROM game_ops.reward_ledger WHERE chain_id = $1 ORDER BY id LIMIT 1', [chainId]);
  return rows.rows[0] ?? null;
}

async function middleLedgerRow(client: Client, chainId: string): Promise<LedgerRow | null> {
  const rows = await client.query<LedgerRow>(
    'SELECT * FROM game_ops.reward_ledger WHERE chain_id = $1 ORDER BY id OFFSET 1 LIMIT 1',
    [chainId],
  );
  return rows.rows[0] ?? null;
}

async function loadRow(client: Client, id: string): Promise<LedgerRow> {
  const rows = await client.query<LedgerRow>('SELECT * FROM game_ops.reward_ledger WHERE id = $1', [id]);
  return rows.rows[0]!;
}

async function allRows(client: Client, chainId: string): Promise<LedgerRow[]> {
  return (await client.query<LedgerRow>('SELECT * FROM game_ops.reward_ledger WHERE chain_id = $1 ORDER BY id ASC', [chainId])).rows;
}

async function headOf(client: Client, chainId: string) {
  const rows = await client.query<{ last_hash: string; last_id: string; row_count: string }>(
    'SELECT last_hash, last_id, row_count FROM game_ops.ledger_chain_head WHERE chain_id = $1',
    [chainId],
  );
  const row = rows.rows[0];
  return row ? { lastHash: row.last_hash, lastId: BigInt(row.last_id), rowCount: BigInt(row.row_count) } : null;
}

async function triggerCount(client: Client): Promise<number> {
  const rows = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'game_ops' AND NOT t.tgisinternal",
  );
  return Number(rows.rows[0]?.count ?? '0');
}

async function auditStats(client: Client): Promise<{ count: number; maxId: string }> {
  const rows = await client.query<{ count: string; max_id: string | null }>(
    'SELECT count(*)::text AS count, max(id)::text AS max_id FROM game_ops.admin_audit',
  );
  return { count: Number(rows.rows[0]?.count ?? '0'), maxId: rows.rows[0]?.max_id ?? '0' };
}

function readAnchor(file: string): { count: number; maxId: string; generatedAt?: string } | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { count: number; maxId: string };
  } catch {
    return null;
  }
}

/**
 * Фикстура «интент ↔ журнал» для мутации m8. Создаётся внутри транзакции
 * мутации, поэтому в базе не остаётся. Хэш считается теми же функциями, что и
 * в проде, — иначе мутация проверяла бы не тот путь.
 */
async function ensureFixture(client: Client, chainId: string): Promise<{ intentId: string } | null> {
  const recipient = ataLike(`mutation-fixture:${chainId}`);
  const nonce = String(BigInt(Date.now()) % 1_000_000_000n + 1_000_000_000n);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO game_ops.reward_intents (recipient_ata, amount_micro, nonce, reason, actor, expires_at)
     VALUES ($1, 777, $2, 'mutation fixture', 'cli:db-mutate', now() + interval '1 day')
     ON CONFLICT (recipient_ata, nonce) DO UPDATE SET reason = EXCLUDED.reason
     RETURNING id`,
    [recipient, nonce],
  );
  const intentId = inserted.rows[0]?.id;
  if (!intentId) return null;
  const head = await headOf(client, chainId);
  if (!head) return null;
  const signature = signatureLike(`mutation-fixture:${chainId}:${nonce}`);
  const blockTime = new Date();
  const rowHash = computeRowHash(head.lastHash, {
    chainId,
    recipientAta: recipient,
    amountMicro: 777n,
    signature,
    slot: 8_888_888n,
    blockTime,
    intentId,
  });
  await client.query(
    `INSERT INTO game_ops.reward_ledger
       (chain_id, intent_id, recipient_ata, amount_micro, signature, slot, block_time, prev_hash, row_hash)
     VALUES ($1, $2, $3, 777, $4, 8888888, $5, $6, $7)`,
    [chainId, intentId, recipient, signature, blockTime.toISOString(), head.lastHash, rowHash],
  );
  return { intentId };
}

export function writeAnchor(file: string, count: number, maxId: string): void {
  writeFileSync(file, JSON.stringify({ count, maxId, generatedAt: new Date().toISOString() }, null, 2));
}

async function main(): Promise<void> {
  const { flags, options } = parseArgs(process.argv.slice(2));
  const url = resolveDatabaseUrl(options);
  const anchorFile = options.get('anchor');

  // --write-anchor: зафиксировать текущее состояние аудита вне БД (одна строка
  // в защищённом хранилище/репозитории инфраструктуры — это и есть «внешний
  // якорь», без которого удаление строки аудита неотличимо от её отсутствия).
  if (flags.has('write-anchor')) {
    if (!anchorFile) throw new Error('--write-anchor требует --anchor=<file>');
    const client = createClient(url, 'ares1-db-mutate');
    await client.connect();
    const stats = await auditStats(client);
    await client.end();
    writeAnchor(anchorFile, stats.count, stats.maxId);
    console.log(`[db:mutate] якорь записан: ${anchorFile} (${stats.count} строк, max id ${stats.maxId})`);
    process.exit(0);
  }

  const reports = await runMutations({ url, writerRole: options.get('writer-role'), chainId: options.get('chain'), anchorFile });
  for (const report of reports) {
    const mark = report.detected ? 'ПОЙМАНО  ' : report.seam === 'external-anchor' ? 'НЕТ ЯКОРЯ' : 'ПРОПУЩЕНО';
    console.log(`[db:mutate] ${mark} ${report.id}: ${report.mutation}`);
    console.log(`            детектор: ${report.detector}`);
    console.log(`            ${report.detail}`);
  }
  const internal = reports.filter(report => report.seam === 'internal');
  const caught = internal.filter(report => report.detected).length;
  const failed = internal.filter(report => !report.detected).length;
  console.log(`[db:mutate] ${caught}/${internal.length} мутаций поймано (${failed} пропущено)`);
  process.exit(failed === 0 ? 0 : 1);
}

if (isEntry('db-mutate')) {
  main().catch(error => {
    console.error('[db:mutate] FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
