/**
 * CLI-сверка пресейла: цепь против БД.
 *
 * Запуск:
 *   GAME_OPS_DATABASE_URL=postgres://… RPC_URL=https://… \
 *   PRESALE_RUN_ID=<run> tsx scripts/presale-reconcile.ts
 *
 * Эта команда сравнивает финализированную SOL-историю казначейства с БД.
 * Exit 0 означает только, что проверяемые данные совпали; это не разрешение
 * принимать платежи, не гарантия полноты при недоступной истории и не одобрение
 * выдачи. Текущие launch gates: ../docs/LAUNCH_NEXT_STEPS.md.
 *
 * Выходной код: 0 = расхождений в проверенной SOL-истории нет;
 *               1 = есть расхождения (не выдавать);
 *               2 = проверка не выполнена: нет конфигурации/тиража или тираж в SKR.
 *                   Автосверка читает SOL-историю казначейства; SKR на mainnet
 *                   запрещён, а devnet SKR payment verification не заменяет launch gate.
 */
import process from 'node:process';
import { Connection } from '@solana/web3.js';
import { expectedGenesisHash } from '../apps/backend/src/cluster.js';
import type { SolanaCluster } from '../apps/backend/src/cluster.js';
import { bindPresaleDatabaseCluster } from '../apps/backend/src/gameops/clusterGuard.js';
import { loadGameOpsConfig } from '../apps/backend/src/gameops/env.js';
import { createPool, query, closePool } from '../apps/backend/src/gameops/pool.js';
import { fetchTreasuryTransfers } from '../apps/backend/src/presale/chain.js';
import { reconcile, payersFromChain } from '../apps/backend/src/presale/reconcile.js';

const SKR_MINT = 'Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o';

async function main(): Promise<void> {
  const runId = process.env.PRESALE_RUN_ID;
  const rpcUrl = process.env.RPC_URL;
  const clusterRaw = process.env.SOLANA_CLUSTER;
  if (!runId) { console.error('PRESALE_RUN_ID не задан'); process.exit(2); }
  if (!rpcUrl) { console.error('RPC_URL не задан'); process.exit(2); }
  if (clusterRaw !== 'devnet' && clusterRaw !== 'mainnet-beta') {
    console.error('SOLANA_CLUSTER должен быть devnet или mainnet-beta');
    process.exit(2);
  }
  const cluster: SolanaCluster = clusterRaw;

  const cfg = loadGameOpsConfig();
  if (!cfg) { console.error('GAME_OPS_DATABASE_URL не задан'); process.exit(2); }

  const pool = createPool(cfg);
  const connection = new Connection(rpcUrl, 'finalized');

  try {
    const actualGenesis = await connection.getGenesisHash();
    const expectedGenesis = expectedGenesisHash(cluster);
    if (actualGenesis !== expectedGenesis) {
      throw new Error(`RPC cluster mismatch: configured=${cluster}, genesis=${actualGenesis}`);
    }
    await bindPresaleDatabaseCluster(pool, cluster);
    const runs = await query<{ currency: 'sol' | 'skr'; treasury: string; started_slot: string }>(
      pool, 'SELECT currency, treasury, started_slot FROM game_ops.presale_runs WHERE run_id = $1', [runId],
    );
    const run = runs[0];
    if (!run) { console.error(`Тираж ${runId} не найден`); process.exit(2); }

    if (cluster === 'mainnet-beta' && run.currency !== 'sol') {
      throw new Error('Mainnet reconciliation only supports native SOL runs; refusing a non-mainnet currency.');
    }
    if (run.currency === 'skr') {
      // Не выдаём SOL-историю за «сверку SKR»: fetchTreasuryTransfers читает
      // только SOL-баланс казначейства, поэтому вердикт для SKR-тиража был бы
      // ложным в обе стороны (и при зелёном exit 0, и при красном). Честный
      // выход — «автосверки нет», а гейт для SKR — поштучный verify заказа.
      console.error('Тираж в SKR: автосверка токен-переводов не реализована.');
      console.error('Гейт для SKR — поштучная проверка заказа перед выдачей:');
      console.error('  POST /api/presale/admin/orders/:id/verify  (ожидается verdict.ok = true)');
      console.error('Mainnet launch blockers: ../docs/LAUNCH_NEXT_STEPS.md; ../game/docs/MAINNET_LAUNCH_GATE.md.');
      process.exit(2);
    }

    const chainTransfers = await fetchTreasuryTransfers(connection, run.treasury, BigInt(run.started_slot));

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
