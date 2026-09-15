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

const EPOCH_DURATION_SECONDS = 86_400;

export async function tryRollEpoch(): Promise<string | null> {
  const config = await fetchConfig();
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
  cron.schedule(env.epochRollCron, async () => {
    try {
      const sig = await tryRollEpoch();
      if (sig) console.log(`[epoch-roller] rolled epoch, tx=${sig}`);
    } catch (err) {
      console.error("[epoch-roller] failed:", err);
    }
  });
}
