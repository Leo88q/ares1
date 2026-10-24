// F-16: the same layout logic exists in three places (web, backend, landing).
// This test locks them together byte-for-byte so a fix in one copy cannot
// silently drift from the others (the bump/guardian skip bug was exactly that).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { anchorDiscriminator, decodeGameConfig } from '../../apps/backend/src/anchorRaw';
import { decodeConfig as decodeWeb, pdas as webPdas } from '../../apps/web/src/utils/anchorClient';
import { decodeConfig as decodeLanding, pdas as landingPdas } from '../../../landing/utils/anchorClient';
import { configFixture } from './fixtures';

const sizes = [156, 164, 228, 260] as const;

for (const size of sizes) {
  test(`web/backend/landing agree on GameConfig ${size}-byte layout`, () => {
    const b = configFixture(size);
    const backend = decodeGameConfig(b);
    const web = decodeWeb(b);
    const landing = decodeLanding(b);
    for (const [name, value] of Object.entries(web)) {
      const expected = backend[name as keyof typeof backend];
      const actual = landing[name as keyof typeof landing];
      if (value instanceof PublicKey) {
        assert.equal(value.toBase58(), (expected as PublicKey).toBase58(), `web/backend ${name}`);
        assert.equal(value.toBase58(), (actual as PublicKey).toBase58(), `web/landing ${name}`);
      } else {
        assert.equal(value, expected, `web/backend ${name}`);
        assert.equal(value, actual, `web/landing ${name}`);
      }
    }
    // Explicit guards for the historical drift points.
    if (size === 260) {
      assert.notEqual(web.guardian.toBase58(), PublicKey.default.toBase58());
      assert.equal(web.guardian.toBase58(), landing.guardian.toBase58());
      assert.equal(web.guardian.toBase58(), backend.guardian.toBase58());
    } else {
      assert.equal(web.guardian.toBase58(), PublicKey.default.toBase58());
      assert.equal(landing.guardian.toBase58(), PublicKey.default.toBase58());
      assert.equal(backend.guardian.toBase58(), PublicKey.default.toBase58());
    }
    assert.equal(backend.bump, 254);
    assert.equal(web.paused, true);
    assert.equal(landing.paused, true);
    assert.equal(web.lastTotalBurnedMicro, size === 156 ? 0n : 10n);
    assert.equal(landing.lastTotalBurnedMicro, size === 156 ? 0n : 10n);
    // Unsupported sizes must throw everywhere (except legacy reads landing
    // previously accepted silently — now validated).
    if (size === 156) {
      assert.throws(() => decodeWeb(Buffer.alloc(157)));
      assert.throws(() => decodeLanding(Buffer.alloc(157)));
      assert.throws(() => decodeGameConfig(Buffer.alloc(157)));
    }
  });
}

test('web/landing PDA derivations agree', () => {
  const programId = new PublicKey('DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf');
  const w = webPdas(programId);
  const l = landingPdas(programId);
  const buyer = new PublicKey(Buffer.alloc(32, 9));
  const samples: Array<[string, PublicKey, PublicKey]> = [
    ['config', w.config(), l.config()],
    ['epoch', w.epoch(7n), l.epoch(7n)],
    ['field', w.field(3n), l.field(3n)],
    ['order', w.order(5n), l.order(5n)],
    ['escrow', w.escrow(w.order(1n)), l.escrow(w.order(1n))],
    ['seller', w.sellerProfile(buyer), l.sellerProfile(buyer)],
    ['marketStats', w.marketStats(), l.marketStats()],
    ['exportLicense', w.exportLicense(buyer), l.exportLicense(buyer)],
    ['adminState', w.adminState(), l.adminState()],
  ];
  for (const [name, a, b] of samples) {
    assert.equal(a.toBase58(), b.toBase58(), name);
  }
});
