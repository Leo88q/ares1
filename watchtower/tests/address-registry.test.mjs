import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const registry = JSON.parse(read('../address-registry.json'));
const manifest = JSON.parse(read('../integration-manifest.json'));
const idl = JSON.parse(read('../../game/apps/web/src/idl.json'));
const anchor = read('../../game/Anchor.toml');
const rust = read('../../game/programs/solana_potato/src/lib.rs');

// Registry is machine-readable evidence, not a substitute for RPC validation.
test('registry rejects placeholder IDs and agrees with all deployed-program declarations', () => {
  const id = registry.programs.solana_potato;
  assert.match(id, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.deepEqual(manifest.programIds, [id]);
  assert.equal(idl.address, id);
  assert.match(anchor, new RegExp(`solana_potato = "${id}"`, 'g'));
  assert.ok(anchor.match(new RegExp(`solana_potato = "${id}"`, 'g')).length >= 3);
  assert.ok(rust.includes(`declare_id!("${id}")`));
  for (const [name, address] of Object.entries(registry.programs)) {
    if (name !== 'solana_potato') assert.equal(address, null, `${name} must remain unknown until verified`);
  }
  assert.deepEqual(registry.mints, manifest.mintAddresses);
  assert.deepEqual(registry.treasuries, manifest.treasuryAddresses);
  assert.deepEqual(registry.pdas, manifest.pdaAccounts);
  assert.equal(registry.deploymentVerified, manifest.deploymentVerified);
  assert.equal(registry.lastVerifiedAt, manifest.lastVerifiedAt);
  assert.equal(registry.provenance, manifest.addressProvenance);
  assert.equal(registry.upgradeAuthorityMultisig, null);
  assert.equal(registry.timelock, null);
});
