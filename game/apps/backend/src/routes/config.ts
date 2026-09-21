import { Router } from "express";
import { fetchConfig, fetchEpoch } from "../solana.js";

export const configRouter = Router();

configRouter.get("/", async (_req, res) => {
  try {
    const config = await fetchConfig();
    const epoch = await fetchEpoch(config.epochId);
    res.json({
      authority: config.authority.toBase58(),
      potatoMint: config.potatoMint.toBase58(),
      maxSupplyMicro: config.maxSupplyMicro.toString(),
      dailyMintCapMicro: config.dailyMintCapMicro.toString(),
      baseYieldMicroPerDay: config.baseYieldMicroPerDay.toString(),
      globalMultiplierBps: config.globalMultiplierBps,
      fieldCount: config.fieldCount.toString(),
      epochId: config.epochId.toString(),
      totalBurnedMicro: config.totalBurnedMicro.toString(),
      paused: config.paused,
      epoch: {
        mintCapMicro: epoch.mintCapMicro.toString(),
        mintedMicro: epoch.mintedMicro.toString(),
        startTime: epoch.startTime.toString(),
      },
    });
  } catch {
    res.status(503).json({ error: "Failed to read on-chain config" });
  }
});
