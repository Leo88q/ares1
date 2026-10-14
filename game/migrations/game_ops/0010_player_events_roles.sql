-- ─────────────────────────────────────────────────────────────────────────────
-- Гранты для player_events (0009): отдельным файлом «*_roles.sql», как у
-- пресейла (0006) — на managed-базах файлы с roles пропускаются (skipRoles),
-- права там выдаёт облако.
--
-- Писать события может только writer-роль сервиса (сам запрос приходит
-- публичным — валидация и лимиты в приложении); чтение когорт — reader.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON game_ops.player_events TO game_ops_writer;
GRANT SELECT ON game_ops.player_events TO game_ops_reader;

-- Сиквенс identity-колонки создан вместе с таблицей (0009), то есть ПОСЛЕ
-- blanket-грантов0003 «ON ALL SEQUENCES» — на нём нет прав:
GRANT USAGE, SELECT ON SEQUENCE game_ops.player_events_id_seq TO game_ops_writer;
