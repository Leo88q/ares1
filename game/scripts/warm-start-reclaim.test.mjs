import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./warm-start-devnet.sh', import.meta.url), 'utf8');
const reclaimStart = source.indexOf('if [ "$CONFIRM_RECLAIM" = "1" ]; then');
const closeIndex = source.indexOf('solana program close "$BUFFER_ADDRESS"');
assert.notEqual(reclaimStart, -1, 'reclaim confirmation branch must exist');
assert.notEqual(closeIndex, -1, 'explicit buffer close command must exist');
const reclaimToClose = source.slice(reclaimStart, closeIndex);

test('buffer close requires exact sum, address list, TTY phrase, and fresh inventory', () => {
  assert.match(reclaimToClose, /\[ "\$CONFIRM_RECLAIM_GENESIS" != "\$BUFFER_GENESIS_HASH" \]/);
  assert.match(reclaimToClose, /\[ "\$CONFIRM_RECLAIM_SUM" != "\$BUFFERS_SUM" \]/);
  assert.match(reclaimToClose, /\[ "\$CONFIRM_RECLAIM_ADDRESSES" != "\$BUFFERS_ADDRESSES" \]/);
  assert.match(reclaimToClose, /\[ ! -t 0 \]/);
  assert.match(reclaimToClose, /read -r -p/);
  assert.match(reclaimToClose, /INVENTORY_BEFORE_CLOSE="\$BUFFER_INVENTORY_JSON"/);
  assert.match(reclaimToClose, /\[ "\$BUFFER_INVENTORY_JSON" != "\$INVENTORY_BEFORE_CLOSE" \]/);
});

test('bulk --buffers close is not used; only individually confirmed addresses are closed', () => {
  assert.doesNotMatch(source, /solana program close --buffers/);
  assert.match(source, /solana program close "\$BUFFER_ADDRESS"/);
  assert.match(source, /--commitment confirmed/);
});

test('buffer inventory is explicitly confirmed and parser failure stops the run', () => {
  assert.match(source, /solana genesis-hash --url "\$RPC_URL"/);
  assert.match(source, /solana program show --buffers[^\n]+--commitment confirmed --output json/);
  assert.match(source, /node scripts\/buffer-inventory\.mjs "\$ADMIN"/);
  assert.match(source, /if ! fetch_buffer_inventory; then exit 1; fi/);
});

test('reclaim-only execution exits before funding, and remaining buffers block airdrop', () => {
  const reclaimComplete = source.indexOf('Этот запуск завершён после reclaim');
  const fundingStep = source.indexOf('# ── 3) Расчёт NEED_TOTAL');
  const airdropStop = source.indexOf('Airdrop остановлен: сначала вручную проверьте');
  const actualAirdrop = source.indexOf('if solana airdrop 2');

  assert.notEqual(reclaimComplete, -1);
  assert.ok(reclaimComplete < fundingStep);
  assert.match(source.slice(reclaimComplete, fundingStep), /exit 0/);
  assert.notEqual(airdropStop, -1);
  assert.ok(airdropStop < actualAirdrop);
  assert.match(source.slice(airdropStop, actualAirdrop), /exit 1/);
});
