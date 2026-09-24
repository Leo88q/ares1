# devnet-legacy

Легаси- и диагностика-скрипты devnet-этапа (не входят в продуктовый релиз):

- `check-devnet.mjs`, `check-devnet-full.mjs` — read-only инвентарь аккаунтов
  живой devnet-программы (поддерживаемые layout'ы GameConfig: 156/164/228/260);
- `migrate-devnet.mjs` — RETIRED (отказывается работать, см. шапку файла);
  актуальный планировщик — `yarn migrate-v2` из `game/`;
- `check_cli_ata.ts`, `check_state.ts`, `fill_test.ts`, `fund_browser_wallet.ts`,
  `init_presale_skr.ts`, `sim_buy*.ts` — разовые devnet-сценарии.

Запуск из каталога `game/`: `npx tsx scripts/devnet-legacy/<file>`.
Кошелёк читается из файла (`ANCHOR_WALLET`, по умолчанию
`~/.config/solana/id.json`) — секретных литералов в репозитории нет (F-19).

Перенесены из `apps/web/` (F-21): продуктовая сборка `apps/web` не должна
содержать devnet-инструменты.
