# UI Assets — «штампованная плита ARES-1»

Реестр растровых ассетов, которые потребуются для финальной сборки визуала.
**Сейчас все они заменены CSS/SVG-заглушками** (grain/царапины — inline SVG feTurbulence
в `game/apps/web/src/theme/tokens.css` и `landing/index.css`). Ни один растровый файл
в репозиторий не добавлен; компоненты продолжают работать на заглушках.

Формат записи: имя → размер → 9-slice отступы → промпт генерации.

---

## 1. `plate-face-metal.png` — базовая плита корпуса

- **Размер:** 512×512 px (RGB, PNG-24)
- **Использование:** фон `.mk-plate` / `.pf-card` (сейчас: CSS-градиент `--mk-face-hi/face/lo` + grain)
- **9-slice отступы:** top 96, right 96, bottom 96, left 96 — фаска по периметру; центр должен тайлиться
- **Промпт:** «Scuffed matte metal panel, warm dark brown steel oxide, machined edge bevel, subtle horizontal grain texture, faint circular scratch marks, no text, no rivets, flat top-down lighting, photorealistic material texture, seamless center»

## 2. `plate-face-brass.png` — латунная плита редкости

- **Размер:** 512×512 px
- **Использование:** `.pf-card--rare` (сейчас: CSS `linear-gradient(#A67C3D → #8A6430)`)
- **9-slice отступы:** top 96, right 96, bottom 96, left 96
- **Промпт:** «Aged brushed brass plate, dark oxide patina in recesses, machined bevel edge, fine diagonal brushing, museum plaque texture, no text, no glow, flat lighting, seamless center»

## 3. `plate-corner-rivets.png` — угловой набор болтов

- **Размер:** 256×256 px
- **Использование:** углы главной плиты (сейчас: CSS `::before` — radial-gradient фланцы + крестообразные шлицы на 4 углах)
- **9-slice отступы:** top 128, right 128, bottom 128, left 128 — болты целиком внутри углов, центр пустой (прозрачный)
- **Промпт:** «Four hex bolts with cross-slot heads, one in each corner, warm dark metal with polished highlight on flange, transparent center, top-down view, no glow»

## 4. `hazard-stripe.png` — аварийная полоса

- **Размер:** 256×64 px (тайлится по X)
- **Использование:** `.mk-hazard` (сейчас: CSS `repeating-linear-gradient(45°, #E8A03C, #E8A03C 10px, #241408 10px, #241408 20px)`)
- **9-slice:** не требуется (горизонтальный repeat-x)
- **Промпт:** «Worn diagonal warning stripes, faded amber paint on dark metal, chipped edges, subtle dust, tileable horizontally, no glow»

## 5. `gauge-face.png` — циферблат стрелочного прибора

- **Размер:** 256×256 px (круг, PNG с прозрачностью)
- **Использование:** `RankGauge` в `components/Header.tsx` (сейчас: SVG — дуга-шкала, тики, стрелка `rotate(pct)`)
- **9-slice:** не требуется
- **Промпт:** «Industrial pressure gauge face, cream dial with fine tick marks, darkened brass bezel ring, small Cyrillic stencil lettering zone left blank, aged paper texture, no needle, no glass reflection»

## 6. `stamp-ok / stamp-warn / stamp-danger` — оттиск статуса

- **Размер:** 192×96 px каждый
- **Использование:** `.mk-stamp` (сейчас: CSS — двойная рамка + поворот −4° + засечённые буквы Oswald)
- **9-slice:** не требуется
- **Промпт:** «Rubber stamp imprint on metal, slightly uneven ink coverage, rough rectangle border with notched corners, one of: OK (faded green), WARNING (amber), OFFLINE (rust red), transparent background»

---

### Конвенции

- Все ассеты — **обесцвеченные, тёплые** (амбровый свет ламп), без неона и свечения.
- Генерация — 1 бит на грань (не PBR-карты); бамп/тени — внутренние `box-shadow` CSS.
- После генерации каждый PNG подключать как `background-image` поверх существующего
  CSS-градиента (fallback сохраняется), отступы 9-slice — `border-image-slice`.

---

## Арт-сет 2026-09-28: капсулы, маскот, монета (единый тёплый стиль)

Сгенерировано и внедрено вместо «черновых» неоновых версий. Исходники: `design-lab/gen/`.
Стиль-токены: тёплый бронзово-медный металл, янтарное свечение, ржаво-оранжевая ткань,
тёмно-коричневый фон #1a0f08; ЗАПРЕЩЕНЫ синий/циан/фиолетовый неон и зелёные визоры.

| Файл (public/ares/) | Статус |
|---|---|
| `cassette-common/rare/epic.webp` 768×768 alpha | ✅ новый сет: сталь → медь → золото, один ракурс/свет; игра + лендинг |
| `tuber9-happy/warn/sleep.webp` 512 alpha | ✅ новый сет персонажа (янтарный визор вместо зелёного неона) |
| `tuber9-jump.webp` | ✅ прыжок с пылью из-под ботинок, тот же персонаж |
| `potato-coin.png` 256 alpha | ✅ прозрачный круг вместо чёрного квадрата |
| `patch-*.webp` (6 нашивок) | ✅ вышитые нашивки: канатный бронзовый обод, тёмное сукно; мотивы: росток/корзина/лавры+картофелина/корона+монеты/барон в короне/звезда ветерана |
| `plantation.webp/mp4` | ✅ уже в тёплом стиле — не тронут |

## Иконки-эмблемы (2026-09-28, второй арт-проход)

Спрайт-лист 24 иконки → 17 вырезанных эмблем `public/ares/icons/*.webp` (128×128 alpha):
gauge, flame, pickaxe, moon, gear, percent, shield, bank, trophy, coins, sprout,
crate, clipboard, license, bunk, wallet, gift. Стиль: литая бронза/латунь,
янтарные акценты, без неона.

Замена generic-иконок (lucide/эмодзи) на эмблемы:
- игра: нав-пульт (sprout/crate/clipboard/bunk), InitStatus (gear/flame),
  ConsoleStatRow ×9 (ЖУРНАЛ), WalletManagement SOL-иконка (gauge),
  ReferralSection (sprout/gift), AudioSettings-кнопка (gear/flame)
- лендинг: FeatureIcon — sprout/moon/percent/shield (механики под куполом)
- маркер 🥔 в строках локализации рендерится иконкой монеты (coinText)
- функциональные глифы (X закрыть, шевроны, копирование) остаются line-иконками —
  это контуры управления, не декор

## Управленческие глифы (2026-09-28, третий арт-проход)

Спрайт-лист 20 UI-глифов → `public/ares/glyphs/*.webp` (96×96 alpha, кремовая кость
с бронзовой обводкой): x, chevron-down/up/right, check, copy, plus, clock, person,
share, deposit, arrow-up-right, wallet, bell, music, speaker, vibrate, warning,
globe, menu. Заменяют ВСЕ line-SVG-иконки управления в игре и на лендинге
(lucide-react выведен из рендера UI; компоненты: Glyph в ui/Emblem.tsx / landing/Glyph.tsx).

Сохранены как исключения (не иконки): анимированный check-success в MorphButton
(pathLength-анимация), иллюстрации (dome-art, tuber-art, TokenReactor, InterstellarBridge),
декоративные рамки AresHullFrame/LiquidPanel.

## Полное замещение SVG растровыми артами и CSS (2026-09-28, финальный проход)

В исходниках игры и лендинга не осталось ни одного `<svg>`: структурные и
декоративные векторы заменены сгенерированными картинками или CSS-эквивалентами.
Анимации (drift/spin/reveal/sweep) сохранены на новом носителе.

Новые ассеты:
| Файл (обе apps, если не указано) | Что изображает / где применяется |
|---|---|
| `hull-frame.webp` | двойная бронзовая рамка с заклёпками — единый каркас AresHullFrame (лендинг) и HullSkinMounter (игра, `.hull-skin`), раньше — два разных векторных генератора |
| `divider-strip.webp` | резной бронзовый разделитель — секции лендинга (Divider) |
| `prize-art.webp` | призовая печать-артефакт — победный экран PrizeRevealShow обоих приложений |
| `flask.webp` (игра) | бронзовая колба с янтарной жидкостью — FlaskGauge (индикатор) и BubblingFlask (загрузка); уровень/бурление — CSS-свечение и пузырьки внутри clip-path сферы |
| `rocket.webp` (лендинг) | ретро-ракета с пламенем — MicroMotion RocketArt |
| `tuber9-happy.webp` (лендинг) | маскот — TuberArt (раньше 60 строк векторного человечка) |
| `grain.png` | шумовой тайл — GrainOverlay игры (feTurbulence → background-repeat) |
| `dome-colony.webp` | купол-колония — dome-art лендинга и кнопка «Дом» в mascot игры |

CSS-эквиваленты (без картинок): terrain/dust-слои Марса (радиальные градиенты),
квантовый маршрут InterstellarBridge (маски-дуги + пакеты), диал TokenReactor
(conic-gradient секторы + вращающиеся кольца), таймлайн SolTimeline (absolute-
сегменты), пиксель-аватар IdCard (CSS-grid), shockwave приза (border-кольцо на
useMotionTemplate), подчёркивание ссылок, параллакс-частицы, свечение рамок.

Удалены мёртвые векторные компоненты: `game .../ares/icons.tsx` (15 svg-иконок),
`landing/DomeHabitat.tsx`, `landing/HullLightCircuit.tsx`, LegacyLiquidPanelBorder.
lucide-react выведен из рендера полностью (states, FieldCard, ParallaxBackground).

## Живописный UI-кит (2026-09-28, четвёртый арт-проход)

Хром интерфейса больше не рисуется CSS-градиентами — он **изготовлен** так же,
как иллюстрации: каждый элемент сгенерирован живописной пластиной на чёрном,
чёрный срезан в альфу, растяжка через 9-slice `border-image` (углы 1:1, кромки
и центр тянутся без искажений). Выбранный стиль: **тёмная литая бронза + костяные
плашки** (вариант A+B из трёх мокапов), живой янтарный свет.

Ассеты `public/ares/kit/` (оба приложения):
| Файл | Размер | Slice | Применение |
|---|---|---|---|
| `panel-bronze.webp` | 988×512 | 88 | `.k-panel`/`.pf-card`/`.glass`, `.k-panel--pop` — окна и карточки |
| `panel-bone.webp` | 932×512 | 84 | `.k-panel--rare` — костяная карточка-артефакт |
| `btn-primary.webp` | 723×144 | 40 | `.k-key`, `Button` primary, `.action--primary`, `.market-filter-apply`, morph-металл — раскалённый янтарный сердечник |
| `btn-secondary.webp` | 713×144 | 40 | ghost-клавиши, `.action--secondary`, `.k-panel--chip`, `.market-filter-reset` — холодная бронза |
| `btn-bone.webp` | 647×144 | 40 | резерв (костяная плашка) |
| `tab.webp` / `tab-active.webp` | 336/428×128 | 44 | табы биржи; активный — янтарное стекло |
| `track.webp` + `fill.webp` | 799×96 / 640×357 | 34/— | прогресс: бронзовый жёлоб + текущий янтарь с анимацией течения (kit-flow) |
| `input.webp` | 738×96 | 30 | инпуты — утопленная бронзовая ниша (фокус = яркость + глоу) |

Состояния кнопок: покой → hover (brightness + янтарный глоу) → active (утапливание
translateY(2px) + затемнение); disabled — обесцвечивание. «Живой свет»: заливка
прогресса течёт (220px/цикл), фокус инпута и hover клавиш дают тёплое свечение.

Двойной носитель устранён: HullSkinMounter больше не монтирует каркас в
`.pf-card`/`.k-panel` (пластина кита — единственная рамка карточек).
Малые карточки-пластины (card-*-small) — в design-lab/ui-kit, перегенерация
следующим ходом (лимит генераций исчерпан).

### Дополнение кита (второй проход, 2026-09-28)

- `card-bronze-small.webp` (293×160, slice 20) — тонкая бронзовая пластина:
  тосты, карточки ордеров — мелкие поверхности без тяжёлых углов
- `card-bone-small.webp` (113×160, slice 20) — костяная пластина с винтами
- `knob.webp` (96²) — литая латунная рукоятка с янтарной точкой:
  маховик тумблеров (доворот 150° при включении) и бегунок ползунка громкости
- ползунок `.ares-range`: жёлоб input.webp + рукоятка knob.webp (webkit+moz)
- тумблеры: утопленная ниша input.webp; ВКЛ — янтарный ток + свечение рукоятки

### Кит-3: чипы, статы, CTA (2026-09-28)

- Header: балансовые чипы, кнопка кошелька и стат-карточки → card-bronze-small
  (тонкая рамка 12–14px вместо тяжёлой оконной); «Подключить кошелёк» → btn-primary
- `.k-tag` шильдики → btn-secondary slice 6px
- лендинг: `.cta-play`, `.header-play` → btn-primary; `.lang-switcher__button` →
  btn-secondary slice 8px; hover = brightness вместо фоновых подкрасок

### Кит-4: паки и модальные инпуты (2026-09-28)

- лендинг `.pack-card` → card-bronze-small; `.pack-buy` → btn-primary
- игра CreateOrderModal: поля цены/количества → input.webp ниша

### Кит-5: модалки, действия, рефералы (2026-09-28)

- кнопки модалок биржи: Оставить/Понятно → btn-secondary; Отменить/ошибка →
  btn-primary с hue-rotate в багровый
- MissionLog: кнопка награды → btn-primary mini; инфо-блок → btn-secondary
- FieldCard: actionStyle (апгрейд/ремонт/налог/удобрение) → btn-secondary
  с цветным текстом действия; «Жатва» → btn-primary (не готова — btn-secondary)
- ReferralSection строки и pack-wallet-line → card-bronze-small
- лендинг boarding-pass → card-bone-small (костяной талон)
