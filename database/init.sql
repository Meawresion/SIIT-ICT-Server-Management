/* =========================================================
   SIIT RESOURCE REQUEST SYSTEM
   MySQL 8.x Schema
   ========================================================= */


/* =========================================================
   1. ACCOUNTS
   ========================================================= */

CREATE TABLE accounts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    google_sub VARCHAR(255) NOT NULL UNIQUE,

    primary_email VARCHAR(255) NOT NULL UNIQUE,

    full_name VARCHAR(255) NOT NULL,

    phone_number VARCHAR(30) NOT NULL,

    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);


/* =========================================================
   2. USERS
   ========================================================= */

CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    account_id BIGINT UNSIGNED NOT NULL UNIQUE,

    student_id VARCHAR(30) NOT NULL UNIQUE,

    degree ENUM(
        'UNDERGRADUATE',
        'MASTER',
        'DOCTORAL'
    ) NOT NULL,

    program VARCHAR(255) NOT NULL,

    advisor_name VARCHAR(255) NOT NULL,

    created_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_users_account
        FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);


/* =========================================================
   3. RESOURCE REQUESTS
   ========================================================= */

CREATE TABLE resource_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    user_id BIGINT UNSIGNED NOT NULL,

    purpose VARCHAR(255) NOT NULL,

    project_description TEXT NOT NULL,

    project_supervisor_name VARCHAR(255) NULL,

    resource_type ENUM(
        'HPC_GPU',
        'BIG_DATA',
        'VM',
        'LAB_EQUIPMENT',
        'AWS_SKILL_BUILDER',
        'AWS_LEARNER_LAB'
    ) NOT NULL,

    justification TEXT NOT NULL,

    estimated_start_date DATE NOT NULL,

    estimated_end_date DATE NOT NULL,

    impact_score TINYINT UNSIGNED NOT NULL,

    supervisor_confirmation ENUM(
        'CONFIRMED',
        'NOT_CONFIRMED'
    ) NOT NULL,

    status ENUM(
        'PENDING',
        'APPROVED',
        'REJECTED',
        'ACTIVE',
        'COMPLETED'
    ) NOT NULL DEFAULT 'PENDING',

    reviewed_by_account_id BIGINT UNSIGNED NULL,

    reviewed_at TIMESTAMP NULL,

    review_comment TEXT NULL,

    created_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT chk_impact_score
        CHECK (
            impact_score BETWEEN 1 AND 10
        ),

    CONSTRAINT chk_request_dates
        CHECK (
            estimated_end_date >= estimated_start_date
        ),

    CONSTRAINT fk_request_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_request_reviewer_account
        FOREIGN KEY (reviewed_by_account_id)
        REFERENCES accounts(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);


/* =========================================================
   4. HPC / GPU REQUEST DETAILS
   ========================================================= */

CREATE TABLE hpc_gpu_requests (
    request_id BIGINT UNSIGNED PRIMARY KEY,

    CONSTRAINT fk_hpc_gpu_request
        FOREIGN KEY (request_id)
        REFERENCES resource_requests(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);


/* =========================================================
   5. BIG DATA REQUEST DETAILS
   ========================================================= */

CREATE TABLE big_data_requests (
    request_id BIGINT UNSIGNED PRIMARY KEY,

    CONSTRAINT fk_big_data_request
        FOREIGN KEY (request_id)
        REFERENCES resource_requests(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);


/* =========================================================
   6. VM REQUEST DETAILS
   ========================================================= */

CREATE TABLE vm_requests (
    request_id BIGINT UNSIGNED PRIMARY KEY,

    CONSTRAINT fk_vm_request
        FOREIGN KEY (request_id)
        REFERENCES resource_requests(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);


/* =========================================================
   7. LAB EQUIPMENT REQUEST DETAILS
   ========================================================= */

CREATE TABLE lab_equipment_requests (
    request_id BIGINT UNSIGNED PRIMARY KEY,

    CONSTRAINT fk_lab_equipment_request
        FOREIGN KEY (request_id)
        REFERENCES resource_requests(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);


/* =========================================================
   8. AWS SKILL BUILDER REQUEST DETAILS
   ========================================================= */

CREATE TABLE aws_skill_builder_requests (
    request_id BIGINT UNSIGNED PRIMARY KEY,

    CONSTRAINT fk_aws_skill_builder_request
        FOREIGN KEY (request_id)
        REFERENCES resource_requests(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);


/* =========================================================
   9. AWS LEARNER LAB REQUEST DETAILS
   ========================================================= */

CREATE TABLE aws_learner_lab_requests (
    request_id BIGINT UNSIGNED PRIMARY KEY,

    CONSTRAINT fk_aws_learner_lab_request
        FOREIGN KEY (request_id)
        REFERENCES resource_requests(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);


/* =========================================================
   10. INDEXES
   ========================================================= */

CREATE INDEX idx_users_account_id
    ON users(account_id);

CREATE INDEX idx_resource_requests_user_id
    ON resource_requests(user_id);

CREATE INDEX idx_resource_requests_status
    ON resource_requests(status);

CREATE INDEX idx_resource_requests_resource_type
    ON resource_requests(resource_type);

CREATE INDEX idx_resource_requests_created_at
    ON resource_requests(created_at);

CREATE INDEX idx_resource_requests_reviewer
    ON resource_requests(reviewed_by_account_id);