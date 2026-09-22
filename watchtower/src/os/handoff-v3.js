// Watchtower OS v3 — handoff: WATCHTOWER_INTEGRATION.md + Final report (20 пунктов).
// Генерация детерминированная (без таймстемпов), режимы:
//   node src/os/handoff-v3.js --write   # записать артефакты в корень репо
//   node src/os/handoff-v3.js --check   # убедиться, что закоммиченные файлы совпадают

import { readFileSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  API_ROUTES, COMPONENTS, DUPLICATES_DEPRECATED, GAME, IDEAL_FREE_PER_CATEGORY,
  L2_ROUTER, OS_CONFIG, PLANNED_EVENTS_V3, PROGRAMS, PROHIBITIONS, VERIFIED_DEPLOYMENT,
} from './stack-v3.js';
import { PANELS_V3, validatePanelReferences } from './control-panels-v3.js';

/** Final report: 20 пунктов = v1 7 + v2 7 + v3 6 ideal-free steps. */
export const REPORT_STEPS_V3 = Object.freeze({
  v1: Object.freeze([
    'Identity v1: unified guest→embedded→native→linked (Privy/Phantom/FirstStep/Altude) + cross-game PDA studio_profile (CgInv111…), pseudonymous playerKey, consent/opt-out.',
    'Session keys v1: createSession(CgInv111…), topUp 0.01 SOL, expiry 60min, scope denied withdraw_treasury; жёсткий риск-кап 0.01 SOL.',
    'Assets v1: cNFT Bubblegum v2 (MCC, $110/1M mints) для common harvest + Standard NFT для rare/legendary + Core Attributes on-chain key-value.',
    'Indexer v1: LaserStream gRPC 24h replay + Shyft gPA 15ms + POST /api/webhooks/shyft/ares1 + PG/TimescaleDB/Redis, canonical identity (cluster+slot+signature+instructionIndex+innerIndex), finalized-only read-only.',
    'L2 v1: Sonic HyperGrid + Sorada 5ms + Rush ECS + REPLA L3 + MagicBlock ER sub-10ms gasless + Magic Actions cron; Router decision tree l2Router(gameId, tps, ux).',
    'Analytics v1: Helika cross-game dashboard + GameSight Late ID Binding (solana_wallet как external_id, funnel ad_click→wallet→mint), POST /api/ingest/solana.',
    'Marketplace v1: Magic Eden 120 QPM Bearer (MCC+MT) + Shyft escrow-less in-app + GameShift USD 170+ + Tensor cNFT primary + marketplaceAggregator(gameId, assetType).',
  ]),
  v2: Object.freeze([
    'Godot detailed v2: GDExtension 4.3+ SolanaClient/WalletAdapter/AnchorProgram + Candy Machine/SPL builders + session-keys analog (temporary keypair 0.01 SOL); no audit, mainnet caution.',
    'Wagering v2: Gamba provably fair house edge 5% jackpot (potato harvest gamble + NFT wager) + Preset official scaffold (npx create-solana-game ares1 --preset farming; duplicate create-solana-game resolved).',
    'Infra v2: ARC Entity potato plot (Position/GrowthStage/Owner/Item source_game=ares1 is_cnft asset_id) + Bolt FOCG verifiable world (bolt init/build/deploy world create, delegateToER executeGasless <10ms, Magic Actions cron 5min auto harvest).',
    'DePIN v2: workers matchmaking/leaderboard/push со stake 10 SOL, escrow 0.1 SOL per 100 players, reward/slash.',
    'AI fighters v2: Husks INT8 procedural pixel fighters — summon NFT fighters, train via harvesting/battles, auto PvP, market dominance (cNFT).',
    'Multichain v2: RACE sdk-solana + race-cli bundles publish Solana/EVM, fairness verifiable, devnet cNFT→Tensor / EVM NFT→OpenSea.',
    'ML v2: Game Signals RandomForest 60M+ tx 12 games churn 14d >85% + funnel/LTV/whale radar + Rust Actix Swagger (create/join/calculate harvest/withdraw) + Claude Skill patterns.',
  ]),
  v3: Object.freeze([
    'Security v3: Security Auditing Skill (signer/owner/PDA/CPI/reentrancy/overflow/access control/close account/init) + Sentio CLI static AST в CI + SolGuard AI 130+ patterns (duplicate SolShield→SolGuard); RBAC/2FA/multisig/timelock/audit log/rollback.',
    'Storage+privacy v3: Xandeum exabyte (better than Arweave) + PST private verifiable commitments + Core Attributes on-chain key-value + Arcium confidential rollups (confidentialPayment private=true, createRollup).',
    'AI agents v3: RitArena lifecycle createArena/addBot/compete + retry + BotCompeted/ArenaFinished (duplicate Aureus→RitArena) + relayzero integrateAgent + StealthSDK framework token STEALTH — full coverage.',
    'Monetization+cross-chain v3: Access Protocol stake-to-access + idosgames bridge EVM↔Solana RewardPool (SPL deposits/withdrawals, complementary to RACE).',
    'Testing v3: Solana SLAM LiteSVM/Anchor/Mocha (slam test --program) + Preset official; write-capability guard и read-only smoke (WATCHTOWER_ENABLE_WRITES только false).',
    'Watchtower OS v3: 19 control panels, /api/os + sdk/infra/ai/security/storage/monetization/testing/privacy routes (GET, read-only), WATCHTOWER_INTEGRATION.md handoff, duplicates deprecated 3.',
  ]),
});

function table(headers, rows) {
  const esc = s => String(s).replaceAll('|', '\\|');
  return [
    `| ${headers.map(esc).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(r => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n');
}

/** WATCHTOWER_INTEGRATION.md (детерминированный, без таймстемпов). */
export function integrationMarkdown() {
  const c = OS_CONFIG;
  return `# ARES-1 — WATCHTOWER INTEGRATION (Watchtower OS v3)

Сгенерировано \`watchtower/src/os/handoff-v3.js\` (детерминированно; обновление: \`npm run os:handoff\`, проверка: \`npm run os:handoff:check\`). Не редактировать вручную.

## Игровая идентичность

${table(['field', 'value'], [
  ['game_id', GAME.gameId],
  ['name', GAME.name],
  ['tenant', GAME.tenant],
  ['genre', GAME.genre],
  ['network', GAME.network],
  ['stage', GAME.stage],
  ['data_quality', GAME.dataQuality],
  ['blockchain_writes_enabled', String(GAME.blockchainWritesEnabled)],
  ['last_verified_at', 'null (devnet verification не проведена)'],
  ['address_provenance', GAME.addressProvenance],
])}

## Program IDs (v3 сплит, prototype)

${table(['key', 'alias / env', 'role', 'address', 'verified'], PROGRAMS.map(p => [
  p.key, `${p.alias} (env ${p.env})`, p.role, p.address ?? 'null — значение не коммитится', String(p.verified),
]))}

Verified v1/v2 deployment (integration-manifest.json): programId \`${VERIFIED_DEPLOYMENT.programId}\`, network ${VERIFIED_DEPLOYMENT.network}, idl ${VERIFIED_DEPLOYMENT.idlVersion}, parser ${VERIFIED_DEPLOYMENT.parserVersion}, deploymentVerified=${VERIFIED_DEPLOYMENT.deploymentVerified}, lastVerifiedAt=null. ${VERIFIED_DEPLOYMENT.note}.

## Идеальный бесплатный стек v3 — ${c.counts.total} компонента (v1 ${c.counts.byTrack.v1} layers + v2 ${c.counts.byTrack.v2} products + v3 ${c.counts.byTrack.v3} best free), deduplicated

${table(['#', 'track', 'id', 'component', 'category', 'status', 'install'], COMPONENTS.map((x, i) => [
  i + 1, x.track, x.id, x.name, x.category.join('+'), x.status === 'deprecated' ? `deprecated → ${x.supersededBy}` : 'ideal-free', x.install ?? 'internal/prompt',
]))}

## Duplicates deprecated (${DUPLICATES_DEPRECATED.length})

${table(['duplicate', 'kept (best free)', 'reason'], DUPLICATES_DEPRECATED.map(d => [d.duplicate, d.kept, d.reason]))}

## Ideal free per category

${Object.entries(IDEAL_FREE_PER_CATEGORY).map(([k, v]) => `- **${k}**: ${v.join('; ')}`).join('\n')}

## L2 Router decision tree

${L2_ROUTER.map((r, i) => `${i + 1}. **${r.when}** → ${r.then}`).join('\n')}

## Плановые on-chain события v3 (status=planned; не являются подтверждённым deployment)

${table(['event', 'source component'], PLANNED_EVENTS_V3.map(e => [e.event, e.source]))}

## API (GET, read-only; dataQuality=partial)

${table(['route', 'component / note'], Object.entries(API_ROUTES).map(([route, meta]) => [route, meta.component ?? meta.note]))}

Notes: игровые POST-эндпоинты интеграций (\`POST /api/ingest/solana\`, \`POST /api/campaigns/proposals\`, \`POST /api/webhooks/shyft/ares1\`) объявлены в конфигурациях компонентов, но НЕ реализованы read-only Watchtower OS.

## Запреты и контроли

- no private keys; read-only; blockchain_writes_enabled=0 (WATCHTOWER_ENABLE_WRITES допускает только false).
- Pseudonymous playerKey; consent/opt-out.
- Session keys: только topUp, риск 0.01 SOL, expiry 60min; scope denied withdraw_treasury.
- Godot SDK: no audit, mainnet caution. Helika: AI focus с backup. ME deprecated for new cNFT; Tensor primary for cNFT.
- Контроли: ${PROHIBITIONS.controls.join(', ')}.
- ENV names without values (в .env.example / config.example.env — только имена).

## Граница данных

Этот документ и OS API — декларативный реестр стека (stage=prototype, data_quality=partial): конфигурации компонентов без live-вызовов, секретов и замеров. Наблюдаемые on-chain данные ARES-1 экспортирует отдельный read-only exporter (см. watchtower/README.md): 30 реальных событий, canonical UNIQUE (cluster, slot, signature, instruction_index, inner_index), finalized-only, replay/resume/gap. События v3 выше — planned и не смешиваются с observed.
`;
}

/** Final report markdown (20 пунктов: v1 7 + v2 7 + v3 6). */
export function reportMarkdown() {
  const steps = [...REPORT_STEPS_V3.v1, ...REPORT_STEPS_V3.v2, ...REPORT_STEPS_V3.v3];
  if (steps.length !== 20) throw new Error('REPORT_STEPS_MUST_BE_20');
  const panelRefs = validatePanelReferences();
  return `# ARES-1 — Watchtower OS v3 Final report (20 пунктов)

Сгенерировано \`watchtower/src/os/handoff-v3.js\`. game_id=${GAME.gameId}, network=${GAME.network}, stage=${GAME.stage}, data_quality=${GAME.dataQuality}, blockchain_writes_enabled=false, last_verified_at=null.

## v1 — 7 layers

${REPORT_STEPS_V3.v1.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## v2 — 7 products/steps

${REPORT_STEPS_V3.v2.map((s, i) => `${REPORT_STEPS_V3.v1.length + i + 1}. ${s}`).join('\n')}

## v3 — 6 best-free ideal steps

${REPORT_STEPS_V3.v3.map((s, i) => `${REPORT_STEPS_V3.v1.length + REPORT_STEPS_V3.v2.length + i + 1}. ${s}`).join('\n')}

## Проверка состава

- Компонентов: ${OS_CONFIG.counts.total} (v1 ${OS_CONFIG.counts.byTrack.v1} + v2 ${OS_CONFIG.counts.byTrack.v2} + v3 ${OS_CONFIG.counts.byTrack.v3}); duplicates deprecated ${OS_CONFIG.counts.duplicatesResolved}: ${DUPLICATES_DEPRECATED.map(d => `${d.duplicate}→${d.kept}`).join(', ')}.
- Control panels: ${PANELS_V3.length} (ссылки на реестр: ${panelRefs.length === 0 ? 'все валидны' : `ОШИБКА ${panelRefs.join(', ')}`}).
- API routes: ${Object.keys(API_ROUTES).length} GET (read-only), все продукты v3 доступны через /api/sdk|infra|ai|security|storage|monetization|testing|privacy.
- Тесты: \`npm run test:os\` (node:test, без сети/БД); docs drift guard: \`npm run os:handoff:check\`.
`;
}

/** Целевые файлы в корне репозитория. */
export function handoffTargets(rootUrl = new URL('../../../', import.meta.url)) {
  return [
    { file: new URL('WATCHTOWER_INTEGRATION.md', rootUrl), content: integrationMarkdown },
    { file: new URL('WATCHTOWER_OS_V3_FINAL_REPORT.md', rootUrl), content: reportMarkdown },
  ];
}

/** CLI: --write (default) или --check. Exit 1 при drift. */
export function handoffCli(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  let ok = true;
  for (const { file, content } of handoffTargets()) {
    const expected = content();
    if (check) {
      let actual = null;
      try { actual = readFileSync(file, 'utf8'); } catch { /* missing */ }
      if (actual !== expected) {
        ok = false;
        console.error(`DRIFT: ${fileURLToPath(file)} — run npm run os:handoff`);
      }
    } else {
      writeFileSync(file, expected);
      console.log(`wrote ${fileURLToPath(file)}`);
    }
  }
  if (check && ok) console.log('handoff artifacts up to date');
  return ok ? 0 : 1;
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : '';
if (invoked === import.meta.url) process.exitCode = handoffCli();
