# ARES — арт остальных отсеков

**2026-10-15.** Продолжение [первой арт-сборки фермы](WARM_MARS_ART_PASS.md), без новых механик: снабжение/рынок, журнал/статистика, каюта/профиль и корпус операции теперь используют общий иллюстрированный стиль.

## Добавленные изображения

Созданы **три отдельные фоновые иллюстрации**, не плоские интерфейсы:

- `market-background.webp` — погрузочный отсек, ящики/грузы, сервисный люк на терракотовую местность;
- `journal-background.webp` — приборный отсек с нейтральными абстрактными экранами, окно на зелёные ряды теплицы;
- `cabin-background.webp` — компактная каюта, шкаф, койка, рабочее снаряжение и пустые нашивки.

Все — вымышленные изображения для ARES, AI-generated в Arena, с теми же greenhouse/bronze-референсами. Без NASA-бренда, реальных измерений, внешних API или покупок. WebP оптимизированы; размеры/байты/SHA-256/происхождение в `public/ares/art/manifest.json`.

Три новых файла: **225 844 B**. Общий текущий арт-инвентарь: **9 файлов, 376 092 B**. Предыдущие фон фермы, предметные иконки, пустая кнопка и производная металлическая поверхность сохранены.

## Где используются

Новый asset-only `SectionFrame` принимает `section`, готовый фон/иконку, существующие локализованные `label`, `hud` и **неизменённые children**:

- `SupplyBay` → фон снабжения, настоящий `MarketScreen` (V1 по умолчанию);
- `StatsBay` → фон журнала, настоящий `StatsScreen`;
- `CabinBay` → фон каюты, настоящий `ProfileScreen`;
- маршрут `/operation` → такой же корпус журнала вокруг неизменённого `OperationScreen`.

В этих трёх Bay больше не рисуются SVG-пейзаж/стеклянная арка/звёзды по старой общей DomeFrame-схеме. Вместо одинаковой plantation-полосы у каждого отсека собственная сюжетная иллюстрация. Разметка и затемнение нужны только для читаемости; artwork — локальные файлы. Существующий HUD сохранён, новых показателей/данных он не получает.

`section-art.css` переиспользует готовые бронзовые панели, тёмную кнопку и металлическую поверхность. В functional screens не добавлены растровые надписи/запечённые цифры; controls и значения остаются live DOM.

## Навигационный пульт

Те же пять разделов и callback `onChange(item.id)` / haptic:

- АГРО — готовый росток;
- СНАБ — готовый ящик;
- ЖУРНАЛ — clipboard;
- КАЮТА — койка;
- ОПЕРАЦИЯ — mission/license icon.

Вместо процедурного hull SVG используется готовая поверхность/кнопки и реальные image icons. Активный раздел по-прежнему имеет `aria-current`/`aria-pressed`; фокус клавиатуры сохранён. Исправлена только реактивность локализованных подписей в memo: язык включён в зависимости, чтобы RU/EN переключение обновляло кнопки, а не оставляло предыдущий перевод.

## Безопасный арт-просмотр в существующем /demo

Нижний пульт `/demo` позволяет переключать оформление АГРО/СНАБ/ЖУРНАЛ/КАЮТА. При возврате в ферму её component остаётся mounted и **сохраняет выбранное поле/локальный сценарий**. ОПЕРАЦИЯ ведёт на настоящий раздел, не выдуманный сезон.

Отсеки `/demo` — **«АРТ-ПРОСМОТР · БЕЗ АККАУНТОВ И ТРАНЗАКЦИЙ»**:

- нет фальшивых кошельков, балансов, ордеров, статистики, наград;
- представлены только header/фон, предметные cards и ссылки на реальные `/market`, `/stats`, `/profile`;
- UI явно говорит, что данные доступны в основной игре;
- картинки являются иллюстрациями, не фото реального отсека или NASA-данными.

Прямые состояния: `/demo?section=market`, `/demo?section=stats`, `/demo?section=profile`. Неизвестное значение query возвращает АГРО. Прямой `/demo` всё ещё открывает прежнюю ферму/engineering SIM без кошелька/RPC.

## Неизменность функциональных экранов

SHA-256 сверены **побайтно неизменными**:

- `MarketScreen.tsx`, `StatsScreen.tsx`, `ProfileScreen.tsx`, `OperationScreen.tsx`;
- `GameContext.tsx`, `useMarketplace.ts`;
- `fields/engineering/engine.ts`, `utils/constants.ts`;
- Solana `lib.rs` и `public/_headers`.

Не изменены fees, prices, escrow rules, token amounts, field yields, rewards, initial V2 feature flag или авторизация. Все изменения — wrappers, CSS/assets, art-preview composition и navigation presentation. Commit/push/deploy, API credentials, покупки или реальные транзакции не выполнялись.

## Проверки

- TypeScript / production build: PASS.
- Web **22/22**, offchain **169/169**, guards **54/54**.
- Art inventory/hashes: PASS; поле-модели остаются **18 GLB + 4 notice, 338 808 B**.
- Release artifacts: **259 файлов, 0 failures / 0 warnings**.
- Production-CSP sections browser smoke: PASS — три фона действительно загружаются, готовые image icons, реальные route links, RU/EN-подписи, farm session continuity, 390/320px без переполнения.
- **Настоящий V1 `MarketScreen` и `CreateOrderModal`** с локальными provider spies: покупка получает прежний order key, отмена получает правильный key, оформление передаёт исходные amount/price; ровно три callbacks. Нет RPC/подписи/реальных транзакций. Fixture не публикуется в build.
- Регрессия engineering field UI под production CSP: PASS — прежние рост/сбор/партии/климат/приоритеты и пять field callbacks остаются безопасными.
- Нет внешних requests, неожиданных console/page/CSP errors. Production CSP не ослаблена.

Два промежуточных harness сбоя исправлены без изменения market behavior: ожидание decode новой фоновой картинки и выбор правильной кнопки `Оформить ордер` внутри существующей модалки. Итоговый повторный полный прогон PASS. Это software Chromium, не физический мобильный FPS-бенчмарк/проверка развёрнутого контракта.

```sh
cd game
yarn build:web
yarn workspace web preview  # другой терминал
CHROMIUM_EXECUTABLE_PATH=/path/to/chrome yarn workspace web test:sections-browser
```

Опционально: `SECTIONS_BASE_URL`, `SECTIONS_SCREENSHOT_DIR`, `CHROMIUM_ARGS_JSON`. Браузер установлен отдельно; тест его не скачивает.

Код: `components/ares/{SectionFrame,SectionArtPreview,SupplyBay,StatsBay,CabinBay,AresBottomNav}.tsx`, `section-art.css`, `DemoScreen.tsx` / route wrapper в `App.tsx`. Данные и функциональные Screen.tsx не переписаны. Все ассеты локальные; original generation PNG/временные bundles остаются вне Git.
