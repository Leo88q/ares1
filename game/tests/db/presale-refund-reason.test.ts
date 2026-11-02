/**
 * Гарантии 0016_presale_refund_reason.sql на настоящем PostgreSQL (PGlite).
 *
 * Почему это отдельный файл. `refundOrder` требовал причину, но сохранял от неё
 * только `left(md5(reason), 4)` в `failure_code`. Через час после возврата
 * восстановить «почему вернули деньги» было нельзя: 16 бит хэша и никакого
 * текста. Для денежной операции это означает, что спор разбирается по памяти.
 *
 * Проверяем то, что обязана держать база, а не обработчик:
 *   • причина сохраняется целиком и её видно в строке заказа;
 *   • короче 3 и длиннее 500 символов — отказ (CHECK);
 *   • причина существует только у `refunded` (CHECK);
 *   • записанную причину нельзя переписать или стереть (триггер);
 *   • причина НЕ попадает в публичное представление (внутренние заметки);
 *   • запись причины попадает в аудит.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationsDirectory = fileURLToPath(new URL('../../migrations/game_ops/', import.meta.url));
const RUN = 'refund-reason';
const WALLET = 'W'.repeat(40);
const TREASURY = 'T'.repeat(40);
const PAYMENT = 'P'.repeat(88);
const REASON = 'покупатель дважды отправил один и тот же перевод';

async function freshDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  const files = (await readdir(migrationsDirectory)).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await db.exec(await readFile(path.join(migrationsDirectory, file), 'utf8'));
  return db;
}

/** Заказ, дошедший до `refunded` честным путём: reserved → payment_seen → refunded. */
async function refundedOrder(db: PGlite, orderNo = 1): Promise<string> {
  await db.query(
    `INSERT INTO game_ops.presale_runs
       (run_id, pack_id, currency, price_units, cap, treasury, reserve_minutes)
     VALUES ($1, 'bed-10', 'sol', 100000000, 10, $2, 30)`,
    [RUN, TREASURY],
  );
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO game_ops.presale_orders
       (run_id, order_no, pack_id, price_units, payer_wallet, reserved_until)
     VALUES ($1, $2, 'bed-10', 100000000, $3, now() + interval '30 minutes')
     RETURNING id`,
    [RUN, orderNo, WALLET],
  );
  const id = inserted.rows[0]!.id;
  await db.query(`UPDATE game_ops.presale_orders SET state = 'payment_seen', tx_signature = $2 WHERE id = $1`, [id, PAYMENT]);
  await db.query(`UPDATE game_ops.presale_orders SET state = 'refunded', refunded_at = now() WHERE id = $1`, [id]);
  return id;
}

test('причина возврата сохраняется целиком и неизменяема', async () => {
  const db = await freshDatabase();
  try {
    const id = await refundedOrder(db);
    await db.query(`UPDATE game_ops.presale_orders SET refund_reason = $2 WHERE id = $1`, [id, REASON]);

    const stored = await db.query<{ refund_reason: string }>(
      'SELECT refund_reason FROM game_ops.presale_orders WHERE id = $1', [id],
    );
    assert.equal(stored.rows[0]?.refund_reason, REASON);

    // Переписать нельзя: причина — часть решения, а не комментарий.
    await assert.rejects(
      db.query(`UPDATE game_ops.presale_orders SET refund_reason = 'другая причина' WHERE id = $1`, [id]),
      /PRESALE_REFUND_REASON_IMMUTABLE/,
    );
    // Стереть тоже нельзя — иначе пропадает единственное доказательство.
    await assert.rejects(
      db.query(`UPDATE game_ops.presale_orders SET refund_reason = NULL WHERE id = $1`, [id]),
      /PRESALE_REFUND_REASON_IMMUTABLE/,
    );
  } finally {
    await db.close();
  }
});

test('причина короче 3 символов и причина на невыплаченном заказе отклоняются', async () => {
  const db = await freshDatabase();
  try {
    const id = await refundedOrder(db, 2);
    await assert.rejects(
      db.query(`UPDATE game_ops.presale_orders SET refund_reason = 'ok' WHERE id = $1`, [id]),
      /presale_orders_refund_reason_shape/,
    );

    // Живой заказ: причина возврата без возврата — противоречие в данных.
    const live = await db.query<{ id: string }>(
      `INSERT INTO game_ops.presale_orders
         (run_id, order_no, pack_id, price_units, payer_wallet, reserved_until)
       VALUES ($1, 3, 'bed-10', 100000000, $2, now() + interval '30 minutes')
       RETURNING id`,
      [RUN, WALLET],
    );
    await assert.rejects(
      db.query(`UPDATE game_ops.presale_orders SET refund_reason = $2 WHERE id = $1`, [live.rows[0]!.id, REASON]),
      /presale_orders_refund_reason_requires_refunded/,
    );
  } finally {
    await db.close();
  }
});

test('причина не утекает в публичное представление, но попадает в аудит', async () => {
  const db = await freshDatabase();
  try {
    const id = await refundedOrder(db, 4);
    await db.query(`UPDATE game_ops.presale_orders SET refund_reason = $2 WHERE id = $1`, [id, REASON]);

    const view = await db.query<Record<string, unknown>>(
      'SELECT * FROM game_ops.presale_orders_public WHERE run_id = $1 AND order_no = 4', [RUN],
    );
    assert.equal(view.rows.length, 1);
    assert.ok(!Object.keys(view.rows[0]!).includes('refund_reason'), 'заметки оператора — внутренние данные');

    const audit = await db.query<{ action: string }>(
      `SELECT action FROM game_ops.admin_audit
        WHERE subject = 'presale_orders' AND subject_id = $1 AND action = 'presale_order.refund_reason'`,
      [id],
    );
    assert.equal(audit.rows.length, 1, 'запись причины обязана оставлять след в аудите');
  } finally {
    await db.close();
  }
});
