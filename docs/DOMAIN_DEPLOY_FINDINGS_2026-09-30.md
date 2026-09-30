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

## 3. Прод-домен Pages отстаёт от `main`

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
