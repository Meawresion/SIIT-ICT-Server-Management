-- Adds the provision_job outbox (plan §2.1, step 6) to a database created before it. A new
-- database gets it from init.sql and privileges.sh. Run once, as root, after
-- 2026-10-28-request-event.sql:
--   docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < database/migrations/2026-10-28-provision-job.sql
-- then give the app user its rights on the new table:
--   docker compose exec -T mysql sh /docker-entrypoint-initdb.d/privileges.sh

CREATE TABLE `provision_job`(
    `job_id` CHAR(36) NOT NULL PRIMARY KEY COMMENT 'UUID; also the message jti, so acc-prov-vm runs each job once',
    `rid` INT UNSIGNED NOT NULL,
    `action` ENUM('CREATE', 'REVOKE') NOT NULL,
    `status` ENUM('Queued', 'Sent', 'Succeeded', 'Failed') NOT NULL DEFAULT 'Queued',
    `payload` JSON NOT NULL COMMENT 'The job as sent, encrypted at send time; never a password',
    `attempts` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Publish attempts',
    `last_error` TEXT NULL COMMENT 'Last publish error, or the error acc-prov-vm reported',
    `result` JSON NULL COMMENT 'acc-prov-vm result: non-secret details only (username, node, VPN state)',
    `next_attempt_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `sent_at` TIMESTAMP NULL,
    `completed_at` TIMESTAMP NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT 'Provisioning jobs for acc-prov-vm (outbox); the app user may not delete them';
ALTER TABLE
    `provision_job` ADD INDEX `provision_job_status_index`(`status`, `next_attempt_at`);
ALTER TABLE
    `provision_job` ADD INDEX `provision_job_rid_index`(`rid`, `created_at`);
ALTER TABLE
    `provision_job` ADD CONSTRAINT `provision_job_rid_foreign` FOREIGN KEY(`rid`) REFERENCES `request`(`rid`);
