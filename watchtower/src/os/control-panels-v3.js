// Watchtower OS v3 — 19 control panels (read-only операционные панели).
// Каждая панель группирует компоненты stack-v3 в операционную поверхность с checks.
// /api/os/health возвращает ровно эти 19 слоёв; панели не выполняют запись в цепочку.

import { COMPONENTS_BY_ID, PROHIBITIONS } from './stack-v3.js';

const commonChecks = ['registry-target-declared', 'data-quality-partial-acknowledged'];

/** @readonly 19 panels, стабильный порядок = порядок слоёв /api/os/health. */
export const PANELS_V3 = Object.freeze([
  {
    id: 'identity', title: 'Identity — guest→embedded→native→linked',
    components: ['identity-layer'],
    summary: 'Privy + Phantom + FirstStep + Altude; cross-game PDA studio_profile (CgInv111…); pseudonymous playerKey с consent/opt-out.',
    checks: [...commonChecks, 'studio_profile-pda-mapped', 'flow-stages-declared'],
  },
  {
    id: 'session-keys', title: 'Session Keys — 0.01 SOL topUp only',
    components: ['session-keys-layer'],
    summary: 'createSession (CgInv111…), topUp 0.01 SOL, expiry 60min, signAndSendTransaction; scope deny withdraw_treasury.',
    checks: [...commonChecks, 'risk-cap-0.01-sol', 'deny-scope-withdraw_treasury', 'expiry-60min'],
    controls: PROHIBITIONS.controls,
  },
  {
    id: 'assets', title: 'Assets — cNFT $110/M + Standard NFT + Core Attributes',
    components: ['assets-layer', 'core-attributes'],
    summary: 'Common harvest → Bubblegum v2 cNFT (MCC, $110/1M); rare/legendary → Standard NFT; on-chain stats через Core Attributes (DAS 5ms).',
    checks: [...commonChecks, 'tensor-primary-cnft', 'me-deprecated-for-new-cnft-flag', 'core-attributes-plugin'],
  },
  {
    id: 'storage-privacy-data', title: 'Storage — Xandeum exabyte + PST private',
    components: ['xandeum', 'pst'],
    summary: 'Xandeum exabytes для game states/assets/player data (better than Arweave); PST commitments on-chain + encrypted off-chain.',
    checks: [...commonChecks, 'arweave-not-in-stack', 'pst-commitments-on-chain'],
  },
  {
    id: 'privacy-confidential', title: 'Privacy — Arcium confidential rollups + PST',
    components: ['arcium', 'pst'],
    summary: 'Confidential gaming payments (confidentialPayment private=true, createRollup) + hidden logic (card games). Full coverage, not competitive.',
    checks: [...commonChecks, 'complementary-er-hypergrid-repla', 'confidential-payments-declared'],
  },
  {
    id: 'indexer', title: 'Indexer — LaserStream + Shyft gPA + PG/TimescaleDB/Redis',
    components: ['indexer-layer'],
    summary: 'Finalized-only read-only экспорт: canonical identity cluster+slot+signature+instructionIndex+innerIndex, dedup, cursor, replay/backfill/gap, tenant_id RLS, cross-game materialized view.',
    checks: [...commonChecks, 'canonical-identity-5-tuple', 'finalized-only', 'idempotency-dedup', 'rls-tenant-id'],
  },
  {
    id: 'l2-router', title: 'L2 Router — HyperGrid / Sorada / Rush / REPLA / MagicBlock ER',
    components: ['l2-layer'],
    summary: 'Router decision tree: tps>100 isolation→HyperGrid; 5ms reads→Sorada; declarative world→Rush; L3 CLI→REPLA; gasless auto triggers→MagicBlock ER + Magic Actions cron 5min.',
    checks: [...commonChecks, 'router-rules-ordered', 'magic-actions-cron-5min', 'executeGasless-sub-10ms'],
  },
  {
    id: 'analytics-attribution', title: 'Analytics — Helika + GameSight Late ID Binding',
    components: ['analytics-layer'],
    summary: 'Cross-game dashboard + ad→on-chain attribution: ad_click(gamesight_click_id)→PlayerJoined→WalletConnected(solana_wallet)→mint/buy/sell. POST /api/ingest/solana.',
    checks: [...commonChecks, 'late-id-binding', 'solana-wallet-as-external-id', 'helika-ai-focus-backup'],
  },
  {
    id: 'ml-game-signals', title: 'ML — Game Signals churn 14d >85%',
    components: ['game-signals-ml'],
    summary: 'RandomForest по 60M+ tx из 12 игр (common wallets, pseudonymous): churn 14d >85%, funnel LTV, whale radar, campaign proposals (risk>0.7).',
    checks: [...commonChecks, 'churn-window-14d', 'no-pii-common-wallets', 'proposal-threshold-0.7'],
  },
  {
    id: 'marketplace-aggregation', title: 'Marketplace — ME/Shyft/GameShift/Tensor aggregator',
    components: ['marketplace-layer'],
    summary: 'ME 120 QPM Bearer (MCC+MT; deprecated for new cNFT), Shyft escrow-less in-app за дни, GameShift USD 170+ 100% chargeback, Tensor cNFT primary. marketplaceAggregator(gameId, assetType).',
    checks: [...commonChecks, 'aggregator-routes-declared', 'tensor-primary-cnft', 'usd-checkout-gameshift'],
  },
  {
    id: 'wagering', title: 'Wagering — Gamba provably fair',
    components: ['gamba'],
    summary: 'Potato harvest gamble + NFT wager, house edge 5%, jackpot, provably fair. Плановое событие WagerCreated.',
    checks: [...commonChecks, 'provably-fair', 'house-edge-5pct'],
  },
  {
    id: 'ai-agents', title: 'AI Agents — Husks/RitArena/relayzero/StealthSDK',
    components: ['husks', 'ritarena', 'relayzero', 'stealthsdk'],
    summary: 'Husks INT8 fighters (summon/train/auto-PvP, cNFT), RitArena arena lifecycle+retry events (chosen over Aureus), relayzero integrateAgent, StealthSDK token STEALTH.',
    checks: [...commonChecks, 'ritarena-over-aureus', 'retry-events-declared', 'token-stealth-named'],
  },
  {
    id: 'cross-chain', title: 'Cross-Chain — RACE multichain + idosgames bridge',
    components: ['race-sdk', 'idosgames-wallet'],
    summary: 'RACE cNFT Solana (Tensor) + NFT EVM (OpenSea), race-cli publish, verifiable fairness; idosgames RewardPool EVM↔Solana SPL deposits/withdrawals (complementary).',
    checks: [...commonChecks, 'race-cli-bundles', 'rewardpool-declared'],
  },
  {
    id: 'monetization', title: 'Monetization — Access stake-to-access + RewardPool + USD',
    components: ['access-protocol', 'idosgames-wallet', 'marketplace-layer', 'gamba'],
    summary: 'Access Protocol stake-to-access (sustainable income), idosgames RewardPool, GameShift USD checkout, Gamba wagering. Full coverage.',
    checks: [...commonChecks, 'stake-to-access', 'no-custodial-subscription'],
  },
  {
    id: 'engines-clients', title: 'Engines — Unity / Godot detailed / Unreal / Turbo / Web',
    components: ['engines-layer', 'godot-solana-sdk'],
    summary: 'Unity Solana.Unity-SDK, Godot GDExtension 4.3+ (SolanaClient/WalletAdapter/AnchorProgram + Candy Machine/SPL builders, session keys analog 0.01 SOL), Unreal VAR META Bifrost, Turbo, Web.',
    checks: [...commonChecks, 'godot-no-audit-mainnet-caution', 'gdunit4-planned'],
  },
  {
    id: 'scaffolding-apis', title: 'Scaffolding — Preset official + Rust Actix + Claude Skill',
    components: ['preset', 'rust-actix-api', 'claude-skill'],
    summary: 'Preset templates farming/racing/casual/strategy/autobattler/arena (npx create-solana-game); Rust Actix + Swagger create/join/calculate harvest/withdraw; Claude Skill patterns.',
    checks: [...commonChecks, 'templates-6', 'swagger-declared', 'create-solana-game-duplicate-resolved'],
  },
  {
    id: 'infra-frameworks', title: 'Infra — ARC ECS + Bolt FOCG + DePIN workers',
    components: ['arc-framework', 'bolt-focg', 'depin-workers'],
    summary: 'ARC Entity potato plot (Position/GrowthStage/Owner/Item source_game=ares1), Bolt FOCG verifiable world + delegateToER executeGasless <10ms, DePIN workers stake 10 SOL escrow 0.1/100 players.',
    checks: [...commonChecks, 'escrow-0.1-per-100', 'worker-stake-10-sol', 'bolt-world-declared'],
  },
  {
    id: 'security', title: 'Security — Skill + Sentio AST + SolGuard 130+',
    components: ['security-auditing-skill', 'sentio-cli', 'solguard'],
    summary: 'Systematic audit (signer/owner/PDA/CPI/reentrancy/overflow/access control/close account/init), Sentio static AST в CI, SolGuard AI 130+ patterns (chosen over SolShield). Full coverage not competitive.',
    checks: [...commonChecks, 'audit-categories-9', 'solguard-over-solshield', 'sentio-ci'],
    controls: PROHIBITIONS.controls,
  },
  {
    id: 'testing', title: 'Testing — Solana SLAM LiteSVM + Preset',
    components: ['solana-slam', 'preset'],
    summary: 'slam test --program (LiteSVM/Anchor/Mocha) + preset scaffold; smoke: anchor test, npm test, Unity play mode, GdUnit4, high-TPS gasless commitment, churn >85%, cross-game funnel.',
    checks: [...commonChecks, 'litesvm-runner', 'preset-official'],
  },
].map(p => Object.freeze({ ...p, status: 'declared', dataQuality: 'partial', network: 'devnet', blockchainWritesEnabled: false })));

if (PANELS_V3.length !== 19) throw new Error('OS_V3_PANELS_MUST_BE_19');

/** Сводка здоровья 19 слоёв для /api/os/health (layers — объект, ключ = panel id). */
export function osHealth() {
  const layers = {};
  for (const p of PANELS_V3) {
    layers[p.id] = {
      title: p.title, status: p.status, dataQuality: p.dataQuality,
      network: p.network, blockchainWritesEnabled: p.blockchainWritesEnabled,
      components: p.components, checks: p.checks,
    };
  }
  return { alive: true, layerCount: PANELS_V3.length, layers };
}

/** Валидация ссылок панелей на реестр (используется тестами и handoff check). */
export function validatePanelReferences() {
  const missing = [];
  for (const p of PANELS_V3) for (const id of p.components) {
    if (!COMPONENTS_BY_ID.has(id)) missing.push(`${p.id}:${id}`);
  }
  return missing;
}
