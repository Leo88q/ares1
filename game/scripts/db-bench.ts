/**
 * Нагрузочный стенд слоя game_ops: измеримые цифры вместо обещаний.
 *
 * Что измеряем (все сценарии — на реальном пути приложения, через pg.Pool):
 *   1) интенты: поштучно vs пачками (100/1000/5000) — во сколько раз пачка
 *      дешевле по round-trip;
 *   2) журнал: append поштучно vs пачками — стоимость hash-chain и блокировки
 *      головы цепочки (она сериализует писателей — это надо видеть в цифрах);
 *   3) конкурентные писатели: N воркеров × M операций — потолок из-за head-lock;
 *   4) чтение: хвост журнала, actionable-интенты, верификация цепочки.
 *
 * Важно: писатели идут в ОТДЕЛЬНУЮ цепочку (`bench_<ts>`), чтобы не пачкать
 * продуктовый `reward`; строки журнала по построению неудаляемы, поэтому это
 * не «мусор в базе», а доказательство прогона (reconciliation по bench-цепочке
 * не считается: она не ончейн).
 *
 * Запуск:
 *   yarn db:bench --url=postgres://… --rows=20000 --concurrency=8
 *   yarn db:bench --url=… --json=bench-results.json
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { appendBatch, verifyChainTail } from '../apps/backend/src/gameops/ledger.js';
import { createIntent, createIntentsBatch, listActionable } from '../apps/backend/src/gameops/intents.js';
import { deriveNonce } from '../apps/backend/src/gameops/hash.js';
import { ataLike, consoleLogger, isEntry, parseArgs, resolveDatabaseUrl, signatureLike, type Logger } from './db-common.js';

export interface BenchOptions {
  url: string;
  /** Сколько строк/операций на сценарий. */
  rows?: number;
  /** Размеры пачек для батч-сценариев. */
  batches?: number[];
  /** Число конкурентных воркеров. */
  concurrency?: number;
  poolMax?: number;
  chainId?: string;
  actor?: string;
  logger?: Logger;
}

export interface BenchResult {
  scenario: string;
  rows: number;
  batchSize: number;
  concurrency: number;
  durationMs: number;
  rowsPerSecond: number;
  opsPerSecond: number;
  p50Ms: number;
  p95Ms: number;
}


function percentile(sorted: number[], quantile: number): number {
  if (!sorted.length) return 0;
  const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[position]!;
}

export async function runBench(options: BenchOptions): Promise<BenchResult[]> {
  const logger = options.logger ?? consoleLogger;
  const rows = Math.max(options.rows ?? 2_000, 1);
  const batches = options.batches ?? [100, 1_000, 5_000];
  const concurrency = Math.max(options.concurrency ?? 4, 1);
  const chainId = options.chainId ?? `bench_${Math.floor(Date.now() / 1000)}`;
  const actor = options.actor ?? 'cli:db-bench';

  const pool = new pg.Pool({
    connectionString: options.url,
    max: Math.max(options.poolMax ?? concurrency + 2, 2),
    application_name: 'ares1-db-bench',
    connectionTimeoutMillis: 10_000,
  });

  const results: BenchResult[] = [];
  try {
    // ── 1. Интенты: поштучно ────────────────────────────────────────────────
    {
      const timings: number[] = [];
      const started = Date.now();
      for (let index = 0; index < rows; index += 1) {
        const t0 = performance.now();
        await createIntent(pool, {
          recipientAta: ataLike(index),
          amountMicro: BigInt(1_000 + (index % 1_000)),
          nonce: deriveNonce(['bench', chainId, index]),
          reason: 'bench:single',
          actor,
        });
        timings.push(performance.now() - t0);
      }
      results.push(summarize('intents.single', rows, 1, 1, Date.now() - started, timings));
    }

    // ── 2. Интенты пачками ─────────────────────────────────────────────────
    for (const batchSize of batches) {
      const total = Math.min(rows, batchSize * 10);
      const timings: number[] = [];
      const started = Date.now();
      for (let offset = 0; offset < total; offset += batchSize) {
        const size = Math.min(batchSize, total - offset);
        const inputs = Array.from({ length: size }, (_, i) => {
          const index = offset + i;
          return {
            recipientAta: ataLike(100_000 + index),
            amountMicro: BigInt(2_000 + (index % 1_000)),
            nonce: deriveNonce(['bench', chainId, 'batch', index]),
            reason: 'bench:batch',
            actor,
          };
        });
        const t0 = performance.now();
        await createIntentsBatch(pool, inputs, actor);
        timings.push(performance.now() - t0);
      }
      results.push(summarize(`intents.batch.${batchSize}`, total, batchSize, 1, Date.now() - started, timings));
    }

    // ── 3. Журнал: пачками (hash-chain + блокировка головы) ────────────────
    let ledgerIndex = 0;
    for (const batchSize of batches) {
      const total = Math.min(rows, batchSize * 10);
      const timings: number[] = [];
      const started = Date.now();
      for (let offset = 0; offset < total; offset += batchSize) {
        const size = Math.min(batchSize, total - offset);
        const payload = Array.from({ length: size }, (_, i) => {
          const index = ledgerIndex + i;
          return {
            recipientAta: ataLike(index),
            amountMicro: BigInt(3_000 + (index % 1_000)),
            signature: signatureLike(index),
            slot: BigInt(1_000_000 + index),
            blockTime: new Date(Date.now() - (total - index) * 1_000),
            chainId,
          };
        });
        const t0 = performance.now();
        await appendBatch(pool, payload, actor, chainId);
        timings.push(performance.now() - t0);
        ledgerIndex += size;
      }
      results.push(summarize(`ledger.append.batch.${batchSize}`, total, batchSize, 1, Date.now() - started, timings));
    }

    // ── 4. Журнал: поштучно (худший случай, важен для индексатора) ─────────
    {
      const total = Math.min(rows, 500);
      const timings: number[] = [];
      const started = Date.now();
      for (let index = 0; index < total; index += 1) {
        const absolute = ledgerIndex + index;
        const t0 = performance.now();
        await appendBatch(pool, [{
          recipientAta: ataLike(absolute),
          amountMicro: 1_500n,
          signature: signatureLike(absolute),
          slot: BigInt(2_000_000 + absolute),
          blockTime: new Date(),
          chainId,
        }], actor, chainId);
        timings.push(performance.now() - t0);
      }
      ledgerIndex += total;
      results.push(summarize('ledger.append.single', total, 1, 1, Date.now() - started, timings));
    }

    // ── 5. Конкурентные писатели: сериализация на голове цепочки ───────────
    {
      const batchSize = 100;
      const perWorker = Math.max(Math.floor(Math.min(rows, batchSize * concurrency) / concurrency / batchSize), 1);
      const started = Date.now();
      const startIndex = ledgerIndex;
      const timings: number[] = [];
      await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
        for (let round = 0; round < perWorker; round += 1) {
          const payload = Array.from({ length: batchSize }, (_, i) => {
            const index = ledgerIndex + worker * perWorker * batchSize + round * batchSize + i;
            return {
              recipientAta: ataLike(index),
              amountMicro: 2_500n,
              signature: signatureLike(index),
              slot: BigInt(3_000_000 + index),
              blockTime: new Date(),
              chainId,
            };
          });
          const t0 = performance.now();
          await appendBatch(pool, payload, actor, chainId);
          timings.push(performance.now() - t0);
          ledgerIndex += batchSize;
        }
      }));
      // Считаем строки ЭТОГО сценария, а не накопленный итог: иначе «строк/с»
      // завышается во столько раз, сколько сценариев было до него.
      results.push(summarize('ledger.append.concurrent', ledgerIndex - startIndex, batchSize, concurrency, Date.now() - started, timings));
    }

    // ── 6. Чтение ──────────────────────────────────────────────────────────
    for (const limit of [100, 1_000]) {
      const timings: number[] = [];
      const started = Date.now();
      for (let round = 0; round < 20; round += 1) {
        const t0 = performance.now();
        await verifyChainTail(pool, { chainId, limit });
        timings.push(performance.now() - t0);
      }
      results.push(summarize(`ledger.verify.tail.${limit}`, 20, 1, 1, Date.now() - started, timings));
    }
    {
      const timings: number[] = [];
      const started = Date.now();
      for (let round = 0; round < 20; round += 1) {
        const t0 = performance.now();
        await listActionable(pool, 100);
        timings.push(performance.now() - t0);
      }
      results.push(summarize('intents.actionable.read', 20, 1, 1, Date.now() - started, timings));
    }

    logger.info(`[db:bench] цепочка прогона: ${chainId}, строк в журнале: ${ledgerIndex}`);
    return results;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function summarize(scenario: string, rows: number, batchSize: number, concurrency: number, durationMs: number, timings: number[]): BenchResult {
  const sorted = [...timings].sort((a, b) => a - b);
  const seconds = durationMs / 1_000;
  return {
    scenario,
    rows,
    batchSize,
    concurrency,
    durationMs: Math.round(durationMs),
    rowsPerSecond: Math.round(rows / seconds),
    opsPerSecond: Math.round(timings.length / seconds),
    p50Ms: Number(percentile(sorted, 0.5).toFixed(2)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
  };
}

function printTable(results: BenchResult[]): void {
  const header = ['сценарий', 'строк', 'пачка', 'потоков', 'мс', 'строк/с', 'оп/с', 'p50,мс', 'p95,мс'];
  const table = results.map(result => [
    result.scenario,
    String(result.rows),
    String(result.batchSize),
    String(result.concurrency),
    String(result.durationMs),
    String(result.rowsPerSecond),
    String(result.opsPerSecond),
    String(result.p50Ms),
    String(result.p95Ms),
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...table.map(row => row[column]!.length)));
  const line = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column]!)).join(' | ');
  console.log(line(header));
  console.log(widths.map(width => '-'.repeat(width)).join('-+-'));
  for (const row of table) console.log(line(row));
}

async function main(): Promise<void> {
  const { options } = parseArgs(process.argv.slice(2));
  const batches = options.get('batches')?.split(',').map(Number).filter(Number.isFinite);
  const results = await runBench({
    url: resolveDatabaseUrl(options),
    rows: options.has('rows') ? Number(options.get('rows')) : undefined,
    batches,
    concurrency: options.has('concurrency') ? Number(options.get('concurrency')) : undefined,
    poolMax: options.has('pool-max') ? Number(options.get('pool-max')) : undefined,
  });
  printTable(results);
  const out = options.get('json');
  if (out) {
    writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
    console.log(`[db:bench] JSON: ${out}`);
  }
  process.exit(0);
}

if (isEntry('db-bench')) {
  main().catch(error => {
    console.error('[db:bench] FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
