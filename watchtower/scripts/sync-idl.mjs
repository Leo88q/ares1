#!/usr/bin/env node
/**
 * Re-syncs the packaged watchtower IDL artifact with the compiled game IDL.
 *
 * Run AFTER `anchor build` has replaced `game/apps/web/src/idl.json`:
 *
 *   node watchtower/scripts/sync-idl.mjs
 *
 * It rewrites:
 *   - events/ares1-idl.json          (address/metadata/sourceIdlSha256/events/
 *                                     filtered types/instructionDiscriminators)
 *   - integration-manifest.json      (idlSha256)
 *
 * and fails loudly if `events/ares1-event-map.json` no longer covers exactly the
 * IDL event set (the decoder test asserts name-set equality; the map is curated
 * by hand because each entry carries normalization semantics).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.resolve(root, '../game/apps/web/src/idl.json');

const raw = readFileSync(sourcePath);
const full = JSON.parse(raw.toString('utf8'));
const sha256 = createHash('sha256').update(raw).digest('hex');

const eventNames = full.events.map((e) => e.name);
const artifact = {
  address: full.address,
  metadata: full.metadata,
  sourceIdlSha256: sha256,
  events: full.events,
  types: full.types.filter((t) => eventNames.includes(t.name)),
  instructionDiscriminators: Object.fromEntries(
    full.instructions.map((i) => [i.name, i.discriminator]),
  ),
};

const eventMapPath = path.join(root, 'events/ares1-event-map.json');
const eventMap = JSON.parse(readFileSync(eventMapPath, 'utf8'));
const mapNames = eventMap.map((e) => e.on_chain_event).sort();
const idlNames = [...eventNames].sort();
const missing = idlNames.filter((n) => !mapNames.includes(n));
const extra = mapNames.filter((n) => !idlNames.includes(n));
if (missing.length || extra.length) {
  console.error(
    `events/ares1-event-map.json is out of sync with the IDL.\n` +
    `  missing from map: ${missing.join(', ') || '—'}\n` +
    `  extra in map:     ${extra.join(', ') || '—'}\n` +
    `Curate the map first (it carries normalization semantics), then re-run.`,
  );
  process.exit(1);
}

writeFileSync(path.join(root, 'events/ares1-idl.json'), JSON.stringify(artifact, null, 2) + '\n');

const manifestPath = path.join(root, 'integration-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.idlSha256 = sha256;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(
  `Synced watchtower IDL artifacts with ${path.relative(root, sourcePath)}\n` +
  `  sha256:        ${sha256}\n` +
  `  events:        ${eventNames.length}\n` +
  `  instructions:  ${full.instructions.length}\n` +
  `Run \`yarn test\` to re-validate the decoder against the new artifact.`,
);
