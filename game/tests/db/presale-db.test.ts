/**
 * DB-тесты Phase 1 presale: инварианты, которые обеспечивает схема и триггеры.
 *
 * Зачем отдельный файл при наличии чистых тестов: каталог и верификация
 * платежа проверяются без БД, но oversell-гейт, неизменяемость денег, машина
 * переходов и счётчик мест существуют ТОЛЬКО как ограничения PostgreSQL.
 * Без живой базы они остаются утверждением в комментарии, а не проверенным фактом.
 *
 * Запуск:
 *   GAME_OPS_TEST_URL=postgres://… yarn test:db
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPool, withTransaction } from '../../apps/backend/src/gameops/pool.js';
import { loadGameOpsConfig } from '../../apps/backend/src/gameops/env.js';
import { GameOpsError } from '../../apps/backend/src/gameops/errors.js';
import {
  openRun, reserveOrder, attachPayment, confirmPayment, markDelivered,
  refundOrder, expireStaleReservations, getRunStatus, getOrderPublic, listPendingDelivery,
} from '../../apps/backend/src/presale/orders.js';
import { ata, signature } from './helpers.js';

const url = process.env.GAME_OPS_TEST_URL ?? '';
const enabled = Boolean(url);
const skip = enabled ? false : 'GAME_OPS_TEST_URL не задан: тесты presale требуют живой PostgreSQL';

const ADMIN = 'presale-db-test';

function config() {
  const cfg = loadGameOpsConfig({
    GAME_OPS_DATABASE_URL: url,
    ADMIN_API_TOKEN: 'fake-presale-test-token-000000000000',
  });
  if (!cfg) throw new Error('конфиг не собрался');
  return cfg;
}

let pool: pg.Pool;
let superPool: pg.Pool;
let runSeq = 0;

function newRunId(): string {
  runSeq += 1;
  return `t${Date.now().toString(36)}${runSeq}`;
}

test('presale: подготовка пула', { skip }, async () => {
  pool = createPool(config());
  superPool = new pg.Pool({ connectionString: url, max: 3, application_name: 'ares1-presale-test' });
  const state = await superPool.query<{ latest: number }>(
    'SELECT max(version)::int AS latest FROM game_ops.schema_version',
  );
  assert.ok((state.rows[0]?.latest ?? 0) >= 6, `нужны миграции до 0006, применено до ${state.rows[0]?.latest}`);
});

test('presale: тираж с невыдаваемым паком не открывается', { skip }, async () => {
  await assert.rejects(
    openRun(pool, {
      runId: newRunId(), packId: 'нет-такого-пака', currency: 'sol', priceUnits: 500_000_000n,
      cap: 5, treasury: ata('treasury'), actor: ADMIN,
    }),
    (e: unknown) => e instanceof GameOpsError && e.code === 'VALIDATION' && /Неизвестный пак/.test(e.message),
  );
});

test('presale: резерв занимает место и выдаёт уникальный номер', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'meadow-4', currency: 'sol', priceUnits: 500_000_000n, cap: 3,
    treasury: ata('treasury'), actor: ADMIN,
  });

  const first = await reserveOrder(pool, { runId, payerWallet: ata('buyer:1'), actor: ADMIN });
  const second = await reserveOrder(pool, { runId, payerWallet: ata('buyer:2'), actor: ADMIN });

  assert.equal(first.order.order_no, 1);
  assert.equal(second.order.order_no, 2);
  // Пыль: база + номер заказа, поэтому суммы различаются.
  assert.equal(first.payUnits, 500_000_001n);
  assert.equal(second.payUnits, 500_000_002n);
  assert.equal(first.remainingAfterReserve, 2);

  const status = await getRunStatus(pool, runId);
  assert.equal(status?.reserved_count, 2);
  assert.equal(status?.remaining, 1);
  assert.equal(status?.pack_potato_micro, '1000000000');
});

test('presale: cap блокирует oversell', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'bed-10', currency: 'sol', priceUnits: 100_000_000n, cap: 2,
    treasury: ata('treasury'), actor: ADMIN,
  });
  await reserveOrder(pool, { runId, payerWallet: ata('b:1'), actor: ADMIN });
  await reserveOrder(pool, { runId, payerWallet: ata('b:2'), actor: ADMIN });

  await assert.rejects(
    reserveOrder(pool, { runId, payerWallet: ata('b:3'), actor: ADMIN }),
    (e: unknown) => e instanceof GameOpsError && e.code === 'RUN_SOLD_OUT',
  );
  const status = await getRunStatus(pool, runId);
  assert.equal(status?.sold_out, true);
  assert.equal(status?.reserved_count, 2, 'отклонённый резерв не должен занимать место');
});

test('presale: параллельные резервы не перепродают тираж', { skip }, async () => {
  const runId = newRunId();
  const cap = 5;
  await openRun(pool, {
    runId, packId: 'field-2', currency: 'sol', priceUnits: 900_000_000n, cap,
    treasury: ata('treasury'), actor: ADMIN,
  });

  // 20 одновременных заявок на 5 мест.
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, index) =>
      reserveOrder(pool, { runId, payerWallet: ata(`race:${index}`), actor: ADMIN }),
    ),
  );
  const ok = results.filter(r => r.status === 'fulfilled');
  const soldOut = results.filter(
    r => r.status === 'rejected' && (r.reason as GameOpsError).code === 'RUN_SOLD_OUT',
  );
  assert.equal(ok.length, cap, `продано ${ok.length}, ожидалось ровно ${cap}`);
  assert.equal(soldOut.length, 20 - cap);

  const status = await getRunStatus(pool, runId);
  assert.equal(status?.reserved_count, cap);
  const numbers = (ok.map(r => (r as PromiseFulfilledResult<{ order: { order_no: number } }>).value.order.order_no)).sort((a, b) => a - b);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5], 'номера обязаны быть уникальными и без пропусков');
});

test('presale: истёкшая бронь освобождает место, но номер не переиспользуется', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'bed-10', currency: 'sol', priceUnits: 100_000_000n, cap: 2,
    treasury: ata('treasury'), reserveMinutes: 1, actor: ADMIN,
  });
  // Состарить бронь через UPDATE нельзя: reserved_until неизменяем, и это
  // проверяет отдельный тест. Поэтому вставляем историческую строку с датами
  // в прошлом — CHECK (reserved_until > created_at) при этом соблюдается.
  await superPool.query(
    `INSERT INTO game_ops.presale_orders
       (run_id, order_no, pack_id, price_units, payer_wallet, created_at, reserved_until)
     VALUES ($1, 1, 'bed-10', 100000000, $2,
             now() - interval '2 minutes', now() - interval '1 minute')`,
    [runId, ata('e:1')],
  );
  let status = await getRunStatus(pool, runId);
  assert.equal(status?.reserved_count, 1, 'вставленная бронь заняла место');

  const expired = await expireStaleReservations(pool, ADMIN);
  assert.equal(expired.expired, 1);

  status = await getRunStatus(pool, runId);
  assert.equal(status?.reserved_count, 0, 'истёкшая бронь освободила место');

  // Ключевое: новый заказ получает НОВЫЙ номер. Если бы номер считался как
  // reserved_count+1, он снова стал бы 1 и столкнулся с существующим.
  const second = await reserveOrder(pool, { runId, payerWallet: ata('e:2'), actor: ADMIN });
  assert.equal(second.order.order_no, 2, 'номер заказа обязан расти монотонно');
});

test('presale: деньги в заказе неизменяемы', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'meadow-4', currency: 'sol', priceUnits: 500_000_000n, cap: 2,
    treasury: ata('treasury'), actor: ADMIN,
  });
  const { order } = await reserveOrder(pool, { runId, payerWallet: ata('m:1'), actor: ADMIN });

  // Присваивание «колонка = колонка» триггер пропускает: IS DISTINCT FROM не
  // видит изменения. Проверять надо реальную подмену значения.
  const mutations: ReadonlyArray<readonly [string, string]> = [
    ['price_units', '999999999'],
    ['order_no', '999'],
    ['pack_id', "'field-2'"],
    ['payer_wallet', `'${ata('m:other')}'`],
    ['payer_email', "'other@example.com'"],
    ['created_at', "now() - interval '1 day'"],
    ['reserved_until', 'now() + interval \'1 day\''],
  ];
  for (const [column, value] of mutations) {
    await assert.rejects(
      withTransaction(pool, ADMIN, client =>
        client.query(`UPDATE game_ops.presale_orders SET ${column} = ${value} WHERE id = $1`, [order.id]),
      ),
      (e: unknown) => e instanceof GameOpsError && e.code === 'VALIDATION' && /PRESALE_IMMUTABLE_FIELD/.test(e.message),
      `колонка ${column} оказалась изменяемой`,
    );
  }
});

test('presale: машина переходов отвергает недопустимые шаги', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'bed-10', currency: 'sol', priceUnits: 100_000_000n, cap: 3,
    treasury: ata('treasury'), actor: ADMIN,
  });
  const { order } = await reserveOrder(pool, { runId, payerWallet: ata('s:1'), actor: ADMIN });

  // reserved -> delivered напрямую: выдача без оплаты.
  await assert.rejects(
    markDelivered(pool, { id: order.id, intentId: 1n, actor: ADMIN }),
    (e: unknown) => e instanceof GameOpsError && e.code === 'INVALID_TRANSITION',
  );
  // reserved -> paid напрямую: подтверждение без привязки платежа.
  await assert.rejects(
    confirmPayment(pool, { id: order.id, receivedUnits: 1n, slot: 1n, actor: ADMIN }),
    (e: unknown) => e instanceof GameOpsError && e.code === 'INVALID_TRANSITION',
  );

  // Законный путь работает.
  const sig = signature(`${runId}:ok`);
  const seen = await attachPayment(pool, { runId, orderNo: order.order_no, signature: sig, actor: ADMIN });
  assert.equal(seen.state, 'payment_seen');
  const paid = await confirmPayment(pool, { id: order.id, receivedUnits: 100_000_001n, slot: 4242n, actor: ADMIN });
  assert.equal(paid.state, 'paid');
  assert.equal(paid.paid_slot, '4242');
  const delivered = await markDelivered(pool, { id: order.id, intentId: 777n, actor: ADMIN });
  assert.equal(delivered.state, 'delivered');
  assert.equal(delivered.intent_id, '777');

  // Терминальное состояние — навсегда.
  await assert.rejects(
    refundOrder(pool, { id: order.id, reason: 'попытка вернуть выданное', actor: ADMIN }),
    (e: unknown) => e instanceof GameOpsError && e.code === 'INVALID_TRANSITION',
  );
});

test('presale: одна подпись не закрывает два заказа', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'bed-10', currency: 'sol', priceUnits: 100_000_000n, cap: 3,
    treasury: ata('treasury'), actor: ADMIN,
  });
  const a = await reserveOrder(pool, { runId, payerWallet: ata('d:1'), actor: ADMIN });
  const b = await reserveOrder(pool, { runId, payerWallet: ata('d:2'), actor: ADMIN });
  const sig = signature(`${runId}:dup`);

  await attachPayment(pool, { runId, orderNo: a.order.order_no, signature: sig, actor: ADMIN });
  await assert.rejects(
    attachPayment(pool, { runId, orderNo: b.order.order_no, signature: sig, actor: ADMIN }),
    (e: unknown) => e instanceof GameOpsError && e.code === 'DUPLICATE_PAYMENT',
  );
});

test('presale: подпись принимается только при переходе в payment_seen', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'bed-10', currency: 'sol', priceUnits: 100_000_000n, cap: 2,
    treasury: ata('treasury'), actor: ADMIN,
  });
  const { order } = await reserveOrder(pool, { runId, payerWallet: ata('g:1'), actor: ADMIN });
  await assert.rejects(
    withTransaction(pool, ADMIN, client =>
      client.query('UPDATE game_ops.presale_orders SET tx_signature = $2 WHERE id = $1',
        [order.id, signature(`${runId}:sneaky`)]),
    ),
    (e: unknown) => e instanceof GameOpsError && e.code === 'VALIDATION'
      && /PRESALE_SIGNATURE_REQUIRES_PAYMENT_SEEN/.test(e.message),
  );
});

test('presale: возврат из paid освобождает место и фиксируется', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'bed-10', currency: 'sol', priceUnits: 100_000_000n, cap: 1,
    treasury: ata('treasury'), actor: ADMIN,
  });
  const { order } = await reserveOrder(pool, { runId, payerWallet: ata('r:1'), actor: ADMIN });
  await attachPayment(pool, { runId, orderNo: order.order_no, signature: signature(`${runId}:ref`), actor: ADMIN });
  await confirmPayment(pool, { id: order.id, receivedUnits: 100_000_001n, slot: 9n, actor: ADMIN });

  // Причина короче 3 символов не принимается: возврат без причины не расследовать.
  await assert.rejects(
    refundOrder(pool, { id: order.id, reason: 'ab', actor: ADMIN }),
    (e: unknown) => e instanceof GameOpsError && e.code === 'VALIDATION' && /Причина возврата/.test(e.message),
  );
  const refunded = await refundOrder(pool, { id: order.id, reason: 'тираж закрыт, возврат по Условиям §7', actor: ADMIN });
  assert.equal(refunded.state, 'refunded');
  assert.match(refunded.failure_code ?? '', /^REFUND_[A-Z0-9]{4}$/);

  const status = await getRunStatus(pool, runId);
  assert.equal(status?.reserved_count, 0, 'возврат освобождает место в тираже');

  // Место свободно — новый покупатель проходит, и номер снова новый.
  const next = await reserveOrder(pool, { runId, payerWallet: ata('r:2'), actor: ADMIN });
  assert.equal(next.order.order_no, 2);
});

test('presale: cap и закрытие тиража необратимы', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'bed-10', currency: 'sol', priceUnits: 100_000_000n, cap: 2,
    treasury: ata('treasury'), actor: ADMIN,
  });

  await assert.rejects(
    superPool.query('UPDATE game_ops.presale_runs SET cap = 99 WHERE run_id = $1', [runId]),
    (e: unknown) => /PRESALE_RUN_CAP_IMMUTABLE/.test(String((e as Error).message)),
  );
  await assert.rejects(
    superPool.query('UPDATE game_ops.presale_runs SET price_units = 1 WHERE run_id = $1', [runId]),
    (e: unknown) => /PRESALE_RUN_IMMUTABLE_FIELD/.test(String((e as Error).message)),
  );

  await superPool.query('UPDATE game_ops.presale_runs SET is_open = false, closed_at = now() WHERE run_id = $1', [runId]);
  await assert.rejects(
    reserveOrder(pool, { runId, payerWallet: ata('c:1'), actor: ADMIN }),
    (e: unknown) => e instanceof GameOpsError && e.code === 'RUN_CLOSED',
  );
  await assert.rejects(
    superPool.query('UPDATE game_ops.presale_runs SET is_open = true WHERE run_id = $1', [runId]),
    (e: unknown) => /PRESALE_RUN_CANNOT_REOPEN/.test(String((e as Error).message)),
  );
});

test('presale: каждое действие попадает в аудит', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'bed-10', currency: 'sol', priceUnits: 100_000_000n, cap: 2,
    treasury: ata('treasury'), actor: ADMIN,
  });
  const { order } = await reserveOrder(pool, { runId, payerWallet: ata('a:1'), payerEmail: 'Buyer@Example.COM', actor: ADMIN });
  await attachPayment(pool, { runId, orderNo: order.order_no, signature: signature(`${runId}:audit`), actor: ADMIN });

  const rows = await superPool.query<{ action: string; outcome: string; actor: string }>(
    `SELECT action, outcome, actor FROM game_ops.admin_audit
      WHERE subject = 'presale_orders' AND subject_id = $1 ORDER BY id`,
    [order.id],
  );
  assert.deepEqual(rows.rows.map(r => r.action), ['presale_order.created', 'presale_order.transition']);
  assert.equal(rows.rows[0].actor, ADMIN, 'актор обязан попасть в аудит из GUC');

  // Email в аудите — только хешем: персональные данные в журнал не кладутся.
  const raw = await superPool.query<{ detail_hash: string }>(
    `SELECT detail_hash FROM game_ops.admin_audit WHERE subject = 'presale_orders' AND subject_id = $1 ORDER BY id LIMIT 1`,
    [order.id],
  );
  assert.match(raw.rows[0].detail_hash, /^[0-9a-f]{32}$/);
  const leaked = await superPool.query(
    `SELECT count(*)::int AS n FROM game_ops.admin_audit WHERE subject_id = $1`,
    [order.id],
  );
  assert.equal(leaked.rows[0].n, 2);
});

test('presale: очередь на выдачу содержит только оплаченное', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'meadow-4', currency: 'sol', priceUnits: 500_000_000n, cap: 3,
    treasury: ata('treasury'), actor: ADMIN,
  });
  const a = await reserveOrder(pool, { runId, payerWallet: ata('q:1'), actor: ADMIN });
  const b = await reserveOrder(pool, { runId, payerWallet: ata('q:2'), actor: ADMIN });
  await attachPayment(pool, { runId, orderNo: b.order.order_no, signature: signature(`${runId}:queue`), actor: ADMIN });
  await confirmPayment(pool, { id: b.order.id, receivedUnits: 500_000_002n, slot: 5n, actor: ADMIN });

  const pending = await listPendingDelivery(pool, 100);
  const ids = pending.map(o => o.id);
  assert.ok(ids.includes(b.order.id), 'оплаченный заказ обязан быть в очереди');
  assert.ok(!ids.includes(a.order.id), 'неоплаченный заказ не должен попасть в очередь');
});

test('presale: роль-писатель не может менять деньги и email', { skip }, async () => {
  const login = 'presale_writer_probe';
  await superPool.query(`DROP ROLE IF EXISTS ${login}`);
  await superPool.query(`CREATE ROLE ${login} LOGIN PASSWORD 'probe'`);
  await superPool.query(`GRANT game_ops_writer TO ${login}`);

  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'bed-10', currency: 'sol', priceUnits: 100_000_000n, cap: 2,
    treasury: ata('treasury'), actor: ADMIN,
  });
  const { order } = await reserveOrder(pool, {
    runId, payerWallet: ata('p:1'), payerEmail: 'probe@example.com', actor: ADMIN,
  });

  const probe = new pg.Pool({
    connectionString: url.replace('postgres:postgres', `${login}:probe`),
    max: 2, application_name: 'ares1-presale-probe',
  });
  try {
    // Служебная колонка — можно.
    await probe.query('UPDATE game_ops.presale_orders SET failure_code = $2 WHERE id = $1', [order.id, 'PROBE_OK']);
    // Деньги и персональные данные — нельзя даже своим кодом.
    for (const column of ['price_units', 'payer_email', 'payer_wallet', 'order_no']) {
      await assert.rejects(
        probe.query(`UPDATE game_ops.presale_orders SET ${column} = ${column} WHERE id = $1`, [order.id]),
        (e: unknown) => (e as pg.DatabaseError).code === '42501',
        `роль-писатель смогла обновить ${column}`,
      );
    }
    // Cap тиража — тоже нельзя.
    await assert.rejects(
      probe.query('UPDATE game_ops.presale_runs SET cap = cap WHERE run_id = $1', [runId]),
      (e: unknown) => (e as pg.DatabaseError).code === '42501',
    );
    // Счётчик мест триггеру нужен — выдаётся.
    await probe.query('SELECT reserved_count FROM game_ops.presale_runs WHERE run_id = $1 FOR UPDATE', [runId]);
  } finally {
    await probe.end();
    await superPool.query(`DROP ROLE IF EXISTS ${login}`);
  }
});

test('presale: тираж в SKR хранит валюту и считает пыль в атомах', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'bed-10', currency: 'skr', priceUnits: 1_053_000_000n, cap: 20,
    treasury: ata('treasury-skr-ata'), actor: ADMIN,
  });
  const res = await reserveOrder(pool, { runId, payerWallet: ata('skr:1'), actor: ADMIN });
  assert.equal(res.currency, 'skr');
  // 1053 SKR = 1 053 000 000 атомов, плюс 1 атом пыли за заказ №1.
  assert.equal(res.payUnits, 1_053_000_001n);

  const second = await reserveOrder(pool, { runId, payerWallet: ata('skr:2'), actor: ADMIN });
  assert.equal(second.payUnits, 1_053_000_002n);

  const status = await getRunStatus(pool, runId);
  assert.equal(status?.currency, 'skr');
  assert.equal(status?.units_per_whole, '1000000', 'у SKR 6 знаков, не 9');
});

test('presale: неизвестная валюта отклоняется схемой', { skip }, async () => {
  await assert.rejects(
    superPool.query(
      `INSERT INTO game_ops.presale_runs (run_id, pack_id, currency, price_units, cap, treasury)
       VALUES ($1, 'bed-10', 'usd', 100000, 5, $2)`,
      [newRunId(), ata('treasury')],
    ),
    (e: unknown) => (e as pg.DatabaseError).code === '23514',
  );
});

test('presale: публичный статус показывает валюту, но не email и не кошелёк', { skip }, async () => {
  const runId = newRunId();
  await openRun(pool, {
    runId, packId: 'meadow-4', currency: 'skr', priceUnits: 2_000_000_000n, cap: 5,
    treasury: ata('treasury-pub'), actor: ADMIN,
  });
  const wallet = ata('pub:1');
  const { order } = await reserveOrder(pool, {
    runId, payerWallet: wallet, payerEmail: 'secret@example.com', actor: ADMIN,
  });
  const pub = await getOrderPublic(pool, runId, order.order_no);
  assert.ok(pub, 'публичный статус должен находиться по номеру заказа');
  assert.equal(pub.currency, 'skr');
  assert.equal(pub.payer_wallet_masked, `${wallet.slice(0, 4)}\u2026${wallet.slice(-4)}`);
  assert.equal('payer_email' in pub, false, 'email не должен попадать в публичное представление');
  assert.equal('payer_wallet' in pub, false, 'полный кошелёк не должен попадать наружу');
});

test('presale: остановка пулов', { skip }, async () => {
  await pool.end();
  await superPool.end();
});
