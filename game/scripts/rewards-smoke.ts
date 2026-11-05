#!/usr/bin/env node
/**
 * Сквозной смоук рельсы наград: приглашение → грант → сверка.
 *
 * Зачем. До этого рельса была покрыта юнит-тестами (16 штук) и localnet-тестами
 * `grant_reward_once`, но ни один прогон не проходил весь путь как игрок:
 * оператор выписывает приглашение, клиент отправляет стартовый запрос, бэкенд
 * подписывает грант, цепь его принимает, а сверка подтверждает, что POTATO
 * действительно дошли. Все четыре стыка (HMAC-код, HTTP-гейты, подпись
 * reward_signer, ончейн-PDA гранта) проверяются порознь и ломаются вместе.
 *
 * Что делает.
 *   1. `status`   — читает `/api/rewards/status`: рельса включена, приглашения
 *                   настроены, проверка активного поля доступна.
 *   2. `invite`   — выписывает приглашение на кошелёк локально (тот же код, что
 *                   у оператора: `issueInvite`), без обращения к серверу.
 *   3. `starter`  — POST `/api/rewards/starter` (запрос идёт с локальной машины:
 *                   сервер видит обычный HTTP-запрос).
 *   4. `reconcile`— ждёт подтверждения и сверяет ДВА факта с цепью: ончейн-PDA
 *                   гранта существует и ATA получателя вырос на сумму гранта.
 *
 * Почему не отправляет транзакцию сам: грант подписывает только `reward_signer`
 * бэкенда. Скрипту нельзя доверять этот ключ — иначе смоук сам стал бы вторым
 * способом печатать POTATO.
 *
 * Запуск (из game/, devnet):
 *   REWARDS_SMOKE_BASE_URL=https://api-beta.example \
 *   REWARDS_SMOKE_WALLET=<адрес кошелька в devnet> \
 *   REWARD_INVITE_SECRET=<тот же секрет, что у бэкенда> \
 *   SOLANA_CLUSTER=devnet RPC_URL=https://api.devnet.solana.com \
 *   yarn rewards:smoke
 *
 * Флаги: --dry-run (только status + проверка конфигурации, ничего не выдаёт),
 *        --no-invite (стартовый набор уже получен; проверять только сверку).
 *
 * Exit codes: 0 — все шаги прошли, 1 — шаг не прошёл, 2 — конфигурация.
 * Секреты в вывод не попадают: печатаются только адреса, суммы и коды ошибок.
 */
import process from 'node:process';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { expectedGenesisHash } from '../apps/backend/src/cluster.js';
import type { SolanaCluster } from '../apps/backend/src/cluster.js';
import { decodeGameConfig, u64LE } from '../apps/backend/src/anchorRaw.js';
import { issueInvite } from '../apps/backend/src/rewards/invite.js';
import { GRANT_AMOUNTS_MICRO, grantNonce } from '../apps/backend/src/rewards/rail.js';
import { safeError } from '../apps/backend/src/security.js';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_INVITE = args.includes('--no-invite');

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`config: ${name} is required`);
    process.exit(2);
  }
  return value;
}

function log(step: string, message: string): void {
  console.log(`[rewards-smoke] ${step}: ${message}`);
}

function fail(step: string, message: string): never {
  console.error(`[rewards-smoke] ${step}: FAIL — ${message}`);
  process.exit(1);
}

/** Стартовый nonce детерминирован от адреса — тот же расчёт, что у бэкенда. */
function rewardClaimPda(programId: PublicKey, ata: PublicKey, nonce: bigint): PublicKey {
  const seed = u64LE(nonce);
  return PublicKey.findProgramAddressSync([Buffer.from('reward'), ata.toBuffer(), seed], programId)[0];
}

interface StatusBody {
  rewards?: {
    enabled?: boolean;
    disabledReason?: string | null;
    rewardSigner?: string | null;
    starter?: { requiresInvite?: boolean; invitesConfigured?: boolean };
    daily?: { activityCheckAvailable?: boolean };
  };
}

async function fetchStatus(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/rewards/status`, { headers: { accept: 'application/json' } });
  const body = (await response.json().catch(() => ({}))) as StatusBody;
  if (!response.ok) fail('status', `HTTP ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function postJson(baseUrl: string, path: string, payload: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

async function main(): Promise<void> {
  const baseUrl = need('REWARDS_SMOKE_BASE_URL').replace(/\/$/, '');
  const wallet = new PublicKey(need('REWARDS_SMOKE_WALLET'));
  const cluster = (process.env.SOLANA_CLUSTER || 'devnet') as SolanaCluster;
  if (cluster === 'mainnet-beta' && process.env.REWARDS_SMOKE_ALLOW_MAINNET !== 'true') {
    // Рельса наград на mainnet включается отдельным одобрением; смоук, который
    // случайно попадёт в mainnet, не должен проверять это на живых деньгах.
    fail('config', 'mainnet smoke requires REWARDS_SMOKE_ALLOW_MAINNET=true');
  }
  const rpcUrl = need('RPC_URL');
  const connection = new Connection(rpcUrl, 'confirmed');
  const genesis = await connection.getGenesisHash();
  if (genesis !== expectedGenesisHash(cluster)) {
    fail('config', `RPC cluster mismatch: configured=${cluster}`);
  }

  // ── 1. status ───────────────────────────────────────────────────────────
  const status = await fetchStatus(baseUrl);
  const rewards = status.rewards ?? {};
  log('status', `http ok, enabled=${Boolean(rewards.enabled)}`);
  if (!rewards.enabled) {
    fail('status', `rail is closed: ${rewards.disabledReason ?? 'no reason given'}`);
  }
  if (!rewards.starter?.invitesConfigured) {
    // Без секрета приглашений стартовый набор не выдаётся — это fail-closed,
    // и смоук обязан сказать об этом прямо, а не падать на 401 ниже.
    fail('status', 'REWARD_INVITE_SECRET is not configured on the backend: starter grants cannot be issued');
  }
  if (typeof rewards.rewardSigner !== 'string' || !rewards.rewardSigner) {
    fail('status', 'backend did not report a reward signer');
  }
  log('status', `reward signer present, activity check ${rewards.daily?.activityCheckAvailable ? 'available' : 'UNAVAILABLE (daily will 503)'}`);

  const programId = new PublicKey(need('PROGRAM_ID'));
  const config = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
  const configInfo = await connection.getAccountInfo(config, 'confirmed');
  if (!configInfo) fail('chain', `GameConfig ${config.toBase58()} does not exist: program is not initialised on this cluster`);
  const cfg = decodeGameConfig(configInfo.data);
  log('chain', `potato mint ${cfg.potatoMint.toBase58()}, epoch ${cfg.epochId}`);

  const ata = getAssociatedTokenAddressSync(cfg.potatoMint, wallet, false);
  // nonce стартового набора детерминирован: тот же расчёт у бэкенда, поэтому
  // повторная выдача на этот кошелёк не создаст второй PDA.
  const nonce = grantNonce('starter', wallet.toBase58(), BigInt(Math.floor(Date.now() / 1000)));
  const claim = rewardClaimPda(programId, ata, nonce);
  const before = await getAccount(connection, ata).catch(() => null);
  log('chain', `ata ${ata.toBase58()} balance before=${before?.amount ?? 0n} micro, claim pda ${claim.toBase58()}`);

  if (DRY_RUN) {
    log('dry-run', 'configuration and chain state look consistent; no grant was requested');
    return;
  }

  // ── 2. invite ───────────────────────────────────────────────────────────
  let invite: string;
  if (SKIP_INVITE) {
    log('invite', 'skipped (--no-invite)');
    invite = '';
  } else {
    const secret = need('REWARD_INVITE_SECRET');
    invite = issueInvite({ wallet: wallet.toBase58(), nowSeconds: Math.floor(Date.now() / 1000), secret });
    // Код печатать целиком не нужно: он одноразовый и привязан к кошельку.
    log('invite', `issued for ${wallet.toBase58()} (${invite.split('.')[0]}., ${invite.length} chars)`);
  }

  // ── 3. starter ──────────────────────────────────────────────────────────
  const startedAt = Date.now();
  const starter = await postJson(baseUrl, '/api/rewards/starter', { wallet: wallet.toBase58(), invite });
  log('starter', `HTTP ${starter.status} ${JSON.stringify(starter.body).slice(0, 240)}`);
  if (starter.status >= 400) {
    // Повторная выдача на тот же кошелёк — ожидаемый отказ, а не поломка:
    // именно так выглядит «идемпотентность уже сработала».
    const code = String((starter.body as { error?: string }).error ?? '');
    if (/ALREADY|COOLDOWN|DONE/i.test(code)) {
      log('starter', `already granted (${code}) — switching to reconciliation only`);
    } else {
      fail('starter', `HTTP ${starter.status} ${code || 'no error code'}`);
    }
  }

  // ── 4. reconcile ────────────────────────────────────────────────────────
  const timeoutMs = Number(process.env.REWARDS_SMOKE_TIMEOUT_MS || 90_000);
  const expected = GRANT_AMOUNTS_MICRO.starter;
  let after = before;
  while (Date.now() - startedAt < timeoutMs) {
    after = await getAccount(connection, ata).catch(() => null);
    const seen = (after?.amount ?? 0n) - (before?.amount ?? 0n);
    const claimExists = Boolean(await connection.getAccountInfo(claim, 'confirmed'));
    if (claimExists && seen >= expected) break;
    await new Promise(resolve => setTimeout(resolve, 3_000));
  }
  const claimExists = Boolean(await connection.getAccountInfo(claim, 'confirmed'));
  const delta = (after?.amount ?? 0n) - (before?.amount ?? 0n);
  log('reconcile', `claim pda exists=${claimExists}, ata delta=${delta} micro (expected ${expected})`);
  if (!claimExists) fail('reconcile', 'grant PDA is absent: the chain did not accept grant_reward_once');
  if (delta < expected) fail('reconcile', `ata did not receive the grant (delta ${delta} < ${expected})`);
  log('reconcile', 'PASS — invite → grant → reconciliation');
}

main().catch((error: unknown) => {
  // safeError вырезает RPC-URL с ключом и любые похожие на credentials строки.
  console.error(`[rewards-smoke] FAIL — ${safeError(error)}`);
  process.exit(1);
});
