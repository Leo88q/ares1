import { assertDedicatedPayer, safeError } from "./security.js";
import cron from "node-cron";
import { env } from "./env.js";
import {
  payerKeypair,
  buildRollEpochIx,
  configPda,
  epochPda,
  fetchConfig,
  fetchEpoch,
  sendPayerTx,
} from "./solana.js";
import { buildAlert, sendAlert, shouldAlert } from "./alert.js";

const EPOCH_DURATION_SECONDS = 86_400;

// Metrics for monitoring
export let lastRollAttempt: number | null = null;
export let lastRollSuccess: number | null = null;
export let lastRollError: string | null = null;
export let consecutiveFailures = 0;

export async function tryRollEpoch(): Promise<string | null> {
  const config = await fetchConfig();
  assertDedicatedPayer(payerKeypair.publicKey, config);
  const current = await fetchEpoch(config.epochId);
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

export function startEpochRoller() {
  console.log(`[epoch-roller] schedule=${env.epochRollCron}`);
  cron.schedule(env.epochRollCron, async () => {
    lastRollAttempt = Date.now();
    try {
      const sig = await tryRollEpoch();
      if (sig) {
        console.log(`[epoch-roller] rolled epoch, tx=${sig}`);
        lastRollSuccess = Date.now();
        lastRollError = null;
        consecutiveFailures = 0;
      }
    } catch (err) {
      consecutiveFailures += 1;
      lastRollError = safeError(err);
      console.error(`[epoch-roller] failed (attempt ${consecutiveFailures}):`, safeError(err));
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
  });

  // Immediate check on startup after 5s
  setTimeout(async () => {
    try {
      const sig = await tryRollEpoch();
      if (sig) console.log(`[epoch-roller] startup roll, tx=${sig}`);
    } catch (err) {
      console.error("[epoch-roller] startup check failed:", safeError(err));
    }
  }, 5000);
}
