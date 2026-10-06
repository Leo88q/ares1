# ПРОМТ ДЛЯ СЛЕДУЮЩЕГО ЧАТА: Пресейл ARES-1, волны 1 и 2

> Скопируй этот документ целиком как первое сообщение нового чата.
> Он самодостаточен: контекст, зафиксированные решения, что уже в main, что сделать, как проверить.

---

## Роль и правила
Ты — инженер в репозитории `Leo88q/ares1` (клон в `/home/user/ares1`). Работай на ветке,
которую тебе назначила сессия (обычно `arena/<id>-ares1`): коммить, пушь и открывай PR **только**
в неё и в `main` как базу. Не переключайся на другие ветки. Если что-то непонятно — **задавай
вопросы пользователю по одному**, не пачкой.

Базовое состояние: в `main` уже слит PR **#56** (merge `3380333`, коммит `1fb1c9a`).
Всё, что перечислено ниже как «уже в main», — есть в кодовой базе; не пиши это заново,
а строй поверх и проверяй, что оно работает.

## Зафиксированные продуктовые решения (НЕ переспрашивай, НЕ меняй)
1. **Выдача — в POTATO.** Предоплата (SOL или SKR) сейчас, POTATO на кошелёк — при запуске mainnet.
2. **Валюты: SOL и SKR.** Обе поддерживаются (`currency IN ('sol','skr')`).
3. **Без возвратов, без эскроу, без заморозки.** Офф-чейн предоплата (волна 1).
4. **Бюджет < 1 SOL**: mainnet сейчас НЕ деплоим.
5. **Один кошелёк может купить СКОЛЬКО УГОДНО паков** на пресейле. Per-wallet лимита НЕТ и добавлять его НЕ НАДО.
   Лимит тиража считается по количеству заказов (`cap`), а не по уникальным кошелькам.
6. **Объёмы: волна 1 = 500 паков, волна 2 = 500 паков.** `cap` задаётся оператором при открытии тиража, не хардкодом.
7. **Выдача POTATO — ВРУЧНУЮ оператором на mainnet.** Авто-signer-бот НЕ нужен и писать его НЕЛЬЗЯ.
   Задача следующего чата — ранбук ручной выдачи (см. W1.2), а не код бота.

## Что УЖЕ в main (из PR #56) — использовать как есть
- **Бэкенд** `game/apps/backend/src/presale/`: `catalog.ts` (паки, `packPotatoMicro`, `MAX_REWARD_MICRO`),
  `orders.ts` (reserve/attach/confirm/refund/expire, `RUN_SOLD_OUT` при `reserved_count>=cap`,
  монотонный `order_no`, пыль = `order_no`), `verify.ts`, `reconcile.ts`, `delivery.ts` (`planDelivery`,
  nonce = id заказа), `chain.ts` (RPC→view).
- **Роуты** `routes/presale.ts` (публичные: `/packs`, `/runs/:id`, `/reserve`, `/orders/:n/payment`,
  статус; админ: `/admin/runs`, `/verify`, `/deliver`, `/delivered`, `/refund`, `/reconcile`),
  смонтированы на `/api/presale`; `routes/shared.ts`.
- **Миграции** `game/migrations/game_ops/0004..0006` (схема, guards, роли).
- **CLI** `game/scripts/presale-reconcile.ts` (сверка цепь↔БД, exit 0/1).
- **UI игра**: `CaseReveal.tsx` + css (кейс трясётся→вспышка→редкость), подключён в `MainScreen`
  (POTATO) и `PresaleSection` (SKR). Арт `public/ares/case-sealed.png`, `case-burst.png` (барочная
  золотая капсула, единый стиль с `cassette-*.webp`).
- **UI лендинг**: `PresaleBanner.tsx` + css (резерв→инструкция→подпись), смонтирован после `<Hero>`;
  тот же арт в `landing/public/ares/`.
- **Тесты**: backend `tests/presale.test.ts`, `tests/delivery.test.ts`; db `tests/db/presale-db.test.ts`.

## ВОЛНА 1 (офф-чейн предоплата) — что ОСТАЛОСЬ сделать
W1.1 **Открыть тираж.** Тираж сам не открывается. Нужен idempotent-скрипт `game/scripts/presale-open-run.ts`
(читает env, открывает тираж `cap=500`, не падает если уже открыт), чтобы бету можно было поднять одной командой.
W1.2 **Финальная выдача POTATO — ВРУЧНУЮ (решение зафиксировано).** `grant_reward_once` требует
authority-подписи; авто-бота НЕТ и писать его НЕЛЬЗЯ. Твоя задача — написать **ранбук ручной выдачи**
(`docs/PRESALE_DELIVERY_RUNBOOK.md`): как из `pending` интентов собрать транзакции
`buildGrantRewardOnceIx`, подписать authority-ключом вручную, отправить, пометить
`markSubmitted`/`markConfirmed`, затем `/admin/orders/:id/delivered`. Плюс чек-лист безопасного
хранения authority-ключа офлайн. Это закрывает выдачу без какого-либо кода бота.
W1.3 **Сверка перед выдачей.** Использовать `presale-reconcile.ts` / `/admin/reconcile`; выдавать только при `ok:true`.

## ВОЛНА 2 (он-чейн пресейл) — что ОСТАЛОСЬ сделать
W2.1 Он-чейн покупка `buy_field_presale`/`buy_field_sol` уже в программе; UI-раскрытие кейса уже есть.
Проверь, что `PresaleSection` корректно читает sold/cap из on-chain `PresaleState` PDA и что константа
`PRESALE_CAP=500` в UI совпадает с он-чейн лимитом. Если он-чейн кап отличается — приведи UI к он-чейн
значению (истина — в программе, не в константе).
W2.2 Убедись, что тир раскрытия берётся из on-chain состояния поля (`data[67]`), а не из UI.

## Обязательная матрица проверок (выполни и приведи вывод)
```
cd game && yarn install --frozen-lockfile --non-interactive
cd landing && npm install --no-audit --no-fund
cd game && yarn workspace backend typecheck          # чисто
cd game && yarn workspace backend test               # node --test, все pass
cd game && yarn test:guards
cd game && yarn test:offchain
cd game && ./node_modules/.bin/tsc -p tsconfig.tools.json --noEmit
cd game && ./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit
cd game && yarn workspace web build
cd landing && npm run typecheck && npm test && npm run build
# DB-проверки требуют живой Postgres (GAME_OPS_DATABASE_URL): db-migrate, db-тесты, db-verify.
# Если в песочнице нет сервера и apt заблокирован — честно скажи, что DB-часть не прогнана.
```

## Финиш
Коммить на свою ветку, пушь, открой PR в `main`. В описании PR перечисли, какие пункты W1/W2 закрыты
и какие проверки прошли. Не удаляй ветку после мерджа.
