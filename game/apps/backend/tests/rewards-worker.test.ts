/**
 * Авто-доставка: порядок переходов, восстановление после падения между
 * отправкой и записью подписи, поведение при гонке и при битой строке.
 * Никакого RPC: все эффекты — фейки, проверяется только логика воркера.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  claimPda,
  parseAtaOwner,
  findExistingGrant,
} from '../src/rewards/chain.js';
import {
  failureCodeFrom,
  isTerminalFailure,
  runDeliveryOnce,
  startDeliveryWorker,
  type DeliveryWorkerDeps,
  type WorkerIntent,
} from '../src/rewards/worker.js';

const PROGRAM = new PublicKey(new Uint8Array(32).fill(7));
const ATA = Keypair.generate().publicKey;
const WALLET = Keypair.generate().publicKey.toBase58();

function intent(overrides: Partial<WorkerIntent> = {}): WorkerIntent {
  return {
    id: '42',
    recipientAta: ATA.toBase58(),
    amountMicro: 1_000_000_000n,
    nonce: 42n,
    state: 'pending',
    ...overrides,
  };
}

function harness(rows: WorkerIntent[], options: {
  execute?: DeliveryWorkerDeps['executeGrant'];
  lookup?: DeliveryWorkerDeps['lookupExistingGrant'];
} = {}) {
  const calls: string[] = [];
  const deps: DeliveryWorkerDeps = {
    actor: 'reward-delivery',
    listActionable: async (limit) => { calls.push(`list:${limit}`); return rows.slice(0, limit); },
    executeGrant: options.execute ?? (async (row) => { calls.push(`send:${row.id}`); return { signature: 'sig-' + row.id, slot: 100n }; }),
    lookupExistingGrant: options.lookup ?? (async (row) => { calls.push(`lookup:${row.id}`); return null; }),
    markSubmitted: async ({ id, signature }) => { calls.push(`submitted:${id}:${signature}`); },
    markConfirmed: async ({ id, slot }) => { calls.push(`confirmed:${id}:${slot}`); },
    markFailed: async ({ id, failureCode }) => { calls.push(`failed:${id}:${failureCode}`); },
  };
  return { deps, calls };
}

test('claimPda детерминирован и зависит от nonce', () => {
  const a = claimPda(PROGRAM, ATA, 1n);
  assert.equal(a.toBase58(), claimPda(PROGRAM, ATA, 1n).toBase58());
  assert.notEqual(a.toBase58(), claimPda(PROGRAM, ATA, 2n).toBase58());
  assert.notEqual(a.toBase58(), claimPda(PROGRAM, Keypair.generate().publicKey, 1n).toBase58());
});

test('parseAtaOwner читает только валидный base58 и молчит на мусоре', () => {
  assert.equal(parseAtaOwner({ data: { parsed: { info: { owner: WALLET } } } }), WALLET);
  assert.equal(parseAtaOwner({ data: { parsed: { info: { owner: 'nope' } } } }), null);
  assert.equal(parseAtaOwner({ data: { parsed: { info: { owner: 42 } } } }), null);
  assert.equal(parseAtaOwner({ data: 'base64' }), null);
  assert.equal(parseAtaOwner(null), null);
});

test('findExistingGrant отдаёт слот и игнорирует неуспешную транзакцию', async () => {
  const ok = { getSignaturesForAddress: async () => [{ signature: 's1', slot: 321, err: null }] } as any;
  assert.deepEqual(await findExistingGrant(ok, ATA), { signature: 's1', slot: 321n });
  const failed = { getSignaturesForAddress: async () => [{ signature: 's1', slot: 321, err: { x: 1 } }] } as any;
  assert.equal(await findExistingGrant(failed, ATA), null);
  const empty = { getSignaturesForAddress: async () => [] } as any;
  assert.equal(await findExistingGrant(empty, ATA), null);
});

test('счастливый путь: pending → submitted → confirmed', async () => {
  const { deps, calls } = harness([intent()]);
  const result = await runDeliveryOnce(deps);
  assert.deepEqual(result, { picked: 1, submitted: 1, confirmed: 1, failed: 0, retryable: 0, recovered: 0, errors: [] });
  assert.deepEqual(calls, ['list:10', 'lookup:42', 'send:42', 'submitted:42:sig-42', 'confirmed:42:100']);
});

test('грант уже на цепи до отправки: отправка не повторяется', async () => {
  const { deps, calls } = harness([intent()], {
    lookup: async () => ({ signature: 'old-sig', slot: 77n }),
    execute: async () => { throw new Error('must not send'); },
  });
  const result = await runDeliveryOnce(deps);
  assert.equal(result.recovered, 1);
  assert.equal(result.submitted, 1);
  assert.equal(result.confirmed, 1);
  assert.ok(!calls.some((c) => c.startsWith('send:')));
});

test('гонка: simulate вернул «already in use», подпись восстанавливается из истории', async () => {
  let lookups = 0;
  const { deps } = harness([intent()], {
    lookup: async () => (++lookups > 1 ? { signature: 'raced', slot: 55n } : null),
    execute: async () => { throw new Error('AccountAlreadyInUse: already in use'); },
  });
  const result = await runDeliveryOnce(deps);
  assert.equal(result.recovered, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.confirmed, 1);
});

test('ошибка отправки помечает failed кодом и не ломает пачку', async () => {
  const { deps } = harness([intent({ id: '1' }), intent({ id: '2' })], {
    execute: async (row) => {
      if (row.id === '1') throw new Error('REWARD_RAIL: simulation failed: {"InstructionError":[1,"Custom"]}');
      return { signature: 'sig-2', slot: 9n };
    },
  });
  const result = await runDeliveryOnce(deps);
  assert.equal(result.picked, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.confirmed, 1);
  assert.deepEqual(result.errors, [{ id: '1', code: 'SIMULATION_FAILED' }]);
});

test('недоступный lookup не отправляет грант вслепую и не закрывает интент', async () => {
  const { deps, calls } = harness([intent()], { lookup: async () => { throw new Error('rpc down'); } });
  const result = await runDeliveryOnce(deps);
  // RPC — не приговор: транзакция не отправлялась, значит повтор безопасен и
  // обязателен. Терминальный failed здесь оставил бы оплаченный заказ без выдачи.
  assert.equal(result.failed, 0);
  assert.equal(result.retryable, 1);
  assert.deepEqual(result.errors, [{ id: '42', code: 'LOOKUP_FAILED' }]);
  assert.ok(!calls.some((c) => c.startsWith('send:')));
  assert.ok(!calls.some((c) => c.startsWith('failed:')));
});

test('таймаут подтверждения оставляет интент открытым: транзакция могла уйти', async () => {
  const { deps, calls } = harness([intent()], {
    execute: async () => { throw new Error('REWARD_RAIL: timed out waiting for confirmation'); },
  });
  const result = await runDeliveryOnce(deps);
  assert.equal(result.failed, 0);
  assert.equal(result.retryable, 1);
  assert.deepEqual(result.errors, [{ id: '42', code: 'CONFIRM_TIMEOUT' }]);
  // Главное: терминального перехода нет, заказ не «потерян».
  assert.ok(!calls.some((c) => c.startsWith('failed:')));
});

test('истёкший blockhash — тоже повтор, а не закрытие', async () => {
  const { deps, calls } = harness([intent()], {
    execute: async () => { throw new Error('Blockhash not found'); },
  });
  const result = await runDeliveryOnce(deps);
  assert.equal(result.retryable, 1);
  assert.equal(result.failed, 0);
  assert.ok(!calls.some((c) => c.startsWith('failed:')));
});

test('детерминированные отказы остаются терминальными', async () => {
  for (const [message, code] of [
    ['insufficient funds for rent', 'SIGNER_UNFUNDED'],
    ['REWARD_RAIL: simulation failed: {"InstructionError":[1,"Custom"]}', 'SIMULATION_FAILED'],
  ] as const) {
    const { deps, calls } = harness([intent()], { execute: async () => { throw new Error(message); } });
    const result = await runDeliveryOnce(deps);
    assert.equal(result.failed, 1, code);
    assert.equal(result.retryable, 0, code);
    assert.ok(calls.includes(`failed:42:${code}`), code);
  }
});

test('isTerminalFailure отделяет повторяемые коды от закрывающих', () => {
  for (const code of ['CONFIRM_TIMEOUT', 'BLOCKHASH_EXPIRED', 'LOOKUP_FAILED', 'GRANT_FAILED']) {
    assert.equal(isTerminalFailure(code), false, code);
  }
  for (const code of ['BAD_INTENT_ROW', 'SIMULATION_FAILED', 'SIGNER_UNFUNDED', 'ALREADY_ON_CHAIN']) {
    assert.equal(isTerminalFailure(code), true, code);
  }
});

test('битая строка интента отклоняется до любых RPC-вызовов', async () => {
  const { deps, calls } = harness([intent({ recipientAta: 'not-an-address' })]);
  const result = await runDeliveryOnce(deps);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.errors, [{ id: '42', code: 'BAD_INTENT_ROW' }]);
  assert.deepEqual(calls, ['list:10', 'failed:42:BAD_INTENT_ROW']);
  assert.ok(!calls.some((c) => c.startsWith('lookup:') || c.startsWith('send:')));
});

test('предел пачки ограничен сверху', async () => {
  const { deps, calls } = harness([], {});
  await runDeliveryOnce({ ...deps, limit: 1_000 });
  assert.equal(calls[0], 'list:25');
});

test('failureCodeFrom не пропускает свободный текст в колонку failure_code', () => {
  assert.equal(failureCodeFrom(new Error('already in use')), 'ALREADY_ON_CHAIN');
  assert.equal(failureCodeFrom(new Error('simulation failed: bad')), 'SIMULATION_FAILED');
  assert.equal(failureCodeFrom(new Error('insufficient lamports')), 'SIGNER_UNFUNDED');
  assert.equal(failureCodeFrom(new Error('Blockhash not found')), 'BLOCKHASH_EXPIRED');
  assert.equal(failureCodeFrom(new Error('timed out waiting')), 'CONFIRM_TIMEOUT');
  assert.equal(failureCodeFrom('whatever'), 'GRANT_FAILED');
});

test('воркер не запускается при interval <= 0 и не дублирует такты', async () => {
  const { deps } = harness([]);
  assert.equal(startDeliveryWorker(deps, 0), null);
  const handle = startDeliveryWorker(deps, 3600, () => {});
  assert.ok(handle);
  const [a, b] = await Promise.all([handle!.runNow(), handle!.runNow()]);
  assert.equal(a.picked + b.picked, 0);
  handle!.stop();
});
