# Этап 6 — Q5: безопасный reclaim authority-owned buffers в runbook

Этап 6 закрыл runbook-гейт вокруг буферов после read-only инвентаризации Stage 4.
Это **операционное изменение**, не изменение Solana-программы: `programs/`, IDL,
экономика, `.so`, `Cargo.toml` и on-chain состояние не менялись. Ни `solana
program close`, ни airdrop, ни deploy/init этот этап не запускал.

## Что изменено

В `game/scripts/warm-start-devnet.sh` обычный `CONFIRM_RECLAIM=1` больше не
является достаточным условием close:

1. Перед инвентаризацией считывается RPC genesis hash; буферы читаются одним
   свежим `confirmed` snapshot через `solana program show --buffers --output json`.
   Отдельный helper `game/scripts/buffer-inventory.mjs` принимает только записи
   с ожидаемым authority, проверяет непустые/уникальные адреса и точный целый
   lamports, сортирует адреса и считает сумму через `BigInt` (без округления
   `jq`/float).
   Неполный JSON, authority mismatch или неразбираемый баланс закрывает путь
   fail-closed до funding/deploy.
2. Runbook печатает каждый адрес и lamports, точный общий итог в lamports/SOL и
   отсортированный список адресов. Reclaim по-прежнему рекомендуется **до
   airdrop**; эта ликвидность не вычитается из `NEED_TOTAL`.
3. Для отдельного reclaim-вызывающего требуется задать точные значения
   `CONFIRM_RECLAIM_GENESIS`, `CONFIRM_RECLAIM_SUM` и
   `CONFIRM_RECLAIM_ADDRESSES`, совпадающие с наблюдаемыми cluster genesis,
   итогом и инвентарём. Затем нужен интерактивный TTY и отдельный ввод полной
   фразы `CLOSE-BUFFERS <genesis> <authority> <sum> <addresses>`.
4. После typed confirmation runbook заново снимает confirmed-инвентарь. Любое
   изменение genesis hash, адресов или lamports прерывает действие. Закрываются только
   адреса из просмотренного списка, по одному (вместо wildcard `--buffers`);
   после этого выполняется read-only проверка пустого остаточного инвентаря.
5. Reclaim-only запуск завершается сразу после проверки: он не продолжает в том
   же процессе к funding, airdrop или deploy. Если баланс ниже `NEED_TOTAL` и
   authority-owned buffers всё ещё есть, обычный запуск также останавливается
   **до airdrop** и печатает сумму, адреса и точную форму отдельного reclaim.

Таким образом, повторный запуск после осознанного reclaim — отдельное решение
оператора. Значения Stage 4 не зашиты в код: адреса/сумма всегда снимаются заново
для выбранного `ADMIN_KEYPAIR` и RPC. Автоматического reclaim, закрытия чужих
buffers и airdrop перед ручной проверкой нет.

## Проверки

| Проверка | Результат |
|---|---|
| `cd game && yarn test:rent-tools` | **PASS**, 22/22; включая точную арифметику `BigInt`, authority/duplicate/invalid-value fail-closed, typed confirmation, rescan и остановку перед airdrop |
| `bash -n game/scripts/warm-start-devnet.sh` | **PASS** |
| `git diff --check` | **PASS** |
| `game/package.json` JSON parse | **PASS**; новый safety suite включён в `test:rent-tools` |
| ShellCheck | Не установлен в окружении; не запускался |
| `warm-start-devnet.sh`, `solana program close`, airdrop/deploy | **Не запускались**; транзакций нет |

`buffer-inventory.mjs` проверен на shape CLI Agave v4.2.2: `CliUpgradeableBuffers`
содержит `buffers[]` с `address`, `authority`, `lamports`; source path
`cli-output/src/cli_output.rs`, revision `v4.2.2`. Проверка версии источника была
read-only через GitHub API. Никакой live RPC-запрос этим Stage 6 не выполнялся.

## Budget history

Изменения касаются только runbook/tooling и не влияют на Program ELF или модель
деплоя. Carry-forward для `z`: `.so` **756 424 Б**, rate **5 080**,
`NEED_BEFORE_RESERVE=3 855 119 640`, `NEED_TOTAL=4 155 119 640 lamports`
(**4.155119640 SOL**). Recovery buffers — отдельная ликвидность. Уровень A —
**529 407 Б**, для него от `z` всё ещё требуется удалить **227 017 Б (−30%)**;
Stage 6 к размеру `.so` не приближает. Результат записан в
`reports/rent-audit/budget-history.csv` как строка Stage 6 с базовым измеренным
кодовым состоянием `2d80316` и каноническим CI/RPC run `36928825557`.

## Решение

Q5 runbook теперь явно рекомендует вручную проверить и reclaim-нуть подтверждённые
authority-owned buffers до airdrop и технически требует точные адреса/сумму,
повторный confirmed snapshot и отдельное интерактивное подтверждение для close.
Это **не** поручение reclaim-нуть найденные Stage 4 buffers сейчас; Stage 4
адреса и суммы являются историческим снимком, не текущим разрешением. Никаких
адресов или значений для close в этом отчёте не подставляется.

| Область | Решение |
|---|---|
| Q5 buffer close | Только при отдельном будущем подтверждении после свежего genesis/list/sum; в этом этапе **NO TRANSACTION** |
| Airdrop | При недостатке средств и остающихся authority-owned buffers теперь блокируется до reclaim/review |
| Product program / IDL / `.so` | Без изменений |
| Экономика / `NEED_TOTAL` | Без изменений; buffers — отдельная ликвидность |
