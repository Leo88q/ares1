import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { Connection, PublicKey } from '@solana/web3.js';
import { withTransaction } from '../gameops/pool.js';
import { FieldOwnershipError, verifyFieldOwnership } from './fieldOwnership.js';
import { ColonyRuleError } from './engine.js';
import { ColonyService, ColonyServiceError } from './service.js';
import { BASE_CAPACITY, BUILDINGS, COLONY_RULESET_STATUS, COLONY_RULESET_VERSION, LAB_UPGRADE_BASE, RESEARCH, STARTER_INITIAL_RESOURCES } from './rules.js';
import { createWalletChallenge, hashWalletChallenge, issueWalletSession, verifyWalletChallenge, verifyWalletSession, type WalletSession } from './walletAuth.js';

export interface ColonyAuthRouterOptions {
  pool: Pool;
  cluster: 'devnet' | 'mainnet-beta';
  sessionSecret: string;
  allowedOrigins: readonly string[];
  allowLocalhostForDevelopment?: boolean;
  fieldRpc?: Connection;
  secondaryFieldRpc?: Connection | null;
  requireSecondaryFieldRpc?: boolean;
  programId?: PublicKey;
  colonyService?: ColonyService;
}

interface ChallengeRow {
  challenge_id: string;
  wallet: string;
  origin: string;
  message_hash: string;
  nonce_hash: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validWallet(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(value);
}

function equalHash(actual: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(actual) || !/^[0-9a-f]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function requestOrigin(req: Request, options: ColonyAuthRouterOptions): string | null {
  const origin = req.get('origin');
  if (!origin) return null;
  if (options.allowedOrigins.includes(origin)) return origin;
  if (options.allowLocalhostForDevelopment && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

const BEARER_TOKEN = /^Bearer ([A-Za-z0-9_.-]{20,2048})$/;

/**
 * Единая точка проверки кошельковой сессии.
 *
 * Раньше эти шесть строк (origin → Bearer → verifyWalletSession) были скопированы
 * в каждый хендлер. Копия — это будущая дыра: новый маршрут добавят без
 * проверки, и заметит это не тест, а инцидент. Ответы сохранены прежними:
 * нет origin/токена — 401 SESSION_REQUIRED, токен невалиден — 401 SESSION_INVALID.
 * Побочный эффект (исправление): `/rules` больше не отвечает SESSION_REQUIRED на
 * битый токен — код стал честным.
 */
function requireSession(options: ColonyAuthRouterOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = requestOrigin(req, options);
    const match = BEARER_TOKEN.exec(req.get('authorization') ?? '');
    if (!origin || !match) {
      res.status(401).json({ error: 'SESSION_REQUIRED' });
      return;
    }
    const session = verifyWalletSession({ token: match[1]!, origin, secret: options.sessionSecret });
    if (!session) {
      res.status(401).json({ error: 'SESSION_INVALID' });
      return;
    }
    res.locals.colonySession = session;
    next();
  };
}

/** Сессия, положенная `requireSession`. Бросать нельзя — middleware уже отсеял. */
function sessionOf(res: Response): WalletSession {
  return res.locals.colonySession as WalletSession;
}

export function colonyAuthRouter(options: ColonyAuthRouterOptions): Router {
  if (Buffer.byteLength(options.sessionSecret, 'utf8') < 32) throw new Error('COLONY_SESSION_SECRET must contain at least 32 UTF-8 bytes');
  const router = Router();

  router.post('/auth/challenge', async (req: Request, res: Response) => {
    const origin = requestOrigin(req, options);
    if (!origin) return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
    if (!isRecord(req.body) || !validWallet(req.body.wallet)) return res.status(400).json({ error: 'INVALID_WALLET' });

    let challenge;
    try {
      challenge = createWalletChallenge({ wallet: req.body.wallet, origin, cluster: options.cluster });
    } catch {
      return res.status(400).json({ error: 'INVALID_CHALLENGE_REQUEST' });
    }
    const challengeId = randomUUID();
    try {
      await withTransaction(options.pool, `wallet:${req.body.wallet}`, async client => {
        await client.query('SELECT game_ops.purge_expired_colony_challenges()');
        const hashes = hashWalletChallenge(challenge.message);
        await client.query(
          `INSERT INTO game_ops.colony_auth_challenges
             (challenge_id, wallet, origin, nonce_hash, message_hash, issued_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [challengeId, req.body.wallet, origin, hashes.nonceHash, hashes.messageHash, challenge.issuedAt, challenge.expiresAt],
        );
      });
      return res.status(201).json({ challengeId, message: challenge.message, expiresAt: challenge.expiresAt });
    } catch {
      return res.status(503).json({ error: 'COLONY_AUTH_UNAVAILABLE' });
    }
  });

  router.post('/auth/verify', async (req: Request, res: Response) => {
    const origin = requestOrigin(req, options);
    if (!origin) return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
    if (!isRecord(req.body) || !validWallet(req.body.wallet)
      || typeof req.body.challengeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(req.body.challengeId)
      || typeof req.body.message !== 'string' || req.body.message.length < 100 || req.body.message.length > 1200
      || typeof req.body.signature !== 'string' || req.body.signature.length > 128) {
      return res.status(400).json({ error: 'INVALID_AUTH_REQUEST' });
    }

    try {
      const authenticated = await withTransaction(options.pool, `wallet:${req.body.wallet}`, async client => {
        const result = await client.query<ChallengeRow>(
          `SELECT challenge_id, wallet, origin, nonce_hash, message_hash, expires_at, consumed_at
             FROM game_ops.colony_auth_challenges
            WHERE challenge_id = $1 AND wallet = $2
            FOR UPDATE`,
          [req.body.challengeId, req.body.wallet],
        );
        const row = result.rows[0];
        if (!row || row.consumed_at !== null || new Date(row.expires_at).getTime() <= Date.now() || row.origin !== origin) return false;
        let submittedHashes: { messageHash: string; nonceHash: string };
        try {
          submittedHashes = hashWalletChallenge(req.body.message);
        } catch {
          return false;
        }
        if (!equalHash(submittedHashes.messageHash, row.message_hash) || !equalHash(submittedHashes.nonceHash, row.nonce_hash)) return false;
        if (!verifyWalletChallenge({
          wallet: row.wallet,
          origin: row.origin,
          message: req.body.message,
          signatureBase64Url: req.body.signature,
        })) return false;
        const consumed = await client.query(
          `UPDATE game_ops.colony_auth_challenges SET consumed_at = now()
            WHERE challenge_id = $1 AND consumed_at IS NULL`,
          [row.challenge_id],
        );
        return consumed.rowCount === 1;
      });
      if (!authenticated) return res.status(401).json({ error: 'WALLET_AUTH_FAILED' });
      const token = issueWalletSession({ wallet: req.body.wallet, origin, secret: options.sessionSecret });
      return res.json({ token, expiresInSeconds: 900, wallet: req.body.wallet, cluster: options.cluster });
    } catch {
      return res.status(503).json({ error: 'COLONY_AUTH_UNAVAILABLE' });
    }
  });

  router.get('/auth/session', requireSession(options), (_req: Request, res: Response) => {
    const session = sessionOf(res);
    return res.json({ wallet: session.wallet, expiresAt: new Date(session.expiresAt * 1000).toISOString(), cluster: options.cluster });
  });

  router.post('/field/verify', requireSession(options), async (req: Request, res: Response) => {
    const session = sessionOf(res);
    if (!options.fieldRpc || !options.programId) return res.status(503).json({ error: 'FIELD_VERIFICATION_NOT_CONFIGURED' });
    if (!isRecord(req.body) || typeof req.body.fieldAddress !== 'string') return res.status(400).json({ error: 'INVALID_FIELD_ADDRESS' });
    try {
      const evidence = await verifyFieldOwnership({
        primary: options.fieldRpc,
        secondary: options.secondaryFieldRpc ?? undefined,
        requireSecondary: options.requireSecondaryFieldRpc,
        cluster: options.cluster,
        programId: options.programId,
        wallet: session.wallet,
        fieldAddress: req.body.fieldAddress,
      });
      return res.json(evidence);
    } catch (error) {
      if (error instanceof FieldOwnershipError) {
        const unavailable = error.code === 'RPC_DISAGREEMENT' || error.code === 'SECONDARY_REQUIRED';
        return res.status(unavailable ? 503 : 403).json({ error: error.code });
      }
      return res.status(503).json({ error: 'FIELD_RPC_UNAVAILABLE' });
    }
  });

  router.post('/fields/link', requireSession(options), async (req: Request, res: Response) => {
    const session = sessionOf(res);
    if (!options.colonyService || !options.fieldRpc || !options.programId) return res.status(503).json({ error: 'COLONY_SERVICE_NOT_CONFIGURED' });
    if (!isRecord(req.body) || typeof req.body.fieldAddress !== 'string'
      || typeof req.body.requestId !== 'string' || typeof req.body.expectedSequence !== 'number') {
      return res.status(400).json({ error: 'INVALID_FIELD_LINK_REQUEST' });
    }
    try {
      const evidence = await verifyFieldOwnership({
        primary: options.fieldRpc, secondary: options.secondaryFieldRpc ?? undefined,
        requireSecondary: options.requireSecondaryFieldRpc, cluster: options.cluster,
        programId: options.programId, wallet: session.wallet, fieldAddress: req.body.fieldAddress,
      });
      const result = await options.colonyService.linkField({
        wallet: session.wallet, fieldAddress: evidence.fieldAddress,
        requestId: req.body.requestId, expectedSequence: req.body.expectedSequence, evidence,
      });
      return res.json({ ...result, rulesetStatus: COLONY_RULESET_STATUS, persistent: true });
    } catch (error) {
      if (error instanceof FieldOwnershipError) {
        const unavailable = error.code === 'RPC_DISAGREEMENT' || error.code === 'SECONDARY_REQUIRED';
        return res.status(unavailable ? 503 : 403).json({ error: error.code });
      }
      if (error instanceof ColonyServiceError) {
        const status = error.code === 'COLONY_NOT_FOUND' ? 404
          : error.code === 'INVALID_REQUEST' ? 400
          : ['VERSION_CONFLICT', 'FIELD_MISMATCH', 'IDEMPOTENCY_CONFLICT', 'FIELD_SLOT_LIMIT', 'FIELD_ALREADY_LINKED', 'FIELD_IN_USE'].includes(error.code) ? 409 : 503;
        return res.status(status).json({ error: error.code });
      }
      return res.status(503).json({ error: 'COLONY_STORAGE_UNAVAILABLE' });
    }
  });

  router.post('/fields/unlink', requireSession(options), async (req: Request, res: Response) => {
    const session = sessionOf(res);
    if (!options.colonyService) return res.status(503).json({ error: 'COLONY_SERVICE_NOT_CONFIGURED' });
    if (!isRecord(req.body) || typeof req.body.fieldAddress !== 'string'
      || typeof req.body.requestId !== 'string' || typeof req.body.expectedSequence !== 'number') {
      return res.status(400).json({ error: 'INVALID_FIELD_UNLINK_REQUEST' });
    }
    try {
      const result = await options.colonyService.unlinkField({
        wallet: session.wallet, fieldAddress: req.body.fieldAddress,
        requestId: req.body.requestId, expectedSequence: req.body.expectedSequence,
      });
      return res.json({ ...result, rulesetStatus: COLONY_RULESET_STATUS, persistent: true });
    } catch (error) {
      if (error instanceof ColonyServiceError) {
        const status = error.code === 'COLONY_NOT_FOUND' ? 404
          : error.code === 'INVALID_REQUEST' ? 400
          : ['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'FIELD_NOT_LINKED', 'FIELD_PRIMARY_IMMUTABLE'].includes(error.code) ? 409 : 503;
        return res.status(status).json({ error: error.code });
      }
      return res.status(503).json({ error: 'COLONY_STORAGE_UNAVAILABLE' });
    }
  });

  router.post('/initialize', requireSession(options), async (req: Request, res: Response) => {
    const session = sessionOf(res);
    if (!options.colonyService || !options.fieldRpc || !options.programId) return res.status(503).json({ error: 'COLONY_SERVICE_NOT_CONFIGURED' });
    if (!isRecord(req.body) || typeof req.body.fieldAddress !== 'string' || typeof req.body.requestId !== 'string') {
      return res.status(400).json({ error: 'INVALID_INITIALIZATION_REQUEST' });
    }
    try {
      const evidence = await verifyFieldOwnership({
        primary: options.fieldRpc, secondary: options.secondaryFieldRpc ?? undefined,
        requireSecondary: options.requireSecondaryFieldRpc, cluster: options.cluster,
        programId: options.programId, wallet: session.wallet, fieldAddress: req.body.fieldAddress,
      });
      const snapshot = await options.colonyService.initialize({
        wallet: session.wallet, fieldAddress: evidence.fieldAddress, requestId: req.body.requestId, evidence,
      });
      return res.status(201).json({ snapshot, rulesetStatus: 'internal-review' });
    } catch (error) {
      if (error instanceof FieldOwnershipError) {
        const unavailable = error.code === 'RPC_DISAGREEMENT' || error.code === 'SECONDARY_REQUIRED';
        return res.status(unavailable ? 503 : 403).json({ error: error.code });
      }
      if (error instanceof ColonyServiceError) {
        const status = error.code === 'ENTITLEMENT_REQUIRED' ? 403 : error.code === 'INVALID_REQUEST' ? 400 : error.code === 'FIELD_MISMATCH' ? 409 : 503;
        return res.status(status).json({ error: error.code });
      }
      return res.status(503).json({ error: 'COLONY_STORAGE_UNAVAILABLE' });
    }
  });

  router.get('/rules', requireSession(options), (req: Request, res: Response) => {
    return res.json({
      version: COLONY_RULESET_VERSION,
      status: COLONY_RULESET_STATUS,
      freeStarterEnabled: options.colonyService?.freeStarterEnabled ?? false,
      freeStarterLimit: 'one-per-wallet',
      initialResources: STARTER_INITIAL_RESOURCES,
      capacities: BASE_CAPACITY,
      buildings: BUILDINGS,
      labUpgrade: LAB_UPGRADE_BASE,
      research: RESEARCH,
    });
  });

  router.get('/state', requireSession(options), async (req: Request, res: Response) => {
    const session = sessionOf(res);
    if (!options.colonyService) return res.status(503).json({ error: 'COLONY_SERVICE_NOT_CONFIGURED' });
    try {
      const snapshot = await options.colonyService.get(session.wallet);
      return res.json({ snapshot, rulesetStatus: 'internal-review', persistent: true });
    } catch (error) {
      if (error instanceof ColonyServiceError) return res.status(error.code === 'COLONY_NOT_FOUND' ? 404 : 503).json({ error: error.code });
      return res.status(503).json({ error: 'COLONY_STORAGE_UNAVAILABLE' });
    }
  });

  router.post('/actions', requireSession(options), async (req: Request, res: Response) => {
    const session = sessionOf(res);
    if (!options.colonyService || !options.fieldRpc || !options.programId) return res.status(503).json({ error: 'COLONY_SERVICE_NOT_CONFIGURED' });
    if (!isRecord(req.body) || typeof req.body.requestId !== 'string' || typeof req.body.expectedSequence !== 'number' || !isRecord(req.body.action)) {
      return res.status(400).json({ error: 'INVALID_ACTION_REQUEST' });
    }
    try {
      const snapshot = await options.colonyService.get(session.wallet);
      await verifyFieldOwnership({
        primary: options.fieldRpc, secondary: options.secondaryFieldRpc ?? undefined,
        requireSecondary: options.requireSecondaryFieldRpc, cluster: options.cluster,
        programId: options.programId, wallet: session.wallet, fieldAddress: snapshot.fieldAddress,
      });
      const result = await options.colonyService.act({
        wallet: session.wallet, fieldAddress: snapshot.fieldAddress,
        requestId: req.body.requestId, expectedSequence: req.body.expectedSequence,
        action: req.body.action as import('./engine.js').ColonyAction,
      });
      return res.json({ ...result, rulesetStatus: 'internal-review', persistent: true });
    } catch (error) {
      if (error instanceof FieldOwnershipError) {
        const unavailable = error.code === 'RPC_DISAGREEMENT' || error.code === 'SECONDARY_REQUIRED';
        return res.status(unavailable ? 503 : 403).json({ error: error.code });
      }
      if (error instanceof ColonyRuleError) {
        const status = error.code === 'INVALID_ACTION' || error.code === 'INVALID_STATE' ? 400 : 409;
        return res.status(status).json({ error: error.code });
      }
      if (error instanceof ColonyServiceError) {
        const status = error.code === 'COLONY_NOT_FOUND' ? 404
          : error.code === 'INVALID_REQUEST' ? 400
          : error.code === 'VERSION_CONFLICT' || error.code === 'FIELD_MISMATCH' || error.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 503;
        return res.status(status).json({ error: error.code });
      }
      return res.status(503).json({ error: 'COLONY_STORAGE_UNAVAILABLE' });
    }
  });

  return router;
}
