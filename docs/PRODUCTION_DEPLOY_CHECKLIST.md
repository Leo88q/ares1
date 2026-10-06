# Production deploy checklist — audit and remediation

**Date:** 2026-09-28 · **Branch:** `arena/01a0e5d9-ares1`
**Scope:** `landing/` (public site), `game/apps/web` (game client), `game/apps/backend` (read-only API),
`.github/`, `scripts/`, `docs/`.
**Method:** static inspection of the working tree and of all 184 commits fetched from `origin`,
plus two purpose-built scanners (the pinned gitleaks binary cannot be downloaded from this
environment — the GitHub release-asset host `objects.githubusercontent.com` is unreachable, so
`scripts/secret-scan.mjs` / `scripts/secret-scan-history.mjs` reproduce the checklist's own
patterns with zero dependencies).

> **Status legend:** PASS · PARTIAL · FAIL · N/A · **HUMAN** (needs a decision or an action only a
> person can take) · **LAWYER** (needs legal review).

---

## 1. Summary

| Priority | Open | Of which HUMAN/LAWYER |
|---|---|---|
| 🔴 Critical | 3 | 2 |
| 🟠 High | 7 | 5 |
| 🟡 Medium | 6 | 3 |
| 🔵 Low / hygiene | 4 | 1 |
| **Fixed in this pass** | **14** | — |

### The five things to do first

1. **Rotate the Helius RPC key ([S-01]).** A real devnet API key was committed in
   `game/apps/web/.env.production` (commits `55ba9d9`…`87eb954`) and deleted in a later commit.
   The repository is **public**, so the key is disclosed. Rotation comes **before** any history
   rewrite — a rewrite does not invalidate the leaked value.
2. **The repository is public and that is a product decision, not an accident ([S-02]).**
   Everything in it — including the game client economy mirrors and every historical commit — is
   disclosed. Before production, decide what must move to a private repository (server code,
   deploy scripts, key handling) and confirm the deploy publishes only `landing/dist`.
3. **Enable GitHub Secret Scanning + Push Protection and Dependabot alerts ([S-03]).**
   Dependabot alerts are *disabled* on this repository today
   (`gh api repos/Leo88q/ares1/dependabot/alerts` → "Dependabot alerts are disabled").
4. **Turn on branch protection for `main` ([S-04]).** `protected: false` today: anyone with write
   access can push straight to `main`, force-push, or delete history.
5. ~~**Fill in the operator's legal identity ([L-01]).**~~ **Снято решением владельца
   (2026-10-06):** юридический блок выведен из скоупа, юридические документы удалены
   из репозитория (RFC §6). Ниже сохранена фактическая история находки. The new legal pages shipped with 36 visible
   placeholders (`[OPERATOR LEGAL NAME]`, `[REGISTERED ADDRESS]`, governing law, target
   countries). Publishing them unfilled is worse than not publishing them.

---

## 2. Findings

### S — secrets, history and repository exposure (§1, §2)

| ID | Pri | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| **S-01** | 🔴 | `game/apps/web/.env.production` (blob `1e2a72daf49d`, commits `55ba9d9`, `ad3d550`, `17eb435`, `1130dee`, `9cf2940`, `87eb954`) | Real Helius **devnet** RPC API key committed and later deleted. Deletion does not remove it from history, and the repo is public. | 1) Revoke the key in the Helius dashboard and check usage/billing. 2) Issue a new key with browser-side restrictions. 3) Only then consider `git filter-repo`. 4) Add the old value to no allowlist — the history scan must stay red until step 3. | **HUMAN** (rotation). Detection: automated and wired into CI. |
| **S-02** | 🔴 | `gh api repos/Leo88q/ares1` → `visibility: public`, `private: false` | Whole repository + all history public. Game client, economy mirrors, backend code, deploy scripts and CI are all disclosed. | Decide the split. Minimum: move server code, deploy scripts and key handling to a private repository; deploy the site only from `landing/` with `publish = "dist"`. | **HUMAN** |
| **S-03** | 🟠 | Repository settings | Dependabot alerts disabled; Secret Scanning / Push Protection status could not be confirmed from the API (403). | `gh api -X PATCH repos/Leo88q/ares1 -f security_and_analysis[secret_scanning][status]=enabled -f security_and_analysis[secret_scanning_push_protection][status]=enabled -f security_and_analysis[dependabot_security_updates][status]=enabled`. Dependabot *updates* are now configured via `.github/dependabot.yml`; **alerts** are a separate repo setting. | **HUMAN** |
| **S-04** | 🟠 | `gh api repos/Leo88q/ares1/branches/main` → `protected: false` | No branch protection: direct push, force-push and branch deletion are possible. | Require PR + 1 review + `CODEOWNERS` review, block force-push and deletion, require the `CI` and `Secret scanning` checks to pass, enforce for admins. | **HUMAN** (`gh api -X PUT repos/Leo88q/ares1/branches/main/protection …`); `CODEOWNERS` added in this pass. |
| **S-05** | 🟠 | `game/scripts/scan-secrets.sh`, `docs/OPERATIONS.md` | Secret scanning existed, but the gate depended on a binary that cannot be downloaded in every environment. | Added `scripts/secret-scan.mjs` (tree / staged / `--root DIR`) and `scripts/secret-scan-history.mjs` (all objects reachable from `--all`), plus `.secret-scan-allowlist.json` where every entry carries a written reason. Both run in CI. | ✅ Fixed |
| **S-06** | 🟠 | `.gitignore` (root) | Coverage gaps: no `*.p12`, `*.keystore`, `id.json`, `keypair*.json`, `wallet*.json`, `serviceAccount*.json`, `credentials*`, `*.sqlite`, `*.dump`, `*.bak`, `**/keys/`, `.envrc`, `*.env`, build/`.next`/`out`/`coverage`, `*.tfstate`. | Rewritten with all of the above, plus documented exceptions (only `*.example` env files are tracked). Verified: `git ls-files --cached --ignored --exclude-standard` is empty. | ✅ Fixed |
| **S-07** | 🟡 | `.githooks/` | No pre-commit gate: a secret reached the index only if someone remembered to run the scanner. | Added `.githooks/pre-commit` (blocks ignored paths, scans staged content, runs gitleaks if installed) and `scripts/install-git-hooks.sh` (sets `core.hooksPath` locally, refuses to clobber an existing setup). Verified: a planted `api_key = "AAA…"` commit was rejected. | ✅ Fixed |
| **S-08** | 🟡 | Build output | No evidence that `dist/` was ever inspected. A `.env` can be absent from Git and still ship. | Added `scripts/check-release-artifacts.mjs` — fails on source maps, `sourceMappingURL`, `.env*`/key/dump files in `dist/`, `.git`, third-party font/script CDNs, hard-coded loopback URLs; warns on oversized chunks and plain-`http://` URLs. Runs in CI on both builds. | ✅ Fixed (0 failures, 0 warnings today) |
| **S-09** | 🟡 | `game/.dockerignore` | Missing `.git`, docs, tests, `*.md`, workspace `apps/web`. | Rewritten (§2.7) with per-section rationale and a verification recipe. | ✅ Fixed |
| **S-10** | 🟡 | `landing/public/_redirects` (was `netlify.toml`) | SPA catch-all returned `200 + index.html` for *any* path, so `/ .git/HEAD` "looked alive" to a scanner (§2.2). The 404 rules also lived in netlify.toml, which Cloudflare Pages ignores. | Moved to `public/_redirects` (portable across both platforms) and added a real `404.html`. Hard 404s for `.git/*`, `.env*`, `*.map`, lockfiles, `docs/`, `scripts/`, `game/`, `watchtower/` run **before** the catch-all. | ✅ Fixed |
| **S-11** | 🔵 | `landing/vite.config.ts` | `sourcemap` was unset (default `false`, but implicit — an upgrade or a new plugin could flip it). | Explicit `sourcemap: false` in both bundlers + a CI assertion that the setting is present. | ✅ Fixed |
| **S-12** | 🔵 | `game/apps/web/src/main.tsx` | `clusterApiUrl(network)` returns **http://** by default → a production build without `VITE_RPC_URL` sent RPC traffic in plaintext. A `http://127.0.0.1:8899` localnet fallback also shipped in every production bundle. | Forced `https`, moved the fallback behind `import.meta.env.DEV`, and made `VITE_RPC_URL` mandatory in production (fail-fast, matching the existing `VITE_PROGRAM_ID` behaviour). | ✅ Fixed (found by `check-release-artifacts.mjs`) |
| **S-13** | 🟡 | `game/apps/web/src/utils/constants.ts`, `landing/utils/constants.ts` | Client mirrors of the economy (yields, fees, lunar table, presale odds). Not a vulnerability — the program is authoritative — but it **is** published game logic (§2.4). | Accepted. Documented. Мёртвое зеркало `landing/utils/constants.ts` (ни одного импортёра — проверено резолвером 2026-10-06) удалено; `rollPresaleDrop` вместе с ним; guard закрепляет отсутствие файла. | ✅ Fixed (2026-10-06) — остаётся только подтвердить на живом хосте, что клиентского ролла нет |
| **S-14** | 🔵 | `landing/index.html`, `game/apps/web/src/styles/global.css`, `@solana/wallet-adapter-react-ui/styles.css` | Google Fonts loaded from a third-party CDN → visitor IP disclosed before consent (§4.6). The wallet-adapter stylesheet's remote `@import` was the non-obvious one. | All fonts self-hosted from `@fontsource/*`; the upstream wallet-adapter stylesheet is vendored as `src/styles/wallet-adapter.css` with the remote `@import` removed and a sync-on-upgrade procedure in its header. Verified: `grep -r fonts.googleapis dist/` → 0 hits in both builds. | ✅ Fixed |
| **S-15** | 🔵 | README | Declares MIT while `gh repo view` reports no detected licence. MIT permits third parties to reuse and resell the code (§2.11). | Choose deliberately. If the code is closed: replace with "All rights reserved". | **HUMAN** / **LAWYER** |

### W — web application security (§3)

| ID | Pri | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| **W-01** | 🟠 | `game/apps/web` (play.ares1.is-a.dev) | No security headers at all: no CSP, no HSTS, no `X-Frame-Options`, no `Referrer-Policy`, none of the clickjacking protection that matters on transaction-signing screens. | Added `game/apps/web/public/_headers` (Netlify / Cloudflare Pages format) with a strict CSP, HSTS, nosniff, referrer policy, `Permissions-Policy`, COOP/CORP, immutable caching for `/assets/*`. | ✅ Fixed (deploy pending) |
| **W-02** | 🟠 | `landing/netlify.toml` → `landing/public/_headers` | Existing CSP allowed `fonts.googleapis.com` / `fonts.gstatic.com`, HSTS was missing — **and the rules were in netlify.toml while the site is deployed by Cloudflare Pages, which ignores netlify.toml entirely**. The live landing had no security headers at all. | Moved to `public/_headers` (understood by Cloudflare Pages *and* Netlify): font origins removed (self-hosted), HSTS `max-age=31536000; includeSubDomains`, `frame-src 'none'`, `worker-src`, `manifest-src`, `upgrade-insecure-requests`, per-path cache rules. `netlify.toml` now holds build config only. | ✅ Fixed (deploy pending) |
| **W-12** | 🟢 | Deployment platform | Hosting was assumed to be Netlify. The PR checks show **Cloudflare Pages** (`Cloudflare Pages: ares1`, `Cloudflare Pages: ares1-play`). Every platform-specific assumption in the repo (netlify.toml headers and redirects) was therefore dead configuration. | All headers/redirects moved to the portable `_headers` / `_redirects` form. Confirm the Cloudflare Pages project settings (root directory, build command, output directory) really point at `landing` / `npm run build` / `dist` — that was inferred from the netlify.toml, not observed. | ✅ Fixed (code), CF settings остаются к подтверждению | **2026-10-06:** красная сборка `ares1-play` разобрана до причины — Cloudflare Pages не видит файлы выше Root directory, а `aa3351fc` завёл `@solana/buffer-layout-utils` как `file:../vendor/…` (выше `game/`); репро в изоляции дал `Package "" refers to a non-existing file`. Исправлено: вендор-пакет переехал в `game/apps/web/vendor/solana-buffer-layout-utils`, манифест web дублирует `resolutions`/`overrides`, страж запрещает `file:../` выше корня. Сборка `ares1` (landing) всё время была зелёной, потому что её Корень в Пейджес выше `landing/`. Осталось человеку: сверить в дашборде Root/Build/Output для `ares1-play` (ожидаемо `game` / `yarn build:web` / `apps/web/dist`) и для `ares1` (`landing` / `npm run build` / `dist`) — при любом из допустимых Roots код теперь ставится и собирается |
| **W-03** | 🟡 | Both CSPs | `style-src 'unsafe-inline'` remains: framer-motion and the wallet-adapter modal inject styles at runtime. Scripts are `'self'` only, so injected markup still cannot execute. | Accepted and documented in-file. Nonce/hash-based styles are tracked as an improvement, not a blocker. | PARTIAL |
| **W-04** | 🟡 | `scripts/check-headers.sh` run against the live host | The audit environment has no egress to `ares1.is-a.dev` (TLS connect fails), so **no header has been verified against production**. | Run `./scripts/check-headers.sh https://ares1.is-a.dev` and `./scripts/check-public-exposure.sh https://ares1.is-a.dev` from a machine that can reach the host, after deploy. Expect grade A on securityheaders.com. | **HUMAN** |
| **W-05** | 🟡 | `game/apps/web/src/ui/HullSkinMounter.tsx:131` | One `innerHTML` use. Reviewed: the argument is `buildSvg(geo(w,h))` — every interpolated value derives from measured element dimensions, with no user-controlled string. | Accepted, documented. No `dangerouslySetInnerHTML`, `eval`, `new Function`, `document.write` or string-`setTimeout` anywhere in either app. | ✅ Reviewed |
| **W-06** | 🟡 | Backend (`game/apps/backend/src/index.ts`) | No authentication of any kind: the API is read-only and rate-limited, but there is no wallet signature verification because there is no session. Consequence: SIWE/SIWS (§3.5.1–5.5) is **not applicable today** and must be designed before any endpoint mutates state. | Accepted for the current read-only surface. `gameops` routes must be authenticated before they are exposed. | N/A + **HUMAN** before any write endpoint |
| **W-07** | 🟡 | `game/apps/backend/src/index.ts:57` | CORS reflects a comma-separated allowlist; `CORS_ORIGIN=*` is permitted with only a startup warning in production. | Already warns. Hardening: fail to start when `CORS_ORIGIN='*'` and `NODE_ENV=production` and `TRUST_PROXY=false`. | **HUMAN** (small change, needs a decision) |
| **W-08** | 🟢 | `landing` (npm audit) | 15 advisories: 3 high, 6 moderate, 6 low. All three high findings are the `bigint-buffer` → `@solana/buffer-layout-utils` → `@solana/spl-token` chain (GHSA-3gc7-fjrx-p6mg). `bigint-buffer` has **no fixed version** (max published is 1.1.5) and npm's "fix" is a downgrade to `@solana/spl-token@0.1.8`. | Accepted, documented, monitored. Reachability is limited: the vulnerable `toBigIntLE()` path is reached only through decoding fixed-width u64 fields. `npm audit --omit=dev --audit-level=high` runs in CI as advisory. | ACCEPTED RISK — **HUMAN** to re-confirm |
| **W-09** | 🟢 | `game` (yarn) | `yarn audit` cannot run here (the yarn audit endpoint is unreachable; the same limitation is already noted in `ci.yml`). | CI runs `yarn audit --groups dependencies --level high` as advisory. Pinned `@solana/web3.js` 1.98.4/1.99.0 — both after the Dec-2024 compromise of 1.95.6/1.95.7, and the existing `security-guards.test.mjs` tripwire blocks those versions. | PASS (verified by pin, not by audit) |
| **W-10** | 🟢 | `game/package.json` | `resolutions` pins `@solana-mobile/wallet-adapter-mobile` to `2.1.5` while `wallet-adapter-react` requests `^2.2.0`. `yarn install --frozen-lockfile` works; `yarn add` fails to re-resolve. | Reproducible today; the lockfile records both specifiers. Noted so nobody "fixes" it during an incident. | PASS (documented quirk) |
| **W-11** | 🟢 | Backend | Express `x-powered-by` disabled, 16 kb body limit, `trust proxy` env-driven, per-IP rate limit (30 req/min), `safeError()` redacts URLs / keypair arrays / credential assignments from diagnostics. | No change needed. | PASS |

### C — cookies and local storage (§4)

| ID | Pri | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| **C-01** | 🟠 | Both apps | 12 `localStorage`/`sessionStorage` keys written with no consent gate and no way to withdraw (§4.1–4.3). No cookie policy, no record of a decision. | Added a consent module (`consent.ts`) with four categories, nothing pre-ticked except `necessary`, a reject button of equal weight, `?cookie-settings=1` / `window.ARES1_CONSENT.open()` to reopen from anywhere, a versioned decision record, 12-month re-ask, and GPC honoured. Every storage write in both apps now goes through `getItem/setItem/removeItem(category, key)`; withdrawal erases the category's keys immediately. | ✅ Fixed |
| **C-02** | 🟡 | `landing/Gamification.tsx` | Was `sessionStorage`; now routed through the consent wrapper, which is `localStorage`-backed. Semantics changed slightly (progress survives a tab close). | Intentional and documented in the Cookie Policy table. | ✅ Accepted |
| **C-03** | 🟢 | Analytics | No analytics, tag manager, pixel, chat widget or advertising SDK anywhere in either app. | Nothing to gate today. The `analytics`/`marketing` categories exist and `onGranted()` is the only supported way to load one later. | PASS |
| **C-04** | 🟢 | Cookies | Zero HTTP cookies are set by either app. | Documented on `/legal/cookies.html`. | PASS |

### L — legal pages, privacy and documents (§5, §7)

| ID | Pri | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| **L-01** | 🔴 | `landing/public/legal/*.html` | Six documents created (privacy, terms, cookies, risk, licences, takedown) in RU + EN, but the operator's identity, address, governing law, supervisory authority, DPO/EU representative and target-country list are **placeholders** (36 markers; `legal.js` renders a "draft — not cleared for launch" banner while any remain). | Fill in every `span.todo` field, or generate them from a single source (`scripts/build-legal-pages.mjs`). | **HUMAN** + **LAWYER** |
| **L-02** | 🟠 | `landing` | No legal documents were reachable from the site at all. | Footer linked all six documents plus a "Cookie settings" button and the operator contact. | ⚪ N/A — документы удалены из репозитория решением владельца (RFC §6); «Cookie settings» в футере остались |
| **L-03** | 🟡 | `game/apps/web` | No `robots.txt`, no `security.txt`, no legal links in the client (a dApp that asks for a signature must link its terms). | `robots.txt` + `/.well-known/security.txt` added to the client. Legal links inside the client are **not** added — pending a decision on where the dApp's footer lives. | PARTIAL — **HUMAN** |
| **L-04** | 🟡 | Data map | No documented inventory of processors, retention or transfer mechanism. | The first data map lived in `/legal/privacy.html`. | ⚪ N/A — страница удалена (RFC §6); карта данных не публикуется |
| **L-05** | 🟡 | DSAR | No channel or procedure for access/erasure requests, and no verified-export tooling. | Policy declares email + wallet-signature verification and a one-month SLA. The **technical** export/delete path does not exist yet. | **HUMAN** (engineering) + **LAWYER** |
| **L-06** | 🟡 | §6 (crypto-specific legal risk) | Tokens with market value, a paid presale with a **randomly rolled tier**, and referral bonuses exist. Whether that is a security, e-money, MiCA-regulated asset or gambling depends on jurisdiction. | Facts recorded here; assessment is not ours to make. | **LAWYER** |
| **L-07** | 🟢 | Third-party attribution | No licence/ attribution page. | `THIRD_PARTY_LICENSES.md` in the repository lists fonts (SIL OFL 1.1) and the main bundled packages; the generated site page was removed with the rest of the legal documents (RFC §6). Music rights are flagged as unverified. | ✅ Fixed in-repo (music rights: **HUMAN**) |

### Q — quality and operability (§8)

| ID | Pri | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| **Q-01** | 🟠 | CI | The landing had **no CI job**: a broken build or a failed i18n-parity test surfaced only at deploy time. | Added a `landing` job (typecheck, tests, build, advisory audit) and a `release-artifacts` job (builds both apps, runs the artifact gate and a bundle secret scan). | ✅ Fixed |
| **Q-02** | 🟢 | Builds | `landing`: typecheck ✅, 2/2 tests ✅, build ✅. `game`: typecheck ✅, 89/89 offchain tests ✅, web build ✅. | — | PASS |
| **Q-03** | 🟡 | Bundle size | Landing JS is 1.13 MB raw / 364 kB gzip in a single chunk — over Vite's 500 kB warning. | Flagged by `check-release-artifacts.mjs`. Code-splitting is not in scope for this pass. | **HUMAN** (performance) |
| **Q-04** | 🟡 | Lighthouse / CWV, uptime, 404/500 pages, cross-browser wallet checks | Not measurable from this environment (no browser, no egress to the live host). | Run Lighthouse and a real device pass after deploy. | **HUMAN** |
| **Q-05** | 🟢 | `landing/public/legal/*` | Generated output could silently drift from its source. | `scripts/build-legal-pages.mjs --check` in CI failed if a page was stale. | ⚪ N/A — генератор и страницы удалены (RFC §6), дрейфовать нечему |

---

## 3. Verify manually — nobody can do this from the repository

| Area | What to check | Command / place |
|---|---|---|
| GitHub → Settings | Secret scanning **and** push protection enabled; Dependabot **alerts** enabled; private vulnerability reporting on | `gh api -X PATCH repos/Leo88q/ares1 -f security_and_analysis[secret_scanning][status]=enabled -f security_and_analysis[secret_scanning_push_protection][status]=enabled -f security_and_analysis[dependabot_security_updates][status]=enabled` |
| GitHub → Branches | `main` protected: PR required, ≥1 review, CODEOWNERS review, force-push and deletion blocked, `CI` + `Secret scanning` required, enforced for admins | `gh api -X PUT repos/Leo88q/ares1/branches/main/protection -f required_status_checks[strict]=true …` |
| GitHub → Collaborators | Minimum necessary permissions; 2FA enforced for the org/owner | Settings → Collaborators / org security |
| Deploy platform | The site is built by **Cloudflare Pages** (projects `ares1` and `ares1-play`), not Netlify. Confirm root directory `landing`, build `npm run build`, output `dist` — **not** the repository root | Cloudflare → Workers & Pages → `<project>` → Settings → Builds & deployments |
| Deploy platform | Builds survive whatever Root directory is set: no `file:` dependency above the project root (2026-10-06 — именно это валило `ares1-play`), verified by isolation for Root = repo root / `game` / `game/apps/web` | `yarn test:guards` (в репо) |
| Deploy platform | Landing proxy is really deployed. Cloudflare компилирует Functions только из `<Root>/functions/`, а Root проекта `ares1` — **корень репозитория**: его сборка ставит landing-зависимость `file:../game/apps/web/vendor`, невидимую при Root=`landing/` (та же причина, по которой `ares1-play` падал 2026-10-02). Поэтому маршрут лежит в `functions/api/[[path]].js` в корне репо, и `curl -s https://ares1-7e1.pages.dev/api/presale/runs/wave1` не должен отдавать HTML-404 приложения — ожидаемо `503 presale_api_not_configured` (без `PRESALE_API_ORIGIN`), `502` при недоступном бэкенде или JSON тиража | `curl -s -D- https://ares1-7e1.pages.dev/api/presale/runs/wave1` |
| DNS / registrar | **Кастомные домены не выдаются DNS (обнаружено 2026-10-06).** `dig`/DoH: у `ares1.is-a.dev` и `play.ares1.is-a.dev` нет CNAME (пустой Answer, только SOA is-a.dev); файл `domains/ares1.json` в реестре `is-a-dev/register` отсутствует, а `is-a.dev/available?d=ares1` предлагает имя как свободное. Работают только `ares1-7e1.pages.dev` (лендинг) и `ares1-play.pages.dev` (игра). Пока домены не восстановлены, канонические URL/`security.txt`/скрипты проверок указывают в никуда | Регистрация заново: PR в `is-a-dev/register` с `domains/ares1.json` (`owner` {`username`, `email`}, `records` {`CNAME`: `<project>.pages.dev`}, `subdomain: play` для игры) |
| Deploy platform | Header rules actually applied after deploy | `./scripts/check-headers.sh https://ares1.is-a.dev` |
| Deploy platform | Nothing sensitive is served (compare content, not status) | `./scripts/check-public-exposure.sh https://ares1.is-a.dev` |
| DNS / registrar | Registrar lock, DNSSEC, CAA records, 2FA on DNS and CDN accounts, no dangling CNAMEs (subdomain takeover) | Registrar + DNS console; `dig +dnssec ares1.is-a.dev` |
| TLS | TLS 1.2+ only, current ciphers, certificate auto-renewal, grade A or better | SSL Labs; `testssl.sh https://ares1.is-a.dev` |
| Wallets / custody | Program upgrade authority and `GameConfig.authority` under multisig (Squads ≥ 3-of-N); hot wallet capped; no admin key on the web server | `solana program show <PROGRAM_ID> --url mainnet-beta`; see `game/docs/MAINNET_LAUNCH_GATE.md` |
| Backups | Encrypted, off-host, restoration actually rehearsed | `game/docs/DB_RUNBOOK.md` |
| Monitoring / alerting | Uptime check, error tracking, payer-balance and epoch-staleness alerts | `game/docs/OPERATIONS.md` |
| ~~Legal~~ | ~~Operator identity filled in on every legal page~~ — юридический блок снят с скоупа решением владельца (RFC §6) | — |
| Music / art rights | Every track and image in `/music`, `/sfx`, `/ares` is licensed for commercial use | `landing/public/music/CREDITS.txt` |
| Accessibility | WCAG 2.1 AA pass; confirm whether the European Accessibility Act applies | Manual + Lighthouse |

---

## 4. For the lawyer

Brought forward from §5–§7 with the current state of the site:

1. **Jurisdictions.** Not decided. The site ships RU/EN plus es-419, pt-BR, id, tl and vi, so
   GDPR/UK GDPR, CCPA/CPRA and 152-ФЗ are all plausibly in scope. Record the real audience list —
   every other obligation follows from it. (Юрдокументы удалены решением владельца, RFC §6.)
2. ~~**Operator identity.**~~ Снято решением владельца (RFC §6). Legal name, registered address, contact, governing law, supervisory
   authority, DPO or EU representative: all placeholders.
3. **Wallet address = personal data.** The code treats the Solana address as an identifier tied to
   gameplay, IP and referral data. The policy says so. Confirm that the "pseudonymous on-chain
   data" framing is acceptable.
4. **Nothing personal on-chain.** Verified by inspection: only addresses and game actions reach the
   ledger. The policy states that erasure cannot remove on-chain data. Confirm the wording.
5. **Randomised paid reward.** The presale rolls a tier (COMMON 70 / RARE 25 / EPIC 5). If the roll
   happens on-chain, record that; if any part is client-side, fix it first. Random reward for
   consideration is regulated as gambling in several jurisdictions (§6.2).
6. **Tokens with market value, staking-like mechanics, referral bonuses** → possible security,
   e-money or MiCA classification (§6.1).
7. **Marketing copy.** No guaranteed-return claims were found in the current content; the
   disclaimer on the landing says $POTATO is not a security or investment advice. Confirm every
   channel, and require disclosure on influencer posts (§6.4).
8. **KYC/AML and geo-blocking.** No sanctions screening, no geo-blocking and no age gate in code
   (§6.3). Decide whether any is required.
9. **DSAR and breach procedure.** The policy promises a one-month SLA and 72-hour notification.
   Neither the tooling nor the runbook exists yet (L-05).
10. **Licence.** README declares MIT while GitHub detects none (S-15). Choose deliberately.

---

## 5. Rotation list — what to replace

| Credential | Why | Owner | Done |
|---|---|---|---|
| Helius devnet RPC key | Committed in history, repository public (**S-01**) | operator | ☐ |
| Any other RPC key created from the same dashboard before this review | Same exposure window, usage unseen | operator | ☐ |
| Deploy/API keys stored on the current host | Public repository implies infrastructure details are known | operator | ☐ |
| Domain registrar, DNS, CDN, hosting account passwords | Assume disclosed if they were ever pasted into a chat or issue | operator | ☐ |
| `GameConfig.authority` and program upgrade authority | Single key today; move to Squads ≥ 3-of-N before real funds | operator | ☐ |
| `security@ares1.is-a.dev` mailbox | Must exist before `security.txt` is published (`/legal/*` больше нет — RFC §6) | operator | ☐ |

**Order of operations for S-01:** revoke → issue a restricted replacement → redeploy → confirm the
old key is rejected → *then* consider history rewriting, and only as a coordinated operation
(force-push invalidates every clone).

---

## 6. What was changed in this pass

**New tooling**
- `scripts/secret-scan.mjs` — dependency-free secret scanner (tree, staged via `--stdin`,
  `--root DIR`, `--json`); covers the checklist's §1.1.3 patterns.
- `scripts/secret-scan-history.mjs` — same rules across every object reachable from `--all`.
- `.secret-scan-allowlist.json` — every entry carries a written reason; no credential-shaped
  literals are allowed inside it.
- `scripts/check-release-artifacts.mjs` — build-output gate (§1.3.5, §2.2, §2.3, §2.5, §4.6).
- `scripts/check-public-exposure.sh`, `scripts/check-headers.sh` — passive checks against a live
  deployment (§2.2, §9).
- `.githooks/pre-commit` + `scripts/install-git-hooks.sh` — local gate (§1.3.6).

**Configuration**
- `.gitignore` rewritten (§1.3.1). `game/.dockerignore` rewritten (§2.7).
- `game/apps/web/public/_headers` created (§3.1, §3.2).
- Landing headers and redirects moved out of `landing/netlify.toml` into
  `landing/public/_headers` and `landing/public/_redirects`: the site is deployed by
  Cloudflare Pages, which ignores netlify.toml, so the previous rules never applied
  (§2.2, §3.1, §3.2). `landing/public/404.html` added (§8.3).
- `.github/dependabot.yml` created (§3.8.5). `.github/CODEOWNERS` created (§2.10).
- CI: `secret-scan-node` and `deploy-readiness` jobs in `security.yml`; `landing` and
  `release-artifacts` jobs in `ci.yml`.

**Application code**
- Self-hosted fonts (`landing/fonts.ts`, `game/apps/web/src/fonts.ts`); Google Fonts links removed;
  wallet-adapter stylesheet vendored without its remote `@import` (§4.6).
- Consent module and UI in both apps; every storage call site routed through it (§4.3).
- `VITE_RPC_URL` now mandatory in production; RPC forced to HTTPS; localnet fallback dev-only
  (§3.1.1).
- Landing footer: cookie settings and operator contact (legal documents removed, RFC §6).
- i18n: three new strings added to all six landing locales so the parity test stays green.

**Documents**
- This report. Юрдокументы (`landing/public/legal/`) — удалены из репозитория (RFC §6), восстанавлимы из истории
  (RU + EN, versioned, with visible placeholders).

---

## 7. Re-audit plan

| Cadence | What runs |
|---|---|
| Every commit / PR | `Secret scanning` workflow (gitleaks + `secret-scan.mjs`), pre-commit hook, CI (typecheck, tests, builds, artifact gate, dependency audit advisory) |
| Every release | `./scripts/check-release-artifacts.mjs` on the exact build; `./scripts/check-headers.sh` and `./scripts/check-public-exposure.sh` against the deployed URL; `node scripts/secret-scan.mjs --root <dist>` |
| Monthly | Dependabot PRs reviewed and merged; `npm audit` / `yarn audit --level high` triaged; Dependabot alerts cleared |
| Quarterly | Full audit against this checklist: `node scripts/secret-scan-history.mjs` (requires `git fetch --unshallow`), key rotation review, restore rehearsal, Lighthouse |
| Before real funds | Independent smart-contract audit, penetration test of the site, legal opinion per jurisdiction, multisig custody in place (`game/docs/MAINNET_LAUNCH_GATE.md`) |

---

## 8. Limitations of this audit

- The pinned gitleaks binary could not be executed here; the Node scanners reproduce the
  checklist's named patterns but do **not** do entropy analysis, so a high-entropy secret matching
  no named rule would be missed. Run `./game/scripts/scan-secrets.sh tree|history` wherever the
  binary is available.
- No browser was available: no Lighthouse, no console-error check, no wallet-connection pass, no
  visual verification of the consent banner.
- No egress to `ares1.is-a.dev` from this environment: **nothing about the live deployment has been
  verified**, including whether the new headers are live.
- No Rust toolchain: the on-chain program was not audited. See `reports/ares1-audit.md`.
- Юридические документы удалены из репозитория решением владельца (RFC §6).
