# ARES-1 — WATCHTOWER INTEGRATION (Watchtower OS v3)

Сгенерировано `watchtower/src/os/handoff-v3.js` (детерминированно; обновление: `npm run os:handoff`, проверка: `npm run os:handoff:check`). Не редактировать вручную.

## Игровая идентичность

| field | value |
| --- | --- |
| game_id | ares1 |
| name | ARES-1 |
| tenant | ares1 |
| genre | strategy |
| network | devnet |
| stage | prototype |
| data_quality | partial |
| blockchain_writes_enabled | false |
| last_verified_at | null (devnet verification не проведена) |
| address_provenance | repository_only_not_network_verified |

## Program IDs (v3 сплит, prototype)

| key | alias / env | role | address | verified |
| --- | --- | --- | --- | --- |
| cgInv | CgInv111111111111111111111111111111111111 (env ARES1_CGINV_PROGRAM_ID) | in-game economy instructions (harvest economy surface, session createSession target) | null — значение не коммитится | false |
| sessKeys | SessKeys111111111111111111111111111111111 (env ARES1_SESSION_KEYS_PROGRAM_ID) | session keys: createSession, topUp 0.01 SOL, scope deny withdraw_treasury | null — значение не коммитится | false |
| treasury | STrEaSuRy11111111111111111111111111111111 (env ARES1_TREASURY_PROGRAM_ID) | treasury program; недоступен для session keys и exporter (deny withdraw_treasury) | null — значение не коммитится | false |
| core | ARES1_CORE_PROGRAM_ID (env ARES1_CORE_PROGRAM_ID) | core program id через env; значение не коммитится (ENV names without values) | null — значение не коммитится | false |

Verified v1/v2 deployment (integration-manifest.json): programId `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf`, network devnet, idl 0.2.0, parser ares1-v1, deploymentVerified=false, lastVerifiedAt=null. единая v1/v2 программа; v3-сплит (CgInv/SessKeys/STrEaSuRy/core) — prototype.

## Идеальный бесплатный стек v3 — 33 компонента (v1 8 layers + v2 12 products + v3 13 best free), deduplicated

| # | track | id | component | category | status | install |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | v1 | identity-layer | Identity: Privy + Phantom + FirstStep + Altude | identity | ideal-free | internal/prompt |
| 2 | v1 | session-keys-layer | Session Keys 0.01 SOL (JWT Web3) | identity | ideal-free | internal/prompt |
| 3 | v1 | assets-layer | Assets: cNFT $110/M + Standard NFT + Core Attributes | assets | ideal-free | internal/prompt |
| 4 | v1 | indexer-layer | Indexer: LaserStream gRPC + Shyft gPA + PG/TimescaleDB/Redis | indexer | ideal-free | internal/prompt |
| 5 | v1 | l2-layer | L2: Sonic HyperGrid + Sorada + Rush + REPLA + MagicBlock ER | l2 | ideal-free | internal/prompt |
| 6 | v1 | analytics-layer | Analytics: Helika + GameSight + Game Signals ML | analytics | ideal-free | internal/prompt |
| 7 | v1 | marketplace-layer | Marketplace: ME + Shyft escrow-less + GameShift + Tensor | marketplace | ideal-free | internal/prompt |
| 8 | v1 | engines-layer | Engines: Unity + Godot + Unreal + Turbo + Web | engines | ideal-free | internal/prompt |
| 9 | v2 | godot-solana-sdk | Godot godot-solana-sdk (GDExtension 4.3+) | engines | ideal-free | Godot Asset Library: godot-solana-sdk |
| 10 | v2 | gamba | Gamba wagering | marketplace+ai | ideal-free | npm i gamba-core-v2 |
| 11 | v2 | preset | Preset — официальный scaffold create-solana-game | testing+scaffold | ideal-free | npx create-solana-game ares1 --preset <template> |
| 12 | v2 | arc-framework | ARC Framework (Entity-Component interoperability) | infra | ideal-free | internal/prompt |
| 13 | v2 | bolt-focg | Bolt FOCG (fully on-chain verifiable farming world) | infra | ideal-free | internal/prompt |
| 14 | v2 | depin-workers | DePIN workers (matchmaking / leaderboard / push) | infra | ideal-free | internal/prompt |
| 15 | v2 | game-signals-ml | Game Signals ML (churn 14d >85%) | analytics | ideal-free | internal/prompt |
| 16 | v2 | rust-actix-api | Rust API (Actix + Swagger) | infra | ideal-free | internal/prompt |
| 17 | v2 | husks | Husks (potato fighters, INT8) | ai | ideal-free | npm i husks-sdk |
| 18 | v2 | aureus | Aureus arena SDK | ai | deprecated → ritarena | internal/prompt |
| 19 | v2 | race-sdk | RACE multichain SDK | cross-chain | ideal-free | npm i race-sdk (sdk-solana), race-cli |
| 20 | v2 | claude-skill | Claude Skill (Solana gamedev patterns) | engines+scaffold | ideal-free | internal/prompt |
| 21 | v3 | security-auditing-skill | Security Auditing Skill | security | ideal-free | internal/prompt |
| 22 | v3 | sentio-cli | Sentio CLI (static AST scanner) | security | ideal-free | sentio CLI |
| 23 | v3 | solguard | SolGuard AI audit (130+ patterns) | security | ideal-free | solguard CLI/AI |
| 24 | v3 | xandeum | Xandeum scalable storage layer | storage | ideal-free | npm i @xandeum/sdk |
| 25 | v3 | pst | PST — Private State Toolkit | storage+privacy | ideal-free | npm i @private-state-toolkit/sdk |
| 26 | v3 | core-attributes | Metaplex Core Attributes Plugin | assets+storage | ideal-free | npm i @metaplex-foundation/mpl-core |
| 27 | v3 | access-protocol | Access Protocol (stake-to-access) | monetization | ideal-free | npm i @access-protocol/sdk |
| 28 | v3 | idosgames-wallet | @idosgames/wallet bridge (EVM↔Solana RewardPool) | monetization+cross-chain | ideal-free | npm i @idosgames/wallet |
| 29 | v3 | ritarena | RitArena SDK (autonomous bot arena) | ai | ideal-free | npm i ritarena-sdk |
| 30 | v3 | relayzero | relayzero agent economy network | ai | ideal-free | npm i relayzero-sdk |
| 31 | v3 | stealthsdk | StealthSDK (AI-games framework, token STEALTH) | ai | ideal-free | npm i stealthsdk |
| 32 | v3 | solana-slam | Solana SLAM (LiteSVM + Anchor + Mocha) | testing | ideal-free | npm i solana-slam |
| 33 | v3 | arcium | Arcium confidential computing rollups | privacy+l2 | ideal-free | npm i @arcium/sdk |

## Duplicates deprecated (3)

| duplicate | kept (best free) | reason |
| --- | --- | --- |
| create-solana-game | preset | duplicate of preset official scaffold; preset best free official |
| aureus | ritarena | duplicate of RitArena; RitArena best free lifecycle retry events |
| solshield | solguard | duplicate of SolGuard; SolGuard best free AI audit 130+, more established |

## Ideal free per category

- **identity**: identity-layer (Privy Phantom FirstStep Altude); session-keys-layer (0.01 SOL, deny withdraw_treasury)
- **assets**: assets-layer (cNFT $110/M); core-attributes (on-chain key-value); xandeum (exabyte)
- **indexer**: indexer-layer (LaserStream gRPC 24h replay + Shyft gPA 15ms + PG TimescaleDB Redis)
- **l2**: sonic-hypergrid; magicblock-er (sub-10ms gasless, Magic Actions); repla (L3); arcium (confidential privacy); pst (private); xandeum (exabyte)
- **analytics**: helika (in analytics-layer); gamesight (in analytics-layer); game-signals-ml (60M+ tx, churn >85%)
- **marketplace**: magic-eden (120 QPM, deprecated for new cNFT); shyft escrow-less; gameshift (USD 170+); tensor (cNFT primary); gamba; husks; ritarena; race-sdk; access-protocol; idosgames-wallet
- **engines**: engines-layer (Unity Godot Unreal Turbo Web); godot-solana-sdk (detailed); gamba; preset (official); ritarena; relayzero; stealthsdk; xandeum; pst; core-attributes; access-protocol; idosgames-wallet; security-auditing-skill; sentio-cli; solguard; solana-slam; arcium — 13 SDKs ideal free deduplicated
- **infra**: arc-framework; bolt-focg; depin-workers; arcium; xandeum; pst; core-attributes — 7 frameworks ideal free infra storage privacy
- **security**: security-auditing-skill; sentio-cli (static AST); solguard (AI 130+) — full coverage not competitive
- **testing**: solana-slam; preset (official)
- **storage**: xandeum (exabyte); pst (private verifiable); core-attributes (on-chain key-value) — full coverage not competitive
- **privacy**: pst (private); arcium (confidential) — full coverage
- **monetization**: access-protocol (stake-to-access); idosgames-wallet (RewardPool); gameshift (USD); gamba
- **aiAgents**: husks (INT8 autobattler); ritarena (lifecycle retry events); relayzero (agent economy); stealthsdk (framework token STEALTH) — full coverage
- **crossChain**: race-sdk (multichain); idosgames-wallet (bridge RewardPool) — ideal free cross-chain bridge full coverage

## L2 Router decision tree

1. **tps > 100 && isolation needed** → sonic-hypergrid
2. **need 5ms reads** → sorada
3. **declarative world config** → rush-ecs
4. **L3 CLI + Anchor settle** → repla
5. **gasless auto triggers (auto PvP, auto tournament, auto harvest)** → magicblock-er (delegate → executeGasless → commit_state; Magic Actions cron 5 min)
6. **confidential payments / private state transitions** → arcium

## Плановые on-chain события v3 (status=planned; не являются подтверждённым deployment)

| event | source component |
| --- | --- |
| ComponentAdded | arc-framework |
| PlotPlanted | bolt-focg |
| WorkerStaked | depin-workers |
| WagerCreated | gamba |
| FighterSummoned | husks |
| BotCreated | ritarena |
| BotCompeted | ritarena |
| ArenaFinished | ritarena |
| CrossChainLinked | race-sdk |
| ConfidentialSettled | arcium |
| RollupCommitted | magicblock-er |
| AutoHarvestTriggered | magicblock-er (Magic Actions cron) |

## API (GET, read-only; dataQuality=partial)

| route | component / note |
| --- | --- |
| GET /api/os/config | v3 33 components ideal free stack duplicates deprecated |
| GET /api/os/health | 19 layers control panels |
| GET /api/sdk/godot-solana | godot-solana-sdk |
| GET /api/sdk/gamba | gamba |
| GET /api/sdk/preset | preset |
| GET /api/sdk/ritarena | ritarena |
| GET /api/sdk/relayzero | relayzero |
| GET /api/sdk/stealthsdk | stealthsdk |
| GET /api/sdk/xandeum | xandeum |
| GET /api/sdk/pst | pst |
| GET /api/sdk/core-attributes | core-attributes |
| GET /api/sdk/access-protocol | access-protocol |
| GET /api/sdk/idosgames-wallet | idosgames-wallet |
| GET /api/sdk/security-auditing-skill | security-auditing-skill |
| GET /api/sdk/sentio-cli | sentio-cli |
| GET /api/sdk/solguard | solguard |
| GET /api/sdk/solana-slam | solana-slam |
| GET /api/sdk/arcium | arcium |
| GET /api/infra/arc | arc-framework |
| GET /api/infra/bolt | bolt-focg |
| GET /api/infra/depin | depin-workers |
| GET /api/infra/arcium | arcium |
| GET /api/infra/xandeum | xandeum |
| GET /api/infra/pst | pst |
| GET /api/infra/core-attributes | core-attributes |
| GET /api/game-signals/config | game-signals-ml |
| GET /api/payments/rust-api | rust-actix-api |
| GET /api/ai/husks | husks |
| GET /api/ai/ritarena | ritarena |
| GET /api/ai/relayzero | relayzero |
| GET /api/ai/stealthsdk | stealthsdk |
| GET /api/cross-chain/race | race-sdk |
| GET /api/security/auditing-skill | security-auditing-skill |
| GET /api/security/sentio-cli | sentio-cli |
| GET /api/security/solguard | solguard |
| GET /api/storage/xandeum | xandeum |
| GET /api/storage/pst | pst |
| GET /api/storage/core-attributes | core-attributes |
| GET /api/monetization/access-protocol | access-protocol |
| GET /api/monetization/idosgames-wallet | idosgames-wallet |
| GET /api/testing/solana-slam | solana-slam |
| GET /api/privacy/arcium | arcium |
| GET /api/assets/strategy | cNFT $110/M + Core Attributes + Xandeum |

Notes: игровые POST-эндпоинты интеграций (`POST /api/ingest/solana`, `POST /api/campaigns/proposals`, `POST /api/webhooks/shyft/ares1`) объявлены в конфигурациях компонентов, но НЕ реализованы read-only Watchtower OS.

## Запреты и контроли

- no private keys; read-only; blockchain_writes_enabled=0 (WATCHTOWER_ENABLE_WRITES допускает только false).
- Pseudonymous playerKey; consent/opt-out.
- Session keys: только topUp, риск 0.01 SOL, expiry 60min; scope denied withdraw_treasury.
- Godot SDK: no audit, mainnet caution. Helika: AI focus с backup. ME deprecated for new cNFT; Tensor primary for cNFT.
- Контроли: RBAC, 2FA, multisig, timelock, audit_log, rollback.
- ENV names without values (в .env.example / config.example.env — только имена).

## Граница данных

Этот документ и OS API — декларативный реестр стека (stage=prototype, data_quality=partial): конфигурации компонентов без live-вызовов, секретов и замеров. Наблюдаемые on-chain данные ARES-1 экспортирует отдельный read-only exporter (см. watchtower/README.md): 30 реальных событий, canonical UNIQUE (cluster, slot, signature, instruction_index, inner_index), finalized-only, replay/resume/gap. События v3 выше — planned и не смешиваются с observed.
