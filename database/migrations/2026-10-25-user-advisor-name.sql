-- Adds the student's primary advisor (FR-2.2 "supervising faculty member") to an existing
-- database. A new database gets the column from init.sql, so run this only once on a
-- database created before 2026-10-25:
--   docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < database/migrations/2026-10-25-user-advisor-name.sql
ALTER TABLE `user` ADD COLUMN `advisor_name` VARCHAR(100) NULL AFTER `s_program`;
