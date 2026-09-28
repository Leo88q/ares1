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

## Иллюстрации-сцены (2026-09-28, третий арт-проход)

Сгенерированные картинки вместо крупных SVG-сцен:
- `dome-colony.webp` (900) — купол-герой лендинга (была SVG-сцена ~170 строк); игра получила копию в public/ares
- `phobos.webp` (360) — живой Фобос (дрейф+вращение сохранены, LivingPhobos)
- `planet-interstellar.webp` (420) — планета интерстишл-секции (не-марсианские миры тонируются hue-rotate)
- `gauge-face.webp` (280) — эмблема панели «Цикл токена» (стрелка рисовалась бы поверх)
Сознательно НЕ тронуты (данные/анимация, не декор): TokenReactor (интерактивный донат),
BubblingFlask (анимация уровня), RankGauge (стрелка по реальному прогрессу), terrain-слои (параллакс-рельеф).
