# ARES-1 → Games Watchtower: пакет handoff (read-only)

Пакет передачи документов и контрактов для команды Games Watchtower.
Игра: **ARES-1**, канонический `gameId = ares1` (ENV `ARES1_PROGRAM_ID`).

**Provenance:** репозиторий `github.com/Leo88q/ares1`, ветка `__SRC_BRANCH__`,
коммит `__SRC_COMMIT__` (2026-10-06).
Все данные собраны read-only методами; продакшн-транзакций и реальных игровых
данных в пакете нет.

## Что внутри

| Путь в `payload/` | Что это |
| --- | --- |
| `WATCHTOWER_HANDOFF.md` | Основной отчёт, разделы A–G: паспорт/deployment, источники, event map, replay/gaps, privacy/economy, проверки и блокеры |
| `watchtower/integration-manifest.json` | gameId, program ID, статусы по доменам, `verificationStatus` отдельно от `dataQuality` |
| `watchtower/address-registry.json` | Адреса (program, POTATO-минт, PDAs) с provenance и статусом проверки |
| `watchtower/events/event-catalog.json` | Machine-readable каталог **31 реального события**: эмиттер, payload/единицы, identity/session, идемпотентность, proof, лимиты; плюс список того, что игра НЕ эмитит |
| `watchtower/events/runtime-evidence.json` | Read-only devnet-факты (explorer): деплой, upgrade authority, 4 декодированных события |
| `watchtower/events/ares1-idl.json` | Event-only IDL игры (sha256 в манифесте) |
| `watchtower/events/ares1-event-map.json` | Предлагаемый mapping `sourceEventName → watchtowerEventType` (31 запись) |
| `watchtower/events/event-types.json`, `schema.json` | Контракт типов/формы событий экспортёра |
| `watchtower/events/fixtures/real-devnet/` | **4 реальные финализированные devnet-транзакции** (3 типа событий), provenance-пометка в README |
| `watchtower/events/fixtures/synthetic/` | Синтетика: Borsh для всех 31 события + примеры ingest-формы; всё помечено `synthetic` |
| `watchtower/config.example.env` | Только **имена** ENV (значения пустые). Секретов нет |
| `watchtower/README.md` | Границы безопасности, схема, контракт и гейты экспортёра |

Секретов, ключей, токенов, HMAC, RPC/API-ключей и PII в пакете нет.
Единственные «реальные» данные — публичные финализированные devnet-транзакции.

## Как применить (вариант 1, из этого архива)

```bash
cd /Users/zlata/LeoGamesStudio/Games-watchtower   # корень хаб-репозитория
tar -xzf /путь/к/ARES1-WATCHTOWER-HANDOFF-2026-10-06.tar.gz
./ares1-watchtower-handoff/apply-ares1-handoff.sh --commit    # скопировать + коммит
# затем, когда всё проверено:
git push -u origin integrations/ares1-handoff
```

Скрипт раскладывает файлы в `integrations/ares1/` внутри хаб-репозитория,
сохраняя относительные пути (`WATCHTOWER_HANDOFF.md`, `watchtower/...`), чтобы
внутренние ссылки в документах оставались валидными. Каталог назначения
меняется ключом `--dest`, ветка — `--branch`, автопуш — `--push`.
Скрипт ничего не удаляет и не переписывает; при чужих staged-изменениях коммит
не делается.

## Как применить (вариант 2, напрямую из GitHub)

Если есть доступ к `Leo88q/ares1`, файлы можно забрать без архива:

```bash
cd /Users/zlata/LeoGamesStudio/Games-watchtower
git remote add ares1 https://github.com/Leo88q/ares1.git 2>/dev/null || true
git fetch ares1 'refs/heads/__SRC_BRANCH__:refs/remotes/ares1/handoff'
git rev-parse ares1/handoff        # ожидается __SRC_COMMIT__
mkdir -p integrations/ares1
git archive ares1/handoff -- WATCHTOWER_HANDOFF.md watchtower/integration-manifest.json \
  watchtower/address-registry.json watchtower/config.example.env watchtower/events \
  | tar -x -C integrations/ares1
git checkout -b integrations/ares1-handoff
git add -- integrations/ares1
git commit -m "ARES-1 handoff (gameId ares1) @ __SRC_COMMIT__"
git push -u origin integrations/ares1-handoff
```

## Что нужно от команды Watchtower (кратко; детали — §G.2–G.3 в handoff)

1. Обновить allowlist/mapping адаптера `ares1` под реальные имена событий
   (`Harvested`, `FieldCreated`, `AchievementClaimed`, `PresalePurchase`,
   `ExportLicensePurchased`, …). On-chain переименований без согласованного
   апгрейда программы не будет.
2. Согласовать identity-контракт (хаб псевдонимизирует wallet сам или игре
   отдавать `playerKey`) и privacy-основание.
3. Определить контракт off-chain ingest (presale-заказы) без PII.
4. Выдать RPC-доступ + отдельный exporter credential (вне Git/чата) и провести
   центральный devnet-smoke — только после этого `deploymentVerified` станет `true`.
5. Определить pull vs push и требуемую глубину backfill.

---

### English summary

Read-only handoff package for the Games Watchtower team. Game **ARES-1**,
`gameId = ares1`, source commit `2169dc0` (branch `__SRC_BRANCH__` of
`github.com/Leo88q/ares1`). Contains the A–G report, integration manifest,
address registry, a machine-readable catalog of all 31 real on-chain events,
read-only devnet runtime evidence, and fixtures (4 real devnet transactions +
explicitly labeled synthetic samples). No secrets, no credentials, no real
player data. Apply with `./apply-ares1-handoff.sh --commit`, or fetch the branch
from GitHub and extract the same paths.
