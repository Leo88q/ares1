/**
 * Крон квест-бюджета: доливка только ниже low-water, не больше суточного
 * капа, nonce фиксирован на UTC-сутки. Никакого RPC — все эффекты фейковые.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUEST_DAILY_REFILL_CAP_MICRO,
  QUEST_POOL_LOW_WATER_MICRO,
  QUEST_POOL_TARGET_MICRO,
  QUEST_REFILL_EXPIRY_SECONDS,
  questRefillAmount,
  questRefillExpiry,
  questRefillNonce,
  runQuestBudgetOnce,
  startQuestBudgetWorker,
  type QuestBudgetDeps,
} from '../src/rewards/questBudget.js';

const DAY = 86_400n;
const NOW = 1_800_000_000n;
const MICRO = 1_000_000n;

test('пул выше low-water не трогаем', () => {
  assert.equal(questRefillAmount(QUEST_POOL_TARGET_MICRO), 0n);
  assert.equal(questRefillAmount(QUEST_POOL_LOW_WATER_MICRO), 0n);
  assert.equal(questRefillAmount(QUEST_POOL_LOW_WATER_MICRO + MICRO), 0n);
});

test('ниже low-water доливаем до полного пула', () => {
  assert.equal(questRefillAmount(0n), QUEST_POOL_TARGET_MICRO);
  assert.equal(questRefillAmount(50n * MICRO), QUEST_POOL_TARGET_MICRO - 50n * MICRO);
});

test('доливка упирается в суточный кап и в потолок одной выдачи', () => {
  // Кап меньше потребности — платим кап.
  assert.equal(questRefillAmount(0n, 100n * MICRO), 100n * MICRO);
  // Большой суточный кап не расширяет доливку: цель — полный пул.
  assert.equal(questRefillAmount(0n, 10_000n * MICRO), QUEST_POOL_TARGET_MICRO);
  assert.throws(() => questRefillAmount(-1n), /отрицательный баланс/);
});

test('nonce фиксирован на UTC-сутки и не пересекается с дейликом', () => {
  const start = (NOW / DAY) * DAY;
  const a = questRefillNonce(start);
  const b = questRefillNonce(start + DAY - 1n);
  const nextDay = questRefillNonce(start + DAY);
  assert.equal(a, b);
  assert.notEqual(a, nextDay);
  assert.notEqual(a, 0n);
});

test('дедлайн доливки внутри ончейн-окна', () => {
  assert.equal(questRefillExpiry(NOW), NOW + BigInt(QUEST_REFILL_EXPIRY_SECONDS));
  assert.ok(questRefillExpiry(NOW) - NOW < 900n);
});

function harness(balance: bigint, options: { refillThrows?: boolean; readThrows?: boolean } = {}) {
  const calls: Array<{ amountMicro: bigint; nonce: bigint; expiresAt: bigint }> = [];
  const deps: QuestBudgetDeps = {
    now: () => NOW,
    readBalance: async () => {
      if (options.readThrows) throw new Error('rpc down');
      return balance;
    },
    refill: async (input) => {
      calls.push(input);
      if (options.refillThrows) throw new Error('simulation failed');
      return 'sig-' + calls.length;
    },
  };
  return { deps, calls };
}

test('выше low-water: такт ничего не отправляет', async () => {
  const { deps, calls } = harness(QUEST_POOL_TARGET_MICRO);
  const outcome = await runQuestBudgetOnce(deps);
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.reason, 'above-low-water');
  assert.equal(calls.length, 0);
});

test('низкий пул: одна доливка с nonce этого дня', async () => {
  const { deps, calls } = harness(10n * MICRO);
  const outcome = await runQuestBudgetOnce(deps);
  assert.equal(outcome.status, 'refilled');
  assert.equal(outcome.amountMicro, QUEST_POOL_TARGET_MICRO - 10n * MICRO);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.nonce, questRefillNonce(NOW));
});

test('второй такт в те же сутки упирается в суточный кап', async () => {
  // Кап = 550 POTATO; пул пуст, значит первая доливка съедает кап целиком.
  const { deps, calls } = harness(0n);
  const first = await runQuestBudgetOnce(deps);
  assert.equal(first.status, 'refilled');
  assert.equal(first.amountMicro, QUEST_DAILY_REFILL_CAP_MICRO);
  const second = await runQuestBudgetOnce(deps);
  assert.equal(second.status, 'skipped');
  assert.equal(second.reason, 'daily-cap');
  assert.equal(calls.length, 1);
});

test('новые UTC-сутки сбрасывают суточный кап', async () => {
  let now = NOW;
  const calls: unknown[] = [];
  const deps: QuestBudgetDeps = {
    now: () => now,
    readBalance: async () => 0n,
    refill: async () => { calls.push(1); return 'sig'; },
  };
  await runQuestBudgetOnce(deps);
  now += DAY;
  const next = await runQuestBudgetOnce(deps);
  assert.equal(next.status, 'refilled');
  assert.equal(calls.length, 2);
});

test('сбой RPC или отправки не бросается наружу и не съедает кап', async () => {
  const readFail = harness(0n, { readThrows: true });
  const a = await runQuestBudgetOnce(readFail.deps);
  assert.equal(a.status, 'failed');
  assert.match(a.reason ?? '', /rpc down/);

  const sendFail = harness(0n, { refillThrows: true });
  const b = await runQuestBudgetOnce(sendFail.deps);
  assert.equal(b.status, 'failed');
  assert.match(b.reason ?? '', /simulation failed/);
  // После неудачной отправки кап не израсходован: следующий такт может повторить.
  assert.equal(sendFail.deps.budget?.spentMicro, 0n);
});

test('воркер выключен при нулевом интервале и не дублирует такты', async () => {
  const { deps } = harness(0n);
  assert.equal(startQuestBudgetWorker(deps, 0), null);
  const handle = startQuestBudgetWorker(deps, 3600, () => {});
  assert.ok(handle);
  const [a, b] = await Promise.all([handle!.runNow(), handle!.runNow()]);
  assert.equal([a, b].filter((o) => o.status === 'refilled').length, 1);
  handle!.stop();
});
