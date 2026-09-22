# Watchtower OS v3 — архитектура, API, ideal free stack

Статус: **prototype, dataQuality=partial, blockchainWritesEnabled=false**. Watchtower OS —
декларативный реестр идеального бесплатного стека ARES-1 (33 компонента, deduplicated),
19 control panels и read-only HTTP API поверх `node:http` без зависимостей. Он не клиент
в Solana, не хранит секретов и не заменяет observed-indexer: существующий exporter
(`src/*`, `WATCHTOWER_*`) остаётся единственным источником on-chain observed данных.

## Файлы

| Файл | Назначение |
| --- | --- |
| `src/os/stack-v3.js` | Single source of truth: 33 компонента (v1 8 layers + v2 12 products + v3 13 best free), duplicates deprecated 3, L2 router, prohibitions, API_ROUTES |
| `src/os/control-panels-v3.js` | 19 control panels (операционные слои /api/os/health), валидация ссылок на реестр |
| `src/os/handoff-v3.js` | Генератор `WATCHTOWER_INTEGRATION.md` + Final report 20 пунктов (v1 7 + v2 7 + v3 6), CLI `--write/--check` |
| `src/os/server.js` | Read-only server: 45 GET routes, строгий query-parse, optional Bearer (WATCHTOWER_OS_TOKEN >=32) |
| `tests/os/watchtower-os-v3.test.mjs` | node:test: состав стека, guard-проверки, весь HTTP contract, token mode |

## On-chain vs off-chain

| Область | On-chain (programs) | Off-chain (services) |
| --- | --- | --- |
| Identity | studio_profile PDA (CgInv111…) | Privy/Phantom/FirstStep/Altude guestsession flow |
| Sessions | SessKeys111… createSession/topUp 0.01 SOL, deny withdraw_treasury | JWT Web3, expiry 60min, risk cap monitoring |
| Assets | Bubblegum v2 cNFT ($110/1M), Standard NFT rare/legendary, Core Attributes plugin | DAS getAssetsByOwner 5ms, Xandeum exabyte payloads |
| World | Bolt FOCG world (Position/Crop/Player), ARC Entity potato plot | REPLA L3 sequenced settle, DePIN workers (matchmaking/leaderboard/push) |
| Execution | delegateToER → executeGasless <10ms → commit_state (MagicBlock ER) | Magic Actions cron 5min auto harvest, Sorada 5ms reads, Rush ECS config |
| Privacy | PST commitments on-chain, Arcium confidential rollup state | PST encrypted payload off-chain |
| Economy | Gamba wager NFT (provably fair, 5%), Access stake-to-access, idosgames RewardPool SPL | Marketplace aggregation (ME/Shyft/GameShift/Tensor), GameShift USD checkout |
| Analytics | on-chain wallet events (mint/buy/sell) | Helika + GameSight Late ID Binding + Game Signals ML churn 14d >85% |
| Indexer | observed events только read | LaserStream gRPC + Shyft gPA + PG/TimescaleDB/Redis (exporter) |

Правило: signer authority, treasury и выплаты — всегда on-chain c RBAC/2FA/multisig/
timelock/audit log/rollback; индексация, аналитика, ML и оркестрация — off-chain, pseudonymous
playerKey, consent/opt-out.

## Indexer v3 (план поверх observed exporter)

Подписки: CgInv111…, SessKeys111…, STrEaSuRy111…, ARES1_CORE_PROGRAM_ID + ARC ComponentAdded,
Bolt PlotPlanted, DePIN WorkerStaked, Gamba WagerCreated, Husks FighterSummoned,
RitArena BotCreated/BotCompeted/ArenaFinished, RACE CrossChainLinked, Arcium ConfidentialSettled,
MagicBlock RollupCommitted/AutoHarvestTriggered — все planned (ещё не на цепочке).

Canonical event identity: `cluster + slot + signature + instructionIndex + innerIndex`
(как у observed exporter). Shyft REST callbacks TOKEN_MINT/NFT_MINT → `POST /api/webhooks/shyft/ares1`
(объявлен, у exporter не реализован). PG: idempotency/dedup/cursor/replay/backfill/gap/
finalized reconciliation/parser versioning/tenant_id RLS/cross-game materialized view.

## Analytics funnel (Late ID Binding)

`ad_click (gamesight_click_id)` → `PlayerJoined external_id=click_id` → `WalletConnected
solana_wallet` → on-chain events `wallet_id` (mint/buy/sell) → attribution ad→wallet→mint.
Ingest: `POST /api/ingest/solana`. ML: `POST /api/campaigns/proposals` при churn_risk>0.7
(RandomForest, 60M+ tx, 12 games, common wallets, pseudonymous). SEO/GEO: Blinks, short
videos, whale radar, TipLink vs payer LTV. Session telemetry: match_start/match_end.

## L2 Router decision tree

1. tps>100 && isolation → **Sonic HyperGrid**
2. нужны 5ms reads → **Sorada** (30-40x)
3. declarative world config → **Rush ECS**
4. L3 CLI + Anchor settle → **REPLA** (repla-cli)
5. gasless auto triggers (auto PvP, auto tournament, auto harvest) → **MagicBlock ER** + Magic Actions cron 5 min
6. confidential payments / private transitions → **Arcium** (complementary ER/HyperGrid/REPLA)

## Security pipeline (full coverage, not competitive)

1. **Security Auditing Skill** — systematic prompt audit: signer/owner/PDA/CPI/reentrancy/overflow/access control/close account/init checks.
2. **Sentio CLI** — static AST scanner по Rust в CI на common vulns.
3. **SolGuard** — AI audit 130+ patterns (signer checks, rights bypass, flash-loan, PDA validation, CPI injection, reentrancy, overflow, account confusions). Chosen over SolShield (duplicate).
4. Runtime: RBAC, 2FA, multisig, timelock, audit log, rollback. Write-capability guard: `WATCHTOWER_ENABLE_WRITES` допускает только `false`.

## Testing

- **Solana SLAM** (LiteSVM/Anchor/Mocha): `slam test --program` — unit + in-VM integration.
- **Preset official**: `npx create-solana-game ares1 --preset farming` (templates: farming/racing/casual/strategy/autobattler/arena).
- Smoke-массив: anchor test, npm test, Unity play mode, GdUnit4 (Godot), high-TPS gasless state commitment, Magic Actions cron run, churn >85% validation, cross-game funnel dry-run, marketplace listing USD.

## API (GET, read-only)

См. `/api/os/config` → `data.api.routes` и таблицу маршрутов в WATCHTOWER_INTEGRATION.md.
Envelope ответа: `osVersion, gameId, network, stage, dataQuality, blockchainWritesEnabled, data`.
Query: `gameId=ares1` (иное → 400 `UNKNOWN_GAME`); дупликаты/неизвестные параметры → 400.
POST → 405 (`READ_ONLY`). При заданном `WATCHTOWER_OS_TOKEN` (>=32) требуется `Authorization: Bearer`.

## Запуск

```sh
cd watchtower
npm run test:os            # 11+ node:test проверок, без сети/БД
npm run os:handoff:check   # docs drift guard (WATCHTOWER_INTEGRATION.md, FINAL_REPORT)
npm run os                 # 0.0.0.0:8791 (WATCHTOWER_OS_PORT), optional WATCHTOWER_OS_TOKEN
```

Env (только имена): `WATCHTOWER_OS_PORT`, `WATCHTOWER_OS_TOKEN`. Private keys и значения
program ids из ARES1_*_PROGRAM_ID в репозиторий не коммитятся.
