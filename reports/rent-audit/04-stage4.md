# Этап 4 — read-only аудит старой программы и authority-owned buffers

Этап 4 закрыл поиск старого Program ID и снял свежий devnet-снимок потенциально
восстанавливаемых лампортов. Работа была **только read-only**: ключи не читались,
транзакции не создавались и не отправлялись, программа и буферы не закрывались.
Суммы ниже — валовые балансы на момент чтения, а не обещание получить их без
комиссий или отдельной проверки условий закрытия.

## 1. Канонический прогон и проверяемость результата

Канонический read-only RPC-прогон — [Rent audit run
36928825557](https://github.com/Leo88q/ares1/actions/runs/36928825557), ревизия
`d71ad54f0ac31a88e37071ad1542ea37da24884c`; probe job **110592734822**. Job и
весь Rent audit завершились успешно. Связанные `CI` run
[36928825370](https://github.com/Leo88q/ares1/actions/runs/36928825370) и
`Secret scanning` run
[36928825498](https://github.com/Leo88q/ares1/actions/runs/36928825498) также
завершились успешно.

Снимок снят 2026-10-01 около 21:27 UTC на публичном RPC
`https://api.devnet.solana.com`, commitment `confirmed`, версия кластера
`4.3.0`, genesis hash
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` (совпадает с ожидаемым Devnet).
Проверенный head slot — **506410601**; контекст инвентаризации буферов и баланса
кошелька — **506410607**. Балансы Program и ProgramData получены отдельными
confirmed-вызовами `getAccountInfo`; это близкий по времени RPC-снимок, не одна
атомарная транзакция.

В артефакт `legacy-recovery-audit-36928825557` загружен полный JSON-снимок
(retention 14 дней). Отдельные GitHub-аннотации `ares-legacy`, `ares-deployments`,
`ares-recovery`, `ares-buffers` и `ares-operator-wallet` разобраны как валидный
JSON; каждая укладывается в безопасный лимит 3 800 байт, поэтому важные поля не
обрезаны лимитом аннотаций. Полные transaction signatures в этом отчёте сокращены;
они доступны в публичных аннотациях указанного run.

Аудитор использовал только `getGenesisHash`, `getVersion`, `getSlot`,
`getAccountInfo`, `getSignaturesForAddress`, `getTransaction`, `getBalance` и
`getProgramAccounts`. В результате помечены `secretKeyRead=false` и
`transactionSent=false`.

## 2. Как найден старый Program ID и что использует продукт сейчас

История Git подтвердила источник ID:

* в исходном коммите `6799485` старый адрес
  `48D2uN5dwrpQuCJcb8Bge1hRkJVCRcS4J1JicAoAvMha` стоял в `game/Anchor.toml` и
  `declare_id!` программы;
* коммит `864bdbb03fbb31fd165433cda11ea11221189bc0` заменил его на
  `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf`; сообщение коммита прямо
  называет `48D2uN` stale и DUUBi фактической on-chain программой;
* сейчас все три окружения в `game/Anchor.toml` и `declare_id!` указывают на
  `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf`;
* поиск полного старого ID в текущих `game/apps`, `game/programs`, `game/tests` и
  `game/Anchor.toml` совпадений не дал. В полном tracked source ID оставлен в
  публичном конфиге recovery-аудита, чтобы проверять legacy-аккаунт.

Это доказывает переключение текущего кода/конфигурации, но само по себе не может
исключить неизвестные внешние клиенты. On-chain история ниже подтверждает, что в
доступном confirmed-индексе публичного RPC после последнего legacy-reference
есть более позднее развёртывание и более поздние references текущего Program ID.

## 3. Legacy Program, ProgramData, authority и балансы

| Объект | Адрес / состояние | Баланс |
|---|---|---:|
| Старая программа (`Program`) | **`48D2uN5dwrpQuCJcb8Bge1hRkJVCRcS4J1JicAoAvMha`**; owner — Upgradeable Loader; `executable=true`, loader state tag `2`, space `36` | **1 038 612 lamports = 0.001038612 SOL** |
| Её `ProgramData` | **`6vgyvPAstdZekvvCgBB29AP1uTcbwPFyVhftigqUuSCn`**; owner — Upgradeable Loader; state tag `3`; slot `497270842`; space `636 701`, data `636 656` байт | **3 235 091 320 lamports = 3.235091320 SOL** |
| Upgrade authority старой программы | **`HW4ekULcWHiVhDMfWpg8MwJwLqZHYskGMrue44WZ3vJ9`**; `authorityOption=Some`; совпадает с operator wallet | — |

Валовой остаток старой Program + ProgramData: **3 236 129 932 lamports =
3.236129932 SOL**. Заголовки Program и ProgramData прошли проверки владельца,
loader-тегов и длины; Program account executable.

Для сравнения текущий Program —
`DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf`, его ProgramData —
`CrTBMUR4wyMDT2SZotSrtDAZoWwQC5U9cpvZp4z7pY5Y`. Текущий ProgramData имеет slot
`498341901`, `space=715053`, `dataLen=715008`, баланс **3 633 119 480 lamports =
3.633119480 SOL** и ту же authority
`HW4ekULcWHiVhDMfWpg8MwJwLqZHYskGMrue44WZ3vJ9`. Баланс самого текущего Program
account — **833 120 lamports = 0.000833120 SOL**. Совпадение authority старого и
текущего ProgramData подтверждено RPC, а не выведено из локального keypair.

## 4. История и свидетельства переключения

* `getSignaturesForAddress` старого Program вернул 20 записей; самая поздняя —
  slot **497270842**, 2026-09-12 16:17:48 UTC. Последняя история старого
  ProgramData вернула 9 записей и тот же latest slot/signature.
* Полученная через `getTransaction` транзакция последнего legacy-reference
  (signature сокращена: `4HAgpUHsff…Fp31Lq4`) успешна; она содержит старый ID,
  не содержит текущий DUUBi ID и подписана operator wallet и
  `B74ZBGksiKmey6n8kjHzcELdKQUsTzCg7Tqp94ghFDJy` (этот адрес также найден среди
  authority-owned buffers ниже).
* История текущего ProgramData вернула 7 записей; транзакция развёртывания в
  slot **498341901**, 2026-09-14 17:07:11 UTC (signature сокращена:
  `2f73UrHKZnyT…NB9bMQaM`), успешна, содержит текущий Program ID, не содержит
  старый ID и подписана authority-кошельком.
* История текущего Program ID вернула 5 записей; latest reference — slot
  **505995704**, 2026-09-30 18:27:59 UTC (signature сокращена:
  `3rNqeHwzy629…U9dfBUH`). Это позднее и legacy-reference, и текущего deployment
  slot.
* Репозиторный README-receipt (signature сокращена:
  `29V5xNzs3MqQ…5jMPGaCj`) найден в RPC на slot `493194605`, 2026-09-04
  20:32:48 UTC. Он содержит старый ID и не содержит текущий; поэтому он не
  трактуется как подтверждение текущего deployment.

**Вывод о неиспользовании:** локальные клиенты/программа используют DUUBi, а в
confirmed-истории старого Program и ProgramData публичный RPC не показывает
references новее slot `497270842`; позднейшие deployment/current-ID references
принадлежат DUUBi. Это сильное свидетельство наблюдаемого переключения, но не
доказательство отсутствия любого внешнего клиента или будущего обращения к
старому ID. Поэтому оно не даёт разрешения закрывать программу.

## 5. Все найденные authority-owned loader buffers

Запрос — `getProgramAccounts` Upgradeable Loader с `memcmp` authority по offset
5, `withContext=true`, commitment `confirmed`, с чтением первых 37 байт. Каждый
результат дополнительно проверен локально: owner — Upgradeable Loader, tag
`Buffer=1`, authority option `Some` и embedded authority совпадает с
`HW4ekULcWHiVhDMfWpg8MwJwLqZHYskGMrue44WZ3vJ9`. Найдено **10** аккаунтов,
`unexpectedMatches=[]`.

| Buffer address | lamports | SOL | space, Б |
|---|---:|---:|---:|
| `7ZzKXEfMfu9QbkgDGdL4Gb8foJyK3dg9d84GxHRTvnQg` | 3 441 054 840 | 3.441054840 | 677 237 |
| `8wwqUWCvsKYAwXLVZcvThLsXkH5Jx8p2nnXFq24FBTqq` | 3 235 091 320 | 3.235091320 | 636 693 |
| `9JjdEf9QBfidtrzEvrAmkL9KV77QhHtygG9StYmjLLoP` | 3 441 054 840 | 3.441054840 | 677 237 |
| `Aqsjnm6oBjh8n1UBvpjNHzc6gukawcUP36mf3C9NWwxd` | 3 235 091 320 | 3.235091320 | 636 693 |
| `B74ZBGksiKmey6n8kjHzcELdKQUsTzCg7Tqp94ghFDJy` | 3 235 091 320 | 3.235091320 | 636 693 |
| `CXSeAMs8Wkwzh4mSiKcw2MfnTh1myGofe9fNeEgTmkMT` | 3 441 054 840 | 3.441054840 | 677 237 |
| `EH8GxzHheKAuyVDFefdA7c2ouNULBb4YmqgWhfsQqmsQ` | 3 235 091 320 | 3.235091320 | 636 693 |
| `FSUr9c8evhJALbgCNyqqZPbuv9e9Yu6FKtyy6apjz4xJ` | 3 235 091 320 | 3.235091320 | 636 693 |
| `HdmGW1S1GKLsrk82ySS8BmeNrZAuEByQJ2dQqPeG6SLp` | 3 633 119 480 | 3.633119480 | 715 045 |
| `HKC1YKegfS16K1i5cP9hg4SBhJApDPD8Wg1bkXFHJW29` | 3 441 054 840 | 3.441054840 | 677 237 |
| **Итого** | **33 572 795 440** | **33.572795440** | — |

На том же context slot `506410607` operator wallet имел **24 266 468 lamports =
0.024266468 SOL**. Буферы — отдельные authority-owned активы, не связанные
loader-ом с конкретной программой. Их сумму нельзя вычитать из `NEED_TOTAL` или
представлять как уменьшение цены `.so`. Для runbook остаётся рекомендация вручную
проверить и reclaim-нуть подтверждённые authority-owned buffers **до airdrop**;
это не поручение отправлять close-транзакции.

## 6. Валовой потенциальный возврат и точный recipient candidate

| Источник | lamports | SOL |
|---|---:|---:|
| Legacy Program | 1 038 612 | 0.001038612 |
| Legacy ProgramData | 3 235 091 320 | 3.235091320 |
| 10 подтверждённых authority-owned buffers | 33 572 795 440 | 33.572795440 |
| **Потенциальный gross total** | **36 808 925 372** | **36.808925372** |

Точный **recipient candidate** —
**`HW4ekULcWHiVhDMfWpg8MwJwLqZHYskGMrue44WZ3vJ9`**. Основание: он является
upgrade authority старого ProgramData, совпадает с authority текущего ProgramData
и был ключом фильтра/embedded-authority проверки buffers. Это не проверка
локального signer keypair и не подтверждение пользователем адреса назначения.
Итог — до transaction fees; считать его гарантированно доступным к выводу без
проверки каждого аккаунта нельзя.

## 7. Влияние на бюджет деплоя

В Stage 4 размер/ABI/экономика не менялись. Контроль `z` снова собран в job
**110592735281**: `.so` **756 424 Б**, SHA-256
`25ba34d7102764ebfccb3ce4229923865a2d974436ccdf0bbf7d761e9d151890` (побитно тот
же Stage 3 контроль). На том же Rent audit run ставка `rate=5080` подтверждена
дельтой rent; `SETUP_ONCHAIN=3 855 720` lamports измерен в `ares-setup`. Поэтому
в `budget-history.csv` добавлена строка carry-forward для `z` / mode `new`:
`NEED_BEFORE_RESERVE=3 855 119 640`, `NEED_TOTAL=4 155 119 640` lamports
(**4.155119640 SOL**). Это прежняя модель деплоя с актуально перепроверенными
входами, а не новая экономия Stage 4. Возможный recovery **не уменьшает**
`NEED_TOTAL`; он остаётся отдельной ликвидностью.

## 8. Решение и обязательный стоп перед любым close

По заданию Q1 выполнен read-only поиск и подготовлен полный набор сведений перед
возможным закрытием: полный Program ID, ProgramData, upgrade authority, оба
баланса, все 10 buffers с адресами/суммами, gross total и точный recipient
candidate; cluster и история транзакций проверены. **Ни программа, ни один buffer
не закрывались, и никаких транзакций не отправляли.**

Перед `solana program close` или закрытием buffers требуется отдельное финальное
подтверждение владельца с перечисленными адресами и суммой. До него закрытие,
перевод и airdrop запрещены. Если решение когда-либо будет принято, повторно
снимите confirmed balances/authority перед действием, сверьте каждый buffer
вручную, подтвердите recipient, а затем покажите владельцу точный набор аккаунтов
и итог и запросите отдельное подтверждение ещё раз.

## Источники

| Что | Источник |
|---|---|
| Полный read-only RPC JSON и аннотации `ares-legacy`, `ares-deployments`, `ares-recovery`, `ares-buffers`, `ares-operator-wallet` | [Rent audit run 36928825557](https://github.com/Leo88q/ares1/actions/runs/36928825557), probe job `110592734822`, рев `d71ad54` |
| Контроль `.so` и сохранение Cargo.lock | size-z job `110592735281`, тот же run; итог 756 424 Б, SHA `25ba34d7…` |
| Исторический ID и исправление на текущий | commits [`6799485`](https://github.com/Leo88q/ares1/commit/6799485) и [`864bdbb`](https://github.com/Leo88q/ares1/commit/864bdbb03fbb31fd165433cda11ea11221189bc0); текущие `game/Anchor.toml`, `game/programs/solana_potato/src/lib.rs` |
| Проверенная ставка и SETUP_ONCHAIN | `ares-rate` / `ares-setup`, probe job `110592734822` того же run |
| CI и secret scan | [CI run 36928825370](https://github.com/Leo88q/ares1/actions/runs/36928825370), [Secret scanning run 36928825498](https://github.com/Leo88q/ares1/actions/runs/36928825498) |
