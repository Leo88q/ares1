# Релиз в Solana dApp Store

Официальные доки, на которые опирается этот гайд:
- Сборка и подпись APK: https://docs.solanamobile.com/dapp-store/build-and-sign-an-apk
- Сабмит нового приложения: https://docs.solanamobile.com/dapp-store/submit-new-app

Наш фронтенд — обычный PWA (Vite/React), поэтому используем путь **PWA → Trusted Web Activity (TWA)** через Bubblewrap, а не нативный Android или Expo.

## Что уже подготовлено в репозитории

- `apps/web/public/manifest.json` — web-манифест PWA (имя, иконки, `display: standalone`).
- `apps/web/public/android-chrome-192x192.png`, `android-chrome-512x512.png` — **плейсхолдер-иконки** (сгенерированы автоматически). Замени на настоящий брендинг перед сабмитом — с плейсхолдером модерация Solana Mobile не пройдёт.
- `apps/web/public/.well-known/assetlinks.json` — пустой плейсхолдер, перегенерируется на шаге 3 ниже.
- `apps/web/src/main.tsx` — в список кошельков добавлен `SolanaMobileWalletAdapter` (Mobile Wallet Adapter), чтобы внутри APK подключение шло через Seed Vault / установленные мобильные кошельки, а не через браузерное расширение.
- `scripts/build-apk.sh` — обёртка над Bubblewrap CLI.

## Шаг 1. Задеплой фронтенд на постоянный HTTPS-домен

Bubblewrap и dApp Store требуют реальный публичный URL (не localhost). Собери и захости `apps/web`:

```bash
cd apps/web
npm run build
# задеплой содержимое dist/ на свой хостинг (Vercel, Cloudflare Pages, Netlify, свой сервер и т.д.)
```

Отдельно от Frontend/Backend в приложении (RPC-нода, `VITE_BACKEND_URL`) настрой prod-переменные окружения перед сборкой (`.env.production` на основе `.env.example`).

Проверь, что после деплоя доступны:
- `https://your-domain.com/manifest.json`
- `https://your-domain.com/android-chrome-192x192.png` и `.../512x512.png`

## Шаг 2. Собери и подпиши APK через Bubblewrap

```bash
PWA_URL=https://your-domain.com bash scripts/build-apk.sh
```

Скрипт вызывает `bubblewrap init --manifest <PWA_URL>/manifest.json`, затем `bubblewrap build`. При первом запуске Bubblewrap попросит:
- путь для нового Android keystore (сохрани файл и пароли — без них нельзя будет выпустить обновление);
- package name (например `com.yourstudio.solanapotato`);
- параметры splash screen.

⚠️ Если приложение также будет в Google Play — для dApp Store нужен **отдельный** keystore, ключи нельзя переиспользовать между сторами.

Результат: подписанный `app-release-signed.apk` в `android-twa/`.

## Шаг 3. Подключи Digital Asset Links

Без этого шага APK будет открываться с адресной строкой Chrome вместо полноэкранного вида.

```bash
cd android-twa
keytool -list -v -keystore <твой-keystore>        # скопируй SHA256 fingerprint
bubblewrap fingerprint add <SHA256_fingerprint>
bubblewrap fingerprint generateAssetLinks
```

Скопируй сгенерированный `assetlinks.json` поверх `apps/web/public/.well-known/assetlinks.json` и передеплой фронтенд, чтобы файл стал доступен по адресу:

```
https://your-domain.com/.well-known/assetlinks.json
```

## Шаг 4. Проверь APK

```bash
apksigner verify --print-certs app-release-signed.apk
bubblewrap install app-release-signed.apk   # установка на подключённое устройство/эмулятор
```

Если после установки видна навигационная панель браузера — Digital Asset Links не подключились, вернись к шагу 3.

## Шаг 5. Публикация через Publisher Portal

CLI-паблишинга больше нет — всё через веб: https://publish.solanamobile.com

1. Зарегистрируй publisher-аккаунт, пройди KYC/KYB.
2. Подключи Solana-кошелёк (Phantom/Solflare/Backpack) — это твой *publisher wallet*, храни доступ к нему: он нужен для всех будущих обновлений этого приложения.
3. Пополни его на ~0.2 SOL (комиссии + загрузка на Arweave через ArDrive).
4. Выбери storage provider (рекомендуется ArDrive).
5. "Add a dApp" → "New dApp" → заполни метаданные (название, описание, скриншоты, иконка, категория).
6. Открой созданное приложение → "New Version" → загрузи `app-release-signed.apk`.
7. Подпиши все запрошенные транзакции/сообщения (загрузка ассетов на Arweave + минт release NFT) — если пропустить хоть одну, часть ассетов не попадёт в сабмит.
8. Дождись ревью (обычно 3–5 рабочих дней, ответ приходит на email от `publishersupport@dappstore.solanamobile.com`).

## Важно про архитектуру именно этого приложения

- Фарминг, харвест и маркетплейс полностью on-chain и не зависят от Telegram — в APK они будут работать через любой MWA-совместимый кошелёк.
- Квесты/реварды (`/api/reward/claim` в бэкенде) проверяют `X-Telegram-Init-Data` и требуют реального Telegram-контекста. В standalone APK (вне Telegram) эти кнопки корректно покажут предупреждение и не будут работать — это ожидаемо. Если нужны квесты и вне Telegram, потребуется отдельная схема авторизации на бэкенде (например, подпись сообщения кошельком) — в текущей сборке это не реализовано.
- Перед сабмитом обнови `VITE_RPC_URL`/`VITE_SOLANA_CLUSTER`/`VITE_PROGRAM_ID`/`VITE_BACKEND_URL` в `.env.production` на реальные mainnet-значения — иначе в сторе окажется devnet-сборка.
