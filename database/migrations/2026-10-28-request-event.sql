-- Adds the request_event audit log (FR-4.2, FR-5.5, FR-9.1) to a database created before
-- 2026-10-28. A new database gets it from init.sql and privileges.sh. Run once, as root:
--   docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < database/migrations/2026-10-28-request-event.sql
-- then limit the app user (it may only SELECT and INSERT on the log):
--   docker compose exec -T mysql sh /docker-entrypoint-initdb.d/privileges.sh
-- (privileges.sh is mounted by docker-compose.yml; recreate the mysql container first if it
-- isn't there: docker compose up -d mysql.)

CREATE TABLE `request_event`(
    `eid` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `rid` INT UNSIGNED NOT NULL,
    `action` VARCHAR(32) NOT NULL COMMENT 'CREATED, EDITED, APPROVED, REJECTED, ACTIVATED, COMPLETED; provisioning events later',
    `from_status` ENUM('Pending', 'Approved', 'Rejected', 'On Use', 'Completed') NULL COMMENT 'NULL when the request is created',
    `to_status` ENUM('Pending', 'Approved', 'Rejected', 'On Use', 'Completed') NOT NULL,
    `actor_uid` INT UNSIGNED NULL COMMENT 'NULL: the system (provisioning results, scheduler)',
    `comment` TEXT NULL,
    `details` JSON NULL COMMENT 'e.g. {"fields":["purpose"]} for an edit, {"confirmed_overlaps":[12]} for an approval',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) COMMENT 'Append-only audit log (FR-9.1): the app user may only SELECT and INSERT (database/privileges.sh)';
ALTER TABLE
    `request_event` ADD INDEX `request_event_rid_index`(`rid`, `eid`);
ALTER TABLE
    `request_event` ADD CONSTRAINT `request_event_rid_foreign` FOREIGN KEY(`rid`) REFERENCES `request`(`rid`);
ALTER TABLE
    `request_event` ADD CONSTRAINT `request_event_actor_uid_foreign` FOREIGN KEY(`actor_uid`) REFERENCES `user`(`uid`);

-- Backfill what the old columns still know: who created each request and when, and the latest
-- review (earlier steps were overwritten, B6). Marked as backfilled.
INSERT INTO `request_event` (`rid`, `action`, `from_status`, `to_status`, `actor_uid`, `details`, `created_at`)
SELECT `rid`, 'CREATED', NULL, 'Pending', `student_uid`, JSON_OBJECT('backfilled', TRUE), `created_at`
FROM `request` ORDER BY `rid`;
INSERT INTO `request_event` (`rid`, `action`, `from_status`, `to_status`, `actor_uid`, `comment`, `details`, `created_at`)
SELECT `rid`,
    CASE `status` WHEN 'Approved' THEN 'APPROVED' WHEN 'Rejected' THEN 'REJECTED' WHEN 'On Use' THEN 'ACTIVATED' ELSE 'COMPLETED' END,
    NULL, `status`, `approver_uid`, JSON_UNQUOTE(JSON_EXTRACT(`extra_details`, '$.review_comment')),
    JSON_OBJECT('backfilled', TRUE, 'note', 'latest review only'), `reviewed_at`
FROM `request` WHERE `status` <> 'Pending' AND `reviewed_at` IS NOT NULL ORDER BY `rid`;

-- The log is append-only for everyone, root included (the app user also lacks the privileges).
CREATE TRIGGER `request_event_no_update` BEFORE UPDATE ON `request_event` FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'request_event is append-only';
CREATE TRIGGER `request_event_no_delete` BEFORE DELETE ON `request_event` FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'request_event is append-only';

-- The SQL procedures log their changes too.
DROP PROCEDURE IF EXISTS add_request;
DROP PROCEDURE IF EXISTS update_request_status;

DELIMITER //

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

DELIMITER ;
