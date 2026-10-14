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
| Quaternius 3D models (Ultimate Space Kit, Ultimate Modular Sci-Fi Pack) in `game/apps/modules-prototype/models/` | CC0-1.0 |

### Prototype models (modules-prototype)

Six GLB models under `game/apps/modules-prototype/models/` come from Quaternius packs
"Ultimate Space Kit" and "Ultimate Modular Sci-Fi Pack" (both CC0-1.0), taken from the
`trebeljahr/quaternius-showcase` mirror (per-pack licences in its `LICENSES.md`).
Retrieved 2026-10-14; inlined into `colony.html` by `scripts/build-models.mjs`.
| `@solana/*`, `@solana/wallet-adapter-*`, `@coral-xyz/anchor` | Apache-2.0 / MIT (per package; check each shipped package) |
| Vendored `@solana/buffer-layout-utils` backport | Apache-2.0; source commit and test provenance: [vendor README](game/apps/web/vendor/solana-buffer-layout-utils/README.vendor.md) |

## Project licence status

No authoritative top-level `LICENSE` file is present in this checkout. The project's own source licence is **unresolved**. Do not infer an MIT grant from old README wording; the owner must choose and publish an authoritative licence before external reuse or commercial release.
