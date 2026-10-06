# Vendored `@solana/buffer-layout-utils` backport

This is a repository-local, prebuilt backport of the upstream source at
`solana-foundation/buffer-layout-utils` commit
`60bc3ca2a0a50181db55a9d862fcebeeeeeac543` (PR #2,
<https://github.com/solana-foundation/buffer-layout-utils/pull/2>).

The upstream PR removes `bigint-buffer` from the four integer conversion paths
used by this package. `bigint-buffer@1.1.5` contains the native-addon overflow
tracked as CVE-2025-3194 / GHSA-3gc7-fjrx-p6mg and has no fixed npm release as of
2026-10-02. All other `src/` modules are byte-for-byte equal to the published
`@solana/buffer-layout-utils@0.3.0`; `src/bigint.ts` is the PR implementation.
The published package's generated `lib/` was rebuilt from these sources with
its upstream build toolchain. The package version is intentionally local and
must not be represented as an upstream npm release.

The upstream Apache-2.0 license is retained. The upstream 47-test bigint suite
is kept in `test/` and runs without install scripts via:

```sh
node --test apps/web/vendor/solana-buffer-layout-utils/test/*.test.mjs
```

When an upstream fixed release becomes available, compare its source and API,
remove the local package-manager overrides, and delete this vendored package
(the real path is `game/apps/web/vendor/solana-buffer-layout-utils`; it sits
inside the web project tree so a build that only sees that directory still
resolves the `file:` dependency)
only after both lockfiles and runtime tests confirm that `bigint-buffer` is no
longer installed.
