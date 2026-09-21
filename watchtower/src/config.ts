import { z } from 'zod';
import bs58 from 'bs58';
import { artifact } from './artifacts.js';

export const address = z.string().refine(s => {
  try { return s.length >= 32 && s.length <= 44 && bs58.decode(s).length === 32 && bs58.encode(bs58.decode(s)) === s; } catch { return false; }
}, 'invalid public address');
const manifestSchema = z.object({
  gameId: z.literal('ares1'), name: z.literal('ARES-1'), network: z.literal('devnet'),
  programIds: z.array(address).length(1), mintAddresses: z.array(address), treasuryAddresses: z.array(address),
  pdaAccounts: z.array(address), idlVersion: z.string().min(1), idlSha256: z.string().regex(/^[a-f0-9]{64}$/),
  parserVersion: z.literal('ares1-v1'), dataQuality: z.literal('partial'), writes: z.literal(false),
  lastVerifiedAt: z.string().datetime().nullable(), deploymentVerified: z.boolean(),
  addressProvenance: z.string(),
}).strict();
export const manifest = manifestSchema.parse(artifact('integration-manifest.json'));
const httpUrl = z.string().url().refine(s => URL.canParse(s) && ['http:', 'https:'].includes(new URL(s).protocol));
const envSchema = z.object({
  WATCHTOWER_EXPORTER_PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  WATCHTOWER_EXPORTER_TOKEN: z.string().min(32),
  WATCHTOWER_CLUSTER: z.literal('devnet').default('devnet'),
  WATCHTOWER_RPC_URL: z.union([httpUrl, z.literal('')]).default(''),
  WATCHTOWER_RPC_FALLBACK_URL: z.union([httpUrl, z.literal('')]).default(''),
  WATCHTOWER_DATABASE_URL: z.string().url().refine(s => URL.canParse(s) && ['postgres:', 'postgresql:'].includes(new URL(s).protocol)),
  WATCHTOWER_EVENT_PROVIDER: z.enum(['mock', 'rpc']).default('mock'),
  WATCHTOWER_ENABLE_WRITES: z.literal('false').default('false'),
  WATCHTOWER_PLAYER_HASH_SALT: z.literal('').default(''),
  WATCHTOWER_RPC_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(10000),
  WATCHTOWER_POLL_MS: z.coerce.number().int().min(1000).max(300000).default(15000),
  WATCHTOWER_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(50),
});
export class SafeError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  // Must run before any DB/RPC/HTTP initialization. Reject ambiguous values too.
  if (env.WATCHTOWER_ENABLE_WRITES !== undefined && env.WATCHTOWER_ENABLE_WRITES !== 'false') {
    throw new SafeError('WRITES_FORBIDDEN');
  }
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new SafeError('INVALID_CONFIG'); // never print Zod inputs/secrets
  const e = parsed.data;
  if (e.WATCHTOWER_EVENT_PROVIDER === 'rpc' && !e.WATCHTOWER_RPC_URL) throw new SafeError('RPC_REQUIRED');
  return {
    port: e.WATCHTOWER_EXPORTER_PORT, token: e.WATCHTOWER_EXPORTER_TOKEN,
    cluster: e.WATCHTOWER_CLUSTER, programId: manifest.programIds[0]!,
    rpcUrls: [e.WATCHTOWER_RPC_URL, e.WATCHTOWER_RPC_FALLBACK_URL].filter(Boolean),
    databaseUrl: e.WATCHTOWER_DATABASE_URL, provider: e.WATCHTOWER_EVENT_PROVIDER,
    source: e.WATCHTOWER_EVENT_PROVIDER === 'rpc' ? 'native-rpc' as const : 'synthetic' as const,
    rpcTimeoutMs: e.WATCHTOWER_RPC_TIMEOUT_MS, pollMs: e.WATCHTOWER_POLL_MS,
    pageSize: e.WATCHTOWER_PAGE_SIZE,
  };
}
export type Config = ReturnType<typeof loadConfig>;
export function safeConfig(config: Config) {
  return { gameId: 'ares1', network: config.cluster, programConfigured: true,
    deploymentVerified: manifest.deploymentVerified, dataQuality: 'partial', writes: false };
}
