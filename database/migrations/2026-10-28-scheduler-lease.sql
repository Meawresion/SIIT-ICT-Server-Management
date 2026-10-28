-- Adds the scheduler lease (FR-8.4, step 7) to a database created before it. A new database gets
-- it from init.sql and privileges.sh. Run once, as root, after 2026-10-28-provision-job.sql:
--   docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < database/migrations/2026-10-28-scheduler-lease.sql
-- then give the app user its rights on the new table:
--   docker compose exec -T mysql sh /docker-entrypoint-initdb.d/privileges.sh

CREATE TABLE `scheduler_lease`(
    `name` VARCHAR(32) NOT NULL PRIMARY KEY,
    `owner` VARCHAR(100) NULL COMMENT 'The backend task holding the lease',
    `lease_until` DATETIME(3) NOT NULL
) COMMENT 'One row per scheduled job; the app user may only read and update it';
INSERT INTO `scheduler_lease` (`name`, `lease_until`) VALUES ('scheduler', '1970-01-01 00:00:00');

ALTER TABLE `request_event` MODIFY `action` VARCHAR(32) NOT NULL
    COMMENT 'CREATED, EDITED, APPROVED, REJECTED, ACTIVATED, COMPLETED; PROVISIONED, PROVISION_FAILED, REVOKED, REVOKE_FAILED, RETRIED; REMINDED, EXPIRED';
