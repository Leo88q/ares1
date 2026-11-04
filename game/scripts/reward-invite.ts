#!/usr/bin/env node
/**
 * Операторский CLI: выписать код приглашения на стартовый набор.
 *
 * Зачем. `/api/rewards/starter` выдаёт 250 POTATO (цену Луга) и теперь требует
 * код, подписанный этим секретом: без приглашения грант не выдаётся вовсе.
 * Открытая выдача была Sybil-краном — любая сгенерированная пара ключей
 * получала бесплатное поле, и цена входа для бота и для человека была
 * одинаковой (ноль).
 *
 * Что делает команда. Ничего не отправляет в сеть: она только подписывает
 * полезную нагрузку (кошелёк + срок) локальным секретом. Код передаётся
 * игроку обычным сообщением, он вставляет его в магазин на главной.
 *
 * Секрет берётся из `REWARD_INVITE_SECRET` — того же значения, что у бэкенда.
 * В git и в бандл он не попадает; на VPS хватает переменной окружения.
 *
 * From game/:
 *   REWARD_INVITE_SECRET=... yarn reward-invite <wallet> [--ttl-hours 12]
 */
import process from 'node:process';
import { issueInvite, DEFAULT_INVITE_TTL_SECONDS, MAX_INVITE_TTL_SECONDS } from '../apps/backend/src/rewards/invite.js';
import { isWalletAddress } from '../apps/backend/src/rewards/rail.js';

const args = process.argv.slice(2);

function usage(message?: string): never {
  if (message) console.error(`reward-invite: ${message}`);
  console.error('usage: REWARD_INVITE_SECRET=... yarn reward-invite <wallet> [--ttl-hours N]');
  process.exit(2);
}

if (args.includes('--help') || args.includes('-h')) usage();
const wallet = args.find((arg) => !arg.startsWith('--'));
if (!wallet) usage('wallet is required');
if (!isWalletAddress(wallet)) usage(`"${wallet}" is not a base58 wallet address`);

const ttlIndex = args.indexOf('--ttl-hours');
const ttlHours = ttlIndex >= 0 ? Number(args[ttlIndex + 1]) : DEFAULT_INVITE_TTL_SECONDS / 3600;
if (!Number.isFinite(ttlHours) || ttlHours <= 0) usage('--ttl-hours must be a positive number');
const ttlSeconds = Math.round(ttlHours * 3600);
if (ttlSeconds > MAX_INVITE_TTL_SECONDS) {
  usage(`--ttl-hours cannot exceed ${MAX_INVITE_TTL_SECONDS / 3600} h`);
}

const secret = process.env.REWARD_INVITE_SECRET ?? '';
if (!secret) usage('REWARD_INVITE_SECRET is not set (it must match the backend value)');
if (secret.length < 32) {
  // Тот же порог, что у остальных секретов бэкенда: короткий HMAC-ключ
  // подбирается перебором, и «приглашение» перестаёт что-либо защищать.
  usage('REWARD_INVITE_SECRET must be at least 32 characters');
}

const nowSeconds = Math.floor(Date.now() / 1000);
const code = issueInvite({ wallet, nowSeconds, secret, ttlSeconds });
const expiresAt = new Date((nowSeconds + ttlSeconds) * 1000).toISOString();

console.log(`wallet:  ${wallet}`);
console.log(`expires: ${expiresAt} (${ttlHours} h)`);
console.log('');
console.log(code);
console.log('');
console.log('Передайте код игроку: магазин на главной → поле приглашения → «Получить стартовый набор».');
console.log('Код одноразовый по смыслу: стартовый грант привязан к кошельку ончейн-PDA.');
