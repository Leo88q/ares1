// Public API stays closed until a reviewed launch explicitly enables it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { onRequest } = await import(
  new URL('../../functions/api/[[path]].js', import.meta.url).href
);
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function request(method, path) {
  return new Request(`https://ares1.example${path}`, { method });
}

test('the public API route is declared once at repository root', () => {
  assert.equal(existsSync(`${repoRoot}/functions/api/[[path]].js`), true);
  assert.equal(existsSync(`${repoRoot}/landing/functions`), false);
});

test('sale status and reservation endpoints are closed even when an API origin is configured', async () => {
  for (const [method, path] of [
    ['GET', '/api/presale/packs'],
    ['GET', '/api/presale/runs/wave1'],
    ['POST', '/api/presale/runs/wave1/reserve'],
    ['POST', '/api/presale/runs/wave1/orders/1/payment'],
  ]) {
    const response = await onRequest({
      request: request(method, path),
      env: { PRESALE_API_ORIGIN: 'https://presale.example' },
    });
    assert.equal(response.status, 410, `${method} ${path} must remain closed`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      error: 'presale_closed',
      message: 'Public presale endpoints are disabled until an approved launch.',
    });
  }
});

test('all proxy requests stay fail-closed without a source-level launch approval', async () => {
  const response = await onRequest({ request: request('GET', '/api/unknown'), env: {} });
  assert.equal(response.status, 410);
  assert.equal((await response.json()).error, 'presale_closed');
});

test('landing chain client exposes read-only telemetry and no purchase transaction builders', () => {
  const client = readFileSync(`${repoRoot}/landing/utils/anchorClient.ts`, 'utf8');
  const liveChain = readFileSync(`${repoRoot}/landing/hooks/useLiveChain.ts`, 'utf8');
  assert.match(client, /Read-only helpers for public devnet telemetry/);
  assert.doesNotMatch(client, /TransactionInstruction|SystemProgram|TOKEN_PROGRAM_ID|SKR_MINT|presaleStatePda|treasurySkrAta|\bix[A-Z]\w*/);
  assert.doesNotMatch(liveChain, /sendTransaction|signTransaction|wallet\.adapter|ixBuy|ixCreate/);
});
