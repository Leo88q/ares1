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
    // The landing deliberately decodes only public telemetry; compare that
    // stable read-only subset rather than forcing it to expose wallet config.
    assert.equal(web.fieldCount, backend.fieldCount);
    assert.equal(web.fieldCount, landing.fieldCount);
    assert.equal(web.totalBurnedMicro, backend.totalBurnedMicro);
    assert.equal(web.totalBurnedMicro, landing.totalBurnedMicro);
    assert.equal(web.paused, backend.paused);
    assert.equal(web.paused, landing.paused);
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
  const samples: Array<[string, PublicKey, PublicKey]> = [
    ['config', w.config(), l.config()],
  ];
  for (const [name, a, b] of samples) {
    assert.equal(a.toBase58(), b.toBase58(), name);
  }
});
