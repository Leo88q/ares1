/**
 * Гарантии 0014_slot_payment_reviews.sql проверяются на настоящем PostgreSQL
 * (PGlite в процессе): очередь разбора не должна превращаться в «журнал
 * намерений». Правила, которые обязана держать БД, а не только код:
 *
 *   • одна подпись платежа — одна строка (повтор не плодит дубликаты);
 *   • закрыть разбор можно только с доказательством (CHECK);
 *   • после закрытия нельзя ни менять решение, ни сумму/адресата (триггер);
 *   • удалять нельзя вовсе (deny_mutation).
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationsDirectory = fileURLToPath(new URL('../../migrations/game_ops/', import.meta.url));
const WALLET = 'A'.repeat(32);
const MINT = 'B'.repeat(32);
const PAYMENT = 'C'.repeat(88);
const REFUND = 'D'.repeat(88);

async function freshDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  const files = (await readdir(migrationsDirectory)).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await db.exec(await readFile(path.join(migrationsDirectory, file), 'utf8'));
  return db;
}

async function insertReview(db: PGlite, paymentSignature = PAYMENT): Promise<void> {
  await db.query(
    `INSERT INTO game_ops.slot_payment_reviews
       (payment_signature, field_id, slot, wallet, mint, amount_units, reason)
     VALUES ($1, 'F1', 7, $2, $3, 1000, 'SLOT_TAKEN_AFTER_VALID_PAYMENT')`,
    [paymentSignature, WALLET, MINT],
  );
}

test('очередь разбора: одна подпись — одна строка', async () => {
  const db = await freshDatabase();
  try {
    await insertReview(db);
    await assert.rejects(() => insertReview(db), /duplicate key|unique/i);
    const rows = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM game_ops.slot_payment_reviews');
    assert.equal(rows.rows[0]?.count, 1);
  } finally {
    await db.close();
  }
});

test('очередь разбора: закрытие без доказательства запрещено схемой', async () => {
  const db = await freshDatabase();
  try {
    await insertReview(db);
    // «вернули» без подписи транзакции — не доказательство
    await assert.rejects(
      () => db.query("UPDATE game_ops.slot_payment_reviews SET status = 'refunded', resolved_at = now() WHERE payment_signature = $1", [PAYMENT]),
      /slot_payment_reviews_resolution_evidence|violates check constraint/i,
    );
    // refund с подписью проходит
    await db.query(
      "UPDATE game_ops.slot_payment_reviews SET status = 'refunded', resolved_at = now(), resolution_signature = $2 WHERE payment_signature = $1",
      [PAYMENT, REFUND],
    );
    const rows = await db.query<{ status: string }>('SELECT status FROM game_ops.slot_payment_reviews WHERE payment_signature = $1', [PAYMENT]);
    assert.equal(rows.rows[0]?.status, 'refunded');
  } finally {
    await db.close();
  }
});

test('очередь разбора: после закрытия решение и денежные поля неизменяемы', async () => {
  const db = await freshDatabase();
  try {
    await insertReview(db);
    await db.query(
      "UPDATE game_ops.slot_payment_reviews SET status = 'refunded', resolved_at = now(), resolution_signature = $2 WHERE payment_signature = $1",
      [PAYMENT, REFUND],
    );
    await assert.rejects(
      () => db.query("UPDATE game_ops.slot_payment_reviews SET status = 'rejected' WHERE payment_signature = $1", [PAYMENT]),
      /через маршрут закрыт|ALREADY_RESOLVED/i,
    );
    await assert.rejects(
      () => db.query('UPDATE game_ops.slot_payment_reviews SET amount_units = 999999 WHERE payment_signature = $1', [PAYMENT]),
      /permission denied|IMMUTABLE_FIELD|null value in column "status"/i,
    );
    await assert.rejects(
      () => db.query('DELETE FROM game_ops.slot_payment_reviews WHERE payment_signature = $1', [PAYMENT]),
      /APPEND_ONLY_DELETE/,
    );
  } finally {
    await db.close();
  }
});

test('очередь разбора: писатель не может править денежные колонки', async () => {
  const db = await freshDatabase();
  try {
    await insertReview(db);
    const privileges = await db.query<{
      insert_ok: boolean;
      amount_update: boolean;
      status_update: boolean;
      delete_ok: boolean;
    }>(`SELECT
         has_table_privilege('game_ops_writer', 'game_ops.slot_payment_reviews', 'INSERT') AS insert_ok,
         has_column_privilege('game_ops_writer', 'game_ops.slot_payment_reviews', 'amount_units', 'UPDATE') AS amount_update,
         has_column_privilege('game_ops_writer', 'game_ops.slot_payment_reviews', 'status', 'UPDATE') AS status_update,
         has_table_privilege('game_ops_writer', 'game_ops.slot_payment_reviews', 'DELETE') AS delete_ok`);
    const row = privileges.rows[0]!;
    assert.equal(row.insert_ok, true);
    assert.equal(row.status_update, true, 'закрытие пункта должно быть доступно рантайм-роли');
    assert.equal(row.amount_update, false, 'сумма возврата не должна быть изменяема рантайм-ролью');
    assert.equal(row.delete_ok, false, 'история разбора не удаляется');
  } finally {
    await db.close();
  }
});
