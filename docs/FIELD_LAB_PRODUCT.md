# Полевая лаборатория `/lab`: продуктовая секция поля

**Дата среза: 2026-10-17.** Учебная песочница `/demo` (`DemoScreen`, `FarmTab`, `SectionArtPreview`) удалена, а «ARES—1 / FIELD LAB» переработана в продуктовую секцию игры — так же, как ранее была встроена вкладка колонии. Это визуальная/ресурсная надстройка над существующими полями и рынком: on-chain yield, программа, цены и комиссии не изменены.

## 1. Вход из игры

- Седьмая клавиша нижнего пульта — **ЛАБ** (иконка `/ares/icons/gauge.webp`, позиция K2 после АГРО). Порядок: АГРО · ЛАБ · КОЛОНИЯ · СНАБ · ЖУРНАЛ · КАЮТА · ОПЕРАЦИЯ.
- Клавиша ведёт на маршрут **`/lab`** (`FieldLabScreen`, lazy-импорт в `App.tsx`) внутри того же шелла: тот же `AresBottomNav`, тот же бронзовый кит, никаких отдельных страниц и второго пульта.
- Прежний дублирующий переключатель ПОЛЯ/ЛАБОРАТОРИЯ внутри АГРО убран: АГРО показывает только настоящую игру. Старый адрес `/demo` редиректит на `/lab` (`<Navigate to="/lab" replace />`).
- Экран входит в `ColonyProvider`, поэтому сток колонии общий с `/base`.

## 2. Реальные данные игры

С кошельком лаборатория не выдумывает ни одного числа:

| Блок | Источник |
| --- | --- |
| Поля, выбор по `publicKey`, пять действий | `useGame()` → `fields`, `harvest`, `upgradeField`, `repairField`, `payTax`, `applyFertilizer`, `purchaseField(tier)` |
| Балансы и статусы | `useGame().stats`: `potatoBalance`, `skrBalance`, `pendingHarvest`, `licenseActive`, `batchLimit` |
| Суточный выход поля | `dailyYieldMicro({ ...field, epochId }, useSolana().config, nowSec)` — живая конфигурация цепи и текущая эпоха |
| Цены/налог/окупаемость ярусов | зеркало программы в `organism/market.ts`: `microFieldPriceMicro`, `fieldYieldPerDayMicro`, `fieldTaxPerDayMicro`, `paybackDays` |
| Порог «готово к сбору» | `HARVEST_THRESHOLD_MICRO` из `organism/parameters.ts` |
| Ордер-бук POTATO/SOL | `useMarketplace()` — монтируется только при `connected`, значения уже в POTATO/SOL (без повторного деления на `MICRO`) |
| Лимит привязки полей к колонии | `canLinkFieldToColony(linked)` и `MARKET.colonyLinkedFieldCap = 24` |

`live = connected && ownedFields.length > 0`. Если условие не выполнено, `panelFields` переключается на учебные стенды, а слой — на `demo`: подпись **«УЧЕБНЫЙ СТЕНД · НЕ АККАУНТ КОШЕЛЬКА»**, стенды `lab-bench-0/1/2` (тиры 0/1/2), вместо книги рынка — **«НЕТ КОШЕЛЬКА»**.

Действия остаются настоящими: сбор, ремонт, удобрение, налог и покупка поля тратят POTATO через прежние callbacks. Инженерный SIM (ARES-LAB/2) — обучающий слой поверх того же `field.publicKey`: он не минтит токены, не подписывает транзакции и ничего не сохраняет между сессиями.

## 3. Один сток колонии на сессию

- `colony/ColonyContext.tsx` — общий стор (`COLONY_TICK_MS = 1200`), `ColonyProvider` оборачивает приложение, `useColony()` возвращает `shared ?? local`. Отдельного localStorage нет: перезагрузка начинает новую экспедицию.
- Лаборатория берёт из колонии воду, питание и запчасти и отдаёт партии еды в её хранилище; `/base` и `/lab` видят одни и те же литры, кВт·ч, кг, запчасти, пады и еду.
- Оба журнала пишутся в одном действии: списание стока и приход еды неразрывны, поэтому масса сохраняется.

Правила моста (`lab/bridge.ts`, `lab/economics.ts`):

- шаги снабжения: **вода 40 л**, **питание 0.2 кг**, **запчасти 1 шт.**; источники — `waterLitres`, `nutrientsKg`, `sparesKg`; мост семян отсутствует (семена — часть SIM-профиля);
- выдача = `min(шаг, остаток колонии, свободное место стенда)`; запас места считает `supplyRoom(...)` из `fields/engineering/engine.ts`, запчасти — только целые штуки, 1 запчасть = 1 кг;
- остаток меньше шага не теряется и не округляется вверх: если колония не может покрыть шаг, операция не выполняется;
- отгрузка еды = `min(lot.kg, запрошено)` → `totals.shippedKg` и `receiveLabFood(state, kg, 'raw' | 'processed')`, что увеличивает `harvestedKg` в `ledger` колонии;
- при нулевом свободном месте (`storageCapKg - rawKg - processedKg = 0`) база отказывает, и партия остаётся на стенде — UI показывает **«ПРИНЯТО БАЗОЙ ЗА СЕАНС»** только после фактического прихода;
- параметры стенда (`organism/parameters.ts:15-26`): бак 120/100 л, старт снабжения 240 л, питание 0.65/0.16, семена 3, запчасти 3, сбор 18 кг, ёмкость хранилища 45 кг, ёмкость снабжения 480 л, питание 2 кг, запчасти 9 шт.; масштаб по тиру `labScale = [1, 1.35, 1.7]` (бак/снабжение/линия/питание), семена = `seedsInitial - 1`.

Действия с колонией приостанавливаются, пока идёт её тик: при **«ЗАПУСТИТЬ»** карточка связи показывает **«ОСТАНОВИ ЧАСЫ КОЛОНИИ»**, а передача снабжения и «+1 день» отключаются до **«ОСТАНОВИТЬ»**.

## 4. Мобильная версия

- Мобильная раскладка первая: breakpoints 1500/1250/1000/820/700/480/360 px в `lab/lab.css`; на телефоне — одна колонка, таблица рынка превращается в карточки, нижние вкладки (Сервис/Управление) собирают действия.
- Клиренс над фиксированным пультом: `.lab-main` — `12px 12px 124px`, `.colony-app--embedded .colony-main` — 124 px, `.main-screen-container` — 140/130 px.
- Все интерактивные элементы ≥ 44×44 px на ширине ≤480 px: новый блок в `fields/art-direction.css` закрывает `.mf-view-toggle`, `.mf-source-tabs`, `.mf-scene-options`, `.mf-button`, `.eg-console`, `.eg-telemetry`, вкладки консоли/палубы, `.mf-camera-controls button`, `.mf-footer a`, ползунки `.mf-panel input[type='range']` и `.field-action-btn`; в `lab/lab.css` — `.lab-hero-chip a` (inline-flex, min-height 44, фокус-кольцо), мёртвый `.lab-inline-key` удалён.
- Семь клавиш пульта при 320 px остаются ≥44 px по высоте и ≥40 px по ширине (`.hull-nav` padding 6 px, `.hull-nav-key { flex: 1; min-height: 54px }`).
- Локализации: 98 lab-ключей в шести словарях (`en`, `es-419`, `id`, `pt-BR`, `tl`, `vi`), 22 demo-ключа удалены; `i18n-parity.test.mjs` проверяет совпадение наборов.

## 5. Проверки

```sh
cd game
yarn workspace web tsc --noEmit            # типы, включая noUnusedLocals/noUnusedParameters
yarn workspace web node --test tests/*.test.mjs   # статические проверки (i18n, copy, секции, мост)
yarn test:offchain                          # tests/offchain/labColonyBridge.test.ts (10), fieldEngineering.test.ts (29)
CHROMIUM_EXECUTABLE_PATH=/path/to/chrome yarn workspace web test:lab-browser
CHROMIUM_EXECUTABLE_PATH=/path/to/chrome yarn workspace web test:browser-no-webgl   # colony + engineering + fields + lab
CHROMIUM_EXECUTABLE_PATH=/path/to/chrome yarn workspace web test:tap-audit          # /, /lab, /base, /market, /stats, /profile, /operation
```

`tests/lab-browser-smoke.mjs` проходит продуктовый сценарий на реальном preview-сервере: живые поля и книга рынка → передача воды в SIM и отчёт «ПЕРЕДАНО ИЗ КОЛОНИИ: 40» → пауза на время тика колонии → «+7 солов» + «Собрать еду SIM» → отгрузка в базу с ростом её стока → учебные стенды без кошелька (тот же общий сток) → 400/390/360/320 px с контролем 44 px; затем проверяет отсутствие внешних запросов и ошибок консоли. Фикстуры: `tests/lab-fixture.mjs` (`/__${slug}/main`, шпионы `__fieldCalls`, `__reorderFields`, `__setLang`), `tests/section-nav-fixture.mjs` (пульт), `tests/fields-main-fixture.mjs`, `tests/market-art-fixture.mjs`. CI: job *Browser smoke (colony, engineering, fields, lab, sections, tap audit)* в `.github/workflows/ci.yml`.

Известные ограничения: браузерные проверки требуют установленного Chromium и не скачивают его; WebGL-сцену можно отключить `NO_WEBGL=1`. Предустановочная база колонии стартует с полным хранилищем (free = 0), поэтому первая отгрузка возможна только после того, как еда освободится или будет съедена/переработана.

## 6. Чего не обещать

- SIM-еда, литры, кВт·ч и запчасти — внутриигровая бухгалтерия сессии; это не токены, не килограммы для выдачи и не конвертация POTATO в продукты.
- Стенды без кошелька — не аккаунты, не NFT-поля и не отдельная экономика.
- Реальные devnet/mainnet-транзакции этим срезом не выполнялись; действия с POTATO идут через прежние callbacks основной игры и требуют кошелька.

## 7. Файлы

- `game/apps/web/src/lab/{bridge.ts,economics.ts,FieldLabScreen.tsx,lab.css}`
- `game/apps/web/src/colony/{ColonyContext.tsx,ColonyScreen.tsx}`
- `game/apps/web/src/fields/{FieldsPanel.tsx,copy.ts,fields.css,art-direction.css}`, `fields/engineering/{engine.ts,copy.ts,EngineeringConsole.tsx,engineering.css}`
- `game/apps/web/src/{App.tsx,main.tsx}`, `components/{AresBottomNav.tsx,MainScreen.tsx,OperationScreen.tsx}`, `components/ares/{SupplyBay,StatsBay,CabinBay}.tsx`, `ui/hull-ui.css`
- `game/apps/web/src/organism/{parameters.ts,market.ts,unified.ts}`
- `game/apps/web/src/i18n/strings/*.ts`, `game/apps/web/tests/*`, `game/tests/offchain/labColonyBridge.test.ts`
- Удалено: `components/DemoScreen.tsx`, `components/ares/FarmTab.tsx`, `components/ares/farm-tab.css`, `components/ares/SectionArtPreview.tsx`
