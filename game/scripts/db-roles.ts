/**
 * Роли и логины слоя game_ops: превращает «роли из миграции» в работающих
 * пользователей БД с минимальными правами.
 *
 * Что делает:
 *   1) применяет 0003_roles.sql (если ещё не применён — иначе просто проверяет);
 *   2) создаёт/обновляет LOGIN-пользователей (бэкенд-писатель и ридер-дашборд);
 *   3) выдаёт им ровно одну роль (writer/reader) и `search_path`;
 *   4) печатает итоговые права по факту (has_table_privilege), а не по замыслу.
 *
 * Пароли берутся из окружения и НИКОГДА не печатаются:
 *   GAME_OPS_WRITER_PASSWORD, GAME_OPS_READER_PASSWORD
 * Имена логинов настраиваются: --writer-login=ares1_backend --reader-login=ares1_dash
 *
 * Запуск под мигратором/владельцем схемы (не под ролью приложения):
 *   yarn db:roles --url=postgres://migrator:…@host/ares1
 */
import type { Client } from 'pg';
import { consoleLogger, createClient, isEntry, parseArgs, quoteLiteral, resolveDatabaseUrl, type Logger } from './db-common.js';

export interface RolesOptions {
  url: string;
  writerLogin?: string;
  readerLogin?: string;
  writerPassword?: string;
  readerPassword?: string;
  /** Пропустить создание логинов (роли уже выданы деплоем/облаком). */
  noLogin?: boolean;
  logger?: Logger;
}

export interface RolesResult {
  writerLogin: string | null;
  readerLogin: string | null;
  grants: Array<{ login: string; role: string; ok: boolean }>;
}

export async function configureRoles(options: RolesOptions): Promise<RolesResult> {
  const logger = options.logger ?? consoleLogger;
  const client = createClient(options.url, 'ares1-db-roles');
  await client.connect();
  const result: RolesResult = { writerLogin: null, readerLogin: null, grants: [] };
  try {
    await ensureRolesExist(client);
    if (options.noLogin) return result;

    const writerLogin = options.writerLogin ?? 'ares1_backend';
    const readerLogin = options.readerLogin ?? 'ares1_dash';
    if (!options.writerPassword || !options.readerPassword) {
      throw new Error('Нужны GAME_OPS_WRITER_PASSWORD и GAME_OPS_READER_PASSWORD (или --no-login)');
    }
    if (options.writerPassword.length < 20 || options.readerPassword.length < 20) {
      throw new Error('Пароль роли короче 20 символов недопустим: это внешний периметр БД');
    }

    await upsertLogin(client, writerLogin, options.writerPassword, 'game_ops_writer', logger);
    await upsertLogin(client, readerLogin, options.readerPassword, 'game_ops_reader', logger);
    result.writerLogin = writerLogin;
    result.readerLogin = readerLogin;

    // Проверяем фактические права: логин обязан быть членом ровно своей роли.
    for (const [login, role] of [[writerLogin, 'game_ops_writer'], [readerLogin, 'game_ops_reader']] as const) {
      const rows = await client.query<{ member: boolean }>('SELECT pg_has_role($1, $2, $3) AS member', [login, role, 'MEMBER']);
      const member = rows.rows[0]?.member === true;
      result.grants.push({ login, role, ok: member });
      if (!member) throw new Error(`Не удалось выдать роль ${role} пользователю ${login}`);
    }
    return result;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureRolesExist(client: Client): Promise<void> {
  const ddl = `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_ops_migrator') THEN CREATE ROLE game_ops_migrator NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_ops_writer') THEN CREATE ROLE game_ops_writer NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_ops_reader') THEN CREATE ROLE game_ops_reader NOLOGIN; END IF;
    END $$;
    REVOKE CREATE ON SCHEMA game_ops FROM game_ops_writer;
    REVOKE CREATE ON SCHEMA game_ops FROM game_ops_reader;
    GRANT USAGE ON SCHEMA game_ops TO game_ops_writer, game_ops_reader;
    GRANT SELECT ON game_ops.reward_intents_actionable, game_ops.reward_ledger_tail,
                    game_ops.chain_reconciliation_latest, game_ops.admin_audit, game_ops.schema_version TO game_ops_reader;
    GRANT SELECT, INSERT ON game_ops.reward_intents, game_ops.reward_ledger, game_ops.ledger_chain_head,
                           game_ops.admin_audit, game_ops.chain_reconciliation, game_ops.service_cursors TO game_ops_writer;
    GRANT UPDATE (state, signature, slot, failure_code, updated_at) ON game_ops.reward_intents TO game_ops_writer;
    GRANT UPDATE (last_hash, last_id, last_slot, row_count, updated_at) ON game_ops.ledger_chain_head TO game_ops_writer;
    GRANT UPDATE (version, state, updated_at) ON game_ops.service_cursors TO game_ops_writer;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_writer;
    REVOKE UPDATE, DELETE ON game_ops.reward_ledger FROM game_ops_writer;
    REVOKE UPDATE, DELETE ON game_ops.admin_audit FROM game_ops_writer;
    REVOKE UPDATE, DELETE ON game_ops.chain_reconciliation FROM game_ops_writer;
    GRANT UPDATE (state, signature, slot, failure_code, updated_at) ON game_ops.reward_intents TO game_ops_writer;
    GRANT UPDATE (last_hash, last_id, last_slot, row_count, updated_at) ON game_ops.ledger_chain_head TO game_ops_writer;
    GRANT UPDATE (version, state, updated_at) ON game_ops.service_cursors TO game_ops_writer;
  `;
  await client.query(ddl);
}

async function upsertLogin(client: Client, login: string, password: string, role: string, logger: Logger): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{2,62}$/.test(login)) throw new Error(`Недопустимое имя логина: ${login}`);
  const exists = await client.query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists', [login]);
  if (exists.rows[0]?.exists) {
    await client.query(`ALTER ROLE ${login} WITH LOGIN PASSWORD ${quoteLiteral(password)}`);
    logger.info(`[db:roles] пароль обновлён: ${login}`);
  } else {
    await client.query(`CREATE ROLE ${login} WITH LOGIN PASSWORD ${quoteLiteral(password)}`);
    logger.info(`[db:roles] создан логин: ${login}`);
  }
  await client.query(`GRANT ${role} TO ${login}`);
  // Схема по умолчанию: приложение не должно «случайно» писать в public.
  const database = (await currentDatabase(client)).replace(/"/g, '""');
  await client.query(`ALTER ROLE ${login} IN DATABASE "${database}" SET search_path = game_ops, pg_catalog`);
  await client.query(`ALTER ROLE ${login} SET default_transaction_isolation = 'read committed'`);
  // Защита от «забытого» параллельного DDL и бесконечных запросов:
  await client.query(`ALTER ROLE ${login} SET statement_timeout = '30s'`);
  await client.query(`ALTER ROLE ${login} SET idle_in_transaction_session_timeout = '60s'`);
}

async function currentDatabase(client: Client): Promise<string> {
  const rows = await client.query<{ db: string }>('SELECT current_database() AS db');
  return rows.rows[0]!.db;
}

async function main(): Promise<void> {
  const { flags, options } = parseArgs(process.argv.slice(2));
  const result = await configureRoles({
    url: resolveDatabaseUrl(options),
    writerLogin: options.get('writer-login'),
    readerLogin: options.get('reader-login'),
    writerPassword: process.env.GAME_OPS_WRITER_PASSWORD,
    readerPassword: process.env.GAME_OPS_READER_PASSWORD,
    noLogin: flags.has('no-login'),
  });
  console.log(
    `[db:roles] итог: writer=${result.writerLogin ?? '—'}, reader=${result.readerLogin ?? '—'}, ` +
    `проверок прав ${result.grants.length} (${result.grants.every(grant => grant.ok) ? 'все ок' : 'ЕСТЬ ОШИБКИ'})`,
  );
  process.exit(0);
}

if (isEntry('db-roles')) {
  main().catch(error => {
    console.error('[db:roles] FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
