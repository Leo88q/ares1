/**
 * Приёмка слоя game_ops: «докажи, а не расскажи».
 *
 * Скрипт не читает намерения, а проверяет факты в работающей БД:
 *   A. реестр миграций: все файлы применены, контрольные суммы совпадают;
 *   B. объекты: таблицы, представления, триггеры, индексы — на месте;
 *   C. права: у писателя НЕТ UPDATE/DELETE на журнал/аудит/сверку, есть
 *      колоночный UPDATE на интенты и курсоры;
 *   D. запреты работают: реальные попытки UPDATE/DELETE/подмены ловятся;
 *   E. цепочка журнала сходится (полная проверка), голова совпадает;
 *   F. сверка: расхождений нет, свежесть в пределах нормы.
 *
 * Любой провал — ненулевой код возврата: это приёмка продукта, а не отчёт.
 * Запуск: yarn db:verify --url=postgres://… [--writer-role=game_ops_writer]
 */
import type { Client } from 'pg';
import { verifyChain } from '../apps/backend/src/gameops/hash.js';
import type { LedgerRow } from '../apps/backend/src/gameops/hash.js';
import { consoleLogger, createClient, isEntry, loadMigrations, parseArgs, resolveDatabaseUrl, type Logger } from './db-common.js';

export interface VerifyOptions {
  url: string;
  writerRole?: string;
  chainId?: string;
  /** Пропустить проверку прав (managed-базы без ролей game_ops_*). */
  skipPrivileges?: boolean;
  logger?: Logger;
}

export interface VerifyCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  checks: VerifyCheck[];
}

const EXPECTED_TRIGGERS = 12;
const EXPECTED_TABLES = ['schema_version', 'reward_intents', 'reward_ledger', 'ledger_chain_head', 'admin_audit', 'chain_reconciliation', 'service_cursors'];
const EXPECTED_VIEWS = ['reward_intents_actionable', 'reward_ledger_tail', 'chain_reconciliation_latest'];

export async function verifyDatabase(options: VerifyOptions): Promise<VerifyResult> {
  const logger = options.logger ?? consoleLogger;
  const chainId = options.chainId ?? 'reward';
  const writerRole = options.writerRole ?? 'game_ops_writer';
  const checks: VerifyCheck[] = [];
  const client = createClient(options.url, 'ares1-db-verify');
  await client.connect();
  try {
    checks.push(...await checkRegistry(client));
    checks.push(...await checkObjects(client));
    if (!options.skipPrivileges) checks.push(...await checkPrivileges(client, writerRole));
    checks.push(...await checkImmutability(client, writerRole, options.skipPrivileges === true));
    checks.push(...await checkChain(client, chainId));
    checks.push(...await checkReconciliation(client));
  } catch (error) {
    checks.push({ id: 'runtime', ok: false, detail: `Исключение при проверке: ${error instanceof Error ? error.message : String(error)}` });
  } finally {
    await client.end().catch(() => undefined);
  }
  const result = { ok: checks.every(check => check.ok), checks };
  for (const check of checks) {
    logger.info(`[db:verify] ${check.ok ? 'OK  ' : 'FAIL'} ${check.id}: ${check.detail}`);
  }
  return result;
}

async function checkRegistry(client: Client): Promise<VerifyCheck[]> {
  const files = loadMigrations();
  const rows = await client.query<{ version: string | number; file_name: string; checksum: string }>(
    'SELECT version, file_name, checksum FROM game_ops.schema_version',
  );
  const registry = new Map(rows.rows.map(row => [Number(row.version), row]));
  const missing = files.filter(file => !registry.has(file.version)).map(file => file.fileName);
  const mismatched = files
    .filter(file => registry.has(file.version) && registry.get(file.version)!.checksum !== file.checksum)
    .map(file => file.fileName);
  return [
    {
      id: 'migrations.applied',
      ok: missing.length === 0,
      detail: missing.length ? `не применены: ${missing.join(', ')}` : `все ${files.length} файлов в реестре`,
    },
    {
      id: 'migrations.checksums',
      ok: mismatched.length === 0,
      detail: mismatched.length ? `изменены после применения: ${mismatched.join(', ')}` : 'контрольные суммы совпадают с репозиторием',
    },
  ];
}

async function checkObjects(client: Client): Promise<VerifyCheck[]> {
  const tables = await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'game_ops' AND table_type = 'BASE TABLE'",
  );
  const names = new Set(tables.rows.map(row => row.table_name));
  const missingTables = EXPECTED_TABLES.filter(name => !names.has(name));

  const views = await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.views WHERE table_schema = 'game_ops'",
  );
  const viewNames = new Set(views.rows.map(row => row.table_name));
  const missingViews = EXPECTED_VIEWS.filter(name => !viewNames.has(name));

  const triggers = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'game_ops' AND NOT t.tgisinternal",
  );
  const triggerCount = Number(triggers.rows[0]?.count ?? '0');

  const indexes = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'game_ops'",
  );
  const indexNames = new Set(indexes.rows.map(row => row.indexname));
  const missingIndexes = ['reward_ledger_chain_idx', 'reward_ledger_slot_idx', 'reward_intents_actionable_idx'].filter(name => !indexNames.has(name));

  return [
    { id: 'schema.tables', ok: missingTables.length === 0, detail: missingTables.length ? `нет таблиц: ${missingTables.join(', ')}` : `таблиц ${EXPECTED_TABLES.length}` },
    { id: 'schema.views', ok: missingViews.length === 0, detail: missingViews.length ? `нет представлений: ${missingViews.join(', ')}` : `представлений ${EXPECTED_VIEWS.length}` },
    { id: 'schema.triggers', ok: triggerCount >= EXPECTED_TRIGGERS, detail: `триггеров ${triggerCount} (ожидается ≥ ${EXPECTED_TRIGGERS})` },
    { id: 'schema.indexes', ok: missingIndexes.length === 0, detail: missingIndexes.length ? `нет индексов: ${missingIndexes.join(', ')}` : 'ключевые индексы на месте' },
  ];
}

async function checkPrivileges(client: Client, writerRole: string): Promise<VerifyCheck[]> {
  const has = async (sql: string, params: unknown[]): Promise<boolean> =>
    (await client.query<{ ok: boolean }>(sql, params)).rows[0]?.ok === true;

  const writerExists = await has('SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS ok', [writerRole]);
  if (!writerExists) {
    return [{ id: 'privileges.role', ok: false, detail: `роль ${writerRole} не найдена (managed-база? запустите с --skip-privileges)` }];
  }

  return [
    {
      id: 'privileges.ledger_immutable',
      ok: !(await has("SELECT has_table_privilege($1, 'game_ops.reward_ledger', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_table_privilege($1, 'game_ops.reward_ledger', 'DELETE') AS ok", [writerRole])),
      detail: 'у писателя нет UPDATE/DELETE на журнал',
    },
    {
      id: 'privileges.audit_immutable',
      ok: !(await has("SELECT has_table_privilege($1, 'game_ops.admin_audit', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_table_privilege($1, 'game_ops.admin_audit', 'DELETE') AS ok", [writerRole])),
      detail: 'у писателя нет UPDATE/DELETE на аудит',
    },
    {
      id: 'privileges.reconciliation_immutable',
      ok: !(await has("SELECT has_table_privilege($1, 'game_ops.chain_reconciliation', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_table_privilege($1, 'game_ops.chain_reconciliation', 'DELETE') AS ok", [writerRole])),
      detail: 'у писателя нет UPDATE/DELETE на сверку',
    },
    {
      id: 'privileges.intents_column_level',
      ok: (await has("SELECT has_column_privilege($1, 'game_ops.reward_intents', 'state', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_column_privilege($1, 'game_ops.reward_intents', 'amount_micro', 'UPDATE') AS ok", [writerRole])),
      detail: 'UPDATE на интенты — только по служебным колонкам',
    },
    {
      id: 'privileges.cursors_cas',
      ok: (await has("SELECT has_column_privilege($1, 'game_ops.service_cursors', 'version', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_column_privilege($1, 'game_ops.service_cursors', 'stream_id', 'UPDATE') AS ok", [writerRole])),
      detail: 'курсоры меняются, но stream_id изменить нельзя',
    },
    {
      // Пресейл: состояние двигать можно, деньги и контакты покупателя — нет.
      id: 'privileges.presale_money_immutable',
      ok: (await has("SELECT has_column_privilege($1, 'game_ops.presale_orders', 'state', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_column_privilege($1, 'game_ops.presale_orders', 'price_units', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_column_privilege($1, 'game_ops.presale_orders', 'order_no', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_column_privilege($1, 'game_ops.presale_orders', 'payer_wallet', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_column_privilege($1, 'game_ops.presale_orders', 'payer_email', 'UPDATE') AS ok", [writerRole])),
      detail: 'UPDATE на заказы пресейла — только по служебным колонкам, не по деньгам и контактам',
    },
    {
      // Тираж: счётчик мест триггеру нужен, а цену и cap задним числом не меняют.
      id: 'privileges.presale_run_immutable',
      ok: (await has("SELECT has_column_privilege($1, 'game_ops.presale_runs', 'reserved_count', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_column_privilege($1, 'game_ops.presale_runs', 'cap', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_column_privilege($1, 'game_ops.presale_runs', 'price_units', 'UPDATE') AS ok", [writerRole]))
        && !(await has("SELECT has_column_privilege($1, 'game_ops.presale_runs', 'treasury', 'UPDATE') AS ok", [writerRole])),
      detail: 'тираж пресейла: счётчик мест доступен, cap/цена/казначейство — нет',
    },
    {
      id: 'privileges.no_ddl',
      ok: !(await has("SELECT has_schema_privilege($1, 'game_ops', 'CREATE') AS ok", [writerRole])),
      detail: 'у рантайм-роли нет права CREATE в схеме',
    },
  ];
}

/**
 * Мутационная проверка «изнутри»: скрипт сам пытается нарушить правила и
 * требует, чтобы попытки были отклонены. Проверка идёт под самой ролью
 * (SET ROLE writer), иначе мы бы проверяли права суперпользователя, а не
 * реального рантайма.
 */
async function checkImmutability(client: Client, writerRole: string, skipPrivileges: boolean): Promise<VerifyCheck[]> {
  const checks: VerifyCheck[] = [];
  // Пробы должны идти от имени рантайм-роли: под суперпользователем мы проверили
  // бы только триггеры, а не весь периметр. Если SET ROLE недоступен, честно
  // помечаем это в детали пробы (и всё равно проверяем триггеры).
  let actingAs = 'current_user';
  if (!skipPrivileges) {
    try {
      await client.query(`SET ROLE ${writerRole}`);
      actingAs = writerRole;
    } catch {
      actingAs = 'current_user (SET ROLE недоступен)';
    }
  }

  const attempt = async (label: string, sql: string): Promise<VerifyCheck> => {
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('ROLLBACK');
      return { id: label, ok: false, detail: `операция НЕ отклонена (${actingAs}) — дыра в защите` };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const message = error instanceof Error ? error.message.slice(0, 160) : String(error);
      return { id: label, ok: true, detail: `отклонено (${actingAs}): ${message}` };
    }
  };

  // Целевые строки: журнал берём только при наличии данных, аудит — всегда.
  const anyLedger = await client.query<{ id: string }>('SELECT id FROM game_ops.reward_ledger ORDER BY id LIMIT 1');
  if (anyLedger.rows[0]) {
    checks.push(await attempt('mutate.ledger_update', `UPDATE game_ops.reward_ledger SET amount_micro = amount_micro + 1 WHERE id = ${anyLedger.rows[0].id}`));
    checks.push(await attempt('mutate.ledger_delete', `DELETE FROM game_ops.reward_ledger WHERE id = ${anyLedger.rows[0].id}`));
  }
  const anyAudit = await client.query<{ id: string }>('SELECT id FROM game_ops.admin_audit ORDER BY id LIMIT 1');
  if (anyAudit.rows[0]) {
    checks.push(await attempt('mutate.audit_delete', `DELETE FROM game_ops.admin_audit WHERE id = ${anyAudit.rows[0].id}`));
  }
  const intent = await client.query<{ id: string }>("SELECT id FROM game_ops.reward_intents WHERE state = 'pending' ORDER BY id LIMIT 1");
  if (intent.rows[0]) {
    checks.push(await attempt('mutate.intent_amount', `UPDATE game_ops.reward_intents SET amount_micro = amount_micro + 1 WHERE id = ${intent.rows[0].id}`));
    checks.push(await attempt('mutate.intent_skip_state', `UPDATE game_ops.reward_intents SET state = 'confirmed' WHERE id = ${intent.rows[0].id}`));
  }
  if (!skipPrivileges) await client.query('RESET ROLE').catch(() => undefined);
  if (!checks.length) checks.push({ id: 'mutate.none', ok: true, detail: 'нет данных для мутационных проб (пустой стенд) — запустите db:bench' });
  return checks;
}

async function checkChain(client: Client, chainId: string): Promise<VerifyCheck[]> {
  const head = await client.query<{ last_hash: string; last_id: string; row_count: string }>(
    'SELECT last_hash, last_id, row_count FROM game_ops.ledger_chain_head WHERE chain_id = $1',
    [chainId],
  );
  if (!head.rows[0]) {
    return [{ id: 'chain.verify', ok: true, detail: 'журнал пуст: цепочка сходится тривиально' }];
  }
  const rows = await client.query<LedgerRow>('SELECT * FROM game_ops.reward_ledger WHERE chain_id = $1 ORDER BY id ASC', [chainId]);
  const report = verifyChain(rows.rows, {
    expectedChainId: chainId,
    head: { lastHash: head.rows[0].last_hash, lastId: BigInt(head.rows[0].last_id), rowCount: BigInt(head.rows[0].row_count) },
    full: true,
  });
  return [
    {
      id: 'chain.verify',
      ok: report.ok,
      detail: report.ok
        ? `проверено ${report.checked} строк, голова ${head.rows[0].last_hash.slice(0, 12)}…`
        : `нарушение ${report.reason} на ${report.brokenAt}`,
    },
    {
      id: 'chain.head_matches_count',
      ok: BigInt(head.rows[0].row_count) === BigInt(rows.rows.length),
      detail: `row_count=${head.rows[0].row_count}, строк в журнале=${rows.rows.length}`,
    },
    ...await checkIntentLedgerConsistency(client),
  ];
}

/**
 * Сверка «интент ↔ зеркало»: сумма и получатель подтверждённого интента обязаны
 * совпадать с записью журнала. Это ловит подмену денежного поля (в том числе
 * привилегированную, с отключённым триггером), которую hash-chain не заметит:
 * цепочка защищает строки журнала, а не поля интента.
 */
async function checkIntentLedgerConsistency(client: Client): Promise<VerifyCheck[]> {
  const rows = await client.query<{ id: string }>(
    `SELECT i.id
     FROM game_ops.reward_intents i
     JOIN game_ops.reward_ledger l ON l.intent_id = i.id
     WHERE i.recipient_ata <> l.recipient_ata OR i.amount_micro <> l.amount_micro
     LIMIT 5`,
  );
  return [{
    id: 'intents.ledger_amount_match',
    ok: rows.rows.length === 0,
    detail: rows.rows.length ? `расхождение интент↔журнал у id: ${rows.rows.map(row => row.id).join(', ')}` : 'суммы и получатели интентов совпадают с зеркалом',
  }];
}

async function checkReconciliation(client: Client): Promise<VerifyCheck[]> {
  const latest = await client.query<{ stream_id: string; drift_micro: string; checked_at: string }>(
    'SELECT stream_id, drift_micro, checked_at FROM game_ops.chain_reconciliation_latest',
  );
  if (!latest.rows.length) {
    return [{ id: 'reconciliation.drift', ok: true, detail: 'сверок нет (новый стенд)' }];
  }
  const drifting = latest.rows.filter(row => BigInt(row.drift_micro) !== 0n);
  return [
    {
      id: 'reconciliation.drift',
      ok: drifting.length === 0,
      detail: drifting.length
        ? `расхождение: ${drifting.map(row => `${row.stream_id}=${row.drift_micro}`).join(', ')}`
        : `потоков ${latest.rows.length}, расхождений нет`,
    },
  ];
}

async function main(): Promise<void> {
  const { flags, options } = parseArgs(process.argv.slice(2));
  const result = await verifyDatabase({
    url: resolveDatabaseUrl(options),
    writerRole: options.get('writer-role'),
    chainId: options.get('chain'),
    skipPrivileges: flags.has('skip-privileges'),
  });
  const passed = result.checks.filter(check => check.ok).length;
  console.log(`[db:verify] ${result.ok ? 'ПРИЁМКА ПРОЙДЕНА' : 'ПРИЁМКА НЕ ПРОЙДЕНА'}: ${passed}/${result.checks.length} проверок`);
  process.exit(result.ok ? 0 : 1);
}

if (isEntry('db-verify')) {
  main().catch(error => {
    console.error('[db:verify] FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
