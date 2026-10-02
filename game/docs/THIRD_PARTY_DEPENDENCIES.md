# Сторонние зависимости и апстрим-риск — пп. 116, 128, 130

**Прецеденты.** Rain card contract (28.08.2026, ≈$1.1M) — несколько интеграторов
(Avici, Tria) сидели на устаревшей версии общего Solana-контракта; атака была
автоматизирована (первые два вывода с разницей 3 секунды). Liquid Network
(06.09.2026, ≈$320M): исправление влили в ветки Elements 1–3 сентября, но в
теговый релиз оно не попало, ПО функционеров не обновлялось >2 лет — multisig
11-из-15 оказался не при чём. Вывод: **уязвимость в чужом коде — ваш
риск, если вы от него зависите и не следите за релизами.**

## 1. Реестр ончейн-программ и crate-зависимостей

Ончейн-программы, от которых зависит `solana_potato` (пины — в
`txSafety.ts` (клиент) и `Program<'info, …>` (программа)):

| Компонент | Версия/пин | Канал security-объявлений | Кто следит | Частота проверки |
|---|---|---|---|---|
| SPL Token Program (`Tokenkeg…`) | заморожена Solana Labs (апгрейдов нет) | GitHub solana-program/token | владелец репо | раз в квартал |
| Associated Token Program | заморожена | GitHub solana-program/associated-token-account | владелец репо | раз в квартал |
| System Program / BPF Loader | заморожены (мажорные апгрейды — только через фичи Solana) | GitHub anza-xyz/agave releases | владелец репо | при апгрейде солана-агда в CI |
| ComputeBudget Program | заморожена | — | — | — |
| anchor-lang / anchor-spl | `=0.31.2` (точный пин, machine-гейт `test:guards` «П.116») | GitHub coral-xyz/anchor releases + security advisories | владелец репо | перед каждым bump: чтение release notes целиком |
| @solana/web3.js | `1.98.4` точный пин + трипваер запрещённых версий (1.95.6/1.95.7 — supply-chain инцидент) в `security-guards.test.mjs` | GitHub solana-labs/solana-web3.js security advisories | владелец репо | перед bump |
| @solana/spl-token (JS) | `0.4.15` | GitHub solana-program/token | владелец репо | перед bump |
| @solana/buffer-layout-utils | local `0.3.1+ares1` backport, API-compatible with `0.3.0`; lock-pinned through `file:` | upstream PR #2 + local `vendor/solana-buffer-layout-utils/README.vendor.md` | владелец репо | until upstream fixed release |
| Rust toolchain | `rust-toolchain.toml` (1.97.1) | Rust security advisories | владелец репо | раз в квартал |
| protobufjs (транзитивно, через `@trezor/*` в wallet-adapter) | `7.6.6` через `resolutions` в `game/package.json` + трипваер в `security-guards.test.mjs` | GitHub Advisory DB (GHSA-xq3m-2v4x-88gg — RCE, исправлен в 7.5.5; GHSA-wcpc-wj8m-hjx6 ≤7.6.0) | владелец репо | перед bump @trezor/wallet-adapter |

**Почему protobufjs пришлось пинить (2026-10-02).** `@trezor/protobuf` требовал
`protobufjs` ровно `7.4.0`, а `@trezor/connect`/`@trezor/transport` уже приносили
7.5.5 — в дереве жили две версии, и в prod-графе висел **critical** advisory
(arbitrary code execution). `resolutions.protobufjs=7.6.6` схлопывает всё в одну
версию, которая закрывает и critical, и прочие protobufjs-advisory (≤7.6.0).
Проверено: `yarn workspace web build`, тесты web, `backend typecheck`,
`yarn install --frozen-lockfile`. Гейт `game/scripts/audit-blocking.sh` блокирует
high/critical (yarn 1 отдаёт битмаску severity, `--level` её не фильтрует), а
landing использует `npm audit --omit=dev --audit-level=high`.

**GHSA-w5hq-g745-h8pq / Solana RPC transitive dependencies (2026-10-02).**
`@solana/web3.js@1.98.4` просит `jayson@^4.1.1`; Jayson 4 подтягивал старые
`stream-json` и `uuid` ветки. Оба менеджера теперь фиксируют `jayson@5.0.0`;
landing закрепляет browser-client вызов тестом `landing/tests/jayson-compat.test.mjs`.
Для прочих потребителей `uuid@8/9` в Yarn-дереве заданы узкие path resolutions на
`uuid@11.1.1`; `uuid@14.0.2` у `rpc-websockets` остаётся без понижения major.
Проверено: `yarn install --frozen-lockfile`, `yarn why uuid`, game/landing
production builds и `npm audit --omit=dev --audit-level=moderate` (landing —
0 findings). Полный Yarn advisory feed в этой среде недоступен из-за TLS-сброса;
release CI всё равно обязан пройти `audit-blocking.sh`. Перед staging/mainnet
нужен RPC smoke test на целевом кластере — unit-test проверяет browser-client
request/response API, но не заменяет живой Solana RPC.

**CVE-2025-3194 / GHSA-3gc7-fjrx-p6mg (2026-10-02).** `bigint-buffer@1.1.5`
в native `toBigIntLE()` содержит buffer overflow; upstream не выпустил patched
version. Вместо маскировки advisory мы backport'нули pure-JS реализацию из
`solana-foundation/buffer-layout-utils` PR #2 в
`vendor/solana-buffer-layout-utils`, сохранив все остальные исходники API
`@solana/buffer-layout-utils@0.3.0`. Вендор-пакет получает фиксированную версию
`0.3.1+ares1`, сохраняет upstream Apache-2.0 license и 47 upstream-тестов;
оба package manager lockfile разрешают транзитивный запрос через эту локальную
копию. Проверки блокируют возврат `bigint-buffer` в Yarn/npm lockfiles, а CI
запускает 47 тестов и блокирует high/critical advisories. После появления
официального upstream release нужно сравнить API, удалить local path pin и
обновить оба lockfile только после прохождения тех же проверок.

Правила:
1. **Никаких диапазонов версий** в критичных зависимостях; всё через lockfile
   (`yarn.lock`, `Cargo.lock` в git, `npm ci`/`--frozen-lockfile` — гейт «П.66»
   и CI).
2. Перед bump любой зависимости из таблицы — прочитать **все** release notes и
   security-объявления между текущей и новой версией (урок Rain: «у нас просто
   старая версия» не оправдание, а диагноз).
3. Новая сторонняя on-chain программа (например, для будущих фич) — сначала
   запись в `program-inventory.json` + политика её версии (см. «Форки» ниже),
   потом интеграция.

## 2. Форки и общие компоненты

- Если проект форкает чужую программу/движок (сейчас форков нет) — форк
  попадает в этот реестр со своим владельцем апстрима и подпиской на его
  security-коммиты.
- П. 128: **тихий фикс у апстрима** — если в апстриме появляется security-коммит
  вне релиза (как в Liquid Network), это сигнал: патчить у себя немедленно,
  не дожидаясь теговой версии. Проверка: смотреть не только Releases, но и
  коммиты в main/ветках релизов.
- Подписка: watch-режим GitHub на репозитории из таблицы + ежеквартальный
  ручной проход по релизам (запись в этом документе: дата, просмотрено до
  тега X).

| Дата прохода | Репозитории | До какого тега/коммита просмотрено |
|---|---|---|
| 2026-09-28 | anchor 0.31.x, web3.js 1.98.x, spl-token 0.4.x, agave 4.2.x | текущие пины (таблица) |

## 3. Политика security-фиксов у НАС (п. 128, Liquid Network)

1. Уязвимость найдена → **приватная ветка** (или GitHub Security Advisory
   fork) → фикc → внутренний деплой → и только потом публикация коммита.
   Публичный diff до деплоя — готовая инструкция для атакующего (и для
   ИИ-агента атакующего).
2. Публикация пост-мортема — после подтверждения, что все деплои обновлены.
3. Исключение — когда скрытие опаснее раскрытия (данные игроков уже утекли):
   решение принимает владелец репо, фиксируется в пост-мортеме.
4. Крупные операции (вывод казны, смена параметров) и так идут через таймлоки
   программы — «тихий фикс» не отменяет их ручную проверку (гейт G-2).

## 4. ИИ-навыки, плагины, MCP (п. 130, расширение гейтов 71–82)

Состояние проекта: ИИ-агентов с доступом к кошелькам/секретам нет (см.
[аудит 71–82](../docs/SECURITY_CHECKLIST_AUDIT_2026-09-27.md)). Гейт при
появлении любых агентских расширений (skill-реестры, плагины, MCP-серверы):

- «навык» может быть просто набором инструкций без кода — рассматривать как
  код и как промпт одновременно;
- ставить только после чтения исходников; хэш версии фиксировать (по образцу
  `idlSha256` в `watchtower/integration-manifest.json`);
- запуск в песочнице: без сети (кроме явно разрешённых хостов), без доступа к
  домашнему каталогу, без `.env`;
- машина с агентом не содержит keypair и секретов; при подозрении — ротация
  ВСЕХ ключей, к которым был доступ;
- проверки «реестра навыков» (VirusTotal/ClawScan и т.п.) не являются
  аудитом — 5 из ~4000 вредоносных навыков их прошли.
