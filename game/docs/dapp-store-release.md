# Solana dApp Store release — ARES-1

**Current status: not submitted, not approved, and not live in the Store.** This is a release runbook, not proof of acceptance. Do not claim a mainnet game or paid colony experience while the corresponding program and purchase path are not deployed and verified.

## Product approach: complete production game, not a public pilot

- Target the **complete mainnet game** as the first public Store release; do not ship a devnet-only beta, a demo, a training mode, or a reduced feature set as the public product. Localnet/devnet/fork testing is still required as pre-release QA, not a public pilot.
- The app must open into the real game flow. Users can inspect the product before connecting a wallet; before every transaction, show the network, exact asset/amount, account rent and who pays it. Clearly distinguish mainnet-verified state from persistent backend state; do not imply backend actions are on-chain.
- Do not submit a fake/minimal game contract merely to appear Solana-native. The Store submission and the game program are separate release dependencies: Store approval does not prove the game contract, mint, economy, or backend is production-ready.
- Keep the purchase/sale path closed until its own release approval. The agreed 1053 SKR price is not permission to open a sale. A free mainnet write still costs transaction fees and account rent; the release plan must specify bounded sponsorship or user-paid costs and anti-abuse controls.
- A production Store build must use the verified mainnet program/config/mint and production HTTPS origin; no devnet fallback in the submitted APK.

## Store requirements and realistic cost

Solana Mobile's current flow accepts a signed APK. A web app is wrapped in the Solana Mobile WebView shell and submitted through the Publisher Portal. The portal requires a publisher account with KYC/KYB, app metadata, a publisher wallet, and signed publishing transactions. The current guide says to have approximately **0.2 SOL** for transaction fees and ArDrive uploads; this is an estimate, not a guaranteed fixed fee. The portal has a storage estimator and also supports uploading to the publisher's AWS S3 bucket, which avoids an ArDrive balance top-up but does not remove Solana transaction costs. A true zero-cost mainnet submission cannot be promised; use an approved grant/sponsor or defer submission rather than bypassing checks.

Official references:

- [Solana Mobile: submit a new app](https://docs.solanamobile.com/dapp-store/submit-new-app)
- [Solana Mobile: build and sign an APK](https://docs.solanamobile.com/dapp-store/build-and-sign-an-apk)
- [Solana Mobile: webshell CLI](https://docs.solanamobile.com/cli/webshell)
- [Publisher Policy](https://legal.solanamobile.com/publisher-policy-web)

## Current repository readiness

- `apps/web/public/manifest.json` exists. Verify the published name, description and icons before listing; the current artwork/manifest must be reviewed as final branded store assets, not assumed to be acceptable placeholders.
- The current PWA is reachable only after a real HTTPS frontend deployment. No live production origin is confirmed by this repository.
- The web bootstrap now registers MWA through `@solana-mobile/wallet-standard-mobile` **0.5.1** using `registerMwa`. Typecheck and browser tests pass; the Android WebShell connect/signing flow has not yet been verified on a Seeker or supported Android wallet. Keep extension wallets for desktop testing.
- The app has no verified safe starter balance path before the first Field. A Common Field costs 100 POTATO; the devnet SOL airdrop does not solve this token-entry requirement. This blocks the complete production onboarding until a bounded, security-reviewed grant or other approved acquisition path exists; do not label backend credits as on-chain POTATO.
- The app has no verified mainnet ARES-1 program/release path. A production listing is blocked until the mainnet program ID, config, mint, backend authority model, and release artifact are independently confirmed and all mainnet gates pass. The submitted APK must not silently fall back to devnet.
- Do not collect profile/device data without explaining it. Avoid user-generated content in v1; if added, implement moderation/reporting and the required user controls. Add a privacy notice that accurately covers RPC, wallet, analytics and backend data handling.

## Build a signed APK with the current WebShell path

Prerequisites: a publicly reachable HTTPS web origin, JDK 17+, Android SDK, a unique Android application id, and a signing keystore dedicated to this app. Do not commit the keystore or passwords. Preserve the keystore for every update. The dApp Store app must have its own signing key; do not reuse a Google Play signing key.

1. Build and deploy the reviewed web app to its production HTTPS origin. Set `VITE_SOLANA_CLUSTER=mainnet-beta` and only independently verified mainnet program/config/mint/RPC values in the Store build. Test every app route, MWA connect/sign/send, transaction warnings, account-rent payer, backend-persistent colony disclosure, failure/recovery path and external link on a supported Android device. Devnet builds are internal QA artifacts only, never the first public listing.
2. Create the WebShell project once; use the exact same project directory and keystore for subsequent versions:

```bash
cd game
PWA_URL=https://your-verified-domain.example \
ANDROID_APPLICATION_ID=com.yourstudio.ares1 \
KEYSTORE_PATH=/secure/path/ares1-dapp-store.keystore \
KEYSTORE_ALIAS=ares1 \
OUT_DIR=./android-webshell \
bash scripts/build-apk.sh
```

On first run, the script uses the pinned `solana-mobile` CLI from npm, seeds the shell from `/manifest.json`, and prompts for Android version metadata. It asks for signing passwords unless `SOLANA_MOBILE_KEYSTORE_PASSWORD` and (if distinct) `SOLANA_MOBILE_KEY_PASSWORD` are supplied through a protected environment. Never put passwords in command-line arguments, repository files, or chat. `webshell init` creates the keystore if the configured path does not exist; back it up securely before proceeding.

3. Verify the release APK signature and install it on a device/emulator:

```bash
apksigner verify --print-certs android-webshell/app/build/outputs/apk/release/app-release.apk
npx solana-mobile@0.6.0 device install android-webshell/app/build/outputs/apk/release/app-release.apk
```

The WebShell is not a Trusted Web Activity, so Digital Asset Links are not required. For each update, increment Android `versionCode` and use the same signing key. The shell loads the deployed web origin, so web updates can ship independently, but changes affecting native wrapper metadata still require a new APK.

## Submit through the Publisher Portal

1. Complete publisher signup and KYC/KYB; review the current Publisher Policy and Developer Agreement.
2. Connect and preserve the publisher wallet. It will be needed for future releases; estimate exact funding with the portal before signing.
3. Choose a storage provider and inspect its estimate. Use ArDrive or the publisher's own S3 bucket; storage cost is separate from game-account rent.
4. Create the dApp listing with accurate production metadata, screenshots, icon, mainnet disclosures and a clear explanation of which assets/state are on-chain versus backend-persistent.
5. Upload the signed APK, approve only the expected release/upload transactions, and retain signatures and release metadata.
6. Submit for review. Store approval and timing belong to Solana Mobile; do not announce acceptance before it is granted.

## Distinguish the three cost buckets

1. **Store submission:** Publisher/release transactions plus APK/media storage. The current official guide suggests ~0.2 SOL for a first submission, depending on uploads and current fees.
2. **Program deployment/upgrade:** Separate from Store listing. Adding a game contract is not needed just to mint the Store's release metadata. A future colony program upgrade requires build, validator tests, review and a separate deployment budget.
3. **Player/game state:** Solana rent-exempt balances depend on account data length. Query `getMinimumBalanceForRentExemption` for exact sizes at release time; never hardcode an assumed rent rate. Rent deposits are locked while accounts live, not a recurring game subscription. Keep colony state compact (one bounded colony account with packed occupancy/structure records where compute and size tests permit), avoid one PDA/NFT per building or SKU, and offer safe close/reclaim only when no user-owned value/state is silently destroyed.

The read-only estimator `yarn rent:estimate` queries live rent values for a new Field account (70 bytes), a draft compact Colony account, optional buyer ATA, and optional separate Building PDAs. Example: `SOLANA_CLUSTER=devnet SOLANA_RPC_URL=https://api.devnet.solana.com COLONY_ACCOUNT_BYTES=512 yarn rent:estimate`. Set the cluster/RPC and Colony byte count explicitly for the intended release; the default 512-byte Colony size is a planning placeholder, not an implemented layout. It verifies the RPC genesis hash and sends no transactions. No fake accounts, meaningless transactions, hidden user-paid rent, or claims of free mainnet gameplay. If a studio sponsors free mainnet onboarding, disclose that it pays the fee/rent and set strict one-per-wallet and budget limits; sponsorship shifts costs to the studio rather than eliminating them.
