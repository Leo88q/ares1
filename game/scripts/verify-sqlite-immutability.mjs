#!/usr/bin/env node
/**
 * Приёмочные проверки SQLite-слоя с «неизменяемыми» таблицами
 * (reward-ledger / economy v2 / admin_audit / память агента / Merkle-якорь).
 *
 * Зачем именно так. В SQLite нет ролей и грантов: любой процесс с правом записи
 * в файл может снять триггер (`DROP TRIGGER`), подменить схему
 * (`PRAGMA writable_schema=ON`) или обойти BEFORE DELETE через `INSERT OR REPLACE`
 * (REPLACE выполняет DELETE-триггеры только при `PRAGMA recursive_triggers=ON`).
 * Поэтому «append-only триггеры» — это защита от собственного кода, а не от
 * злоумышленника; целостность обязана подтверждаться вне файла: HMAC на строку /
 * цепочка хэшей + периодический Merkle-корень, запечённый ончейн. Этот скрипт
 * проверяет все три уровня и НИЧЕГО не пишет в исходный файл: все
 * разрушительные пробы выполняются на копии во временном каталоге.
 *
 * Использование:
 *   node scripts/verify-sqlite-immutability.mjs --db path/to/backend.sqlite
 *   node scripts/verify-sqlite-immutability.mjs --db ... --config sqlite-checks.json
 *   node scripts/verify-sqlite-immutability.mjs --db ... --json
 *
 * Конфиг (все поля необязательны; без него проверяются структура, режимы,
 * триггеры и обходимость, а HMAC/Merkle только обнаруживаются):
 * {
 *   "appendOnly": ["economy_v2_events", "reward_ledger"],
 *   "audit": { "table": "admin_audit", "subjects": ["wallets", "economy_v2_events"] },
 *   "hmac": [{ "table": "agent_memory", "column": "hmac", "keyEnv": "AGENT_MEMORY_HMAC_KEY",
 *              "template": "{id}|{kind}|{payload}|{created_at}",
 *              "chain": { "column": "prev_hmac", "orderBy": "id", "genesis": "" } }],
 *   "merkle": { "table": "epoch_leaves", "template": "{leaf_hash}", "root": "…", "anchor": "on-chain sig/epoch" },
 *   "teehistorian": ["/var/lib/neonrelay/teehistorian/*.teehistorian"]
 * }
 *
 * Exit: 0 — блокирующих находок нет; 1 — есть HIGH/CRITICAL; 2 — конфиг/вход
 * некорректны (не выдавать «зелёный» результат при непроверенных предпосылках).
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const findings = [];
const report = (severity, code, detail, extra = {}) => findings.push({ severity, code, detail, ...extra });
const quote = identifier => `"${String(identifier).replaceAll('"', '""')}"`;

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--db') args.db = argv[++i];
    else if (arg === '--config') args.config = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help') args.help = true;
  }
  return args;
}

/** Копия БД вместе с WAL/SHM: пробы не должны трогать рабочий файл. */
function copyDatabase(dbPath) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sqlite-verify-'));
  const target = path.join(dir, path.basename(dbPath));
  copyFileSync(dbPath, target);
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, target + suffix);
  }
  return target;
}

function tables(db) {
  return db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
}
function triggers(db) {
  return db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
}
function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(row => row.name);
}

/** Пробует операцию в транзакции; возвращает { ok, error }. */
function probe(db, sql) {
  try {
    db.exec('BEGIN');
    db.exec(sql);
    db.exec('ROLLBACK');
    return { ok: true };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* транзакция могла не начаться */ }
    return { ok: false, error: error.message };
  }
}

function pragmaValue(db, name) {
  try {
    const row = db.prepare(`PRAGMA ${name}`).get();
    return row ? Object.values(row)[0] : null;
  } catch {
    return null;
  }
}

function firstRowid(db, table) {
  try {
    // Явный алиас: для таблицы с `id INTEGER PRIMARY KEY` колонка rowid
    // возвращается под именем id, и `row.rowid` был бы undefined.
    const row = db.prepare(`SELECT rowid AS __rowid FROM ${quote(table)} LIMIT 1`).get();
    return row && row.__rowid !== undefined ? Number(row.__rowid) : null;
  } catch {
    return null;
  }
}

// ---------- 1. режимы файла ----------
function checkFileModes(dbPath, db) {
  const stat = statSync(dbPath);
  const mode = stat.mode & 0o777;
  if (mode & 0o077) {
    report('MEDIUM', 'DB_FILE_PERMISSIONS',
      `Права на файл БД ${mode.toString(8)} — доступ есть у группы/всех; при отсутствии ролей в SQLite это прямой путь снять триггер`,
      { mode: mode.toString(8) });
  }
  const journal = pragmaValue(db, 'journal_mode');
  if (String(journal).toLowerCase() !== 'wal') {
    report('HIGH', 'JOURNAL_MODE_NOT_WAL', `journal_mode=${journal}; ожидался wal (долговечность + параллельные чтения)`, { journal });
  }
  const synchronous = pragmaValue(db, 'synchronous');
  const foreignKeys = pragmaValue(db, 'foreign_keys');
  if (Number(foreignKeys) !== 1) {
    report('INFO', 'FOREIGN_KEYS_OFF_NOTE',
      'foreign_keys выключены в соединении проверяющего: приложение обязано включать их на каждом соединении — проверьте код открытия БД',
      { foreignKeys });
  }
  const recursive = pragmaValue(db, 'recursive_triggers');
  // Значение рекурсивных триггеров — настройка СОЕДИНЕНИЯ: приложение может её
  // не выставлять. Поэтому это INFO, а не «дыра», и проверяется пробой ниже.
  if (Number(recursive) !== 1) {
    report('INFO', 'RECURSIVE_TRIGGERS_OFF_NOTE',
      'recursive_triggers выключены в соединении проверяющего: приложение обязано ставить PRAGMA recursive_triggers=ON на каждом соединении, иначе INSERT OR REPLACE не вызовет BEFORE DELETE-триггеры',
      { recursiveTriggers: recursive });
  }
  const integrity = pragmaValue(db, 'integrity_check');
  if (integrity !== 'ok') report('CRITICAL', 'INTEGRITY_CHECK_FAILED', `integrity_check=${integrity}`);
  return { journal, synchronous, foreignKeys, recursiveTriggers: recursive, integrity };
}

// ---------- 2. append-only: триггеры + обходы ----------
function checkAppendOnly(db, table) {
  const tableTriggers = triggers(db).filter(t => t.tbl_name === table);
  const hasUpdate = tableTriggers.some(t => /BEFORE\s+UPDATE|AFTER\s+UPDATE/i.test(t.sql ?? ''));
  const hasDelete = tableTriggers.some(t => /BEFORE\s+DELETE|AFTER\s+DELETE/i.test(t.sql ?? ''));
  if (!hasUpdate) report('HIGH', 'MISSING_UPDATE_GUARD', `${table}: нет UPDATE-триггера — строки можно менять`, { table });
  if (!hasDelete) report('HIGH', 'MISSING_DELETE_GUARD', `${table}: нет DELETE-триггера — строки можно удалять`, { table });

  const rowid = firstRowid(db, table);
  if (rowid === null) return; // нет данных — обходы не проверить, это фиксируем отдельно
  const cols = columns(db, table);
  const payloadColumn = cols.find(name => name !== 'id' && name !== 'rowid') ?? cols[0];
  const row = db.prepare(`SELECT ${cols.map(quote).join(', ')} FROM ${quote(table)} WHERE rowid = ?`).get(rowid);
  const literal = value => (value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`);

  const update = probe(db, `UPDATE ${quote(table)} SET ${quote(payloadColumn)} = ${quote(payloadColumn)} WHERE rowid = ${rowid}`);
  if (update.ok) report('CRITICAL', 'UPDATE_NOT_BLOCKED', `${table}: UPDATE прошёл при «запрете» UPDATE`, { table });

  const del = probe(db, `DELETE FROM ${quote(table)} WHERE rowid = ${rowid}`);
  if (del.ok) report('CRITICAL', 'DELETE_NOT_BLOCKED', `${table}: DELETE прошёл при «запрете» DELETE`, { table });

  const values = cols.map(c => literal(row[c])).join(', ');
  const replaceSql = `INSERT OR REPLACE INTO ${quote(table)} (${cols.map(quote).join(', ')}) VALUES (${values})`;
  // REPLACE выполняет BEFORE DELETE-триггеры ТОЛЬКО при recursive_triggers=ON,
  // а UPDATE-триггеры не выполняет никогда. Проверяем оба режима и различаем
  // «дыру при неверной настройке» и «дыру в самой схеме».
  db.exec('PRAGMA recursive_triggers=OFF');
  const replaceOff = probe(db, replaceSql);
  db.exec('PRAGMA recursive_triggers=ON');
  const replaceOn = probe(db, replaceSql);
  db.exec('PRAGMA recursive_triggers=OFF');
  if (replaceOn.ok) {
    report('HIGH', 'INSERT_OR_REPLACE_BYPASS',
      `${table}: INSERT OR REPLACE перезаписал строку даже при recursive_triggers=ON — схема не защищает от подмены`,
      { table });
  } else if (replaceOff.ok) {
    report('MEDIUM', 'INSERT_OR_REPLACE_DEPENDS_ON_PRAGMA',
      `${table}: INSERT OR REPLACE проходит при выключенных рекурсивных триггерах — каждое соединение приложения обязано выполнять PRAGMA recursive_triggers=ON`,
      { table });
  }

  const upsert = probe(db, `INSERT INTO ${quote(table)} (${cols.map(quote).join(', ')}) VALUES (${values}) ON CONFLICT DO UPDATE SET ${quote(payloadColumn)} = ${quote(payloadColumn)}`);
  if (upsert.ok) report('HIGH', 'UPSERT_BYPASS', `${table}: INSERT … ON CONFLICT DO UPDATE изменил строку`, { table });

  if (tableTriggers.length) {
    const drop = probe(db, `DROP TRIGGER ${quote(tableTriggers[0].name)}`);
    if (drop.ok) {
      report('INFO', 'TRIGGER_DROPPABLE',
        `${table}: триггер снимается обычным DROP TRIGGER — в SQLite нет ролей; целостность обязана подтверждаться вовне (HMAC/Merkle), а файл — лежать с правами 600 и вне зоны записи приложения`,
        { table, trigger: tableTriggers[0].name });
    }
  }
  return { hasUpdate, hasDelete };
}

// ---------- 3. аудит административных действий ----------
/** Операции, на которые срабатывает триггер: поддержаны `BEFORE/AFTER INSERT OR UPDATE`. */
function triggerOps(sql) {
  const match = /(?:BEFORE|AFTER)\s+((?:INSERT|UPDATE|DELETE)(?:\s+OR\s+(?:INSERT|UPDATE|DELETE))*(?:\s+OF\s+[^\s]+(?:\s*,\s*[^\s]+)*)?)/i.exec(sql ?? '');
  if (!match) return [];
  return match[1].split(/\s+OR\s+/i).map(op => op.split(/\s+OF\s+/i)[0].trim().toUpperCase());
}

function checkAudit(db, audit) {
  const auditColumns = columns(db, audit.table);
  const allTriggers = triggers(db);
  const coverage = {};
  for (const subject of audit.subjects) {
    // Аудит должен покрывать каждую операцию отдельно: «есть триггер на INSERT»
    // не значит, что изменения (UPDATE) и удаления (DELETE) восстановимы.
    const writing = allTriggers.filter(t => t.tbl_name === subject && new RegExp(audit.table, 'i').test(t.sql ?? ''));
    const missing = ['INSERT', 'UPDATE', 'DELETE'].filter(op => !writing.some(t => triggerOps(t.sql).includes(op)));
    coverage[subject] = { triggers: writing.length, missing };
    if (missing.length) {
      report('HIGH', 'AUDIT_TRIGGER_MISSING',
        `${subject}: не аудируются операции ${missing.join(', ')} — по ${audit.table} нельзя восстановить, что изменилось`,
        { subject, missing });
    }
  }
  const count = db.prepare(`SELECT count(*) AS n FROM ${quote(audit.table)}`).get().n;
  const required = ['actor', 'action', 'created_at'];
  const missing = required.filter(name => !auditColumns.includes(name));
  if (missing.length) report('MEDIUM', 'AUDIT_COLUMNS_MISSING', `${audit.table}: нет колонок ${missing.join(', ')} (кто/что/когда)`, { missing, columns: auditColumns });
  return { rows: count, columns: auditColumns, coverage };
}

// ---------- 4. HMAC на строках памяти агента ----------
function renderTemplate(template, row) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (row[key] === null || row[key] === undefined ? '' : String(row[key])));
}

function checkHmac(db, spec, key) {
  const cols = columns(db, spec.table);
  if (!cols.includes(spec.column)) {
    report('HIGH', 'HMAC_COLUMN_MISSING', `${spec.table}: нет колонки ${spec.column}`, { table: spec.table });
    return { checked: 0 };
  }
  if (!key) {
    report('MEDIUM', 'HMAC_KEY_UNAVAILABLE', `${spec.table}: ключ не задан (keyEnv/keyFile) — HMAC не проверен`, { table: spec.table });
    return { checked: 0, verified: false };
  }
  const orderBy = spec.chain?.orderBy ?? cols[0];
  const rows = db.prepare(`SELECT rowid AS __rowid, * FROM ${quote(spec.table)} ORDER BY ${quote(orderBy)}`).all();
  const template = spec.template ?? cols.filter(c => c !== spec.column).map(c => `{${c}}`).join('|');
  let checked = 0; let mismatches = 0; let chained = 0; let previous = spec.chain ? (spec.chain.genesis ?? '') : null;
  for (const row of rows) {
    const expected = createHmac('sha256', key).update(renderTemplate(template, row)).digest('hex');
    const actual = String(row[spec.column] ?? '');
    checked += 1;
    const equal = actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
    if (!equal) {
      mismatches += 1;
      if (mismatches <= 5) report('CRITICAL', 'HMAC_MISMATCH', `${spec.table}: строка rowid=${row.__rowid} не сходится с HMAC (подмена или чужой ключ)`, { rowid: row.__rowid });
    }
    if (spec.chain) {
      if (String(row[spec.chain.column] ?? '') !== previous) {
        report('CRITICAL', 'HMAC_CHAIN_BROKEN', `${spec.table}: разрыв цепочки на rowid=${row.__rowid} — удаление/перестановка строки`, { rowid: row.__rowid });
      } else {
        chained += 1;
      }
      previous = actual;
    }
  }
  return { rows: rows.length, checked, mismatches, chained };
}

// ---------- 5. Merkle-корень ----------
function sha256(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}
function merkleRoot(leaves) {
  if (!leaves.length) return createHash('sha256').update('').digest('hex');
  let level = [...leaves].sort();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(sha256(Buffer.from(left, 'hex'), Buffer.from(right, 'hex')).toString('hex'));
    }
    level = next;
  }
  return level[0];
}

function checkMerkle(db, spec) {
  const rows = db.prepare(`SELECT * FROM ${quote(spec.table)}`).all();
  const template = spec.template ?? Object.keys(rows[0] ?? {}).map(c => `{${c}}`).join('|');
  const single = /^\{(\w+)\}$/.exec(template);
  const leafOf = row => {
    // Шаблон ровно из одного плейсхолдера означает «эта колонка и есть лист»
    // (hex-значение уже посчитанного листа) — двойного хэширования нет.
    if (single) {
      const value = String(row[single[1]] ?? '');
      if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
      return createHash('sha256').update(value).digest('hex');
    }
    return createHash('sha256').update(renderTemplate(template, row)).digest('hex');
  };
  const leaves = rows.map(leafOf);
  const computed = merkleRoot(leaves);
  const result = { leaves: leaves.length, computedRoot: computed, expectedRoot: spec.root ?? null, anchor: spec.anchor ?? null };
  if (spec.root && spec.root !== computed) {
    report('CRITICAL', 'MERKLE_ROOT_MISMATCH', `Merkle-корень не совпадает с запечённым (${computed} ≠ ${spec.root})`, result);
  }
  if (!spec.root) {
    report('INFO', 'MERKLE_ROOT_UNVERIFIED', `Корень посчитан (${computed}), но запечённый корень не задан — сверить ончейн вручную`, result);
  }
  return result;
}

// ---------- 6. teehistorian / демо ----------
function checkTeehistorian(pattern) {
  if (!existsSync(pattern)) return { present: false, pattern };
  const stat = statSync(pattern);
  const head = readFileSync(pattern).subarray(0, 64);
  const magic = head.subarray(0, 14).toString('latin1');
  const result = { present: true, bytes: stat.size, sha256: createHash('sha256').update(readFileSync(pattern)).digest('hex'), magic };
  if (magic !== 'teehistorian@') {
    report('HIGH', 'TEEHISTORIAN_MAGIC', `${pattern}: заголовок не начинается с teehistorian@ (${JSON.stringify(magic)})`, result);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.db) {
    console.error('Usage: node scripts/verify-sqlite-immutability.mjs --db <file> [--config <json>] [--json]');
    process.exit(args.help ? 0 : 2);
  }
  if (!existsSync(args.db)) {
    console.error(`Нет файла БД: ${args.db}`);
    process.exit(2);
  }
  let config = {};
  if (args.config) {
    try {
      config = JSON.parse(readFileSync(args.config, 'utf8'));
    } catch (error) {
      console.error(`Некорректный конфиг: ${error.message}`);
      process.exit(2);
    }
  }

  const copy = copyDatabase(args.db);
  const db = new DatabaseSync(copy, { readOnly: false });
  const result = { database: args.db, copy, checkedAt: new Date().toISOString() };
  try {
    result.pragmas = checkFileModes(args.db, db);
    const allTables = tables(db).map(t => t.name);
    result.tables = allTables;

    const appendOnly = config.appendOnly ?? allTables.filter(name => /(ledger|econom|reward|audit|event|memory|_v2$)/i.test(name));
    result.appendOnly = {};
    for (const table of appendOnly) {
      if (!allTables.includes(table)) {
        report('HIGH', 'APPEND_ONLY_TABLE_MISSING', `${table}: объявлена append-only, но таблицы нет`, { table });
        continue;
      }
      result.appendOnly[table] = checkAppendOnly(db, table) ?? { checked: false, reason: 'no rows' };
    }

    if (config.audit) result.audit = checkAudit(db, config.audit);
    else {
      const auditTable = allTables.find(name => /audit/i.test(name));
      result.audit = auditTable
        ? { detected: auditTable, rows: db.prepare(`SELECT count(*) AS n FROM ${quote(auditTable)}`).get().n }
        : (report('HIGH', 'AUDIT_TABLE_MISSING', 'Нет таблицы admin_audit — действия администратора не восстановимы'), { detected: null });
    }

    result.hmac = [];
    const hmacSpecs = config.hmac ?? [];
    for (const spec of hmacSpecs) {
      const key = spec.keyEnv ? process.env[spec.keyEnv] : spec.keyFile ? readFileSync(spec.keyFile, 'utf8').trim() : null;
      result.hmac.push({ table: spec.table, chain: Boolean(spec.chain), ...checkHmac(db, spec, key) });
    }
    if (!hmacSpecs.length) {
      const candidates = allTables.filter(name => columns(db, name).some(c => /^(hmac|sig|signature|mac)$/i.test(c)));
      if (!candidates.length) report('MEDIUM', 'HMAC_NOT_FOUND', 'Не найдено ни одной таблицы с HMAC-колонкой — «память агента» не защищена от подмены');
      else report('MEDIUM', 'HMAC_SPECS_MISSING', `Найдены таблицы с HMAC (${candidates.join(', ')}), но в конфиге не описано, что именно подписывается — HMAC не проверен`, { candidates });
      result.hmacCandidates = candidates;
    }

    if (config.merkle) result.merkle = checkMerkle(db, config.merkle);
    else report('MEDIUM', 'MERKLE_ANCHOR_NOT_CONFIGURED', 'Merkle-якорь не описан: неизвестно, чем подтверждается неизменяемость за пределами файла');

    if (config.teehistorian) {
      result.teehistorian = config.teehistorian.map(checkTeehistorian);
    }
  } finally {
    db.close();
  }

  result.findings = findings;
  result.summary = {
    critical: findings.filter(f => f.severity === 'CRITICAL').length,
    high: findings.filter(f => f.severity === 'HIGH').length,
    medium: findings.filter(f => f.severity === 'MEDIUM').length,
    info: findings.filter(f => f.severity === 'INFO').length,
  };
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Проверка ${args.db} (копия: ${copy})`);
    console.log(`Таблиц: ${result.tables.length}; пробы выполнены на копии, исходный файл не изменялся.`);
    for (const finding of findings) console.log(`[${finding.severity}] ${finding.code}: ${finding.detail}`);
    console.log(`Итого: CRITICAL ${result.summary.critical}, HIGH ${result.summary.high}, MEDIUM ${result.summary.medium}, INFO ${result.summary.info}`);
  }
  const blocking = result.summary.critical + result.summary.high;
  process.exit(blocking ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('verify-sqlite-immutability.mjs')) main();
