# Домены и деплой Pages: что найдено 30.09.2026

Проверено при разборе двух симптомов: «в игре старый дизайн» и «на сайте пропал текст».
Оба симптома — следствие того, что **деплой в Cloudflare Pages не соответствует `main`**,
а **домены проекта не подключены**. Код это не лечит: нужны действия в панели Cloudflare
и у регистратора поддомена.

## 1. Субдомен `ares1.is-a.dev` не зарегистрирован

`https://ares1.is-a.dev/` отдаёт страницу-заглушку is-a.dev
(`https://is-a.dev/available?d=ares1` → «the subdomain ares1.is-a.dev is available for registration»).

Причина: DNS-записи A/AAAA есть (wildcard `*.is-a.dev` → Cloudflare:
`104.18.4.103`, `104.18.5.103`, `2606:4700::6812:467`, `2606:4700::6812:567`), но сам
поддомен в реестре is-a.dev не зарегистрирован, поэтому edge Cloudflare отдаёт чужой
(парковочный) ответ. `scripts/dns-baseline.json` фиксирует эти A/AAAA как baseline — он
про подмену, а не про факт регистрации, поэтому угон тут ни при чём.

Что сделать:
1. PR в репозиторий `is-a.dev` (`domains/ares1.json`) с записью, указывающей на проект
   Cloudflare Pages: `"proxied": true`, `"owner": { "username": "Leo88q" }`.
2. В Cloudflare Pages → проект `ares1` → Custom domains → добавить `ares1.is-a.dev`
   (и `play.ares1.is-a.dev` для проекта `ares1-play`). После привязки алиас появится в
   check-run'ах «Cloudflare Pages: …».

## 2. `play.ares1.is-a.dev` — ошибка TLS

`curl`/браузер: `net::ERR_SSL_VERSION_OR_CIPHER_MISMATCH` (curl exit 000 при TCP-коннекте
к `104.18.4.103`). Классический признак того, что hostname не привязан ни к одному
проекту/зоне с сертификатом на edge. После шага 1.2 (Custom domain в проекте
`ares1-play`) сертификат выпустится автоматически.

## 3. Проект `ares1-play`: `main` собирается как веточный превью, прод не обновляется

Проверено 30.09.2026 после мержа PR #47 по хэшам ассетов (playwright в CI, скоуп — те же
файлы, что отдаёт браузер):

| URL | JS-бандл | CSS | Вердикт |
|---|---|---|---|
| `ares1-play.pages.dev` (прод) | `index-Ceu3eesf.js` | `index-BkEq2h2N.css` | **старая сборка** (в HTML есть `t('ПРОГРЕСС')` — до #45) |
| `main.ares1-play.pages.dev` (алиас) | `index-DgXYL6ym.js` | `index-DZdkzD4B.css` | сборка `5aa07a7` (в CSS есть `--s-pop-bg`) |
| `01c6cafb.ares1-play.pages.dev` (превью `5aa07a7`) | `index-DgXYL6ym.js` | `index-DZdkzD4B.css` | то же самое |

Почему так: в check-run'е сборки на `main` для этого проекта Cloudflare пишет
«Branch Preview URL: https://main.ares1-play.pages.dev», а не прод-деплой. То есть для
проекта `ares1-play` ветка `main` считается **не продакшн-веткой**: каждая сборка `main`
уходит в веточный превью-алиас, а прод-деплой (который обслуживает `ares1-play.pages.dev`)
не обновляется. У проекта лендинга `ares1` такой строки нет — там `main` = продакшн, и
после мержа прод `ares1-7e1.pages.dev` уже отдаёт ту же сборку, что превью `5aa07a7`
(`index-Dh--_To_.js` / `index-CHTymu_d.css` совпадают) ✅.

Что сделать (панель Cloudflare, доступ из репозитория недоступен):
1. **Pages → проект `ares1-play` → Settings → Builds & deployments → Production branch.**
   Поставить `main` (сейчас там другая ветка — возможно, дефолт из старой настройки).
2. **Deployments →** выбрать деплой `main.ares1-play.pages.dev` (или `01c6cafb…`) →
   **Promote to production** / **Retry deployment** с прод-веткой `main`, чтобы
   `ares1-play.pages.dev` переключился на сборку `5aa07a7` не дожидаясь следующего пуша.
3. `create-react-app`-подобные настройки (build command / output dir) менять не нужно —
   сборка проходит; дело только в ветке.

После этого проверить: `https://ares1-play.pages.dev/` должен отдавать `index-DgXYL6ym.js`
и текст «Emission is player harvests…» вместо `t('ПРОГРЕСС')`.

### Историческая справка: как это выглядело раньше

- `https://ares1-7e1.pages.dev/` — прод-URL проекта `ares1`; на момент разбора отдавал
  сборку коммита `3caa1a9` (merge #45), хотя после этого в `main` уже были коммиты.
- `https://ares1-play.pages.dev/` — прод-URL проекта `ares1-play`; отдавал сборку **до** #45
  (старый дизайн), потому что сборки проекта падали с #45 (причина — `@fontsource/oswald`,
  объявленный только в корневом `game/package.json`; исправлено: объявлен в
  `game/apps/web/package.json`).
- Алиас `main.ares1-play.pages.dev` на тот момент отдавал веточную сборку с крашем
  `Cannot read properties of undefined (reading 'bg')` (`BackgroundScene variant={screen as never}` →
  глобальный `window.screen`; исправлено в #45).

Проверить после мержа фиксов: прод-URL и алиас `main.*` должны обновиться на коммит из
`main`. Если прод-домен не обновляется при зелёной сборке — смотреть в панели
Pages → проект → Settings → Builds & deployments: «Production branch» и «Build cache»
(кеш ни при чём для расхождения коммитов — прод всегда собирает последний коммит
production-ветки; расхождение означает, что прод-ветка в настройках проекта не `main`).
