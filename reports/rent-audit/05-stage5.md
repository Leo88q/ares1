# Этап 5 — readiness-gates для условных удалений Q2/Q3/Q4

Этап 5 — read-only проверка условий перед любым удалением продуктовых
инструкций или миграций. Результат — **STOP для продуктового удаления**:
условия Q3 не выполнены, а экспериментальные оценки Q2/Q4 не являются
разрешением менять программу. `lib.rs`, IDL, клиенты, `Cargo.toml`, экономика и
состояние devnet в этом этапе не менялись; транзакций не отправляли.

## 1. Q3 — удаление только `grant_reward`, сохранение `grant_reward_once`

Пользовательское разрешение условное. Ниже проверены блокирующие условия до
начала какого-либо вертикального удаления.

| Условие | Наблюдение | Статус |
|---|---|---|
| Нет активных call sites во frontend/backend/game clients/scripts/tests | В web UI/builder прямого вызова не обнаружено; `backend/src/solana.ts` экспортирует deprecated builder, а `reward-rail.test.ts` запрещает production-модулям backend вызывать его. Но `game/scripts/init-onchain.ts:225–244` реально формирует `grant_reward` и отправляет `send(ix)`, если quest treasury ATA ниже целевых 550 POTATO. Anchor-тесты `game/tests/solana_potato.ts` также напрямую вызывают legacy handler и проверяют его поведение/квоту. | **FAIL — активный script call site** |
| Одинаковы ли назначение и параметры | Legacy: только `amount_micro`; получатель — заданный token account. `grant_reward_once`: `nonce`, `amount_micro`, `expires_at`; получатель также задаётся token account, а replay marker привязан к `(recipient ATA, nonce)`. | Различаются replay/expiry/учёт |
| Сопоставлены ли основные on-chain guards | У обоих: pause check, authority или `reward_signer`, положительная сумма до `MAX_REWARD_MICRO`, max-supply check и общий `charge_epoch_grant` (10% quota плюс epoch mint cap), затем mint CPI. Оба обновляют on-chain состояние и минтят в рамках одной инструкции, поэтому ошибка откатывает эти изменения транзакционно. | Паритет guard-ов подтверждён частично |
| Доказано ли покрытие всех видов наград и production settlement через `grant_reward_once` | Builder `buildGrantRewardOnceIx` существует, но текущий search не нашёл production-клиента, который его вызывает. Backend game-ops хранит off-chain intents `(recipient_ata, nonce)` и курсоры; это не on-chain per-user nonce/cursor и не доказательство end-to-end coverage всех типов выплат. Активное одноразовое финансирование quest treasury пока использует legacy instruction. | **НЕ ДОКАЗАНО** |
| Безопасен ли `grant_reward_once` для routine/high-frequency rewards | Его `RewardClaim` PDA создаётся через `init` для каждой пары `(ATA, nonce)` и намеренно никогда не закрывается. Это постоянный rent-bearing replay marker, не подходит как settlement-механизм рутинных частых выплат. В текущем источнике не найдено aggregate settlement или on-chain per-user cursor, которое заменяло бы постоянный marker для таких выплат. | **FAIL / design gap** |
| Негативные проверки для once-rail | Уже есть Anchor-тесты на повторный nonce без минта, не-authority signer, неверный PDA/nonce, expiry, размер выплаты и общую epoch quota. | Набор есть; в `grant_reward_once` ничего не менялось |
| Вертикальное удаление и повторное измерение `.so` | Не выполнялись из-за провала первого gate и отсутствия модели частых settlement-ов. | **STOP — не начинать удаление** |

Статический слойный отчёт Stage 2 для `grant_reward` показывал совпадения в
backend/tests/scripts (`evidence/02-usage-details.json`, run `36919450348`, job
`110561535903`). Ручная проверка отделяет текстовые/тестовые упоминания от
реального вызова: безусловно блокирующий путь — `init-onchain.ts`, который
проверяет баланс quest treasury и при недофинансировании подписывает/отправляет
инструкцию. Дополнительные устаревшие описания остаются в `game/README.md`,
`game/docs/API.md` и `game/docs/ECONOMY.md`; их пришлось бы обновлять при
разрешённом вертикальном изменении. `game/docs/MAINNET_LAUNCH_GATE.md` прямо
говорит не подключать legacy rail к reward endpoint и отмечает его удаление как
задачу будущего reviewed upgrade.

**Вывод Q3: NO-GO.** До рассмотрения отдельного reviewed change как минимум нужно
убрать или заменить активный bootstrap-вызов `init-onchain.ts`, согласовать
поддерживаемые типы выплат и доказать settlement-путь для `grant_reward_once`
без постоянного аккаунта на каждой routine выплате. Нынешнюю `RewardClaim`
модель нельзя расширять на высокочастотные выплаты. При любом будущем изменении
`grant_reward_once` остаётся без изменений, кроме необходимых parity tests.

Уже существующий отдельный CI-замер Q3 не является разрешением на merge:
[run 36920831012](https://github.com/Leo88q/ares1/actions/runs/36920831012), job
`110566155966`, вариант `no-grant-legacy` дал `.so` **748 032 Б** против `z`
**756 424 Б** (−8 392 Б) и расчётную дельту `NEED_TOTAL` **−42 697 360 lamports
(−0.042697360 SOL)** при rate 5 080. Это CI-only изолированное удаление; оно не
проверяет bootstrap-поведение, внешние клиенты, ABI-совместимость или settlement
для пользователей.

## 2. Q2 — миграции legacy layout

В актуальном Devnet-снимке `ares-accounts` run `36928825557`, job
`110592734822`, измерено `legacy.config164=1` (`current.config260=0`). То есть в
публичном Devnet RPC есть как минимум один аккаунт старого Config-размера.
Код `init-onchain.ts` намеренно отказывается молча продолжать с legacy Config
или Epoch и отправляет оператора к reviewed migration planner.

Удаление `migrate_*` не готово как вертикальный продуктовый change: миграционные
handler-ы/контексты есть в Rust; builders — в `game/apps/web/src/utils/anchorClient.ts`
и `game/scripts/migrationClient.ts`; planner — `game/scripts/migrate-v2.ts`;
`warm-start-devnet.sh` сохраняет отдельный opt-in `PRESERVE_STATE=1`; миграции
покрыты on-chain/off-chain/localnet tests и документированы в
`game/docs/MIGRATIONS.md` / `OPERATIONS.md`. Кроме того, CI-вариант `no-m`
удаляет не только legacy-layout handlers и `mod migrations`, но и
`migrate_presale_authority`, который синхронизирует authority пресейла после
transfer; его нельзя приравнять к выбрасыванию старого layout.

`no-m` измерил **729 272 Б** (−27 152 Б к `z`), но это агрегированный CI-only
upper bound, не проверка сохранения работающего состояния. Разрешение считать
legacy state disposable не является разрешением удалить эти entrypoints из
боевого ABI без отдельного reviewed change. Ни миграции, ни сами аккаунты в этом
этапе не запускались и не менялись.

## 3. Q4 — `buy_field_sol`

Изолированный CI-замер уже есть в Stage 3: `no-buy-field-sol` — **736 912 Б**,
−19 512 Б / −0.099279360 SOL по `NEED_TOTAL` при ставке 5 080. Он подтверждает
только цену удаления. Отсутствие внешних/динамических клиентов не доказано; ABI
не удаляли и в этом этапе не удаляем.

## 4. Budget history и итоговый стоп

Контроль `z` в run `36928825557` остался **756 424 Б**, rate — **5 080**,
`SETUP_ONCHAIN` — **3 855 720 lamports**. Stage 5 не меняет продуктовую программу
или калькулятор; строка в `budget-history.csv` переносит ту же модель:
`NEED_BEFORE_RESERVE=3 855 119 640`, `NEED_TOTAL=4 155 119 640 lamports`
(**4.155119640 SOL**). Recovery из Stage 4 остаётся отдельной ликвидностью и не
уменьшает `NEED_TOTAL`. Для уровня A при ставке 5 080 порог — **529 407 Б**;
от `z` требуется убрать **227 017 Б (−30%)**. Ни Q3, ни Q4 по отдельности не
доводят бюджет до уровня A (≤3 SOL); Q2/Q3/Q4 остаются независимыми
CI-экспериментами, не комбинацией для мержа.

Q5 также остаётся без on-chain действий: `warm-start-devnet.sh` сначала
показывает `solana program show --buffers --lamports` и рекомендует reclaim до
airdrop, но его `CONFIRM_RECLAIM=1` ветка исполняет `solana program close
--buffers`. В этой работе эту ветку не запускали. Перед любым будущим close
обязательны ручная сверка адресов и сумм из свежего confirmed-снимка и отдельное
финальное подтверждение владельца с точным списком и итогом.

| Gate | Решение этапа |
|---|---|
| Q2: legacy migration removal | Не менять программу; `config164=1`, `no-m` — только CI-only верхняя оценка, `migrate_presale_authority` требует отдельного рассмотрения |
| Q3: удалить только `grant_reward` | **NO-GO**: активный вызов из `init-onchain.ts`; once rail использует постоянный `RewardClaim`, а routine settlement replacement не доказан |
| Q4: `buy_field_sol` | Размер измерен, но удаление не разрешено этим evidence; внешние клиенты не исключены |
| Q5: buffers | Только read-only inventory/runbook; никаких close, transfer или airdrop |
| ABI, экономика, `.so` source | Без изменений |

## Источники

| Что | Источник |
|---|---|
| Layered usage и пути `grant_reward` | `evidence/02-usage-details.json`, run `36919450348`, job `110561535903`; ручная проверка `game/scripts/init-onchain.ts:225–244` |
| Rust handlers/Accounts/shared caps | `game/programs/solana_potato/src/lib.rs:1327–1435`, `2858–2904`, `2012–2040`, `3290–3302` |
| Once-rail negative tests | `game/tests/solana_potato.ts:177–250`; backend builder policy: `game/apps/backend/tests/reward-rail.test.ts` |
| Active migration surface and no-m upper bound | `game/scripts/size-experiments.py`, `game/scripts/migrate-v2.ts`, `game/scripts/warm-start-devnet.sh`; Stage 3 run `36920831012` |
| Devnet `config164=1` | `ares-accounts`, run `36928825557`, job `110592734822` |
| Buffer runbook guard | `game/scripts/warm-start-devnet.sh:128–153`; Stage 4 report `reports/rent-audit/04-stage4.md` |
