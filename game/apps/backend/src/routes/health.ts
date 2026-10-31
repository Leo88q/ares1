/**
 * Публичный /health.
 *
 * Вынесен из index.ts, чтобы у него был тест: это единственный эндпоинт,
 * который исключён из rate-limit и не требует токена, поэтому состав полей —
 * вопрос безопасности, а не только удобства. Раньше он отдавал адрес и баланс
 * плательщика (`payer`, `payerSol`), то есть публичную карту для атаки на
 * hot-wallet. Адрес и остаток остаются в стартовом логе и в /ready (за токеном).
 *
 * Зависимости инжектируются — тест не ходит ни в RPC, ни в сеть.
 */
import { Router } from 'express';

export interface HealthDeps {
  /** Только `getSlot`: всё остальное health знать не должен. */
  connection: { getSlot: () => Promise<number> };
  fetchConfig: () => Promise<{ epochId: bigint; paused: boolean }>;
  /** Геттер, а не значение: пул game_ops создаётся позже монтирования роутера. */
  gameOpsEnabled: () => boolean;
  cluster: string;
  uptime: () => number;
}

export function healthRouter(deps: HealthDeps): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    try {
      const slot = await deps.connection.getSlot();
      const config = await deps.fetchConfig();
      res.json({
        ok: true,
        slot,
        epochId: config.epochId.toString(),
        paused: config.paused,
        gameOps: deps.gameOpsEnabled() ? 'on' : 'off',
        cluster: deps.cluster,
        uptime: deps.uptime(),
      });
    } catch {
      res.status(503).json({ ok: false, error: 'Dependency check failed' });
    }
  });
  return router;
}
