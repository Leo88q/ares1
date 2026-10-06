/**
 * CLI-сверка пресейла: цепь против БД.
 *
 * Запуск:
 *   GAME_OPS_DATABASE_URL=postgres://… RPC_URL=https://… \
 *   PRESALE_RUN_ID=<run> tsx scripts/presale-reconcile.ts
 *
 * Это та же логика, что и в `GET /api/presale/admin/reconcile`, но как
 * автономная команда: оператор может запустить её до того, как поднят бэкенд,
 * и получить вердикт «можно ли выдавать» из терминала.
 *
 * Выходной код: 0 = расхождений нет, 1 = есть расхождения (не выдавать).
 */
import process from 'node:process';
import { Connection, PublicKey } from '@solana/web3.js';
import { loadGameOpsConfig } from '../apps/backend/src/gameops/env.js';
import { createPool, query, closePool } from '../apps/backend/src/gameops/pool.js';
import { fetchTreasuryTransfers } from '../apps/backend/src/presale/chain.js';
import { reconcile, payersFromChain } from '../apps/backend/src/presale/reconcile.js';

const SKR_MINT = 'Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o';

async function main(): Promise<void> {
  const runId = process.env.PRESALE_RUN_ID;
  const rpcUrl = process.env.RPC_URL;
  if (!runId) { console.error('PRESALE_RUN_ID не задан'); process.exit(2); }
  if (!rpcUrl) { console.error('RPC_URL не задан'); process.exit(2); }

  const cfg = loadGameOpsConfig();
  if (!cfg) { console.error('GAME_OPS_DATABASE_URL не задан'); process.exit(2); }

  const pool = createPool(cfg);
  const connection = new Connection(rpcUrl, 'confirmed');

  try {
    const runs = await query<{ currency: 'sol' | 'skr'; treasury: string }>(
      pool, 'SELECT currency, treasury FROM game_ops.presale_runs WHERE run_id = $1', [runId],
    );
    const run = runs[0];
    if (!run) { console.error(`Тираж ${runId} не найден`); process.exit(2); }

    const chainTransfers = await fetchTreasuryTransfers(connection, run.treasury);

    if (run.currency === 'skr') {
      console.log('Тираж в SKR: автосверка токен-переводов выполняется по подписям заказов.');
    }

    const orders = await query<{
      order_no: number; tx_signature: string | null; received_units: string | null;
      state: string; payer_wallet: string;
    }>(pool, `SELECT order_no, tx_signature, received_units, state, payer_wallet
              FROM game_ops.presale_orders WHERE run_id = $1`, [runId]);

    const dbOrders = orders.map(o => ({
      order_no: o.order_no,
      tx_signature: o.tx_signature,
      received_units: o.received_units !== null ? BigInt(o.received_units) : null,
      state: o.state,
      payer_wallet: o.payer_wallet,
    }));

    const report = reconcile(chainTransfers, dbOrders);
    const payers = payersFromChain(chainTransfers);

    console.log(JSON.stringify({
      ok: report.ok,
      matched: report.matchedCount,
      chainOnly: report.chainOnly,
      dbOnly: report.dbOnly.map(o => o.order_no),
      amountMismatch: report.amountMismatch,
      walletMismatch: report.walletMismatch,
      duplicateSignature: report.duplicateSignature,
      payers: payers.map(p => ({ wallet: p.fromWallet, transfers: p.transfers, total: p.totalUnits.toString() })),
    }, null, 2));

    process.exit(report.ok ? 0 : 1);
  } finally {
    await closePool(pool);
  }
  void SKR_MINT;
}

main().catch(err => {
  console.error('Ошибка сверки:', err instanceof Error ? err.message : err);
  process.exit(2);
});
