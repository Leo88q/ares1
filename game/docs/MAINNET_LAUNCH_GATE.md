# Mainnet launch gate — ARES-1

Чек-лист 31–70: организационные пункты, которые нельзя закрыть кодом
(44, 45, 62–65, 67, 68 и гейты на будущую функциональность).
Статус: **mainnet не запущен, gate не пройден.** Документ — обязательный
проход перед тем, как программа получит реальные средства.

Машино-проверяемая часть автоматизирована: `scripts/preflight-mainnet.sh`
(падает с exit 1 при нарушении) и `scripts/check-invariants.ts` (крон/мониторинг).

---

## G-0. Порядок прохода

```sh
cd game
anchor build                       # reproducible: сравнить sha256 двух сборок
PROGRAM_ID=<id> \
MAINNET_AUTHORITY=<squads-vault> \
MAINNET_TREASURY=<treasury-owner> \
MAINNET_PAYER=<backend-hot-wallet> \
POTATO_MINT=<mint> \
RPC_URL=<mainnet-rpc> \
  ./scripts/preflight-mainnet.sh --expected-so-sha256 <hash-reviewed-build>
```

Скрипт проверяет: программа существует; upgrade authority — ожидаемый мультисиг
и не совпадает с hot-wallet/владельцем казны; артефакт сборки совпадает с
рассмотренным хешем; трипваер защит зелёный. Всё остальное — в этом файле,
под подпись ответственного.

---

## G-1. Рельс выплат (`grant_reward`) — включить только с nonce-PDA

**Сегодня:** рельс собран (`buildGrantRewardIx`), но не подключён ни к одному
эндпоинту; ущерб от угнанного `reward_signer` ограничен 10 % капа эпохи.

**Условие включения** (чек-лист п. 41 — replay выплат):

1. Инструкция `grant_reward_once(nonce: u64, amount_micro: u64)` с аккаунтом
   `reward_claim` = PDA `["reward", recipient_ata, nonce]`, создаваемым через
   `init` → повторная выплата по тому же nonce физически невозможна.
2. Бэкенд хранит одноразовый `nonce` + `expiry` для каждой награды; заявка без
   nonce или с истёкшим expiry отклоняется.
3. `reward_signer` — выделенный ключ, не authority (уже так), лимит на сутки
   ниже квоты 10 % капа.
4. Мониторинг: алерт на любое превышение планового числа грантов за час.

Без пунктов 1–2 эндпоинт наград **не открывать**: это ровно тот класс багов,
на котором Aurory потерял ~600k токенов (гонка/повтор оффчейн-запросов).

---

## G-2. Ключи и права (пп. 44, 63, 64, 65)

| Роль | Требование | Проверка |
|---|---|---|
| Program upgrade authority | Squads-мультисиг, порог **≥ 3 из N**, независимые держатели | `solana program show` + `preflight-mainnet.sh` |
| `GameConfig.authority` | Тот же мультисиг (или отдельный governance-мультисиг) | `check-invariants.ts` + key inventory |
| `guardian` | Отдельный ключ, только `set_paused(true)` | событие `PausedToggled` |
| `reward_signer` | Выделенный low-priv ключ, **не** authority | `assertDedicatedPayer` |
| Epoch payer (hot wallet) | Отдельный кошелёк, баланс ≤ `PAYER_MAX_LAMPORTS` (0.5 SOL), пополнение траншами | старт бэкенда + алерты |
| RPC credentials | Отдельные ключи для браузера и сервера, ограничения по провайдеру | регламент |

- **Ротация:** при увольнении/смене подрядчика ротировать все ключи, которых
  человек касался; дату последней ротации — в приватный key inventory.
- **Хранение:** секреты — в KMS/HSM или аппаратном кошельке; запрещено:
  keypair в CI-артефактах, логах, чатах, бэкапах, образах контейнеров.
- **Разделение:** никто в одиночку не может и предложить, и исполнить вывод
  казны (propose → 30 с → execute + мультисиг).

---

## G-3. Апгрейд программы (пп. 45, 68)

1. `anchor build` дважды → сравнить `sha256sum target/deploy/solana_potato.so`;
   при расхождении сборка не воспроизводима и в прод не идёт. Публиковать
   `solana-verify`/Verified Build для внешней проверки.
2. Перед апгрейдом — прогон миграций **на форке мейннета** с реальными
   «старыми» аккаунтами: `migrate_config` / `migrate_field` / `migrate_epoch` /
   `migrate_admin_state`, затем чтение каждого аккаунта и сверка полей.
   Версия раскладки == размер аккаунта (белый список в `migrations.rs`,
   host-тест `current_layouts_are_the_terminal_entry_of_every_migration_whitelist`).
3. Апгрейд — через Squads (buffer → proposal → подписи → deploy), окно между
   созданием буфера и применением минимально.
4. После апгрейда: `scripts/check-invariants.ts` + интеграционный smoke
   (harvest на тестовом поле, ордер на маркете) + `watchtower` на события.

---

## G-4. Фронтенд и DNS (пп. 50, 67)

Для игрового хоста (`play.ares1.is-a.dev`) выставить те же заголовки, что на
лендинге (`landing/netlify.toml`):

```
Content-Security-Policy: default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  connect-src 'self' https://<rpc-host>; frame-src 'self' https://*.phantom.app https://*.solflare.com;
  object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY (или frame-ancestors 'none' при iframe-кошельках)
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

DNS: DNSSEC включён; 2FA + hardware key на аккаунте регистратора; мониторинг
смены NS/A/AAAA и CT-логов сертификатов; алерт на появление новых сертификатов
для домена. План отката: заранее подготовленный статус-баннер и альтернативный
домен для коммуникации при хайджеке.

---

## G-5. Аудит и тестирование (пп. 52, 54, 58)

- Внешний аудит (OtterSec / Sec3 / Neodyme) — до реальных средств; все
  high/medium закрыты или письменно приняты.
- Fuzzing/property-кампания (Trident) по инструкциям программы — дополняет
  host-property-тесты, добавленные 2026-09-26.
- Закрытая бета 20–50 игроков, 2–3 недели: замер burn/mint, оттока и
  реального `sell_rate`; при расхождении с моделью — подстройка капа/цен.
- Экономическая симуляция прогоняется на каждой правке экономики
  (`yarn test:economy`).

---

## G-6. Мониторинг (пп. 49, 53, 65)

```sh
# крон, каждые 10 минут; exit 1 = инвариант нарушен → алерт
RPC_URL=<mainnet-rpc> PROGRAM_ID=<id> yarn tsx scripts/check-invariants.ts
```

Проверяет: authority минта = config PDA; freeze authority = none; decimals = 6
(POTATO и SKR); `supply ≤ max_supply`; `epoch.minted ≤ epoch.mint_cap`;
казна + квестовый пул ≤ supply.

Дополнительно мониторить:
- падение квестового пула (сибил-сигнал, риск R8);
- баланс hot-wallet (ниже 0.01 SOL — фатал, выше 0.5 SOL — предупреждение);
- события `PausedToggled`, `TreasuryWithdrawn*`, `AuthorityProposed`,
  `SkrMintUpdated` (watchtower + внешние алерты);
- неподтверждённые `roll_epoch` (лестница алертов 3/9/27 уже реализована).

---

## Гейты на будущую функциональность

| Когда появится | Что обязательно сделать |
|---|---|
| NFT-предметы (пп. 46, 47) | Сжечь update authority после финализации коллекции; `revoke` делегата в той же инструкции, что и возврат из стейкинга |
| Таск-маркетплейс / выдача SKR за клипы (п. 59) | Антифрод (частота, similarity между клипами связанных кошельков), proof-of-humanity на клейм, ступенчатые лимиты наград |
| Лидерборды/PvP/турниры (п. 57) | Сервер — единственный источник результата; подпись сервера с nonce; клиент не передаёт итоговый счёт |
| DAO/governance (п. 62) | Veto-совет/multisig поверх голосования, уведомления о предложениях, кворум выше доли инициатора |
| Переход POTATO/SKR на Token-2022 (пп. 38, 39) | Явный whitelist hook-программ; проверка отсутствия Permanent Delegate и Default Frozen; новый mint → `update_skr_mint` с проверкой decimals (уже в коде) |
| Платный RNG с дорогими призами (п. 36) | Switchboard/ORAO VRF вместо slot+SlotHashes |
