# Ранбук: ручная выдача POTATO за пресейл (волна 1)

Статус: **операционная инструкция**. Решение зафиксировано — авто-signer-бота нет:
каждую выдачу собирает, подписывает и отправляет человек. Этот документ описывает
порядок действий, а не автоматизацию (кода бота в репозитории нет и не будет).

Область: офчейн-предоплата (волна 1): заказ → платёж SOL или SKR → выдача POTATO
через `grant_reward_once`. Ончейн-покупка поля (`buy_field_skr` / `buy_field_sol`) —
другая рельса: там минтит сама программа, ручная выдача не требуется.

## 0. Инварианты (нельзя обойти)

| Инвариант | Где закреплён |
| --- | --- |
| Одна выдача на заказ: `nonce` = id заказа; ончейн-PDA `["reward", ATA, nonce]` создаётся через `init` | `programs/solana_potato/src/lib.rs` (`grant_reward_once`), `apps/web/.../delivery` → `backend/src/presale/delivery.ts:29` |
| Интент идемпотентен по `(recipient_ata, nonce)`: повторный `deliver` вернёт **тот же** интент, а не второй | `backend/src/gameops/intents.ts` (`createIntent`), схема `reward_intents` |
| Переходы интента: `pending → submitted → confirmed`, из `pending`/`submitted` — `failed`/`expired`; терминальные не переигрываются | `backend/src/gameops/intents.ts:147,160` |
| `delivered` у заказа возможен только при `intent.state = 'confirmed'` | `backend/src/routes/presale.ts` (`/admin/orders/:id/delivered`) |
| Окно подписи: `expiresAt` ≤ 900 секунд от времени цепи | `MAX_REWARD_EXPIRY_SECONDS` (`lib.rs`), зеркало в `presale/catalog.ts` |
| Один пак ≤ `MAX_REWARD_MICRO` (1000 POTATO) — ровно одна транзакция на заказ | `presale/catalog.ts`, тест `presale.test.ts` |
| Приватный ключ authority не попадает в сервер, репозиторий, чат, CI и облако | чек-лист §7 |

## 1. Предусловия

- Бэкенд поднят с `GAME_OPS_DATABASE_URL` и `ADMIN_API_TOKEN` (≥32 символов) — админ-эндпоинты отвечают на `/api/presale` и `/api/gameops` с `Authorization: Bearer $ADMIN_API_TOKEN`.
- Лендинг видит бэкенд: в проде — Cloudflare Pages Function
  `landing/functions/api/[[path]].js` с переменной Pages-проекта
  `PRESALE_API_ORIGIN=https://<бэкенд>` (без `/api`). Без неё `/api/*` отвечает
  `503 presale_api_not_configured`, и купить пак через форму нельзя.
- `VITE_PRESALE_RUN` (лендинг и игра) совпадает с `PRESALE_RUN_ID` тиража — по
  умолчанию `wave1`. Если id разойдётся, баннер покажет пустую цену/остаток.
- Если игра ходит в бэкенд напрямую (`VITE_BACKEND_URL`), origin игры должен
  быть в `CORS_ORIGIN` бэкенда — иначе счётчик Фазы 1 в игровом окне не
  загрузится (сам блок условий от этого не зависит).
- Есть `RPC_URL` нужного кластера (**devnet или mainnet — проверьте дважды**) и `PRESALE_RUN_ID` открытого тиража (открывается `yarn presale:open-run`, W1.1).
- Authority-ключ доступен только на офлайн-носителе (см. §7). На сервере его быть не должно.
- Заказы в очереди на выдачу: `state = 'paid'`.

Во все POST-запросы ниже добавляйте заголовок `X-Actor: <имя оператора>`: он попадает
в журнал `game_ops.actor` и в аудит; без него все действия запишутся как `admin:api`,
и разобрать инцидент будет не по чему.

### 1.1 Открыть тираж (W1.1)

Тираж открывается одной идемпотентной командой (повтор с теми же параметрами ничего
не меняет и не падает; повтор с другими — exit 1, потому что цена/cap/казначейство
неизменяемы):

```bash
cd game
GAME_OPS_DATABASE_URL="$GAME_OPS_DATABASE_URL" ADMIN_API_TOKEN="$ADMIN_API_TOKEN" \
PRESALE_RUN_ID=wave1 PRESALE_PACK_ID=meadow-4 PRESALE_CURRENCY=skr \
PRESALE_PRICE_UNITS=888000000 \
PRESALE_TREASURY=<ATA казначейства SKR> \
PRESALE_CAP=500 \
  yarn presale:open-run
# exit 0 — открыт (или уже был открыт с теми же параметрами)
# exit 1 — расхождение параметров / тираж закрыт / ошибка БД
# exit 2 — конфигурация: нет env, нет GAME_OPS_DATABASE_URL или схема не развёрнута
```

`PRESALE_PRICE_UNITS` — в базовых единицах: лампорты для `sol`, атомы (6 знаков) для `skr`.
Примеры: `250000000` = 0.25 SOL, `888000000` = 888 SKR (цена пака Фазы 1, решение владельца
2026-10-06), `1053000000` = 1053 SKR (цена ончейн-модуля Фазы 2). Цена —
решение оператора, а не константа; проверка «пыль пренебрежима» (`price ≥ cap × 1000`)
выполняется при открытии. Для `skr` в `PRESALE_TREASURY` — **токен-аккаунт (ATA)**, для
`sol` — кошелёк.

Срок выдачи, который виден покупателю до оплаты: **в день листинга на mainnet**.
Формулировка продублирована в баннере лендинга (`landing/PresaleBanner.tsx`) и в
блоке Фазы 1 в игре (`Phase1Notice.tsx`).

Юридического гейта перед открытием тиража нет: юрблок снят с скоупа решением
владельца 2026-10-06 (RFC §6). Решение владельца, не технический вывод — ранбук
описывает операцию, а не правовые последствия.

Переменные окружения, которые понадобятся дальше (значения — с офлайн-носителя, не из репозитория и не из чата):

```bash
export API="https://<бэкенд>"
export RPC_URL="https://<rpc-провайдер>"
export ADMIN_API_TOKEN="<токен администратора>"
export PRESALE_RUN_ID="wave1"
export AUTHORITY_KEYPAIR_PATH="/media/usb/authority.json"   # офлайн-носитель
```

## 2. Шаг 0 — сверка перед любой выдачей (W1.3)

Выдавать можно только при `ok:true`. Проверьте это **до** первого `deliver` и после каждой
пачки выдач.

```bash
cd game
GAME_OPS_DATABASE_URL=… ADMIN_API_TOKEN=… RPC_URL="$RPC_URL" PRESALE_RUN_ID="$PRESALE_RUN_ID" \
  yarn presale:reconcile
# exit 0 — расхождений нет, выдавать можно
# exit 1 — расхождения (chainOnly / dbOnly / amountMismatch / walletMismatch / duplicateSignature):
#          СТОП, разбираться до выдачи
# exit 2 — проверка не выполнена: нет конфигурации, тираж не тот или тираж в SKR
#          (для SKR автосверки нет — см. ниже)
```

Эквивалент по HTTP (для журнала): `GET /api/presale/admin/reconcile?runId=$PRESALE_RUN_ID` →
`{ report: { ok, matched, chainOnly, dbOnly, amountMismatch, walletMismatch, duplicateSignature }, payers }`.

**Честное ограничение.** Автосверка сравнивает **SOL**-историю казначейства
(`fetchTreasuryTransfers` читает SOL-переводы на адрес `treasury`). Поэтому:

- **SOL-тираж** — это полноценный гейт, как описано выше.
- **SKR-тираж** — автоматического гейта нет, и CLI это признаёт: `yarn presale:reconcile`
  для SKR **не запускает** SOL-сверку и выходит с кодом **2**, а не 0 — чтобы зелёный exit
  нельзя было принять за пройденный гейт. HTTP `GET /api/presale/admin/reconcile` отвечает
  `400 VALIDATION` («Автоматическая сверка пока реализована для SOL-тиражей»). Ни то, ни
  другое не является доказательством получения SKR — решает только поштучный `verify`.

Гейт для SKR — поштучная проверка каждого заказа:

```bash
# для каждого заказа перед выдачей: подтверждает финализированный перевод SKR в казначейство
curl -sS -X POST "$API/api/presale/admin/orders/<ORDER_ID>/verify" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
# ожидается verdict.ok = true; иначе заказ не выдавать
```

## 3. Шаг 1 — очередь на выдачу

```bash
curl -sS "$API/api/presale/admin/pending" -H "Authorization: Bearer $ADMIN_API_TOKEN"
# массив заказов в state='paid' (ORDER BY paid_at, id)
```

Дополнительно: `GET /api/presale/admin/attention` — всё, что требует глаз оператора
(`payment_seen`, просроченные брони, возвраты).

## 4. Шаг 2 — интент на выдачу (идемпотентно)

Для каждого заказа из очереди:

```bash
curl -sS -X POST "$API/api/presale/admin/orders/<ORDER_ID>/deliver" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
# → { "intentId": 123, "reused": false,
#     "plan": { "recipientAta": "…", "amountMicro": "1000000000", "nonce": "42",
#               "reason": "presale:meadow-4:order:42", "grants": 1 } }
```

- `plan.nonce` — **id заказа** (ончейн-гейт повторной выдачи); `plan.amountMicro` — сумма пака.
- Повторный вызов безопасен: вернётся тот же `intentId` с `reused: true`, второй интент не создаётся.
- Суммы приходят строками (bigint в JSON не переносится): в коде приводите через `BigInt(...)`.

## 5. Шаг 3 — сборка ОДНОЙ транзакции

Сохраните разовый сборщик в `game/tmp-deliver-one.ts` (файл **не коммитится**, после работы удалите;
это ручной инструмент, а не часть продукта), затем запустите его из `game/`.

```ts
// game/tmp-deliver-one.ts — одна выдача grant_reward_once, вручную.
// Запуск: ARES1_RECIPIENT_ATA=… ARES1_AMOUNT_MICRO=… ARES1_NONCE=… \
//         AUTHORITY_KEYPAIR_PATH=… RPC_URL=… PROGRAM_ID=… PAYER_KEYPAIR_JSON=… \
//         yarn tsx tmp-deliver-one.ts
import fs from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { buildGrantRewardOnceIx, configPda, epochPda, fetchConfig } from './apps/backend/src/solana.js';

const claim = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} не задан`);
  return value;
};

const connection = new Connection(claim('RPC_URL'), 'finalized');
const authority = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(claim('AUTHORITY_KEYPAIR_PATH'), 'utf-8'))),
);

const config = await fetchConfig();                    // configPda + decodeGameConfig
if (!config.authority.equals(authority.publicKey)) {
  throw new Error(`Ключ не совпадает с authority конфига (${config.authority.toBase58()}) — СТОП`);
}

const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 600); // ≤ 900 c, см. §0
const ix = buildGrantRewardOnceIx({
  config: configPda(),
  epoch: epochPda(config.epochId),
  authority: authority.publicKey,
  potatoMint: config.potatoMint,
  userPotato: new PublicKey(claim('ARES1_RECIPIENT_ATA')),   // = plan.recipientAta
  nonce: BigInt(claim('ARES1_NONCE')),                       // = plan.nonce (id заказа)
  amountMicro: BigInt(claim('ARES1_AMOUNT_MICRO')),          // = plan.amountMicro
  expiresAt,
});

const tx = new Transaction().add(ix);
tx.feePayer = authority.publicKey;                     // authority платит rent за claim-PDA и комиссию
const signature = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: 'finalized' });
console.log(JSON.stringify({ signature, expiresAt: expiresAt.toString() }));
```

Замечания по зависимостям модуля: `backend/src/solana.ts` читает `RPC_URL`, `PROGRAM_ID` и
`PAYER_KEYPAIR_JSON` из env. `PROGRAM_ID` — адрес программы **того кластера, в котором выдаёте**:
devnet-адрес из `Anchor.toml` или mainnet-адрес после деплоя (по RFC §12 выдача Фазы 1 идёт на
mainnet, программа там собирается заново — не подставляйте devnet-адрес в mainnet-транзакцию).
`PAYER_KEYPAIR_JSON` — любой локальный keypair (в этой транзакции он не используется,
требование модуля).

Перед подписью глазами сверьте: `recipientAta`, `amountMicro`, `nonce` = id заказа, кластер
(devnet/mainnet) и что `config.authority` совпал с ключом.

## 6. Шаги 4–6 — подпись, фиксация, закрытие заказа

```bash
# 4. подпись и отправка — вывод предыдущего шага
SIGNATURE="<signature из шага 3>"
INTENT_ID=123; ORDER_ID=97

# 5a. submitted: подпись фиксируется навсегда
curl -sS -X POST "$API/api/gameops/intents/$INTENT_ID/submitted" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"signature\":\"$SIGNATURE\"}"

# 5b. проверьте на цепи, что POTATO пришли на plan.recipientAta (баланс ATA вырос на amountMicro)
#     и возьмите slot финализированной транзакции
SLOT=$(curl -sS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":[\"$SIGNATURE\",{\"encoding\":\"json\",\"maxSupportedTransactionVersion\":0}]}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["slot"])')

# 5c. confirmed: только после финализации
curl -sS -X POST "$API/api/gameops/intents/$INTENT_ID/confirmed" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"signature\":\"$SIGNATURE\",\"slot\":$SLOT}"

# 6. заказ → delivered (требует intent.state = 'confirmed')
curl -sS -X POST "$API/api/presale/admin/orders/$ORDER_ID/delivered" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"intentId\": $INTENT_ID}"
```

Журнал выдачи (обязателен): `order_id, intent_id, signature, slot, recipient_ata, amount_micro,
run_id, дата/время, кто выдал`. Храните вне репозитория.

## 7. Чек-лист офлайн-хранения authority-ключа

1. Ключ authority **не** лежит на сервере с бэкендом, в репозитории, в CI-секретах, в облаке,
   в мессенджерах и в буфере обмена.
2. Носитель: аппаратный кошелёк или зашифрованный съёмный носитель (FileVault/LUKS).
   Пароль/фраза — отдельно от носителя, в сейфе.
3. Перед каждой подписью: сверка `config.authority == pubkey` ключа (скрипт выше падает,
   если это не так), кластера, `recipientAta`, `amountMicro`, `nonce`.
4. Для партий > ~10 заказов — принцип двух человек: один собирает и подписывает, второй
   сверяет план (заказ ↔ интент ↔ транзакция) и журнал.
5. Никаких скриншотов keypair-файла, никаких копий «на всякий случай» в других местах.
6. После работы — размонтировать/убрать носитель; проверить `git status` в репозитории:
   временный сборщик и журнал не должны попасть в коммит.
7. Ротация/смена authority — только штатными инструкциями программы с согласованием
   (см. `game/docs/OPERATIONS.md`, `game/docs/KEY_PROVENANCE.md`).
8. При подозрении на компрометацию — немедленный kill switch `update_presale_price(0)`
   (закрывает обе рельсы пресейла) и далее по `game/docs/INCIDENT_RESPONSE.md`.

## 8. Пропускная способность и тайминги

- `grant_reward_once` тратит квоту ручных грантов: 10 % от **капа эпохи**
  (`epoch.mint_cap_micro`), а не от фиксированной константы. Кап эпохи зажат в
  `[daily_mint_cap_micro, 3 × daily_mint_cap_micro]` (RFC §12.1), поэтому квота — это
  диапазон **25 000 … 75 000 POTATO/сутки**, а не одно число: пак = 1000 POTATO →
  **25 … 75 паков в сутки**. Волна в 500 паков — от ~7 до ~20 суток выдачи, и под
  нагрузкой квота поднимается сама (ось утилизации в `roll_epoch`).
  Нижняя оценка закреплена в `packsPerDay` / `deliveryDays` (`presale/catalog.ts`).
- Ончейн-покупка Фазы 2 (`buy_field_sol` / `buy_field_skr`) **не тратит** квоту грантов
  вообще: в `buy_field_sol` нет ни `mint_to`, ни `charge_epoch_grant` (RFC §12.1).
- Клейм-окно 900 секунд ограничивает **вашу подписанную транзакцию**, а не действия
  покупателя: `grant_reward_once` минтит прямо в ATA получателя в той же транзакции
  (RFC §12.1), а `reward_claim` — маркер защиты от повтора. Покупатель может быть офлайн.
- Но из этого следует: подписывайте и отправляйте сразу; подписанная транзакция «на потом»
  обесценивается через 900 c (защита от replay).
- Один заказ = ровно одна транзакция (пак ≤ `MAX_REWARD_MICRO`).

## 9. Ошибки и что делать

| Симптом | Причина | Действие |
| --- | --- | --- |
| `verdict.ok = false` при `verify` | платёж не подтверждён цепью | не выдавать; разобрать платёж вручную (`admin/attention`) |
| `INVALID_TRANSITION` на `delivered` | интент ещё не `confirmed` | выполнить шаг 5b–5c |
| `INVALID_TRANSITION` на `submitted` | интент не в `pending` | посмотреть `GET /api/gameops/intents/:id`; не переигрывать терминальные состояния |
| `DUPLICATE_INTENT` | подпись уже привязана к другому интенту | СТОП: разбираться (возможен двойной учёт) |
| `MIGRATIONS_MISSING` (503) | схема не развёрнута | `yarn db:migrate`, затем повторить |
| `DB_UNAVAILABLE` (503) | база недоступна | повторить позже, ничего не «додумывать» руками |
| транзакция не ушла (таймаут сети) | сеть/RPC | интент остаётся `pending`: пересоберите транзакцию и отправьте снова (nonce не сожжён) |
| транзакция ушла и упала на цепи | программа отклонила | `POST /api/gameops/intents/:id/failed` c кодом (`TX_FAILED_ONCHAIN`), заказ остаётся `paid`; см. §10 |
| `expiresAt` истёк до отправки | задержка подписи | пересобрать с новым `expiresAt` (интент всё ещё `pending`) |

## 10. Известные ограничения (честно)

1. **Автосверка только для SOL** (§2). Для SKR автоматического гейта нет — только поштучный `verify`.
2. **Терминальный `failed`/`expired` интент не переиграть** тем же `(recipient_ata, nonce)`:
   onчейн-гарантия «одна выдача на заказ» завязана на `nonce = id заказа`. Пока это
   эскалационный случай (заказ остаётся `paid`, POTATO вне рельсы не выдаём); менять схему
   nonce без решения владельца продукта нельзя.
3. Выдача не пройдёт, если у authority нет lamports на rent claim-PDA и комиссию.
4. Ранбук описывает выдачу **вручную**; любые скрипты-циклы, планировщики и «подпись на сервере»
   противоречат зафиксированному решению.
5. **Лимит 5 паков на кошелёк** остаётся в ончейн-рельсе Фазы 2 (`BuyerPresaleCounter`,
   `lib.rs:636`), хотя в офчейн-тираже Фазы 1 per-wallet лимита нет (решение владельца).
   Практическое следствие: покупатель Фазы 1 может набрать больше 5 паков, но при трате
   POTATO на ончейн-покупку упрётся в потолок 5 (RFC §4.5). Это не баг ранбука и не повод
   добавлять лимит в Фазу 1 — это расхождение двух рельсов, зафиксированное для владельца.
6. **Юридический гейт до первой оплаты** (RFC §6): приём денег без юрлица/Impressum, раздела
   о предоплате в Terms и решения по 14-дневному праву потребителя ЕЭС — не готов. Ранбук
   описывает операцию, а не легальность её запуска.
7. **Платёж после закрытия тиража** — единственное исключение из «возвратов нет», которое
   надо решить явно (RFC §4.3, риск R3): либо автоматический возврат единственному плательщику,
   либо иная письменная политика. Ранбук этого не решает за владельца.
8. «Возвратов нет» — операционное правило тиража, а не юридическая формулировка.
   Императивные права потребителя (в ЕЭЗ — в том числе право на отказ) решением
   владельца не сопровождаются документами (RFC §6) и остаются на нём.

## 11. Код, на который опирается ранбук

- `game/apps/backend/src/presale/delivery.ts:29` — `planDelivery` (ATA, сумма, nonce = id заказа).
- `game/apps/backend/src/solana.ts:100` — `buildGrantRewardOnceIx` (+ `rewardClaimPda`).
- `game/apps/backend/src/gameops/intents.ts:147,160` — `markSubmitted`, `markConfirmed`.
- `game/apps/backend/src/routes/presale.ts` — `/admin/pending`, `/admin/orders/:id/deliver|delivered|verify|refund`, `/admin/reconcile`.
- `game/apps/backend/src/routes/gameops.ts:174,182,191` — `/intents/:id/submitted|confirmed|failed`.
- `game/apps/backend/src/presale/catalog.ts` — `packsPerDay`, `deliveryDays`, `MAX_REWARD_EXPIRY_SECONDS`.
- `docs/PRESALE_PHASE1_RFC_2026-10-06.md` — §5 (вариант A), §6 (юргейт), §12 (реальная
  пропускная способность, квота эпохи, отсутствие клейма у покупателя).
