# Стабилизация ARES-1 — 21.09.2026

## Статус

**Первый пакет выполнен частично. Mainnet/реальные средства не разрешены. CI целиком
не объявляется зелёным.** Экономические параметры и управление в сети не менялись.
Ничего не деплоилось, ключи не отзывались, история Git не переписывалась.

Проверка исходного CI на `a271984`: запуск GitHub Actions `35533898275` от 20.09.2026.
Web упал на двух неиспользуемых импортах, Rust — на разрешении зависимости `zeroize`.
Backend typecheck прошёл. Полные логи/артефакты получить не удалось; причины падений
получены из GitHub check annotations и воспроизведения frontend typecheck.

## Уточнение экономики владельцем

- Лицензия: **500 SKR**; пресейл: **1053 SKR**.
- Обычная покупка полей, налог, ремонт, улучшения, удобрения и регистрация реферера:
  исходные платежи/сжигание **POTATO**.
- Ошибочная общая замена игровых расходов на SKR отменена в исходниках и клиенте.
  Восстановлен исходный интеграционный набор `tests/solana_potato.ts`.
- По рынку восстановлено состояние до этой переделки; иной способ расчётов здесь
  не считается согласованным. On-chain обновлений не выполнялось.
- Исправления CI, транспорта настоящего IDL и изолированного тестового валидатора
  сохранены отдельно от отката экономики; их новый полный CI ещё требуется проверить.

## Изменения

### Сборка и CI
- Удалены два неиспользуемых импорта frontend.
- Из Rust manifest удалены неиспользуемые experimental SDK и вводившая в заблуждение
  feature `full`. Эти библиотеки не вызываются программой, но их optional-зависимости
  участвуют в Cargo resolution. Восстановлен набор зависимостей до их добавления;
  `Cargo.lock` оставлен неизменным. Исправление Rust-конфликта требует проверки сборкой.
- Зафиксированы Node 22.22.3/Yarn 1.22.22 и локальный Rust toolchain. Anchor/Solana
  оставлены на существующих версиях 0.31.2/4.2.2. JS Anchor отдельно закреплён на
  ранее использовавшейся версии 0.30.1; это не заявление о совместимости новой ABI.
- CI больше не пишет логи в Git-ветки/PR-комментарии; permissions сведены к чтению.
- Добавлены off-chain tests, backend build, container build и проверка program IDs,
  списка инструкций, ошибок и полного сгенерированного IDL. Проверка IDL не переписывает файл.
- Anchor integration suite сохранён как clean-localnet deployment smoke; новые
  off-chain тесты исключены из его glob.

### Клиент и on-chain код
- Тест импорта выявил невалидный Token-2022 program ID с дефисами. Вместо него
  используется константа SPL SDK: исправлено исключение при загрузке клиента.
- Переводы ошибок теперь привязаны к именам из IDL, а не неверным старым кодам.
- Поддержано чтение старых Config 156/164 и Epoch 41 байт; backend проверяет
  discriminator/допустимый размер и владельца on-chain аккаунта.
- Исправлена запись Field в `batch_harvest`: Anchor сериализует discriminator вместе
  с payload, поэтому запись с дополнительного offset 8 выходила за размер аккаунта.
  Добавлены проверка writable и корректное сравнение коэффициента масштабирования.
- `close_field`: получатель возвращаемой ренты явно writable в Anchor accounts.
- Исправлены три ошибочных unit-assertion размеров experimental аккаунтов (не учитывали discriminator).
- Добавлены Rust regression tests и integration cases: сериализация, duplicate proofs,
  batch harvest, close/refund while paused, делегирование/отзыв reward signer,
  запрет admin-операций этому signer, идемпотентность миграции **текущего** layout.
  Эти chain-тесты ещё не запускались; старые layout migration fixtures ими не покрыты.

### Секреты / backend
- Удалён отслеживаемый `.env.production` с RPC credential; усилены Git/Docker exclusions.
  Ни значение, ни новый ключ не записаны в отчёт.
- Убрана печать RPC URL; добавлена редакция credential-bearing ошибок, generic HTTP
  ошибки, тесты редакции и отдельности payer.
- Backend отказывается запускаться/роллить эпоху, если payer совпал с game authority,
  pending authority или reward signer. Это не заменяет проверку upgrade authority.
- Добавлен `/live`, независимый от RPC. `/health` и `/ready` сохранены; внешнего
  мониторинга/alert webhook в этом пакете пока нет.
- Docker использует общий lockfile, Node 22.22.3, non-root и read-only secrets.
  Нерабочий `bot` и неиспользуемый data volume убраны из Compose.
- Добавлены Gitleaks config, pinned installer/checksum verification, локальные команды
  и отдельный workflow: текущие файлы, новые коммиты, ручной полный исторический скан.
- Обновлены API, SECURITY и [operations/incident/recovery runbook](OPERATIONS.md).
  Старый production report помечен как исторический, не подтверждающий готовность.

## Что действительно проверено здесь

| Проверка | Результат |
|---|---|
| `yarn install --frozen-lockfile` | PASS |
| Web + backend typecheck | PASS |
| `yarn test:offchain` | PASS: 10 тестов |
| `yarn build` (web + backend) | PASS; есть существующие предупреждения CSS/bundler |
| `./scripts/ci-local.sh --skip-chain` | PASS; явно не сертифицирует on-chain часть |
| YAML CI/security/Compose | Parse PASS; Docker runtime не проверен |
| Shell syntax, `git diff --check` | PASS |
| Integration TS syntax | PASS; не generated-IDL typecheck и не исполнение |
| `yarn check:contract` | FAIL: committed IDL устарел — корректно обнаружено |
| Rust/Anchor/localnet tests | NOT RUN: инструменты отсутствуют; загрузка toolchain блокируется сетью |
| Docker build/runtime | NOT RUN: Docker отсутствует |
| Gitleaks | NOT RUN: скачать бинарник не удалось; workflow подготовлен, но не исполнялся |
| Проверка полномочий через devnet RPC | NOT VERIFIED: сетевой запрос недоступен |
| Новый удалённый GitHub CI | NOT RUN: изменения не pushed; не заявляется green |

## Секреты: границы проверки

Доступная история основной ветки была дозагружена без переключения рабочей ветки.
Предварительный regex-поиск (не Gitleaks!) обнаружил credential-кандидат в одной
исторической ревизии `game/apps/web/.env.production`. Текущие файлы очищены от этой
находки. Это **не** полный аудит всех refs, локальных env/keypair, CI logs/artifacts
или внешних deployment bundles. Артефакты CI скачать не удалось.

**Владелец должен отозвать ключ у RPC-провайдера.** Удаление файла/очистка истории
не заменяет отзыв. Browser `VITE_*` значения публичны даже при хранении в CI Secrets.
Полный history scan не содержит исключения для известной утечки.

## Оставшиеся блокеры первого пакета

1. Запустить pinned Rust/Anchor/Solana в доступном окружении, проверить `cargo test
   --locked`, SBF build, integration tests. Исправить любые следующие ошибки, не
   отключая проверки. Удаление SDK — обоснованный патч, но не доказанная зелёная сборка.
2. Сгенерировать настоящий IDL и сверить ABI. Сейчас отсутствуют:
   `batch_harvest`, `close_field`, `execute_transfer_hook`, `init_compression_tree`,
   `mint_compressed_field`, `mint_core_field`, `update_reward_signer`, `update_skr_mint`.
   Структуры аккаунтов/события тоже требуют generated comparison. IDL вручную не подделывался.
3. Прогнать Docker и Gitleaks, включая отдельно приватные env/keypair и скачанные CI artifacts.
4. Подтвердить отзыв RPC-ключа, live upgrade/game authority, независимость signer и recovery.
5. Проверить legacy migration fixtures: например, переход Config 156→228 копирует
   старый хвост без явного перемещения paused/bump после нового snapshot-поля;
   обработчики realloc также требуют проверки rent top-up. Без этой проверки не мигрировать
   реальные аккаунты. Тест идемпотентности текущего layout этот риск не закрывает.

## Решения на отдельное согласование

- `update_config.daily_mint_cap_micro` ограничен 250k, но следующий `roll_epoch`
  вычисляет независимый лимит 250k–750k. Выбрать семантику: жёсткий admin ceiling
  поверх динамики либо явно отдельный bootstrap-параметр. В этом пакете формула не менялась.
- Отдельный reward budget: сейчас reward signer может израсходовать общий бюджет harvest.
- Experimental compression/Core/hook — заглушки, не реальные заявленные CPI/burn.
  Удаление неиспользуемых зависимостей не отключает соответствующие инструкции.
  Решить: исключить их из beta surface либо отдельно реализовать и протестировать.
- Treasury governance: game authority и upgrade authority, multisig/delay, быстрый
  emergency pause и проверка всех обходных путей. В сети ничего не передавалось.

Закрытая devnet-бета без реальных платежей — следующий этап после закрытия технических
блокеров. Indexer/Watchtower, платный RPC и внешний аудит не выдаются за выполненные работы.
