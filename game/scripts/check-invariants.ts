#!/usr/bin/env tsx
/**
 * On-chain invariant monitor — security checklist items 49 and 53.
 *
 * The game has no off-chain balances, but four accounting invariants still have
 * to hold at all times, and none of them is checked by a single instruction:
 *
 *   1. mint authority is still the config PDA (nobody re-took the mint);
 *   2. no freeze authority and decimals are still 6 (prices are quoted in atoms);
 *   3. circulating supply <= max_supply and the epoch counter never exceeded
 *      its mint cap (emission is bounded);
 *   4. the treasuries the program can move are inside the supply (sanity check
 *      for the "sum of balances + treasury <= supply" invariant — the monitor
 *      cannot enumerate every holder's ATA, so it checks the accounts the
 *      program itself controls plus the quest pool).
 *
 * Usage:
 *   RPC_URL=... PROGRAM_ID=... yarn tsx scripts/check-invariants.ts
 *   yarn tsx scripts/check-invariants.ts --json      # machine-readable output
 *
 * Exit codes: 0 = all invariants hold, 1 = at least one violated, 2 = the
 * monitor could not read the chain (RPC/accounts). Run it from cron and alert
 * on any non-zero exit — a silent invariant breach is how "fake burn"
 * economies die (checklist item 58).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { decodeGameConfig, decodeEpoch, u64LE } from "../apps/backend/src/anchorRaw.js";

export interface InvariantResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface InvariantReport {
  programId: string;
  slot: number;
  checks: InvariantResult[];
  violated: string[];
}

/**
 * Pure evaluation: takes already-read chain values, returns the verdicts.
 * Kept free of RPC so the rules are unit-testable without a cluster.
 */
export function evaluateInvariants(input: {
  configPda: PublicKey;
  mintAuthority: PublicKey | null;
  freezeAuthority: PublicKey | null;
  decimals: number;
  supply: bigint;
  maxSupplyMicro: bigint;
  epochMintedMicro: bigint;
  epochCapMicro: bigint;
  treasuryBalanceMicro: bigint;
  questPoolBalanceMicro: bigint;
  skrDecimals: number;
}): InvariantResult[] {
  const checks: InvariantResult[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // 1. Mint authority: the only path to new supply must be the program itself.
  push(
    "mint_authority_is_config_pda",
    !!input.mintAuthority && input.mintAuthority.equals(input.configPda),
    `mint authority ${input.mintAuthority?.toBase58() ?? "none"} vs config PDA ${input.configPda.toBase58()}`,
  );
  // 2a. No freeze authority — otherwise balances could be frozen at will.
  push(
    "mint_has_no_freeze_authority",
    input.freezeAuthority === null,
    `freeze authority ${input.freezeAuthority?.toBase58() ?? "none"}`,
  );
  // 2b. Decimals never change: every game price is quoted in 10^-6 atoms.
  push("potato_decimals_are_six", input.decimals === 6, `decimals ${input.decimals}`);
  push("skr_decimals_are_six", input.skrDecimals === 6, `SKR decimals ${input.skrDecimals}`);
  // 3. Emission bounds.
  push(
    "supply_within_max_supply",
    input.supply <= input.maxSupplyMicro,
    `supply ${input.supply} <= max ${input.maxSupplyMicro}`,
  );
  push(
    "epoch_minted_within_cap",
    input.epochMintedMicro <= input.epochCapMicro,
    `minted ${input.epochMintedMicro} <= cap ${input.epochCapMicro}`,
  );
  // 4. Treasuries the program controls must be a subset of the supply.
  push(
    "treasuries_within_supply",
    input.treasuryBalanceMicro + input.questPoolBalanceMicro <= input.supply,
    `treasury ${input.treasuryBalanceMicro} + quest pool ${input.questPoolBalanceMicro} <= supply ${input.supply}`,
  );
  return checks;
}

async function main(): Promise<number> {
  const rpcUrl = process.env.RPC_URL;
  const programIdRaw = process.env.PROGRAM_ID;
  if (!rpcUrl || !programIdRaw) {
    console.error("RPC_URL and PROGRAM_ID are required");
    return 2;
  }
  const programId = new PublicKey(programIdRaw);
  const connection = new Connection(rpcUrl, "confirmed");
  const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
  const questTreasuryPda = PublicKey.findProgramAddressSync([Buffer.from("quest_treasury")], programId)[0];

  try {
    const configInfo = await connection.getAccountInfo(configPda);
    if (!configInfo) {
      console.error("GameConfig not found — the program is not initialized on this cluster");
      return 2;
    }
    const config = decodeGameConfig(configInfo.data);
    const epochPda = PublicKey.findProgramAddressSync(
      [Buffer.from("epoch"), u64LE(config.epochId)],
      programId,
    )[0];
    const [mint, epochInfo, slot] = await Promise.all([
      getMint(connection, config.potatoMint),
      connection.getAccountInfo(epochPda),
      connection.getSlot(),
    ]);
    if (!epochInfo) {
      console.error(`Epoch ${config.epochId} account not found`);
      return 2;
    }
    const epoch = decodeEpoch(epochInfo.data);
    const treasuryAta = getAssociatedTokenAddressSync(config.potatoMint, configPda, true);
    const questAta = getAssociatedTokenAddressSync(config.potatoMint, questTreasuryPda, true);
    const [treasuryAccount, questAccount] = await Promise.all([
      getAccount(connection, treasuryAta).catch(() => null),
      getAccount(connection, questAta).catch(() => null),
    ]);
    let skrDecimals = 6;
    try {
      skrDecimals = (await getMint(connection, config.skrMint)).decimals;
    } catch {
      // SKR mint may not exist on this cluster (devnet constant) — report it.
      skrDecimals = -1;
    }

    const report: InvariantReport = {
      programId: programId.toBase58(),
      slot,
      checks: evaluateInvariants({
        configPda,
        mintAuthority: mint.mintAuthority,
        freezeAuthority: mint.freezeAuthority,
        decimals: mint.decimals,
        supply: mint.supply,
        maxSupplyMicro: config.maxSupplyMicro,
        epochMintedMicro: epoch.mintedMicro,
        epochCapMicro: epoch.mintCapMicro,
        treasuryBalanceMicro: treasuryAccount?.amount ?? 0n,
        questPoolBalanceMicro: questAccount?.amount ?? 0n,
        skrDecimals,
      }),
      violated: [],
    };
    report.violated = report.checks.filter(c => !c.ok).map(c => c.name);

    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`invariants @ slot ${report.slot} (program ${report.programId})`);
      for (const c of report.checks) {
        console.log(`  ${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`);
      }
    }
    if (report.violated.length) {
      console.error(`INVARIANTS VIOLATED: ${report.violated.join(", ")}`);
      return 1;
    }
    // Informational: quest pool draining fast is the sybil signal (checklist R8).
    if (!process.argv.includes("--json")) {
      console.log(`  info  quest pool: ${(questAccount?.amount ?? 0n).toString()} micro POTATO`);
      console.log(`  info  epoch minted: ${epoch.mintedMicro}/${epoch.mintCapMicro}`);
    }
    return 0;
  } catch (err) {
    console.error(`invariant monitor failed: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

// Runs only when invoked directly (`tsx scripts/check-invariants.ts`), so the
// pure rules above can be imported by tests without touching the network.
if (process.argv[1]?.endsWith("check-invariants.ts")) {
  main().then(code => process.exit(code));
}
