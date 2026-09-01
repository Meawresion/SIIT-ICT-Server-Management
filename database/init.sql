/* =========================================================
   SIIT RESOURCE REQUEST SYSTEM
   MySQL 8.x Schema
   ========================================================= */


/* =========================================================
   1. PROGRAMS
   ========================================================= */

CREATE TABLE programs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,

    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP
);


INSERT INTO programs (code, name)
VALUES
    ('CPE', 'Computer Engineering'),
    ('DE', 'Digital Engineering'),
    ('OTHER', 'Other');


/* =========================================================
   2. USERS
   ========================================================= */

CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    /* Google / SIIT authentication */
    google_sub VARCHAR(255) NOT NULL UNIQUE,

    /* Required user information */
    student_id VARCHAR(30) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    primary_email VARCHAR(255) NOT NULL UNIQUE,

    degree ENUM(
        'UNDERGRADUATE',
        'MASTER',
        'DOCTORAL'
    ) NOT NULL,

    program_id BIGINT UNSIGNED NULL,

    other_program_name VARCHAR(255) NULL,

    phone_number VARCHAR(30) NOT NULL,

    advisor_name VARCHAR(255) NOT NULL,

    /* Authorization */
    role ENUM(
        'USER',
        'ADMIN'
    ) NOT NULL DEFAULT 'USER',

    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_users_program
        FOREIGN KEY (program_id)
        REFERENCES programs(id)
        ON DELETE SET NULL
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
        'DRAFT',
        'PENDING',
        'ON_HOLD',
        'APPROVED',
        'REJECTED',
        'ACTIVE',
        'COMPLETED',
        'CANCELLED'
    ) NOT NULL DEFAULT 'PENDING',

    reviewed_by BIGINT UNSIGNED NULL,

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

    CONSTRAINT fk_request_reviewer
        FOREIGN KEY (reviewed_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);


/* =========================================================
   4. INDEXES
   ========================================================= */

CREATE INDEX idx_resource_requests_user_id
    ON resource_requests(user_id);

CREATE INDEX idx_resource_requests_status
    ON resource_requests(status);

CREATE INDEX idx_resource_requests_resource_type
    ON resource_requests(resource_type);

CREATE INDEX idx_resource_requests_created_at
    ON resource_requests(created_at);