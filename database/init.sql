CREATE TABLE `user`(
    `uid` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `role` ENUM('Approver', 'Student') NOT NULL,
    `fullname` VARCHAR(100) NOT NULL,
    `siitemail` VARCHAR(100) NOT NULL,
    `phone_number` VARCHAR(15) NOT NULL,
    `s_id` VARCHAR(12),
    `study_degree` ENUM('Undergraduate', 'Master', 'PhD'),
    `s_program` VARCHAR(50),
    `advisor_name` VARCHAR(100),
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
ALTER TABLE
    `user` ADD UNIQUE `user_siitemail_unique`(`siitemail`);
CREATE TABLE `request`(
    `rid` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `student_uid` INT UNSIGNED NOT NULL,
    `resource_type` ENUM(
        'GPU_SERVER',
        'BIG_DATA',
        'VM',
        'LAB_EQUIPMENT',
        'AWS_LAB',
        'AWS_SKILL'
    ) NOT NULL,
    `por` VARCHAR(255) NOT NULL COMMENT 'Project title',
    `proj_description` TEXT NOT NULL,
    `spv_name` VARCHAR(100) NOT NULL,
    `justify` TEXT NOT NULL,
    `tech_requirements` VARCHAR(2000) NOT NULL DEFAULT '' COMMENT 'e.g. GPU memory, software, dataset size',
    `impact_score` TINYINT UNSIGNED NOT NULL COMMENT 'Criticality, 1 to 10',
    `supervisor_confirmed` BOOLEAN NOT NULL,
    `start_date` DATETIME NOT NULL,
    `end_date` DATETIME NOT NULL,
    `process_type` ENUM('Manual', 'Automate') NOT NULL DEFAULT 'Manual',
    `status` ENUM(
        'Pending',
        'Approved',
        'Rejected',
        'On Use',
        'Completed'
    ) NOT NULL DEFAULT 'Pending',
    `gpu_node` VARCHAR(32) NULL COMMENT 'GPU requests: the node chosen at approval',
    `approver_uid` INT UNSIGNED NULL,
    `review_comment` TEXT NULL COMMENT 'The latest decision''s comment; every decision is also a request_event',
    `reviewed_at` TIMESTAMP NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `request_impact_score_check` CHECK (`impact_score` BETWEEN 1 AND 10)
);
-- Extensions (FR-8.3): a student asks for a later end date, an approver decides. At most one is
-- Pending per request (checked by the backend under a row lock).
CREATE TABLE `request_extension`(
    `xid` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `rid` INT UNSIGNED NOT NULL,
    `end_date` DATE NOT NULL COMMENT 'The end date asked for',
    `reason` VARCHAR(1000) NOT NULL,
    `status` ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
    `requested_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `reviewer_uid` INT UNSIGNED NULL,
    `review_comment` TEXT NULL,
    `reviewed_at` TIMESTAMP NULL
);
-- Unfinished requests (FR-3.2, FR-3.3): every field may still be empty. A student can keep several.
CREATE TABLE `draft`(
    `did` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `student_uid` INT UNSIGNED NOT NULL,
    `resource_type` ENUM(
        'GPU_SERVER',
        'BIG_DATA',
        'VM',
        'LAB_EQUIPMENT',
        'AWS_LAB',
        'AWS_SKILL'
    ) NULL,
    `por` VARCHAR(255) NULL,
    `proj_description` TEXT NULL,
    `spv_name` VARCHAR(100) NULL,
    `justify` TEXT NULL,
    `tech_requirements` VARCHAR(2000) NULL,
    `impact_score` TINYINT UNSIGNED NULL,
    `supervisor_confirmed` BOOLEAN NOT NULL DEFAULT FALSE,
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `draft_impact_score_check` CHECK (`impact_score` BETWEEN 1 AND 10)
);
CREATE TABLE `request_event`(
    `eid` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `rid` INT UNSIGNED NOT NULL,
    `action` VARCHAR(32) NOT NULL COMMENT 'CREATED, EDITED, APPROVED, REJECTED, ACTIVATED, COMPLETED; PROVISIONED, PROVISION_FAILED, REVOKED, REVOKE_FAILED, RETRIED; REMINDED, EXPIRED; EXTENSION_REQUESTED, EXTENSION_APPROVED, EXTENSION_REJECTED, EXTENDED, EXTEND_FAILED',
    `from_status` ENUM('Pending', 'Approved', 'Rejected', 'On Use', 'Completed') NULL COMMENT 'NULL when the request is created',
    `to_status` ENUM('Pending', 'Approved', 'Rejected', 'On Use', 'Completed') NOT NULL,
    `actor_uid` INT UNSIGNED NULL COMMENT 'NULL: the system (provisioning results, scheduler)',
    `comment` TEXT NULL,
    `details` JSON NULL COMMENT 'e.g. {"fields":["purpose"]} for an edit, {"confirmed_overlaps":[12]} for an approval',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) COMMENT 'Append-only audit log (FR-9.1): the app user may only SELECT and INSERT (database/privileges.sh)';
ALTER TABLE
    `request_event` ADD INDEX `request_event_rid_index`(`rid`, `eid`);
-- Outbox for acc-prov-vm: a job is written in the same transaction as the decision
-- that causes it, and the backend's dispatcher publishes it later, so a broker outage loses
-- nothing. A retry is a new job (new job_id), because acc-prov-vm answers a job_id it has seen
-- with its stored result.
CREATE TABLE `provision_job`(
    `job_id` CHAR(36) NOT NULL PRIMARY KEY COMMENT 'UUID; also the message jti, so acc-prov-vm runs each job once',
    `rid` INT UNSIGNED NOT NULL,
    `action` ENUM('CREATE', 'REVOKE', 'EXTEND') NOT NULL,
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
-- Scheduler lease (FR-8.4): every backend task runs the scheduler loop, and only the one that
-- holds the lease does a pass. MySQL GET_LOCK belongs to one connection, which Prisma's pool
-- doesn't keep.
CREATE TABLE `scheduler_lease`(
    `name` VARCHAR(32) NOT NULL PRIMARY KEY,
    `owner` VARCHAR(100) NULL COMMENT 'The backend task holding the lease',
    `lease_until` DATETIME(3) NOT NULL
) COMMENT 'One row per scheduled job; the app user may only read and update it';
INSERT INTO `scheduler_lease` (`name`, `lease_until`) VALUES ('scheduler', '1970-01-01 00:00:00');
-- Log shipping (NFR-7.1): the last request_event copied out of the database
-- (backend/src/services/audit-log.service.js). On AWS the events go to the audit log group, kept 400 days.
CREATE TABLE `log_cursor`(
    `name` VARCHAR(32) NOT NULL PRIMARY KEY,
    `last_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT 'One row per log stream copied out of the database; the app user may only read and update it';
INSERT INTO `log_cursor` (`name`) VALUES ('audit');
-- The request lists (NFR-2.1): newest first, by status for the approver tabs, by student for
-- their own list (this one also serves the student foreign key).
ALTER TABLE
    `request` ADD INDEX `request_created_index`(`created_at`);
ALTER TABLE
    `request` ADD INDEX `request_status_created_index`(`status`, `created_at`);
ALTER TABLE
    `request` ADD INDEX `request_student_created_index`(`student_uid`, `created_at`);
ALTER TABLE
    `request_extension` ADD INDEX `request_extension_rid_index`(`rid`, `status`);
ALTER TABLE
    `draft` ADD INDEX `draft_student_updated_index`(`student_uid`, `updated_at`);

ALTER TABLE
    `draft` ADD CONSTRAINT `draft_student_uid_foreign` FOREIGN KEY(`student_uid`) REFERENCES `user`(`uid`) ON DELETE CASCADE;
ALTER TABLE
    `request` ADD CONSTRAINT `request_student_uid_foreign` FOREIGN KEY(`student_uid`) REFERENCES `user`(`uid`);
ALTER TABLE
    `request` ADD CONSTRAINT `request_approver_uid_foreign` FOREIGN KEY(`approver_uid`) REFERENCES `user`(`uid`);
ALTER TABLE
    `request_extension` ADD CONSTRAINT `request_extension_rid_foreign` FOREIGN KEY(`rid`) REFERENCES `request`(`rid`);
ALTER TABLE
    `request_extension` ADD CONSTRAINT `request_extension_reviewer_uid_foreign` FOREIGN KEY(`reviewer_uid`) REFERENCES `user`(`uid`);
-- No cascade: a request or user that has events can't be deleted, so the log stays complete.
ALTER TABLE
    `request_event` ADD CONSTRAINT `request_event_rid_foreign` FOREIGN KEY(`rid`) REFERENCES `request`(`rid`);
ALTER TABLE
    `request_event` ADD CONSTRAINT `request_event_actor_uid_foreign` FOREIGN KEY(`actor_uid`) REFERENCES `user`(`uid`);
ALTER TABLE
    `provision_job` ADD CONSTRAINT `provision_job_rid_foreign` FOREIGN KEY(`rid`) REFERENCES `request`(`rid`);

-- The log is append-only for everyone, root included (the app user also lacks the privileges).
CREATE TRIGGER `request_event_no_update` BEFORE UPDATE ON `request_event` FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'request_event is append-only';
CREATE TRIGGER `request_event_no_delete` BEFORE DELETE ON `request_event` FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'request_event is append-only';
