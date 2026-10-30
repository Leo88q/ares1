/**
 * Гарантии 0015_presale_refund_evidence.sql на настоящем PostgreSQL (PGlite).
 *
 * Почему это отдельный файл. `state = 'refunded'` означает РЕШЕНИЕ вернуть
 * деньги, а не факт их возврата: перевод делает оператор отдельным шагом.
 * Пока эти два факта жили в одном слове, заказ числился возвращённым, даже
 * если покупатель не получил ничего, и в очереди «требует внимания» он висел
 * вечно. Колонка `refund_tx_signature` разделяет факты, но держать такое
 * разделение только в коде приложения бессмысленно — код можно обойти.
 *
 * Проверяем ровно те правила, которые обязана держать база:
 *   • подпись существует только у возвращённого заказа (CHECK);
 *   • длина подписи 64..88 (CHECK);
 *   • записанная подпись неизменяема (триггер);
 *   • писатель закрывает возврат, но по-прежнему не трогает деньги (права);
 *   • покупатель видит подпись возврата, но не полный кошелёк (представление);
 *   • закрытие возврата попадает в аудит (триггер).
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationsDirectory = fileURLToPath(new URL('../../migrations/game_ops/', import.meta.url));
const RUN = 'refund-evidence';
const WALLET = 'W'.repeat(40);
const TREASURY = 'T'.repeat(40);
const PAYMENT = 'P'.repeat(88);

async function freshDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  const files = (await readdir(migrationsDirectory)).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await db.exec(await readFile(path.join(migrationsDirectory, file), 'utf8'));
  return db;
}

/**
 * Заказ, дошедший до `refunded` честным путём.
 *
 * Вставлять сразу `state='refunded'` нельзя и это правильно: триггер 0005
 * требует, чтобы заказ рождался в состоянии, занимающем место, — иначе можно
 * «создать» возврат по деньгам, которых никто не платил. Поэтому идём
 * reserved -> payment_seen (с подписью платежа) -> refunded.
 */
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
  await db.query(
    `UPDATE game_ops.presale_orders
        SET state = 'payment_seen', tx_signature = $2, received_units = 100000001
      WHERE id = $1`,
    [id, PAYMENT],
  );
  await db.query(
    `UPDATE game_ops.presale_orders SET state = 'refunded', refunded_at = now() WHERE id = $1`,
    [id],
  );
  return id;
}

test('доказательство возврата существует только у возвращённого заказа', async () => {
  const db = await freshDatabase();
  try {
    await db.query(
      `INSERT INTO game_ops.presale_runs
         (run_id, pack_id, currency, price_units, cap, treasury, reserve_minutes)
       VALUES ($1, 'bed-10', 'sol', 100000000, 10, $2, 30)`,
      [RUN, TREASURY],
    );
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO game_ops.presale_orders
         (run_id, order_no, pack_id, price_units, payer_wallet, reserved_until)
       VALUES ($1, 1, 'bed-10', 100000000, $2, now() + interval '30 minutes')
       RETURNING id`,
      [RUN, WALLET],
    );
    // Живой заказ с «доказательством возврата» — это подпись, приложенная не к
    // тому заказу; сверка после такого считает деньги возвращёнными.
    await assert.rejects(
      () => db.query(
        'UPDATE game_ops.presale_orders SET refund_tx_signature = $2 WHERE id = $1',
        [inserted.rows[0]!.id, 'A'.repeat(88)],
      ),
      /presale_orders_refund_signature_requires_refunded|violates check constraint/i,
    );
  } finally {
    await db.close();
  }
});

test('подпись возврата: длина 64..88 символов', async () => {
  const db = await freshDatabase();
  try {
    const id = await refundedOrder(db);
    await assert.rejects(
      () => db.query('UPDATE game_ops.presale_orders SET refund_tx_signature = $2 WHERE id = $1', [id, 'A'.repeat(63)]),
      /presale_orders_refund_signature_shape|violates check constraint/i,
      'обрезанная подпись не должна приниматься',
    );
    await assert.rejects(
      () => db.query('UPDATE game_ops.presale_orders SET refund_tx_signature = $2 WHERE id = $1', [id, 'A'.repeat(89)]),
      /presale_orders_refund_signature_shape|violates check constraint/i,
      'слишком длинная строка — не подпись',
    );
    await db.query('UPDATE game_ops.presale_orders SET refund_tx_signature = $2 WHERE id = $1', [id, 'A'.repeat(64)]);
    const row = await db.query<{ len: number }>(
      'SELECT length(refund_tx_signature)::int AS len FROM game_ops.presale_orders WHERE id = $1', [id],
    );
    assert.equal(row.rows[0]?.len, 64, 'минимально допустимая подпись записалась');
  } finally {
    await db.close();
  }
});

test('записанная подпись возврата неизменяема', async () => {
  const db = await freshDatabase();
  try {
    const id = await refundedOrder(db);
    const first = 'B'.repeat(88);
    await db.query('UPDATE game_ops.presale_orders SET refund_tx_signature = $2 WHERE id = $1', [id, first]);
    // Подмена доказательства — это подмена факта выплаты: покупатель денег не
    // получил, а учёт считает возврат закрытым.
    await assert.rejects(
      () => db.query('UPDATE game_ops.presale_orders SET refund_tx_signature = $2 WHERE id = $1', [id, 'C'.repeat(88)]),
      /PRESALE_REFUND_SIGNATURE_IMMUTABLE/,
    );
    const row = await db.query<{ signature: string }>(
      'SELECT refund_tx_signature AS signature FROM game_ops.presale_orders WHERE id = $1', [id],
    );
    assert.equal(row.rows[0]?.signature, first, 'подпись осталась прежней');
  } finally {
    await db.close();
  }
});

test('писатель закрывает возврат, но денежные колонки ему недоступны', async () => {
  const db = await freshDatabase();
  try {
    const privileges = await db.query<{
      settle_ok: boolean;
      price_update: boolean;
      wallet_update: boolean;
      order_no_update: boolean;
      delete_ok: boolean;
    }>(`SELECT
         has_column_privilege('game_ops_writer', 'game_ops.presale_orders', 'refund_tx_signature', 'UPDATE') AS settle_ok,
         has_column_privilege('game_ops_writer', 'game_ops.presale_orders', 'price_units', 'UPDATE') AS price_update,
         has_column_privilege('game_ops_writer', 'game_ops.presale_orders', 'payer_wallet', 'UPDATE') AS wallet_update,
         has_column_privilege('game_ops_writer', 'game_ops.presale_orders', 'order_no', 'UPDATE') AS order_no_update,
         has_table_privilege('game_ops_writer', 'game_ops.presale_orders', 'DELETE') AS delete_ok`);
    const row = privileges.rows[0]!;
    assert.equal(row.settle_ok, true, 'рантайм должен уметь записать доказательство возврата');
    assert.equal(row.price_update, false, 'сумма заказа не должна быть изменяема рантайм-ролью');
    assert.equal(row.wallet_update, false, 'адресат возврата не должен быть изменяем рантайм-ролью');
    assert.equal(row.order_no_update, false, 'номер заказа неизменяем');
    assert.equal(row.delete_ok, false, 'заказ не удаляется');
  } finally {
    await db.close();
  }
});

test('покупатель видит подпись возврата, но не полный кошелёк', async () => {
  const db = await freshDatabase();
  try {
    const id = await refundedOrder(db);
    const signature = 'D'.repeat(88);
    await db.query('UPDATE game_ops.presale_orders SET refund_tx_signature = $2 WHERE id = $1', [id, signature]);
    const pub = await db.query<Record<string, unknown>>(
      'SELECT * FROM game_ops.presale_orders_public WHERE run_id = $1 AND order_no = 1', [RUN],
    );
    const row = pub.rows[0]!;
    assert.equal(row.state, 'refunded');
    assert.equal(row.refund_tx_signature, signature, 'подпись возврата — то, что покупатель может проверить сам');
    assert.ok(row.refunded_at, 'момент решения о возврате виден');
    assert.equal('payer_wallet' in row, false, 'полный кошелёк наружу не отдаётся');
    assert.equal(row.payer_wallet_masked, `${WALLET.slice(0, 4)}\u2026${WALLET.slice(-4)}`);
  } finally {
    await db.close();
  }
});

test('закрытие возврата попадает в аудит', async () => {
  const db = await freshDatabase();
  try {
    const id = await refundedOrder(db);
    const before = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM game_ops.admin_audit
        WHERE action = 'presale_order.refund_settled' AND subject_id = $1`, [id],
    );
    assert.equal(before.rows[0]?.count, 0, 'до записи подписи события нет');
    await db.query('UPDATE game_ops.presale_orders SET refund_tx_signature = $2 WHERE id = $1', [id, 'E'.repeat(88)]);
    const after = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM game_ops.admin_audit
        WHERE action = 'presale_order.refund_settled' AND subject_id = $1`, [id],
    );
    assert.equal(after.rows[0]?.count, 1, 'закрытие возврата обязано оставить след');
  } finally {
    await db.close();
  }
});
