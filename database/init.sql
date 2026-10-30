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
    `por` VARCHAR(255) NOT NULL COMMENT 'Purpose: Senior Project, Thesis, etc.',
    `proj_name` VARCHAR(255) NOT NULL,
    `spv_name` VARCHAR(100) NOT NULL,
    `spv_email` VARCHAR(100) NOT NULL,
    `justify` TEXT NOT NULL,
    `start_date` DATETIME NOT NULL,
    `end_date` DATETIME NOT NULL,
    `extra_details` JSON NULL COMMENT 'Stores polymorphic attributes like equipment_name, coordinator info, or hardware specs',
    `process_type` ENUM('Manual', 'Automate') NOT NULL DEFAULT 'Manual',
    `status` ENUM(
        'Pending',
        'Approved',
        'Rejected',
        'On Use',
        'Completed'
    ) NOT NULL DEFAULT 'Pending',
    `approver_uid` INT UNSIGNED NULL,
    `reviewed_at` TIMESTAMP NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE `draft`(
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
    `proj_name` VARCHAR(255) NULL,
    `spv_name` VARCHAR(100) NULL,
    `spv_email` VARCHAR(100) NULL,
    `justify` TEXT NULL,
    `start_date` DATETIME NULL,
    `end_date` DATETIME NULL,
    `extra_details` JSON NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(`student_uid`)
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
-- Outbox for acc-prov-vm (plan §2.1): a job is written in the same transaction as the decision
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
-- Log shipping (NFR-7.1): the last request_event copied into the logs as an audit.event line
-- (backend/src/services/audit-log.service.js). On AWS the logs go to S3 and outlive the database.
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
    `draft` ADD CONSTRAINT `draft_student_uid_foreign` FOREIGN KEY(`student_uid`) REFERENCES `user`(`uid`) ON DELETE CASCADE;
ALTER TABLE
    `request` ADD CONSTRAINT `request_student_uid_foreign` FOREIGN KEY(`student_uid`) REFERENCES `user`(`uid`);
ALTER TABLE
    `request` ADD CONSTRAINT `request_approver_uid_foreign` FOREIGN KEY(`approver_uid`) REFERENCES `user`(`uid`);
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

-- ====================================================
-- Student Procedures
-- ====================================================

DELIMITER //

CREATE PROCEDURE add_student (
    IN p_fullname VARCHAR(100),
    IN p_siitemail VARCHAR(100),
    IN p_phone_number VARCHAR(15),
    IN p_s_id VARCHAR(12),
    IN p_study_degree ENUM('Undergraduate', 'Master', 'PhD'),
    IN p_s_program VARCHAR(50)
)
BEGIN
    INSERT INTO `user` (
        `role`,
        `fullname`,
        `siitemail`,
        `phone_number`,
        `s_id`,
        `study_degree`,
        `s_program`,
        `created_at`,
        `updated_at`
    ) VALUES (
        'Student',
        p_fullname,
        p_siitemail,
        p_phone_number,
        p_s_id,
        p_study_degree,
        p_s_program,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );
END //

CREATE PROCEDURE edit_student (
    IN p_fullname VARCHAR(100),
    IN p_siitemail VARCHAR(100),
    IN p_phone_number VARCHAR(15),
    IN p_s_id VARCHAR(12),
    IN p_study_degree ENUM('Undergraduate', 'Master', 'PhD'),
    IN p_s_program VARCHAR(50)
)
BEGIN
    UPDATE `user`
    SET 
        `fullname` = p_fullname,
        `phone_number` = p_phone_number,
        `s_id` = p_s_id,
        `study_degree` = p_study_degree,
        `s_program` = p_s_program,
        `updated_at` = CURRENT_TIMESTAMP
    WHERE `siitemail` = p_siitemail 
      AND `role` = 'Student';
END //

CREATE PROCEDURE get_student_by_email (
    IN p_siitemail VARCHAR(100)
)
BEGIN
    SELECT 
        `uid`,
        `fullname`,
        `siitemail`,
        `phone_number`,
        `s_id`,
        `study_degree`,
        `s_program`,
        `created_at`,
        `updated_at`
    FROM `user`
    WHERE `siitemail` = p_siitemail 
      AND `role` = 'Student';
END //

CREATE PROCEDURE get_student_by_uid (
    IN p_uid INT UNSIGNED
)
BEGIN
    SELECT 
        `uid`,
        `fullname`,
        `siitemail`,
        `phone_number`,
        `s_id`,
        `study_degree`,
        `s_program`,
        `created_at`,
        `updated_at`
    FROM `user`
    WHERE `uid` = p_uid 
      AND `role` = 'Student';
END //

-- ====================================================
-- Approver Procedures
-- ====================================================

CREATE PROCEDURE get_approver_by_email (
    IN p_siitemail VARCHAR(100)
)
BEGIN
    SELECT 
        `uid`,
        `fullname`,
        `siitemail`,
        `phone_number`,
        `created_at`,
        `updated_at`
    FROM `user`
    WHERE `siitemail` = p_siitemail 
      AND `role` = 'Approver';
END //

CREATE PROCEDURE get_approver_by_uid (
    IN p_uid INT UNSIGNED
)
BEGIN
    SELECT 
        `uid`,
        `fullname`,
        `siitemail`,
        `phone_number`,
        `created_at`,
        `updated_at`
    FROM `user`
    WHERE `uid` = p_uid 
      AND `role` = 'Approver';
END //

-- ====================================================
-- Request Procedures
-- ====================================================

CREATE PROCEDURE add_request (
    IN p_student_uid INT UNSIGNED,
    IN p_resource_type ENUM('GPU_SERVER', 'BIG_DATA', 'VM', 'LAB_EQUIPMENT', 'AWS_LAB', 'AWS_SKILL'),
    IN p_por VARCHAR(255),
    IN p_proj_name VARCHAR(255),
    IN p_spv_name VARCHAR(100),
    IN p_spv_email VARCHAR(100),
    IN p_justify TEXT,
    IN p_start_date DATETIME,
    IN p_end_date DATETIME,
    IN p_extra_details JSON
)
BEGIN
    DECLARE v_process_type ENUM('Manual', 'Automate');
    DECLARE v_new_rid INT UNSIGNED;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    -- ตรวจสอบเงื่อนไขกระบวนการทำงาน
    IF p_resource_type IN ('GPU_SERVER', 'BIG_DATA') THEN
        SET v_process_type = 'Automate';
    ELSE
        SET v_process_type = 'Manual';
    END IF;

    START TRANSACTION;

        INSERT INTO `request` (
            `student_uid`,
            `resource_type`,
            `por`,
            `proj_name`,
            `spv_name`,
            `spv_email`,
            `justify`,
            `start_date`,
            `end_date`,
            `extra_details`,
            `status`,
            `process_type`,
            `created_at`,
            `updated_at`
        ) VALUES (
            p_student_uid,
            p_resource_type,
            p_por,
            p_proj_name,
            p_spv_name,
            p_spv_email,
            p_justify,
            p_start_date,
            p_end_date,
            p_extra_details,
            'Pending',
            v_process_type,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        );

        SET v_new_rid = LAST_INSERT_ID();

        INSERT INTO `request_event` (`rid`, `action`, `from_status`, `to_status`, `actor_uid`)
        VALUES (v_new_rid, 'CREATED', NULL, 'Pending', p_student_uid);

        -- เคลียร์แบบร่างของนักศึกษาคนนี้ออกทันทีเมื่อส่งคำร้องจริง
        DELETE FROM `draft` WHERE `student_uid` = p_student_uid;

    COMMIT;

    SELECT 
        'SUCCESS' AS status, 
        'Request submitted successfully' AS message, 
        v_new_rid AS rid;

END //

CREATE PROCEDURE get_student_request (
    IN p_student_uid INT UNSIGNED
)
BEGIN
    SELECT 
        r.rid,
        r.resource_type,
        r.por,
        r.proj_name,
        r.spv_name,
        r.spv_email,
        r.justify,
        r.start_date,
        r.end_date,
        r.extra_details,
        r.process_type,
        r.status,
        r.created_at,
        r.updated_at,
        r.reviewed_at,
        a.uid AS approver_uid,
        a.fullname AS approver_fullname,
        a.siitemail AS approver_email
    FROM `request` r
    LEFT JOIN `user` a ON r.approver_uid = a.uid
    WHERE r.student_uid = p_student_uid
    ORDER BY r.created_at DESC;
END //

CREATE PROCEDURE get_request_by_status (
    IN p_status ENUM('Pending', 'Approved', 'Rejected', 'On Use', 'Completed')
)
BEGIN
    SELECT 
        r.rid,
        r.resource_type,
        r.por,
        r.proj_name,
        r.spv_name,
        r.spv_email,
        r.justify,
        r.extra_details,
        r.process_type,
        r.status,
        r.start_date,
        r.end_date,
        r.created_at,
        r.updated_at,
        r.reviewed_at,
        
        -- ข้อมูลนักศึกษา
        s.uid AS student_uid,
        s.s_id AS student_id,
        s.fullname AS student_fullname,
        s.siitemail AS student_email,
        s.phone_number AS student_phone,
        s.study_degree,
        s.s_program,

        -- ข้อมูล Approver
        a.uid AS approver_uid,
        a.fullname AS approver_fullname,
        a.siitemail AS approver_email

    FROM `request` r
    INNER JOIN `user` s ON r.student_uid = s.uid
    LEFT JOIN `user` a ON r.approver_uid = a.uid
    WHERE r.status = p_status
    ORDER BY r.created_at DESC;
END //

CREATE PROCEDURE update_request_status (
    IN p_rid INT UNSIGNED,
    IN p_approver_uid INT UNSIGNED,
    IN p_new_status ENUM('Pending', 'Approved', 'Rejected', 'On Use', 'Completed')
)
BEGIN
    DECLARE v_is_approver INT DEFAULT 0;
    DECLARE v_request_exists INT DEFAULT 0;
    DECLARE v_from_status ENUM('Pending', 'Approved', 'Rejected', 'On Use', 'Completed');

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    SELECT COUNT(*), MAX(`status`) INTO v_request_exists, v_from_status
    FROM `request`
    WHERE `rid` = p_rid;

    IF v_request_exists = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Error: Request ID not found.';
    END IF;

    SELECT COUNT(*) INTO v_is_approver
    FROM `user`
    WHERE `uid` = p_approver_uid 
      AND `role` = 'Approver';

    IF v_is_approver = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Unauthorized: User is not an approver or does not exist.';
    END IF;

    START TRANSACTION;

        UPDATE `request`
        SET 
            `status` = p_new_status,
            `approver_uid` = p_approver_uid,
            `reviewed_at` = CURRENT_TIMESTAMP,
            `updated_at` = CURRENT_TIMESTAMP
        WHERE `rid` = p_rid;

        INSERT INTO `request_event` (`rid`, `action`, `from_status`, `to_status`, `actor_uid`)
        VALUES (p_rid, CASE p_new_status
            WHEN 'Pending' THEN 'REOPENED'
            WHEN 'Approved' THEN 'APPROVED'
            WHEN 'Rejected' THEN 'REJECTED'
            WHEN 'On Use' THEN 'ACTIVATED'
            ELSE 'COMPLETED'
        END, v_from_status, p_new_status, p_approver_uid);

    COMMIT;

    SELECT 'SUCCESS' AS status, 'Status updated successfully' AS message;
END //

-- ====================================================
-- Draft Procedures
-- ====================================================

CREATE PROCEDURE save_draft (
    IN p_student_uid INT UNSIGNED,
    IN p_resource_type ENUM('GPU_SERVER', 'BIG_DATA', 'VM', 'LAB_EQUIPMENT', 'AWS_LAB', 'AWS_SKILL'),
    IN p_por VARCHAR(255),
    IN p_proj_name VARCHAR(255),
    IN p_spv_name VARCHAR(100),
    IN p_spv_email VARCHAR(100),
    IN p_justify TEXT,
    IN p_start_date DATETIME,
    IN p_end_date DATETIME,
    IN p_extra_details JSON
)
BEGIN
    INSERT INTO `draft` (
        `student_uid`,
        `resource_type`,
        `por`,
        `proj_name`,
        `spv_name`,
        `spv_email`,
        `justify`,
        `start_date`,
        `end_date`,
        `extra_details`,
        `updated_at`
    ) VALUES (
        p_student_uid,
        p_resource_type,
        p_por,
        p_proj_name,
        p_spv_name,
        p_spv_email,
        p_justify,
        p_start_date,
        p_end_date,
        p_extra_details,
        CURRENT_TIMESTAMP
    )
    ON DUPLICATE KEY UPDATE
        `resource_type` = p_resource_type,
        `por`           = p_por,
        `proj_name`     = p_proj_name,
        `spv_name`      = p_spv_name,
        `spv_email`     = p_spv_email,
        `justify`       = p_justify,
        `start_date`    = p_start_date,
        `end_date`      = p_end_date,
        `extra_details` = p_extra_details,
        `updated_at`    = CURRENT_TIMESTAMP;

    SELECT 'SUCCESS' AS status, 'Draft saved successfully' AS message;
END //

CREATE PROCEDURE get_draft (
    IN p_student_uid INT UNSIGNED
)
BEGIN
    SELECT 
        `student_uid`,
        `resource_type`,
        `por`,
        `proj_name`,
        `spv_name`,
        `spv_email`,
        `justify`,
        `start_date`,
        `end_date`,
        `extra_details`,
        `updated_at`
    FROM `draft`
    WHERE `student_uid` = p_student_uid;
END //

CREATE PROCEDURE delete_draft (
    IN p_student_uid INT UNSIGNED
)
BEGIN
    DELETE FROM `draft`
    WHERE `student_uid` = p_student_uid;

    SELECT 'SUCCESS' AS status, 'Draft removed' AS message;
END //

DELIMITER ;