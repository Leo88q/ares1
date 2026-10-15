# Third-party licence inventory

This is the repository's working attribution inventory for bundled fonts, packages and media; it is not a legal opinion or a guarantee that every transitive dependency is listed. A generated public attribution page and other legal pages were removed by an owner decision on 2026-10-06. That is not legal clearance; required notices remain a release gate.

## Rules when adding something

1. **Fonts must be self-hosted.** Install `@fontsource/<family>` and import it from `landing/fonts.ts` or `game/apps/web/src/fonts.ts`. Do not add a CDN `<link>` or CSS `@import` from a font host: it discloses visitor IP addresses before consent. CI fails the build if a font CDN host reappears in source.
2. **Keep vendored upstream CSS local.** `game/apps/web/src/styles/wallet-adapter.css` is a copy of the wallet-adapter stylesheet with its remote `@import` removed; its header documents the sync procedure.
3. **Update this inventory** when a new package, font, image, sound, or other asset ships to users. Keep upstream license texts/notices with vendored code.
4. **Verify asset rights before release.** Music and SFX credits are in `game/apps/web/public/music/CREDITS.txt`; commercial-use rights are **not confirmed** in this repository.

## Working summary

| Category | Recorded licence |
|---|---|
| Inter, Oswald, JetBrains Mono, Anton, Archivo Black, DM Sans | SIL Open Font License 1.1 |
| React, Vite, Tailwind, framer-motion, canvas-confetti, lenis | MIT (per package) |
| lucide-react | ISC |
| `@solana/*`, `@solana/wallet-adapter-*`, `@coral-xyz/anchor` | Apache-2.0 / MIT (per package; check each shipped package) |
| Vendored `@solana/buffer-layout-utils` backport | Apache-2.0; source commit and test provenance: [vendor README](game/apps/web/vendor/solana-buffer-layout-utils/README.vendor.md) |

## 3D colony prototype (added 2026-10-14)

- **Three.js 0.180.0** — MIT; full notice is shipped at `game/apps/web/public/licenses/three.txt`. `@types/three` is a development-only type package. The renderer is lazy-loaded by the 3D field/demo view and the earlier colony route.
- **Quaternius, Ultimate Space Kit** — CC0-1.0; [author's pack page](https://quaternius.com/packs/ultimatespacekit.html). Nine models are bundled, repacked from self-contained glTF to GLB.
- **Kenney, Space Kit** — CC0-1.0; [author's pack page](https://kenney.nl/assets/space-kit). Battery stand-in (originally a generator), astronaut and cargo props.
- **Kenney, Survival Kit** — CC0-1.0; [author's pack page](https://kenney.nl/assets/survival-kit). Hammer and shovel; their CC0 colour-map texture is embedded in each GLB, with its own pinned provenance.

All 14 model files are local under `game/apps/web/public/models/colony/`. The [manifest](game/apps/web/public/models/colony/manifest.json) records pinned GitHub mirror commits/blobs, original author pages, packaging changes, byte sizes and SHA-256 hashes. Unmodified upstream notices are retained in that directory's `licenses/` subdirectory. The mirrored Quaternius `License.txt` misnames the pack as “Ultimate Platformer Pack”; it is preserved verbatim, and the official **Ultimate Space Kit** page separately confirms CC0. Runtime alterations include schematic scale, greenhouse glazing/interior crops and recoloured rocks; these are illustrative art, not engineering CAD. NASA models are research references only, not bundled.

Offline integrity check: `cd game && yarn check:colony-assets`. Optional pinned restoration: `python3 scripts/fetch-colony-assets.py` using the existing GitHub CLI connection. No marketplace/CDN model requests are made by the game.

## Martian field view (added 2026-10-15)

Ten local GLBs under `game/apps/web/public/models/fields/` reuse:

- **Kenney, Nature Kit** — CC0-1.0; [author's page](https://kenney.nl/assets/nature-kit). Five planting-row/soil/foliage models. The original Nature Kit (2.1) notice is kept verbatim.
- **Kenney, Space Kit** — CC0-1.0; canopy and pipe models, with the same original pack notice.
- **Quaternius, Ultimate Space Kit** — CC0-1.0; support, solar and rock models. Original glTF is losslessly repacked; the upstream misnamed notice caveat above still applies.

The [field manifest](game/apps/web/public/models/fields/manifest.json) pins all source commits/blobs, hashes, bytes and notices. Runtime changes: materials (including non-metallic soil/foliage), colour, scale, cutaway/glazing and assembly. Procedural Three.js geometry adds trim, service cabinets, crossbars, lighting and terrain. No bought pack or NASA asset was added. Model files total 125,484 bytes; original notices 1,583 bytes. Three.js uses the existing full MIT notice; no new runtime package was added.

Offline check: `cd game && yarn check:field-assets`. Restore: `python3 scripts/fetch-field-assets.py` with `gh`. The field UI fetches only local model URLs, not author/marketplace hosts.

## Engineering extension (2026-10-15)

The field engineering solver/UI are independently written project code. No code, graphics or data were copied from CDDA, Mindustry, Barotrauma, Terraria/tModLoader, OpenFarm or NASA. Existing CC0 models/Three.js are reused; local CanvasTexture noise supplies microdetail and simple Three.js primitives add SIM hardware. No new runtime library, external texture host or NASA/NFT content was added. The project source licence remains unresolved below.

## Warm-industrial art pass (2026-10-15)

The field model kit is now 18 GLBs. Eight ready-made prefab parts from **Kenney Space Kit** and **Kenney Factory Kit** replace visible custom hardware primitives. Factory Kit is CC0-1.0 ([author page](https://kenney.nl/assets/factory-kit)); the original 3.0 notice is kept at `public/models/fields/licenses/kenney-factory.txt`. Its `colormap.png` is embedded into each dependent GLB with separately pinned blob/hash/size metadata. The updated [field manifest](game/apps/web/public/models/fields/manifest.json) records exact originals, aliases and packaging. This is generic game art, not engineering CAD; source generator/pipe machinery/window machine are respectively power-unit, pump-station and climate-housing visuals.

Five separate fictional art assets were generated for ARES in Arena (environment plate, battery/reservoir/solar icons, blank button), optimized as WebP; one painted surface is a crop of the existing bronze panel. The [art manifest](game/apps/web/public/ares/art/manifest.json) records origin and hashes. These are not NASA images or real terrain, and no institutional endorsement/rights claim is made. Existing plantation/Tuber-9/bronze kit and image icons remain project media, not newly sourced third-party downloads. Original large generation PNGs and temporary Pillow are not shipped. No new runtime package was added. See [art-pass details](docs/WARM_MARS_ART_PASS.md).

## Ship section illustrations (2026-10-15)

Three separate fictional environment plates were generated in Arena for ARES supply, journal and cabin sections. Optimized local WebPs total 225,844 bytes, with origin/dimensions/hash metadata in the [art manifest](game/apps/web/public/ares/art/manifest.json). No NASA material, external image host or new third-party runtime package was added. Existing crate/clipboard/bunk/sprout/license images are reused as navigation keys; market/data code is not replaced by generated imagery. See [section implementation](docs/WARM_MARS_SECTIONS.md).

## Project licence status

No authoritative top-level `LICENSE` file is present in this checkout. The project's own source licence is **unresolved**. Do not infer an MIT grant from old README wording; the owner must choose and publish an authoritative licence before external reuse or commercial release.
