
CREATE TABLE `User` (
  `uid` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `role` ENUM('Admin', 'Student') NOT NULL,
  `fullname` VARCHAR(100) NOT NULL,
  `siitemail` VARCHAR(100) UNIQUE NOT NULL,
  `phone_number` VARCHAR(15),
  `s_id` VARCHAR(12) NULL,
  `study_degree` ENUM('Undergraduate', 'Master', 'PhD') NULL,
  `s_program` VARCHAR(50) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE `Request` (
  `rid` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `student_uid` INT UNSIGNED NOT NULL,
  `resource_type` ENUM('GPU_SERVER', 'BIG_DATA', 'VM', 'LAB_EQUIPMENT', 'AWS_LAB', 'AWS_SKILL') NOT NULL,
  `por` VARCHAR(255) COMMENT 'Purpose: Senior Project, Thesis, etc.',
  `proj_name` VARCHAR(255) NOT NULL,
  `spv_name` VARCHAR(100),
  `spv_email` VARCHAR(100),
  `justify` TEXT NOT NULL,
  `start_date` DATETIME NOT NULL,
  `end_date` DATETIME NOT NULL,
  `extra_details` JSON NULL COMMENT 'Stores polymorphic attributes like equipment_name, coordinator info, or hardware specs',
  `process_type` ENUM('Manual', 'Automate') DEFAULT 'Manual',
  `status` ENUM('Pending', 'Approved', 'Rejected', 'On Use', 'Completed') DEFAULT 'Pending',
  `admin_uid` INT UNSIGNED NULL,
  `reviewed_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`student_uid`) REFERENCES `User` (`uid`),
  FOREIGN KEY (`admin_uid`) REFERENCES `User` (`uid`)
);

CREATE TABLE `Draft` (
  `student_uid` INT UNSIGNED PRIMARY KEY,
  `resource_type` ENUM('GPU_SERVER', 'BIG_DATA', 'VM', 'LAB_EQUIPMENT', 'AWS_LAB', 'AWS_SKILL') NULL,
  `por` VARCHAR(255) NULL,
  `proj_name` VARCHAR(255) NULL,
  `spv_name` VARCHAR(100) NULL,
  `spv_email` VARCHAR(100) NULL,
  `justify` TEXT NULL,
  `start_date` DATETIME NULL,
  `end_date` DATETIME NULL,
  `extra_details` JSON NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`student_uid`) REFERENCES `User` (`uid`) ON DELETE CASCADE
);

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
    INSERT INTO `User` (
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
    UPDATE `User`
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
    FROM `User`
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
    FROM `User`
    WHERE `uid` = p_uid 
      AND `role` = 'Student';
END //

-- ====================================================
-- Admin Procedures
-- ====================================================

CREATE PROCEDURE get_admin_by_email (
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
    FROM `User`
    WHERE `siitemail` = p_siitemail 
      AND `role` = 'Admin';
END //

CREATE PROCEDURE get_admin_by_uid (
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
    FROM `User`
    WHERE `uid` = p_uid 
      AND `role` = 'Admin';
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

        INSERT INTO `Request` (
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

        -- เคลียร์แบบร่างของนักศึกษาคนนี้ออกทันทีเมื่อส่งคำร้องจริง
        DELETE FROM `Draft` WHERE `student_uid` = p_student_uid;

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
        a.uid AS admin_uid,
        a.fullname AS admin_fullname,
        a.siitemail AS admin_email
    FROM `Request` r
    LEFT JOIN `User` a ON r.admin_uid = a.uid
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

        -- ข้อมูล Admin
        a.uid AS admin_uid,
        a.fullname AS admin_fullname,
        a.siitemail AS admin_email

    FROM `Request` r
    INNER JOIN `User` s ON r.student_uid = s.uid
    LEFT JOIN `User` a ON r.admin_uid = a.uid
    WHERE r.status = p_status
    ORDER BY r.created_at DESC;
END //

CREATE PROCEDURE update_request_status (
    IN p_rid INT UNSIGNED,
    IN p_admin_uid INT UNSIGNED,
    IN p_new_status ENUM('Pending', 'Approved', 'Rejected', 'On Use', 'Completed')
)
BEGIN
    DECLARE v_is_admin INT DEFAULT 0;
    DECLARE v_request_exists INT DEFAULT 0;

    SELECT COUNT(*) INTO v_request_exists
    FROM `Request`
    WHERE `rid` = p_rid;

    IF v_request_exists = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Error: Request ID not found.';
    END IF;

    SELECT COUNT(*) INTO v_is_admin
    FROM `User`
    WHERE `uid` = p_admin_uid 
      AND `role` = 'Admin';

    IF v_is_admin = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Unauthorized: User is not an admin or does not exist.';
    END IF;

    UPDATE `Request`
    SET 
        `status` = p_new_status,
        `admin_uid` = p_admin_uid,
        `reviewed_at` = CURRENT_TIMESTAMP,
        `updated_at` = CURRENT_TIMESTAMP
    WHERE `rid` = p_rid;

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
    INSERT INTO `Draft` (
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
    FROM `Draft`
    WHERE `student_uid` = p_student_uid;
END //

CREATE PROCEDURE delete_draft (
    IN p_student_uid INT UNSIGNED
)
BEGIN
    DELETE FROM `Draft`
    WHERE `student_uid` = p_student_uid;

    SELECT 'SUCCESS' AS status, 'Draft removed' AS message;
END //

DELIMITER ;