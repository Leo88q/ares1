# Rent audit — финальный отчёт, этапы 0–6

**Итог:** размер и бюджет измерены, Q2–Q4 не удалялись; Q3 получил **NO-GO** по проверяемым критериям. Для Q5 усилен только runbook: он требует актуальный confirmed inventory и точное отдельное подтверждение перед закрытием buffers. Никаких on-chain close, airdrop, deploy/init или иных транзакций в этой работе не отправляли. Pull request открыт и **не смержен**.

- Ветка: `arena/01a0f81d-ares1` → `main`
- PR: [#50 — Rent audit: finish stages 5–6 and gate buffer reclaim](https://github.com/Leo88q/ares1/pull/50), состояние **OPEN**, не объединён
- Финальные отчёты этапов: [`00-baseline.md`](00-baseline.md), [`01-stage1.md`](01-stage1.md), [`02-stage2.md`](02-stage2.md), [`03-stage3.md`](03-stage3.md), [`04-stage4.md`](04-stage4.md), [`05-stage5.md`](05-stage5.md), [`06-stage6.md`](06-stage6.md)

## 1. Бюджет деплоя и пороги

Каноническая измеренная модель первого деплоя при `rate=5 080 lamports/Б`,
`SETUP_ONCHAIN=3 855 720 lamports` и `RESERVE=0.30 SOL`:

| Показатель | Результат |
|---|---:|
| Контроль `opt-level=z` | **756 424 Б** |
| `NEED_BEFORE_RESERVE` | **3 855 119 640 lamports** |
| `NEED_TOTAL` | **4 155 119 640 lamports = 4.155119640 SOL** |
| Порог уровня A | **529 407 Б / ≤3 SOL** |
| Требуемый срез от `z` до A | **227 017 Б (−30%)** |

Ни один одиночный безопасно готовый change не обеспечивает уровень A. Изолированные
эксперименты при ставке 5 080 (все **CI-only**, не основание для merge):

| Вариант | `.so` | Экономия к `z` | Вывод |
|---|---:|---:|---|
| `no-m` | 729 272 Б | 27 152 Б / около 0.1382 SOL | Верхняя оценка группы миграций; не сохраняет ABI и включает `migrate_presale_authority` |
| `no-grant` — обе reward-инструкции | 729 600 Б | 26 824 Б / около 0.1365 SOL | Не применимо к разрешённому условию Q3 «сохранить `grant_reward_once`» |
| `no-grant-legacy` — только `grant_reward` | 748 032 Б | 8 392 Б / 0.042697360 SOL | Цена известна, но Q3 readiness **не пройден** |
| `no-buy-field-sol` | 736 912 Б | 19 512 Б / 0.099279360 SOL | Цена известна, отсутствие внешних клиентов — нет |
| `arch-v3` | 696 408 Б | 60 016 Б / 0.3054 SOL | Смена целевой SBPF-платформы; порог A всё равно не достигается |

Суммировать отдельные дельты как измеренный результат нельзя: совместная сборка
не проводилась. В частности, `M + grant + v3` из Stage 1 — арифметическая оценка,
а не собранный/проверенный вариант. Перед любым будущим деплоем необходимо заново
проверить rent rate, ProgramData и баланс через RPC.

## 2. Результаты этапов

| Этап | Результат и статус |
|---|---|
| 0 — базовая линия | Измерены `.so`, rent, ProgramData, аккаунты и бюджет; подтверждён legacy `config164=1`; составлен контур измерений. См. `00-baseline.md`. |
| 1 — size experiments | `opt-level=z` дал 756 424 Б; изолированы цены группы M, rewards и SBPF v3. Удаления/платформенный срез не стали продуктовыми изменениями. См. `01-stage1.md`. |
| 2 — ELF/usage/CU | В ELF не обнаружены удаляемые таблицы символов/debug; CU в измеренном тестовом прогоне ниже лимита. Статическое совпадение имени не трактовалось как доказательство dead code. См. `02-stage2.md`. |
| 3 — Q3/Q4 | Измерены отдельно `grant_reward` без `grant_reward_once` и `buy_field_sol`; ABI не менялся. См. `03-stage3.md`. |
| 4 — Q1/Q5 evidence | Read-only найден legacy Program, ProgramData, authority и 10 authority-owned buffers; точные сведения зафиксированы ниже и в `04-stage4.md`. Никакие аккаунты не закрывались. |
| 5 — Q2/Q3/Q4 gates | Q3 — **NO-GO**; Q2 и Q4 остаются только отдельными reviewed-кандидатами, не удалениями. См. `05-stage5.md`. |
| 6 — Q5 runbook | Reclaim теперь fail-closed по genesis, точной сумме/адресам, повторному снимку и интерактивной фразе. Reclaim-only запуск не продолжает к funding/deploy; при buffers аirdrop блокируется до ручной проверки. См. `06-stage6.md`. |

## 3. Q1 — найденный legacy Program; никаких close

Read-only снимок Stage 4 снят **2026-10-01 около 21:27 UTC** на публичном
Devnet RPC, commitment `confirmed`, кластер 4.3.0, genesis
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; head slot — `506410601`, контекст
inventory buffers — `506410607`.

| Объект | Адрес | Баланс |
|---|---|---:|
| Legacy Program (`executable=true`) | `48D2uN5dwrpQuCJcb8Bge1hRkJVCRcS4J1JicAoAvMha` | 1 038 612 lamports = 0.001038612 SOL |
| Legacy ProgramData | `6vgyvPAstdZekvvCgBB29AP1uTcbwPFyVhftigqUuSCn` | 3 235 091 320 lamports = 3.235091320 SOL |
| Upgrade authority / recipient candidate | `HW4ekULcWHiVhDMfWpg8MwJwLqZHYskGMrue44WZ3vJ9` | — |
| 10 подтверждённых authority-owned buffers | полный список адресов и сумм в [`04-stage4.md`](04-stage4.md), §5 | 33 572 795 440 lamports = 33.572795440 SOL |
| **Валовой потенциальный итог** | Program + ProgramData + buffers | **36 808 925 372 lamports = 36.808925372 SOL** |

Recipient candidate выведен по on-chain authority и не является проверкой локального
signer-файла. Сумма валовая, минус возможные fees, и не гарантирует доступность
каждого аккаунта. Снимок исторический: перед любым потенциальным действием нужны
новая проверка genesis/authority/address/balance и отдельное финальное подтверждение
владельца с точными адресами и суммой. Программа и buffers остались на месте;
секретные ключи не читались и не раскрывались.

**Buffers — отдельная ликвидность, не снижение `NEED_TOTAL`.** По текущему Stage 6
runbook их нужно вручную проверить и reclaim-нуть до airdrop. Ни старый Program,
ни один buffer не закрывали.

## 4. Решения Q2–Q4

### Q2 — `migrate_*`

На Devnet в последнем account snapshot найдено `legacy.config164=1` при
`current.config260=0`. Код bootstrap отказывается молча продолжать с legacy
layout. Эксперимент `no-m` удалял группу migration-функций и
`migrate_presale_authority`; его результат — только размерная верхняя оценка.

**Решение:** миграции в этой работе не удалять и не запускать. Разрешение считать
legacy state disposable означает лишь возможность рассмотреть отдельный reviewed
change; оно не одобряет изменение ABI. `migrate_presale_authority` требует
отдельного семантического рассмотрения после authority transfer.

### Q3 — удалить только `grant_reward`, сохранить `grant_reward_once`

**Решение: NO-GO.** `game/scripts/init-onchain.ts` действительно отправляет
`grant_reward`, если quest treasury ниже целевого баланса; это активный script
call site и опровергает утверждение, что старый rail оставлен только ради
совместимости/тестов. Anchor integration tests тоже вызывают legacy rail.

Оба handler-а делят основные authority/pause/amount/supply/epoch caps и mint
ограничения, но `grant_reward_once` дополнительно требует nonce/expiry и создаёт
постоянный `RewardClaim` PDA на `(recipient ATA, nonce)`. Такой постоянный
rent-bearing marker не принят как механизм routine/high-frequency settlement;
aggregate settlement или on-chain per-user nonce/cursor в репозитории не доказан.
Полное покрытие всех видов выплат и production caller для once-rail не доказаны.
Старый handler не удалялся; `grant_reward_once` не менялся. До любого отдельного
reviewed change нужно убрать/заменить активный init script path и закрыть все
условия из Stage 5.

### Q4 — `buy_field_sol`

Размерная цена изолированного удаления известна, но отсутствие внешних или
динамических клиентов не доказано. **ABI не менять** до отдельного reviewed
решения с доказательством внешней совместимости.

## 5. Методические и scope-ограничения

- `Cargo.toml [profile.release]`, lock-gate и продуктовый `programs/` не менялись;
  `Cargo.lock` в замерах сохранялся. Stage 5/6 изменяли только отчёты, budget
  history, runbook/tooling и тесты runbook.
- Для extend-калибровки сохраняются confirmed-only чтения и ожидание смены
  `slot/space` до 30 с; raw `ExtendProgram` не используется. Extend не объявлялся
  критическим путём к бюджету ≤3 SOL.
- Q3/Q4 цены приведены при `rate=5 080`; buffers и recovery не вычитались из
  `NEED_TOTAL`.
- Ни Q2/Q3/Q4 удалений, ни деплоя, upgrade-authority transfer, Program/ProgramData
  close, buffer close, airdrop, `grant_reward` или `grant_reward_once` транзакций
  эта работа не выполняла.
- Перед любым будущим close действует отдельное финальное подтверждение с точной
  суммой и адресами. PR оставлен открытым без merge.

## 6. Проверки и артефакты

- Stage 3 CI: run `36920831012` — отдельные size variants успешно собраны;
  это не означает, что измерительные удаления можно мерджить.
- Stage 4 audit: run `36928825557` / job `110592734822` завершился успешно;
  связанные CI `36928825370` и Secret scanning `36928825498` — success.
- Stage 6 local: `cd game && yarn test:rent-tools` — **22/22 PASS**;
  `bash -n game/scripts/warm-start-devnet.sh`, `git diff --check` и
  `game/package.json` JSON parse — PASS. ShellCheck в среде не установлен.
- PR #50 GitHub checks после открытия: secret scan и deploy-readiness прошли;
  остальные CI/checks были ещё pending на момент первичного просмотра. Актуальный
  статус — на [странице PR](https://github.com/Leo88q/ares1/pull/50).
- Полные evidence сохранены в `reports/rent-audit/evidence/`; бюджеты всех этапов
  — в [`budget-history.csv`](budget-history.csv).

## 7. Финальный статус и оставшиеся действия

| Вопрос | Итог |
|---|---|
| Уровень A ≤3 SOL | **Не достигнут:** `z` требует 4.155119640 SOL; нужен дополнительный подтверждённый срез ≥227 017 Б либо отдельный пересмотр стратегии бюджета |
| Q1 / legacy Program | Адрес, ProgramData, authority и gross balances найдены read-only; **не закрыты** |
| Q2 / migration | Сохранить сейчас; рассматривать только отдельным reviewed change |
| Q3 / reward rail | **NO-GO** до удаления/замены script call site и доказанного routine settlement без permanent receipt |
| Q4 / `buy_field_sol` | Сохранить до отдельного решения о внешних клиентах |
| Q5 / buffers | Ручной confirmed inventory и reclaim до airdrop; close только после отдельного подтверждения; сейчас **NO TRANSACTION** |
| PR | [#50 открыт из `arena/01a0f81d-ares1`](https://github.com/Leo88q/ares1/pull/50), **не смержен** |

Дальнейший шаг по Q2/Q3/Q4 — не автоматическое удаление, а отдельные reviewed
изменения после выполнения соответствующих gates. Если владелец когда-либо
решит закрывать старый Program или buffers, следует снять новый confirmed
snapshot, показать полный список адресов и сумму и запросить отдельное финальное
подтверждение до любой транзакции.
