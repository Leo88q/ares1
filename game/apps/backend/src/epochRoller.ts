import { assertDedicatedPayer, safeError } from "./security.js";
import cron from "node-cron";
import { Connection } from "@solana/web3.js";
import { env } from "./env.js";
import {
  payerKeypair,
  buildRollEpochIx,
  configPda,
  epochPda,
  sendPayerTx,
  programId,
} from "./solana.js";
import { buildAlert, sendAlert, shouldAlert } from "./alert.js";
import { LockedRun, RollLock, withEpochRollLock } from "./rollLock.js";
import {
  DataSourceMismatchError,
  SigningSnapshot,
  fetchSigningSnapshot,
  verifySnapshotConsistency,
} from "./policy.js";

const EPOCH_DURATION_SECONDS = 86_400;

// Metrics for monitoring
export let lastRollAttempt: number | null = null;
export let lastRollSuccess: number | null = null;
export let lastRollError: string | null = null;
export let consecutiveFailures = 0;

/**
 * Checklist item 103 (audit 2026-09-28): the signing decision is made ONLY on
 * a snapshot that (a) is read at `finalized` commitment and (b) matches the
 * same snapshot fetched from a second, independent RPC provider.
 *
 * KelpDAO precedent: the off-chain signer read a poisoned source while the
 * monitoring saw honest data. Here the monitoring (watchtower) and the signer
 * are separate processes already; in addition the signer itself refuses to act
 * on a single-source view when REQUIRE_SECONDARY_RPC is set (default: on in
 * production). A mismatch aborts the roll and fires the alert ladder — it is
 * an incident, not a transient RPC error.
 */
async function verifiedSnapshot(): Promise<SigningSnapshot> {
  const primary = await fetchSigningSnapshot(new Connection(env.rpcUrl, "finalized"), programId);
  let secondary: SigningSnapshot | null = null;
  if (env.secondaryRpcUrl) {
    secondary = await fetchSigningSnapshot(new Connection(env.secondaryRpcUrl, "finalized"), programId);
  }
  verifySnapshotConsistency(primary, secondary, env.requireSecondaryRpc);
  return primary;
}

export async function tryRollEpoch(): Promise<string | null> {
  const snapshot = await verifiedSnapshot();
  const config = snapshot.config;
  assertDedicatedPayer(payerKeypair.publicKey, config);
  const current = snapshot.epoch;
  const now = Math.floor(Date.now() / 1000);

  if (now < Number(current.startTime) + EPOCH_DURATION_SECONDS) {
    return null;
  }

  const nextId = config.epochId + 1n;
  const ix = buildRollEpochIx({
    config: configPda(),
    currentEpoch: epochPda(config.epochId),
    nextEpoch: epochPda(nextId),
    payer: payerKeypair.publicKey,
  });
  return sendPayerTx([ix]);
}

/** Missing/secondary-source problems must be loud: item 103 treats them as incidents. */
async function reportDataSourceProblem(err: unknown): Promise<void> {
  console.error(`[epoch-roller] DATA SOURCE INCIDENT: ${safeError(err)}`);
  void sendAlert(
    env.alertWebhookUrl,
    buildAlert(
      "data_source_mismatch",
      `epoch roller refused to sign: ${safeError(err)}`,
      consecutiveFailures,
    ),
  );
}

export interface EpochRollerOptions {
  /**
   * Общий замок для нескольких инстансов (game_ops advisory lock). null —
   * ровно один инстанс: такт выполняется без блокировки, как раньше.
   */
  lock?: RollLock | null;
}

export function startEpochRoller(options: EpochRollerOptions = {}) {
  const lock = options.lock ?? null;
  const logLine = (message: string) => console.log(`[epoch-roller] ${message}`);
  console.log(
    `[epoch-roller] schedule=${env.epochRollCron} lock=${lock ? "game_ops advisory" : "none (single instance)"} ` +
      `secondaryRpc=${env.secondaryRpcUrl ? "configured" : "none"} ` +
      `requireSecondary=${env.requireSecondaryRpc}`,
  );

  /** Сбой такта по крону: лестница алертов 3/9/27 (F-10). */
  async function handleCronFailure(err: unknown): Promise<void> {
    consecutiveFailures += 1;
    lastRollError = safeError(err);
    console.error(`[epoch-roller] failed (attempt ${consecutiveFailures}):`, safeError(err));
    // Checklist item 103: disagreement between data sources is not retried
    // silently — it goes to the alert channel on the FIRST occurrence.
    if (err instanceof DataSourceMismatchError) {
      await reportDataSourceProblem(err);
      return;
    }
    // F-10: external alert ladder (3/9/27) — console line above already fired.
    if (shouldAlert(consecutiveFailures)) {
      console.error(`[epoch-roller] CRITICAL: ${consecutiveFailures} consecutive roll failures! Check RPC and payer balance.`);
      void sendAlert(
        env.alertWebhookUrl,
        buildAlert(
          "epoch_roll_failures",
          `${consecutiveFailures} consecutive roll_epoch failures; check RPC and payer balance`,
          consecutiveFailures,
        ),
      );
    }
  }

  /** Стартовая проверка не считает попытки: это не крон, а разовый прогрев. */
  async function handleStartupFailure(err: unknown): Promise<void> {
    if (err instanceof DataSourceMismatchError) await reportDataSourceProblem(err);
    else console.error("[epoch-roller] startup check failed:", safeError(err));
  }

  /**
   * Один такт. Замок берётся до чтения цепи, поэтому два инстанса не выполняют
   * одну и ту же работу; «замок занят» — штатная ситуация, а не сбой.
   */
  async function tick(source: "cron" | "startup"): Promise<void> {
    let outcome: LockedRun<string | null>;
    try {
      outcome = await withEpochRollLock(
        lock,
        () => {
          lastRollAttempt = Date.now();
          return tryRollEpoch();
        },
        logLine,
      );
    } catch (err) {
      if (source === "cron") await handleCronFailure(err);
      else await handleStartupFailure(err);
      return;
    }
    if (!outcome.ran) return;
    const sig = outcome.value;
    if (sig) {
      console.log(`[epoch-roller] ${source === "startup" ? "startup roll" : "rolled epoch"}, tx=${sig}`);
      lastRollSuccess = Date.now();
      lastRollError = null;
      consecutiveFailures = 0;
    }
  }

  cron.schedule(env.epochRollCron, () => {
    void tick("cron");
  });

  // Immediate check on startup after 5s
  setTimeout(() => {
    void tick("startup");
  }, 5000);
}

