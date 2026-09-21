# Стабилизация ARES-1 — 21.09.2026

## Статус и границы

Работа ведётся в `arena/01a0c0d9-ares1`. **Это не разрешение на mainnet или реальные
средства.** В публичную сеть контракт не деплоился, миграции не выполнялись,
полномочия не передавались, ключи не отзывались, история Git не переписывалась.

В CI `35545805957` для `5ffdc0b` прошли Rust unit tests, SBF-сборка, интеграционный
localnet, миграционные fixtures, web/backend и Docker. Единственное падение —
проверка устаревшего клиентского IDL. Настоящий IDL из этой сборки получен, проверен
по SHA-256 и синхронизирован; локальное полное сравнение ABI теперь проходит.
**Контрольный CI прошёл полностью**: [35547357011](https://github.com/Leo88q/ares1/actions/runs/35547357011),
проверенный commit `ed3fc2f9e002cb0a0baafa644374e237202273c2`. В нём одновременно
прошли web/backend, 49 off-chain тестов, Rust units, SBF, Anchor integration,
оба набора legacy migration fixtures, полный IDL gate и Docker build.
[Secret scanning 35547357047](https://github.com/Leo88q/ares1/actions/runs/35547357047)
также прошёл для текущих файлов и новых коммитов; полный исторический аудит в этом
запуске не выполнялся. После CI повторно скачан и сверен generated IDL именно `ed3fc2f`.
Эта проверка предшествует последующему изменению цены регистрации реферера до 5 POTATO;
её результат не выдаётся за проверку нового бинарника.

## Проверка цены регистрации реферера — 5 POTATO

По явному уточнению владельца стоимость регистрации изменена с 50 на **5 POTATO**.
Проверенный commit: `095c2f4cb46368f3f5c0a04f140a9096578865c1`.
[Полный CI 35548308795](https://github.com/Leo88q/ares1/actions/runs/35548308795)
прошёл: **50 off-chain тестов**, web/backend, Rust units, SBF, интеграционные тесты,
legacy migration fixtures, полное сравнение IDL и Docker. Source/new-commit scan
`35548308797` также прошёл; историческая утечка этим не считается устранённой.

On-chain тесты подтвердили списание и уменьшение supply ровно на 5 POTATO,
атомарный отказ при балансе 4.999999, успешную регистрацию с ровно 5 и отсутствие
повторного списания при self-referral/повторной регистрации. Лицензия 500 SKR,
пресейл 1053 SKR и ставки рыночных реферальных выплат не менялись.
Изменение проверено на disposable localnet, **не развернуто в публичной сети**.

## Сверка frontend upkeep с контрактом

- `taxCostMicro(level, type)` и `repairCostMicro(level, type)` теперь учитывают
  уровень и редкость, как существующие Rust handlers. Контракт/IDL не изменялись.
- Ремонт: `scaled(15 POTATO, type) × max(floor(level / 3), 1)`.
  Налог за 7 дней: `scaled(6 POTATO, type) × floor((level + 1) / 2)`.
  В расчёте налога используется фактическое целочисленное деление Rust, а не
  старый комментарий с дробными множителями. Например, Rare L10: 30 POTATO,
  Rare L50: 150 POTATO; ремонт Rare L50: 240 POTATO.
- Preflight перед wallet transaction использует те же функции, что обе карточки.
  В активной `FieldCardVice` добавлены цены четырёх действий в POTATO; доступность
  кнопок и длительности услуг не менялись. Common L1 tax отображается как 2.4,
  а не округляется до 2; предупреждение сохраняет разницу 2.399999 / 2.4.
- Новый formatter выводит до 6 десятичных знаков без округления; BigInt-вход
  форматируется без преобразования в Number. Краткое отображение урожая не менялось.
- Локально **58/58 off-chain tests PASS**, web/backend/tools typechecks, обе сборки,
  source contract check (40 инструкций) и `git diff --check` прошли.
  `upkeepCosts.test.ts` проверяет все 50 уровней × 3 редкости для обеих услуг,
  переходы множителей, форматирование, source-wiring карточек и preflight.
  Это unit/source-guards, **не исполнение нового UI с реальным кошельком**.
- Контрольный [CI 35551306128](https://github.com/Leo88q/ares1/actions/runs/35551306128)
  **PASS** для `38986dfdc82dd78d16f43e51b3cd867f65c423a3`: web/backend,
  Docker, Rust units/SBF, localnet integration, legacy migrations и полный IDL gate.
  [Secret scanning 35551306109](https://github.com/Leo88q/ares1/actions/runs/35551306109)
  также **PASS** для той же ревизии; отзыв исторического RPC-ключа не подтверждён.

## Согласованные правила оплаты

- Лицензия: **500 SKR**; пресейл `buy_field_skr`: **1053 SKR**.
- Последующее уточнение владельца: регистрация реферера — **5 POTATO**, разовый burn.
- Обычная покупка полей, налог, ремонт, улучшения, удобрения и регистрация реферера:
  исходные платежи/сжигание **POTATO** с существующими ценами и множителями.
- Ошибочная общая замена игровых расходов на SKR отменена коммитом `5ffdc0b`.
  Исходный набор `tests/solana_potato.ts` восстановлен. Проверки
  `economyRules.test.ts` защищают это разделение от повторной случайной замены.
- Рынок оставлен в исходной реализации SOL/POTATO. Это описание текущего кода,
  а не согласование нового способа расчётов. Старый SOL-пресейл также остаётся
  в ABI; решение о его отключении отдельно не принималось.
- Эмиссия, fee rates, распределение казны и административные полномочия не меняются
  при синхронизации IDL/исправлении клиентских аккаунтов.

## Что исправлено

### Сборка и CI

- Зафиксированы Node 22.22.3, Yarn 1.22.22, Rust 1.97.1, Anchor 0.31.2 и Solana 4.2.2.
  JS Anchor 0.30.1 сохранён намеренно; совместимость проверяется тестами.
- Удалены неиспользуемые конфликтующие experimental SDK/feature, не реализующие
  реальные CPI. `Cargo.lock` не менялся: SHA-256
  `0d14dd5afc4fd02d7afad2d42d235ba4f2a46d8df0fbecf3888c05758d9abaf4`.
- Сборка проверяет lockfile до/после Anchor; CI не пишет логи в Git и не получает
  production keys. Ошибки выводятся ограниченными, редактированными annotations.
- Anchor-тесты запускаются в отдельной группе процессов с таймаутом и cleanup
  собственного валидатора, включая ошибочное завершение.
- Миграционный harness использует отдельные порты, конечное HTTP-подтверждение
  транзакций и уникальные сообщения для реального повторного выполнения миграций.
  Нет бесконечного websocket reconnect после остановки тестового валидатора.

### Контракт и миграции

- Исправлены сериализация `batch_harvest`, writable-проверки и возврат rent при
  `close_field`. Эти исправления подтверждены интеграционным CI.
- Миграции Config 156/164→228, Field 69→70 и Epoch 41→49 проверяют владельца,
  discriminator, точный размер, authority и поддерживаемые PDA.
- Authority оплачивает только недостающую rent целевого аккаунта. Текущие данные
  сохраняются при повторе, включая SKR/reward signer, burn snapshot и mutation.
- Реальные localnet fixtures проверяют успешные переходы, rent, повторные вызовы
  и отказы для неверных полномочий/владельцев/типов/PDA. См. [MIGRATIONS.md](MIGRATIONS.md).
- Миграционный CLI по умолчанию read-only; исполнение требует явных RPC, program ID,
  genesis hash и приватного пути к admin key. Устаревший небезопасный скрипт отключён.

### Настоящий ABI и клиент

- `apps/web/src/idl.json` скопирован **из фактической Anchor-сборки** `5ffdc0b`,
  CI `35545805957`, check `106171358913`. JSON не составлялся вручную.
- IDL содержит 40 инструкций вместо 32, включая 8 ранее отсутствовавших. Ошибки
  не перенумерованы; текст `OrderTotalTooSmall` теперь соответствует исходнику.
- SHA-256 сгенерированного и клиентского JSON:
  `7df5d0668bb4e8dcbb901212f64671bb35c8ac94fc30ae2f90570f9646ff84b7`.
- Транспорт публичного IDL учитывает обрезание annotations до 4096 символов:
  части по 3000, строгий Git SHA и checksum; восстановление пишет только в ignored
  `target/idl`. Полное сравнение с новым build остаётся обязательным в CI.
- 23 клиентские инструкции сравниваются с generated IDL по discriminator, бинарным
  аргументам, порядку аккаунтов и signer/writable-флагам. Отдельно проверены
  дополнительные аккаунты batch harvest/achievements и все 8 комбинаций market
  license/referral accounts. Это не сертификация experimental Core/compression/hook.
- Найдены и исправлены три клиентских несоответствия: readonly config при регистрации
  реферера, лишний writable у System Program при claim achievement, сдвиг позиций
  referral accounts при отсутствии seller license. Цены/ставки не менялись.

### Backend и секреты

- Удалён отслеживаемый `.env.production` с RPC credential; усилены Git/Docker
  exclusions, убрана печать RPC URL, добавлена редакция секретов в диагностике.
- Backend отказывается использовать authority/pending authority/reward signer как
  epoch payer. Добавлен `/live`, сохранены `/health` и `/ready`.
- Docker: общий lockfile, non-root, read-only mount ключа; нерабочий bot удалён
  из Compose. Docker build подтверждён CI, production runtime здесь не проверялся.
- Source-tree/new-commit secret scans проходят. **Историческая утечка не устранена
  отзывом:** полный audit `35543363365` проверил 107 коммитов и нашёл 1 утечку.
  Она не allowlisted. Удаление файла не делает старый ключ безопасным.

## Проверки и происхождение результатов

| Проверка | Подтверждённый результат |
|---|---|
| Rust host unit tests | PASS в CI `35545805957` / `5ffdc0b` |
| Pinned SBF build | PASS в том же CI |
| Anchor integration / deployment smoke | PASS на disposable localnet в том же CI |
| Legacy migration fixtures | PASS в том же CI, оба Config layout |
| Backend container build | PASS в том же CI |
| Web/backend build и typechecks | PASS в том же CI |
| Локальные web/backend/tools typechecks после ABI-sync | PASS |
| Локальные off-chain tests после ABI-sync | **49/49 PASS** |
| `check:contract target/idl/solana_potato.json` после ABI-sync | PASS, все 40 инструкций и полный JSON |
| `git diff --check` | PASS |
| Source/new-commit secrets | PASS `35547357047` / `ed3fc2f`; history step skipped |
| Полная история | FAIL: 1 известная утечка, audit `35543363365` |
| Отзыв RPC credential / live authority inventory | Не подтверждены |
| Полный CI после ABI-sync | **PASS `35547357011` / `ed3fc2f`**, все jobs и release-check steps |

Локально Rust/Anchor/Solana/Docker отсутствуют: соответствующие PASS относятся к
**GitHub CI**, а не к имитации локального исполнения. ABI-тесты браузера выполняются
без кошелька/сети; localnet CI отдельно проверяет контракт, но не UI реального кошелька.

## Отдельно согласованный пакет Watchtower

После frontend upkeep владелец отдельно согласовал изолированный read-only exporter.
Реализация и границы: [watchtower/README.md](../../watchtower/README.md).
Контракт/экономика не изменены. Локально 69 проверок прошли без skips, включая
PostgreSQL rollback/crash recovery и synthetic RPC → отдельный процесс → HTTP.
Devnet RPC probe из sandbox не удался; реальные fixtures, deployment manifest
и центральное подключение Games Watchtower **не подтверждены**. `lastVerifiedAt=null`.
Для `c733fc8fdae082920b96afcf0c1b0899e40f40c1` прошли Watchtower CI `35553774523`
(PostgreSQL 17, types/build/tests), общий game CI `35553774450` (включая Rust/SBF,
localnet/migrations/full IDL/Docker) и current-tree/new-commit scan `35553774449`.
Smoke verifier дополнительно усилен: полная идентичность событий и индексов,
пагинация, safe config, фактический свежий readyz до/после, HTTPS для remote bearer.
Локально 111 тестов без skips, types/build PASS; 42 проверки verifier плюс CLI через
synthetic RPC и реальную локальную PostgreSQL. Повторный devnet probe: `ECONNRESET`.
Live-конфигурация exporter не задана; это не доказательство devnet deployment.
Для `cd8cae9fe3c758a9e8145695a3914139ace5e00b` прошли Watchtower CI `35556440719`
(обязательная PostgreSQL 17), общий CI `35556440813` и security `35556440772`.
Все три результата проверены для этой точной ревизии, не для предыдущего пакета.

Этот пакет не снимает wallet/UI, credential rotation и live authority release gates.

## Оставшиеся release gates

1. Провести wallet/UI-проверку перед бетой, отдельно от ABI/contract CI. Расчёты
   ремонта/налога и preflight синхронизированы с level-множителями и покрыты
   unit/source-guards; реальный wallet flow ими не проверяется.
   Цена регистрации реферера отдельно подтверждена владельцем: **5 POTATO**.
   Константа burn и тесты обновлены с 50 до 5; интерфейс уже показывал 5.
   Цена и граница 4.999999/5 POTATO подтверждены новым CI `35548308795`;
   ручная wallet/UI-проверка перед бетой остаётся отдельным этапом.
2. Владельцу отозвать исторически раскрытый RPC-ключ у провайдера; отдельно проверить
   приватные env/keypair, deployment bundles/caches и политику browser/server RPC keys.
   В чат ключи не передавать. Переписывание истории требует отдельного согласования.
3. Проверить в целевой сети program upgrade authority, game authority, reward signer,
   независимость payer, recovery и emergency pause. Это не выполнено локальным CI.
4. Только после отдельного согласования — репетиция обновления и миграций в devnet
   с проверенной сборкой, затем ограниченная бета без реальных средств.

## Решения не входят в этот пакет

- Семантика cap: bootstrap ≤250k, последующий `roll_epoch` независимо ограничен
  250k–750k. Reward signer делит бюджет с harvest. Формула/бюджеты не переписаны.
- Реальные Core/compression/transfer-hook CPI вместо существующих заглушек.
- Treasury timelock/multisig, новая политика вывода, новые валюты/цены рынка.
- Production indexer, доставляемые alerts, внешний аудит и mainnet. Отдельно
  согласованный read-only Watchtower exporter описан выше; production-подключение
  этим отчётом не сертифицируется.

Операционные команды, инциденты и восстановление: [OPERATIONS.md](OPERATIONS.md).
