// Watchtower OS v3 — идеальный бесплатный стек ARES-1 (deduplicated, read-only).
// Single source of truth для /api/os/config, control-panels-v3.js и handoff-v3.js.
// Границы: без private keys, blockchainWritesEnabled=false, stage=prototype,
// dataQuality=partial. Это декларативный реестр конфигураций, а не клиент в Solana.

/** @readonly игровая и tenancy идентичность */
export const GAME = Object.freeze({
  gameId: 'ares1',
  name: 'ARES-1',
  tenant: 'ares1',
  genre: 'strategy',
  network: 'devnet',
  stage: 'prototype',
  dataQuality: 'partial',
  blockchainWritesEnabled: false,
  addressProvenance: 'repository_only_not_network_verified',
});

/**
 * Программные ID. v3 декларирует сплит программ; живой deployment v1/v2 — одна
 * программа. Значения адресов не хранятся для непроверенных программ; ARES1_CORE_PROGRAM_ID
 * фигурирует только как ИМЯ env (запрет: ENV names without values).
 */
export const PROGRAMS = Object.freeze([
  {
    key: 'cgInv', alias: 'CgInv111111111111111111111111111111111111',
    role: 'in-game economy instructions (harvest economy surface, session createSession target)',
    env: 'ARES1_CGINV_PROGRAM_ID', address: null, verified: false,
    note: 'v3 alias; фактический devnet deployment см. verifiedDeploymentProgramId ниже',
  },
  {
    key: 'sessKeys', alias: 'SessKeys111111111111111111111111111111111',
    role: 'session keys: createSession, topUp 0.01 SOL, scope deny withdraw_treasury',
    env: 'ARES1_SESSION_KEYS_PROGRAM_ID', address: null, verified: false,
  },
  {
    key: 'treasury', alias: 'STrEaSuRy11111111111111111111111111111111',
    role: 'treasury program; недоступен для session keys и exporter (deny withdraw_treasury)',
    env: 'ARES1_TREASURY_PROGRAM_ID', address: null, verified: false,
  },
  {
    key: 'core', alias: 'ARES1_CORE_PROGRAM_ID',
    role: 'core program id через env; значение не коммитится (ENV names without values)',
    env: 'ARES1_CORE_PROGRAM_ID', address: null, verified: false,
  },
]);

/** Единственный проверенный программный deployment (watchtower/integration-manifest.json). */
export const VERIFIED_DEPLOYMENT = Object.freeze({
  programId: 'DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf',
  network: 'devnet',
  idlVersion: '0.2.0',
  parserVersion: 'ares1-v1',
  deploymentVerified: false,
  lastVerifiedAt: null,
  note: 'единая v1/v2 программа; v3-сплит (CgInv/SessKeys/STrEaSuRy/core) — prototype',
});

/** Запреты и обязательные контроли (из «Запреты» ARES-1 v3). */
export const PROHIBITIONS = Object.freeze({
  noPrivateKeys: true,
  readOnly: true,
  blockchainWritesEnabled: false,
  pseudonymousPlayerKey: true,
  consentOptOut: true,
  envNamesWithoutValues: true,
  sessionKeys: Object.freeze({
    riskCapSol: 0.01,
    allowedScope: ['topUp'],
    deniedScope: ['withdraw_treasury'],
    expiryMinutes: 60,
  }),
  marketplace: Object.freeze({
    magicEdenDeprecatedForNewCnft: true,
    tensorPrimaryForCnft: true,
  }),
  godot: Object.freeze({ audited: false, mainnet: 'caution' }),
  helika: 'AI focus with backup attribution path',
  controls: ['RBAC', '2FA', 'multisig', 'timelock', 'audit_log', 'rollback'],
});

/** L2 Router decision tree (порядок правил значим). */
export const L2_ROUTER = Object.freeze([
  { when: 'tps > 100 && isolation needed', then: 'sonic-hypergrid' },
  { when: 'need 5ms reads', then: 'sorada' },
  { when: 'declarative world config', then: 'rush-ecs' },
  { when: 'L3 CLI + Anchor settle', then: 'repla' },
  { when: 'gasless auto triggers (auto PvP, auto tournament, auto harvest)', then: 'magicblock-er (delegate → executeGasless → commit_state; Magic Actions cron 5 min)' },
  { when: 'confidential payments / private state transitions', then: 'arcium' },
]);

/** Аналитическая воронка GameSight / Helika (Late ID Binding). */
export const ANALYTICS_FUNNEL = Object.freeze([
  'ad_click (gamesight_click_id)',
  'PlayerJoined external_id=click_id',
  'WalletConnected solana_wallet link',
  'on-chain events wallet_id (mint/buy/sell)',
  'attribution ad_click→wallet→mint (full funnel)',
]);

/** v1: 8 слоёв (layer-bundles, провайдеры внутри). */
const V1 = [
  {
    id: 'identity-layer', track: 'v1', kind: 'layer', category: ['identity'],
    name: 'Identity: Privy + Phantom + FirstStep + Altude',
    bestFree: 'unified guest-→embedded-→native-→linked, cross-game PDA studio_profile',
    providers: ['Privy (embedded wallets)', 'Phantom', 'FirstStep', 'Altude'],
    crossGame: { pda: 'studio_profile', program: 'CgInv111111111111111111111111111111111111' },
    key: { flow: ['guest', 'embedded', 'native', 'linked'], pseudonymousPlayerKey: true, consentOptOut: true },
  },
  {
    id: 'session-keys-layer', track: 'v1', kind: 'layer', category: ['identity'],
    name: 'Session Keys 0.01 SOL (JWT Web3)',
    bestFree: 'keyless UX при жёстком риск-капе 0.01 SOL',
    calls: ['createSession (CgInv111…)', 'topUp 0.01 SOL', 'signAndSendTransaction'],
    key: {
      riskSol: 0.01, expiryMinutes: 60, scopeAllowed: ['topUp'],
      scopeDenied: ['withdraw_treasury'], program: 'SessKeys111…', txTarget: 'CgInv111…',
    },
  },
  {
    id: 'assets-layer', track: 'v1', kind: 'layer', category: ['assets'],
    name: 'Assets: cNFT $110/M + Standard NFT + Core Attributes',
    bestFree: 'массовые common предметы как cNFT, rare/legendary — Standard NFT',
    key: {
      cnft: { standard: 'Bubblegum v2', merkleTree: true, mcc: true, costPer1MMintsUsd: 110 },
      standardNft: 'rare/legendary single mints',
      marketplace: { primary: 'tensor', magicEden: 'deprecated for new cNFT' },
      onChainStats: 'core-attributes', storage: 'xandeum',
    },
  },
  {
    id: 'indexer-layer', track: 'v1', kind: 'layer', category: ['indexer'],
    name: 'Indexer: LaserStream gRPC + Shyft gPA + PG/TimescaleDB/Redis',
    bestFree: 'finaned-only read-only экспорт с идемпотентностью и replay',
    providers: ['Triton LaserStream gRPC (24h replay)', 'Shyft gPA 15ms + REST callbacks', 'PostgreSQL + TimescaleDB + Redis'],
    key: {
      subscriptions: ['CgInv111…', 'SessKeys111…', 'STrEaSuRy111…', 'ARES1_CORE_PROGRAM_ID'],
      shyftCallbacks: ['TOKEN_MINT', 'NFT_MINT'],
      webhook: 'POST /api/webhooks/shyft/ares1',
      canonicalIdentity: ['cluster', 'slot', 'signature', 'instructionIndex', 'innerIndex'],
      guarantees: ['idempotency', 'dedup', 'cursor', 'replay', 'backfill', 'gap', 'finalized reconciliation', 'parser versioning', 'tenant_id RLS', 'cross-game materialized view'],
    },
  },
  {
    id: 'l2-layer', track: 'v1', kind: 'layer', category: ['l2'],
    name: 'L2: Sonic HyperGrid + Sorada + Rush + REPLA + MagicBlock ER',
    bestFree: 'ideal free L2 + privacy + storage с Router decision tree',
    providers: ['Sonic HyperGrid (тысячи TPS, no contention)', 'Sorada (5ms reads, 30-40x)', 'Rush ECS (declarative world)', 'REPLA repla-cli L3', 'MagicBlock ER (sub-10ms gasless, Magic Actions cron)'],
    key: {
      magicActions: { cronEveryMinutes: 5, job: 'auto harvest' },
      router: L2_ROUTER,
    },
  },
  {
    id: 'analytics-layer', track: 'v1', kind: 'layer', category: ['analytics'],
    name: 'Analytics: Helika + GameSight + Game Signals ML',
    bestFree: 'ad→on-chain attribution через solana_wallet как external_id (Late ID Binding)',
    providers: ['Helika cross-game dashboard (Web2 in-game + on-chain, acquisition, LiveOps, A/B)', 'GameSight Late ID Binding', 'Game Signals ML'],
    key: {
      campaignMapping: 'campaign_id ↔ solana_wallet',
      ingestEndpoint: 'POST /api/ingest/solana',
      funnel: ANALYTICS_FUNNEL,
      seoGeo: ['Blinks', 'short videos', 'whale radar', 'TipLink vs payer LTV'],
    },
  },
  {
    id: 'marketplace-layer', track: 'v1', kind: 'layer', category: ['marketplace'],
    name: 'Marketplace: ME + Shyft escrow-less + GameShift + Tensor',
    bestFree: 'aggregator marketplaceAggregator(gameId, assetType) маршрутизирует листинги',
    providers: [
      'Magic Eden 120 QPM Bearer (MCC+MT; deprecated for new cNFT)',
      'Shyft escrow-less in-app (за дни, stats API one call)',
      'GameShift USD, 170+ стран, 100% chargeback, gas abstraction',
      'Tensor cNFT Bubblegum v2 (primary)',
    ],
    key: {
      itemFlows: ['Gamba wager NFT', 'Husks fighter cNFT', 'RitArena bot', 'RACE multichain', 'Access stake-to-access', 'idosgames RewardPool'],
      aggregator: { fn: 'marketplaceAggregator', args: ['gameId', 'assetType'], routes: { cnft: 'tensor', standard: ['tensor', 'magic-eden'], usdCheckout: 'gameshift' } },
    },
  },
  {
    id: 'engines-layer', track: 'v1', kind: 'layer', category: ['engines'],
    name: 'Engines: Unity + Godot + Unreal + Turbo + Web',
    bestFree: 'официальные SDK + детальный Godot; 13 best-free v3 SDK подключены отдельно',
    providers: ['Unity Solana.Unity-SDK', 'Godot godot-solana-sdk (GDExtension 4.3+)', 'Unreal VAR META Bifrost', 'Turbo', 'Web'],
    key: { clients: ['unity', 'godot', 'unreal', 'turbo', 'web'] },
  },
];

/** v2: 12 продуктов (incl. aureus deprecated). */
const V2 = [
  {
    id: 'godot-solana-sdk', track: 'v2', kind: 'product', category: ['engines'],
    name: 'Godot godot-solana-sdk (GDExtension 4.3+)',
    install: 'Godot Asset Library: godot-solana-sdk',
    bestFree: 'нативный детальный клиентский SDK',
    key: {
      gdextension: '4.3+', classes: ['SolanaClient', 'WalletAdapter', 'AnchorProgram'],
      builders: ['Candy Machine', 'SPL token'],
      sessionKeysAnalog: 'temporary keypair capped 0.01 SOL (аналог session keys)',
      audited: false, mainnet: 'caution', tests: 'GdUnit4',
    },
  },
  {
    id: 'gamba', track: 'v2', kind: 'product', category: ['marketplace', 'ai'],
    name: 'Gamba wagering',
    install: 'npm i gamba-core-v2',
    bestFree: 'potato harvest gamble + NFT wager, provably fair',
    key: { provablyFair: true, houseEdgePct: 5, jackpot: true, items: ['potato harvest gamble', 'NFT wager'], eventsPlanned: ['WagerCreated'] },
  },
  {
    id: 'preset', track: 'v2', kind: 'product', category: ['testing', 'scaffold'],
    name: 'Preset — официальный scaffold create-solana-game',
    install: 'npx create-solana-game ares1 --preset <template>',
    bestFree: 'official templates + Anchor + Player score + JS/Unity clients + IDL',
    chosenOver: 'create-solana-game (duplicate, deprecated)',
    key: { templates: ['farming', 'racing', 'casual', 'strategy', 'autobattler', 'arena'], official: true },
  },
  {
    id: 'arc-framework', track: 'v2', kind: 'product', category: ['infra'],
    name: 'ARC Framework (Entity-Component interoperability)',
    bestFree: 'кросс-игровые Entity potato plot из tenant ares1',
    key: {
      entity: 'potato plot',
      components: ['Position', 'GrowthStage', 'Owner', 'Item(source_game=ares1, is_cnft, asset_id)'],
      systems: ['harvest'], eventsPlanned: ['ComponentAdded'],
    },
  },
  {
    id: 'bolt-focg', track: 'v2', kind: 'product', category: ['infra'],
    name: 'Bolt FOCG (fully on-chain verifiable farming world)',
    bestFree: 'verifiable FOCG world + MagicBlock ER delegate <10ms gasless',
    key: {
      cli: ['bolt init', 'bolt build', 'bolt deploy world create'],
      client: ['BoltClient', 'createEntity', 'addComponent', 'executeSystem', 'delegateToER', 'executeGasless (<10ms)'],
      components: ['Position', 'Crop', 'Player'], systems: ['plant', 'harvest'],
      magicActionsCron: '*/5 * * * * (auto harvest)', eventsPlanned: ['PlotPlanted'],
    },
  },
  {
    id: 'depin-workers', track: 'v2', kind: 'product', category: ['infra'],
    name: 'DePIN workers (matchmaking / leaderboard / push)',
    bestFree: 'license + escrow + rewards за сервисные воркеры',
    key: {
      useCases: ['matchmaking', 'leaderboard', 'push notifications'],
      workerStakeSol: 10, escrowSolPer100Players: 0.1, slashing: true, rewards: true,
      eventsPlanned: ['WorkerStaked'],
    },
  },
  {
    id: 'game-signals-ml', track: 'v2', kind: 'product', category: ['analytics'],
    name: 'Game Signals ML (churn 14d >85%)',
    bestFree: 'common wallets поверх 12 игр → churn/LTV/funnel без PII',
    key: {
      trainedOn: '60M+ tx, 12 games, common wallets (pseudonymous)',
      model: 'sklearn.RandomForest', churnWindowDays: 14, churnAccuracy: '>85%',
      outputs: ['churn_risk', 'funnel LTV', 'cross-game retention', 'campaign proposal', 'whale radar'],
      campaignProposal: { endpoint: 'POST /api/campaigns/proposals', churnRiskThreshold: 0.7 },
      question: 'which funnel brings most valuable players (SEO/GEO Blinks, TipLink vs payer LTV)',
      telemetry: ['session match_start', 'session match_end'],
    },
  },
  {
    id: 'rust-actix-api', track: 'v2', kind: 'product', category: ['infra'],
    name: 'Rust API (Actix + Swagger)',
    bestFree: 'high-performance off-chain backend контракт',
    key: {
      framework: 'actix-web', swagger: true,
      endpoints: ['create game', 'join', 'calculate harvest', 'withdraw'],
      track: 'Track Watchtower PotatoHarvested + solana_wallet',
    },
  },
  {
    id: 'husks', track: 'v2', kind: 'product', category: ['ai'],
    name: 'Husks (potato fighters, INT8)',
    install: 'npm i husks-sdk',
    bestFree: 'procedural pixel fighters, авто-PvP и market dominance',
    key: {
      int8Training: true, asset: 'cNFT', summonNftFighters: true,
      trainVia: ['harvesting', 'battles'], autoPvp: true, eventsPlanned: ['FighterSummoned'],
    },
  },
  {
    id: 'aureus', track: 'v2', kind: 'product', category: ['ai'],
    name: 'Aureus arena SDK',
    bestFree: null, status: 'deprecated', supersededBy: 'ritarena',
    key: { reason: 'duplicate of RitArena; RitArena best free lifecycle + retry events' },
  },
  {
    id: 'race-sdk', track: 'v2', kind: 'product', category: ['cross-chain'],
    name: 'RACE multichain SDK',
    install: 'npm i race-sdk (sdk-solana), race-cli',
    bestFree: 'cNFT Solana (Tensor) + NFT EVM (OpenSea), fairness verifiable',
    key: {
      chains: ['solana', 'evm'], cli: 'race-cli', bundles: true, publish: ['solana', 'evm'],
      verifiableFairness: true, nftTargets: { solana: 'Tensor (cNFT)', evm: 'OpenSea' },
      eventsPlanned: ['CrossChainLinked'],
    },
  },
  {
    id: 'claude-skill', track: 'v2', kind: 'product', category: ['engines', 'scaffold'],
    name: 'Claude Skill (Solana gamedev patterns)',
    bestFree: 'prompt patterns для интеграций без секретов',
    key: { patterns: ['Unity SDK', 'MWA', 'state arch onchain vs offchain', 'testing'] },
  },
];

/** v3: 13 best-free (deduplicated ideal free additions). */
const V3 = [
  {
    id: 'security-auditing-skill', track: 'v3', kind: 'skill', category: ['security'],
    name: 'Security Auditing Skill',
    bestFree: 'systematic prompt-based audit до и после Sentio/SolGuard',
    key: {
      systematic: true, promptBased: true,
      categories: ['signer', 'owner', 'PDA', 'CPI', 'reentrancy', 'overflow', 'access control', 'close account', 'init checks'],
      target: 'Anchor Rust vulnerabilities',
    },
  },
  {
    id: 'sentio-cli', track: 'v3', kind: 'product', category: ['security'],
    name: 'Sentio CLI (static AST scanner)',
    install: 'sentio CLI',
    bestFree: 'static Rust AST scan в CI на common vulns',
    key: { astScanner: true, staticRust: true, ci: true },
  },
  {
    id: 'solguard', track: 'v3', kind: 'product', category: ['security'],
    name: 'SolGuard AI audit (130+ patterns)',
    install: 'solguard CLI/AI',
    bestFree: 'AI auto audit 130+ паттернов; более established, чем SolShield',
    chosenOver: 'solshield (duplicate)',
    key: {
      patterns: 130, ai: true,
      covers: ['signer checks', 'rights bypass', 'flash-loan exploits', 'PDA validation', 'CPI injection', 'reentrancy', 'overflow', 'account confusions'],
    },
  },
  {
    id: 'xandeum', track: 'v3', kind: 'product', category: ['storage'],
    name: 'Xandeum scalable storage layer',
    install: 'npm i @xandeum/sdk',
    bestFree: 'экзабайты game states/assets/player data; better than Arweave',
    chosenOver: 'arweave',
    key: { capacity: 'exabytes', decentralized: true, stores: ['game states', 'assets', 'player data'] },
  },
  {
    id: 'pst', track: 'v3', kind: 'product', category: ['storage', 'privacy'],
    name: 'PST — Private State Toolkit',
    install: 'npm i @private-state-toolkit/sdk',
    bestFree: 'private verifiable commitments on-chain + encrypted off-chain',
    key: { commitments: 'on-chain', payload: 'encrypted off-chain', hiddenLogic: ['card games'], verifiable: true },
  },
  {
    id: 'core-attributes', track: 'v3', kind: 'product', category: ['assets', 'storage'],
    name: 'Metaplex Core Attributes Plugin',
    install: 'npm i @metaplex-foundation/mpl-core',
    bestFree: 'on-chain key-value NFT stats, читаемые программами и DAS',
    key: {
      onChainKeyValue: true, stats: ['level', 'wins', 'harvests'],
      readableBy: ['programs', 'DAS getAssetsByOwner (5ms)'],
    },
  },
  {
    id: 'access-protocol', track: 'v3', kind: 'product', category: ['monetization'],
    name: 'Access Protocol (stake-to-access)',
    install: 'npm i @access-protocol/sdk',
    bestFree: 'sustainable income без кастодиальной подписки',
    key: { model: 'stake-to-access', sustainable: true },
  },
  {
    id: 'idosgames-wallet', track: 'v3', kind: 'product', category: ['monetization', 'cross-chain'],
    name: '@idosgames/wallet bridge (EVM↔Solana RewardPool)',
    install: 'npm i @idosgames/wallet',
    bestFree: 'депозиты/выводы SPL через RewardPool; complementary to RACE',
    key: { direction: 'EVM↔Solana', rewardPool: true, spl: true, flows: ['deposits', 'withdrawals'], complementaryTo: 'race-sdk' },
  },
  {
    id: 'ritarena', track: 'v3', kind: 'product', category: ['ai'],
    name: 'RitArena SDK (autonomous bot arena)',
    install: 'npm i ritarena-sdk',
    bestFree: 'harvest tournament bots: lifecycle + retry + event emission',
    chosenOver: 'aureus',
    key: {
      lifecycle: ['createArena', 'addBot', 'compete'], retryLogic: true,
      eventEmission: ['BotCompeted', 'ArenaFinished', 'BotCreated'], autonomous: true,
    },
  },
  {
    id: 'relayzero', track: 'v3', kind: 'product', category: ['ai'],
    name: 'relayzero agent economy network',
    install: 'npm i relayzero-sdk',
    bestFree: 'agent economy: integrateAgent',
    key: { integrateAgent: true, network: 'agent economy' },
  },
  {
    id: 'stealthsdk', track: 'v3', kind: 'product', category: ['ai'],
    name: 'StealthSDK (AI-games framework, token STEALTH)',
    install: 'npm i stealthsdk',
    bestFree: 'framework AI-игр с токеном STEALTH',
    key: { init: 'stealthsdk init', token: 'STEALTH', aiGames: true },
  },
  {
    id: 'solana-slam', track: 'v3', kind: 'product', category: ['testing'],
    name: 'Solana SLAM (LiteSVM + Anchor + Mocha)',
    install: 'npm i solana-slam',
    bestFree: 'современное тестирование: slam test --program',
    chosenOver: 'older anchor-only flows',
    key: { litesvm: true, anchor: true, mocha: true, command: 'slam test --program' },
  },
  {
    id: 'arcium', track: 'v3', kind: 'product', category: ['privacy', 'l2'],
    name: 'Arcium confidential computing rollups',
    install: 'npm i @arcium/sdk',
    bestFree: 'confidential payments + private rollout state; best free privacy rollup',
    key: {
      calls: ['confidentialPayment(private=true)', 'createRollup'],
      confidential: true, gamingPaymentsPrivacy: true,
      complementaryTo: ['magicblock-er (sub-10ms gasless)', 'sonic-hypergrid', 'repla'],
      eventsPlanned: ['ConfidentialSettled'],
    },
  },
];

/** 33 компонента: 8 v1 layers + 12 v2 products + 13 v3 best free (dedup через id). */
export const COMPONENTS = Object.freeze([...V1, ...V2, ...V3].map(c => Object.freeze({ status: 'ideal-free', install: null, chosenOver: null, supersededBy: null, ...c })));

/** Duplicates deprecated 3: разрешённые дубли и их замена. */
export const DUPLICATES_DEPRECATED = Object.freeze([
  { duplicate: 'create-solana-game', status: 'deprecated', kept: 'preset', reason: 'duplicate of preset official scaffold; preset best free official' },
  { duplicate: 'aureus', status: 'deprecated', kept: 'ritarena', reason: 'duplicate of RitArena; RitArena best free lifecycle retry events' },
  { duplicate: 'solshield', status: 'deprecated', kept: 'solguard', reason: 'duplicate of SolGuard; SolGuard best free AI audit 130+, more established' },
]);

/** Ideal free per category (итоговая дедупликация, not competitive внутри категории). */
export const IDEAL_FREE_PER_CATEGORY = Object.freeze({
  identity: ['identity-layer (Privy Phantom FirstStep Altude)', 'session-keys-layer (0.01 SOL, deny withdraw_treasury)'],
  assets: ['assets-layer (cNFT $110/M)', 'core-attributes (on-chain key-value)', 'xandeum (exabyte)'],
  indexer: ['indexer-layer (LaserStream gRPC 24h replay + Shyft gPA 15ms + PG TimescaleDB Redis)'],
  l2: ['sonic-hypergrid', 'magicblock-er (sub-10ms gasless, Magic Actions)', 'repla (L3)', 'arcium (confidential privacy)', 'pst (private)', 'xandeum (exabyte)'],
  analytics: ['helika (in analytics-layer)', 'gamesight (in analytics-layer)', 'game-signals-ml (60M+ tx, churn >85%)'],
  marketplace: ['magic-eden (120 QPM, deprecated for new cNFT)', 'shyft escrow-less', 'gameshift (USD 170+)', 'tensor (cNFT primary)', 'gamba', 'husks', 'ritarena', 'race-sdk', 'access-protocol', 'idosgames-wallet'],
  engines: ['engines-layer (Unity Godot Unreal Turbo Web)', 'godot-solana-sdk (detailed)', 'gamba', 'preset (official)', 'ritarena', 'relayzero', 'stealthsdk', 'xandeum', 'pst', 'core-attributes', 'access-protocol', 'idosgames-wallet', 'security-auditing-skill', 'sentio-cli', 'solguard', 'solana-slam', 'arcium — 13 SDKs ideal free deduplicated'],
  infra: ['arc-framework', 'bolt-focg', 'depin-workers', 'arcium', 'xandeum', 'pst', 'core-attributes — 7 frameworks ideal free infra storage privacy'],
  security: ['security-auditing-skill', 'sentio-cli (static AST)', 'solguard (AI 130+) — full coverage not competitive'],
  testing: ['solana-slam', 'preset (official)'],
  storage: ['xandeum (exabyte)', 'pst (private verifiable)', 'core-attributes (on-chain key-value) — full coverage not competitive'],
  privacy: ['pst (private)', 'arcium (confidential) — full coverage'],
  monetization: ['access-protocol (stake-to-access)', 'idosgames-wallet (RewardPool)', 'gameshift (USD)', 'gamba'],
  aiAgents: ['husks (INT8 autobattler)', 'ritarena (lifecycle retry events)', 'relayzero (agent economy)', 'stealthsdk (framework token STEALTH) — full coverage'],
  crossChain: ['race-sdk (multichain)', 'idosgames-wallet (bridge RewardPool) — ideal free cross-chain bridge full coverage'],
});

/** Плановые on-chain события v3 (planned, ещё не на цепочке; dataQuality=partial). */
export const PLANNED_EVENTS_V3 = Object.freeze([
  { event: 'ComponentAdded', source: 'arc-framework' },
  { event: 'PlotPlanted', source: 'bolt-focg' },
  { event: 'WorkerStaked', source: 'depin-workers' },
  { event: 'WagerCreated', source: 'gamba' },
  { event: 'FighterSummoned', source: 'husks' },
  { event: 'BotCreated', source: 'ritarena' },
  { event: 'BotCompeted', source: 'ritarena' },
  { event: 'ArenaFinished', source: 'ritarena' },
  { event: 'CrossChainLinked', source: 'race-sdk' },
  { event: 'ConfidentialSettled', source: 'arcium' },
  { event: 'RollupCommitted', source: 'magicblock-er' },
  { event: 'AutoHarvestTriggered', source: 'magicblock-er (Magic Actions cron)' },
].map(e => Object.freeze({ ...e, status: 'planned' })));

const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const ITEM_TYPES = ['common', 'rare', 'legendary'];

/** /api/assets/strategy: common+common → cNFT; иначе rare/legendary → Standard NFT. */
export function assetStrategy(itemType = 'common', rarity = 'common') {
  if (!ITEM_TYPES.includes(itemType) || !RARITIES.includes(rarity)) {
    return { error: 'INVALID_ASSET_QUERY', allowed: { itemType: ITEM_TYPES, rarity: RARITIES } };
  }
  const common = itemType === 'common' && rarity === 'common';
  return {
    itemType, rarity,
    selected: common ? 'cnft' : 'standard-nft',
    strategy: common
      ? {
        standard: 'Metaplex Bubblegum v2 (cNFT)', merkleTree: true, mcc: true,
        costPer1MMintsUsd: 110, useCase: 'mass potato harvest commons',
        marketplace: { primary: 'tensor', magicEden: 'deprecated for new cNFT' },
      }
      : {
        standard: 'Metaplex Token Metadata (Standard NFT)',
        useCase: `single-mint ${rarity} items`,
        marketplace: { primary: 'tensor', secondary: 'magic-eden (MCC+MT supported)' },
      },
    alwaysOn: {
      onChainStats: 'core-attributes (level/wins/harvests, DAS 5ms)',
      storage: 'xandeum (exabyte)',
      privacy: 'pst + arcium (confidential transfers, optional)',
    },
  };
}

const TPS_BANDS = ['low', 'high'];
const UX_MODES = ['gasless', 'reads', 'declarative', 'l3'];

/**
 * /api/l2/router?gameId=ares1&tps&ux — l2Router(gameId, tps, ux) decision tree.
 * tps=high(+isolation) → sonic-hypergrid; ux: reads→sorada, declarative→rush-ecs,
 * l3→repla, gasless→magicblock-er. Companions всегда: Arcium + PST + Xandeum
 * (ideal free L2 privacy storage bundle).
 */
export function l2Router(tps = 'low', ux = 'gasless') {
  if (!TPS_BANDS.includes(tps) || !UX_MODES.includes(ux)) {
    return { error: 'INVALID_L2_QUERY', allowed: { tps: TPS_BANDS, ux: UX_MODES } };
  }
  const primary = tps === 'high'
    ? 'sonic-hypergrid'
    : ({ gasless: 'magicblock-er', reads: 'sorada', declarative: 'rush-ecs', l3: 'repla', })[ux];
  return {
    tps, ux, primary,
    companions: ['arcium', 'pst', 'xandeum'],
    rationale: {
      'sonic-hypergrid': 'tps>100 && isolation needed',
      'sorada': 'need 5ms reads (30-40x)',
      'rush-ecs': 'declarative world config',
      repla: 'L3 CLI + Anchor settle (repla-cli)',
      'magicblock-er': 'gasless auto triggers: delegate→executeGasless<10ms→commit_state + Magic Actions cron 5min (auto PvP, auto tournament, auto harvest)',
      arcium: 'confidential payments / private state transitions (createRollup)',
      pst: 'private verifiable commitments on-chain + encrypted off-chain',
      xandeum: 'exabyte scalable storage layer',
    },
    tree: L2_ROUTER,
  };
}

const MARKET_ASSET_TYPES = ['cnft', 'standard', 'usd'];

/** /api/marketplace/router?gameId=ares1&assetType — marketplaceAggregator(gameId, assetType). */
export function marketplaceRouter(assetType = 'cnft') {
  if (!MARKET_ASSET_TYPES.includes(assetType)) {
    return { error: 'INVALID_MARKETPLACE_QUERY', allowed: { assetType: MARKET_ASSET_TYPES } };
  }
  const base = {
    assetType,
    monetization: ['access-protocol (stake-to-access)', 'idosgames-wallet (EVM↔Solana RewardPool bridge)'],
    escrows: ['shyft escrow-less in-app (stats API one call)'],
  };
  if (assetType === 'cnft') {
    return { ...base, primary: 'tensor', routes: ['tensor', 'access-protocol', 'idosgames-wallet'], magicEden: 'deprecated for new cNFT' };
  }
  if (assetType === 'standard') {
    return { ...base, primary: 'tensor', secondary: 'magic-eden (120 QPM Bearer, MCC+MT)', routes: ['tensor', 'magic-eden', 'access-protocol', 'idosgames-wallet'] };
  }
  return { ...base, primary: 'gameshift', routes: ['gameshift (USD, 170+ стран, 100% chargeback, gas abstraction)'] };
}

/** Индексы и помощники. */
export const COMPONENTS_BY_ID = new Map(COMPONENTS.map(c => [c.id, c]));
export const TRACKS = Object.freeze({
  v1: COMPONENTS.filter(c => c.track === 'v1').length,
  v2: COMPONENTS.filter(c => c.track === 'v2').length,
  v3: COMPONENTS.filter(c => c.track === 'v3').length,
});

export function componentOrError(id) {
  return COMPONENTS_BY_ID.get(id) ?? { error: 'UNKNOWN_COMPONENT', id };
}

/**
 * Роут-карта OS API (GET, read-only). Используется сервером, тестами и docs.
 * Вид: { 'METHOD /path': { component?, params?, note } }.
 */
export const API_ROUTES = Object.freeze({
  'GET /api/os/config': { note: 'v3 33 components ideal free stack duplicates deprecated' },
  'GET /api/os/health': { note: '19 layers control panels' },
  'GET /api/sdk/godot-solana': { component: 'godot-solana-sdk' },
  'GET /api/sdk/gamba': { component: 'gamba' },
  'GET /api/sdk/preset': { component: 'preset', params: ['template'] },
  'GET /api/sdk/ritarena': { component: 'ritarena', note: 'best free arena chosen over Aureus' },
  'GET /api/sdk/relayzero': { component: 'relayzero' },
  'GET /api/sdk/stealthsdk': { component: 'stealthsdk' },
  'GET /api/sdk/xandeum': { component: 'xandeum', note: 'best free scalable exabyte' },
  'GET /api/sdk/pst': { component: 'pst', note: 'best free private verifiable' },
  'GET /api/sdk/core-attributes': { component: 'core-attributes', note: 'best free on-chain key-value' },
  'GET /api/sdk/access-protocol': { component: 'access-protocol', note: 'best free stake-to-access' },
  'GET /api/sdk/idosgames-wallet': { component: 'idosgames-wallet', note: 'best free bridge RewardPool' },
  'GET /api/sdk/security-auditing-skill': { component: 'security-auditing-skill', note: 'best free security skill' },
  'GET /api/sdk/sentio-cli': { component: 'sentio-cli', note: 'best free static AST scanner' },
  'GET /api/sdk/solguard': { component: 'solguard', note: 'best free AI audit 130+ chosen over SolShield' },
  'GET /api/sdk/solana-slam': { component: 'solana-slam', note: 'best free testing LiteSVM' },
  'GET /api/sdk/arcium': { component: 'arcium', note: 'best free privacy rollup' },
  'GET /api/infra/arc': { component: 'arc-framework' },
  'GET /api/infra/bolt': { component: 'bolt-focg' },
  'GET /api/infra/depin': { component: 'depin-workers' },
  'GET /api/infra/arcium': { component: 'arcium' },
  'GET /api/infra/xandeum': { component: 'xandeum' },
  'GET /api/infra/pst': { component: 'pst' },
  'GET /api/infra/core-attributes': { component: 'core-attributes' },
  'GET /api/game-signals/config': { component: 'game-signals-ml' },
  'GET /api/payments/rust-api': { component: 'rust-actix-api' },
  'GET /api/ai/husks': { component: 'husks' },
  'GET /api/ai/ritarena': { component: 'ritarena' },
  'GET /api/ai/relayzero': { component: 'relayzero' },
  'GET /api/ai/stealthsdk': { component: 'stealthsdk' },
  'GET /api/cross-chain/race': { component: 'race-sdk' },
  'GET /api/security/auditing-skill': { component: 'security-auditing-skill' },
  'GET /api/security/sentio-cli': { component: 'sentio-cli' },
  'GET /api/security/solguard': { component: 'solguard' },
  'GET /api/storage/xandeum': { component: 'xandeum' },
  'GET /api/storage/pst': { component: 'pst' },
  'GET /api/storage/core-attributes': { component: 'core-attributes' },
  'GET /api/monetization/access-protocol': { component: 'access-protocol' },
  'GET /api/monetization/idosgames-wallet': { component: 'idosgames-wallet' },
  'GET /api/testing/solana-slam': { component: 'solana-slam' },
  'GET /api/privacy/arcium': { component: 'arcium' },
  'GET /api/assets/strategy': { params: ['itemType', 'rarity'], note: 'cNFT $110/M + Core Attributes + Xandeum' },
  'GET /api/l2/router': { params: ['tps', 'ux'], note: 'l2Router decision tree → e.g. MagicBlock ER + Arcium + PST + Xandeum' },
  'GET /api/marketplace/router': { params: ['assetType'], note: 'marketplaceAggregator → e.g. Tensor + Access + idosgames' },
});

/** Тенанты OS (check: /api/os/config → .tenants содержит ares1). */
export const TENANTS = Object.freeze([
  Object.freeze({ tenant: 'ares1', gameId: 'ares1', genre: 'strategy farming', stack: 'watchtower-os v3' }),
]);

export const OS_CONFIG = Object.freeze({
  version: 'v3.0.0',
  game: GAME,
  tenants: TENANTS,
  programs: PROGRAMS,
  verifiedDeployment: VERIFIED_DEPLOYMENT,
  counts: Object.freeze({
    total: COMPONENTS.length, // 33
    byTrack: TRACKS, // v1 8, v2 12, v3 13
    deprecatedRecords: COMPONENTS.filter(c => c.status === 'deprecated').length,
    duplicatesResolved: DUPLICATES_DEPRECATED.length, // 3
  }),
  components: COMPONENTS,
  duplicatesDeprecated: DUPLICATES_DEPRECATED,
  idealFreePerCategory: IDEAL_FREE_PER_CATEGORY,
  l2Router: L2_ROUTER,
  analyticsFunnel: ANALYTICS_FUNNEL,
  plannedEventsV3: PLANNED_EVENTS_V3,
  prohibitions: PROHIBITIONS,
  api: Object.freeze({ routes: Object.keys(API_ROUTES) }),
});
