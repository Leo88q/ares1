// Кросс-инстансная блокировка крона эпохи: поведение равно «подавитель дублей,
// не предохранитель» — занятый замок пропускает такт, недоступный замок не
// останавливает эпоху (fail-open), а release выполняется в любом случае.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RollLock, withEpochRollLock } from '../src/rollLock.js';

function fakeLock(overrides: Partial<RollLock> = {}): RollLock & { acquired: number; released: number } {
  const lock = {
    acquired: 0,
    released: 0,
    async acquire() {
      lock.acquired += 1;
      return true;
    },
    async release() {
      lock.released += 1;
    },
    ...overrides,
  };
  return lock;
}

test('no lock (game_ops off): the tick runs — single-instance mode', async () => {
  let calls = 0;
  const outcome = await withEpochRollLock(null, async () => {
    calls += 1;
    return 'sig';
  });
  assert.deepEqual(outcome, { ran: true, value: 'sig' });
  assert.equal(calls, 1);
});

test('the lock is taken and released around the tick', async () => {
  const lock = fakeLock();
  let inCritical = false;
  const outcome = await withEpochRollLock(lock, async () => {
    assert.equal(lock.released, 0, 'must not be released while the tick runs');
    inCritical = true;
    return 42;
  });
  assert.equal(inCritical, true);
  assert.deepEqual(outcome, { ran: true, value: 42 });
  assert.equal(lock.acquired, 1);
  assert.equal(lock.released, 1);
});

test('another instance holds the lock: tick is skipped, work is not done', async () => {
  const lock = fakeLock({ acquire: async () => false });
  const logs: string[] = [];
  let calls = 0;
  const outcome = await withEpochRollLock(
    lock,
    async () => {
      calls += 1;
      return 'sig';
    },
    (m) => logs.push(m),
  );
  assert.deepEqual(outcome, { ran: false, value: null });
  assert.equal(calls, 0);
  assert.equal(lock.released, 0, 'nothing to release when the lock was not acquired');
  assert.ok(logs.some((m) => /another instance/.test(m)), `expected a skip log, got: ${logs.join('|')}`);
});

test('release runs even when the tick throws, and the error propagates', async () => {
  const lock = fakeLock();
  await assert.rejects(
    withEpochRollLock(lock, async () => {
      throw new Error('RPC down');
    }),
    /RPC down/,
  );
  assert.equal(lock.released, 1);
});

test('an unavailable lock fails open: the tick still runs, loudly', async () => {
  const lock = fakeLock({
    acquire: async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
    },
  });
  const logs: string[] = [];
  let calls = 0;
  const outcome = await withEpochRollLock(
    lock,
    async () => {
      calls += 1;
      return 'sig';
    },
    (m) => logs.push(m),
  );
  assert.deepEqual(outcome, { ran: true, value: 'sig' });
  assert.equal(calls, 1);
  assert.equal(lock.released, 0);
  assert.ok(logs.some((m) => /lock unavailable/.test(m)), `expected a fail-open log, got: ${logs.join('|')}`);
});

test('a failing release is logged and does not mask the tick result', async () => {
  const lock = fakeLock({
    release: async () => {
      throw new Error('connection terminated');
    },
  });
  const logs: string[] = [];
  const outcome = await withEpochRollLock(lock, async () => 'sig', (m) => logs.push(m));
  assert.deepEqual(outcome, { ran: true, value: 'sig' });
  assert.ok(logs.some((m) => /release failed/.test(m)), `expected a release log, got: ${logs.join('|')}`);
});
