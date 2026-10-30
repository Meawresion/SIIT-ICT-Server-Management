# Database Usage

This directory contains the MySQL initialization script for the SIIT ICT Resource
Request System.

- `init.sql` creates the application tables.
- `privileges.sh` runs after it and limits the backend's database user (`MYSQL_USER`) to the
  application tables, with only `SELECT` and `INSERT` on the `request_event` audit log (FR-9.1).
  Root (the admin user) owns the schema.
- `init.sql` also creates stored procedures for direct SQL access to student,
  approver, request, and draft workflows. The HTTP backend uses Prisma with the same tables and workflow rules.
- `docker-compose.yml` mounts `database/init.sql` into the MySQL container at
  `/docker-entrypoint-initdb.d/init.sql`, so it runs automatically when the
  database volume is initialized for the first time.

## ER Diagram

![ER diagram](er-diagram.png)

The diagram uses Chen notation:

- Rectangle: entity. A double rectangle (`Draft`) is a weak entity, identified through its owner `User`.
- Ellipse: attribute. An underlined attribute is the primary key.
- Diamond: relationship. A double diamond (`Saves`) is the identifying relationship of a weak entity.
- `1` and `N` on a line: cardinality. One user submits N requests, one approver reviews N requests, and one user saves 1 draft.
- Double line: total participation, meaning every row on that side must take part.
- Italic text on a line: the role the `User` plays in that relationship (`student` or `approver`).

Foreign key columns (`student_uid`, `approver_uid`) are not drawn as attributes, because the
relationships represent them. `reviewed_at` is drawn on `Reviews`, since it describes the review.

To regenerate the image after a schema change, edit `er-diagram.py`, then run:

```bash
python3 database/er-diagram.py
rsvg-convert database/er-diagram.svg -o database/er-diagram.png
```

Relationships:

- **User submits Request:** one student has zero or more requests. `Request.student_uid` is required.
- **User reviews Request:** one approver reviews zero or more requests. `Request.approver_uid` stays `NULL` until a review happens.
- **User saves Draft:** one student has at most one draft, because `Draft.student_uid` is both the primary key and the foreign key.

## Tables

### User

Stores both student and approver accounts.

| Column | Notes |
|--------|-------|
| `uid` | Unsigned auto-increment primary key |
| `role` | `Approver` or `Student` |
| `fullname` | Full display name |
| `siitemail` | Unique SIIT email address |
| `phone_number` | Contact number |
| `s_id` | Optional student ID, used by student accounts |
| `study_degree` | Optional, `Undergraduate`, `Master`, or `PhD` |
| `s_program` | Optional study program |
| `advisor_name` | Student's primary advisor (supervising faculty member) |
| `created_at` | Created timestamp |
| `updated_at` | Automatically updated timestamp |

### Request

Stores submitted resource requests.

| Column | Notes |
|--------|-------|
| `rid` | Unsigned auto-increment primary key |
| `student_uid` | Required student owner, references `User.uid` |
| `resource_type` | Requested resource category |
| `por` | Purpose of request, such as Senior Project or Thesis |
| `proj_name` | Project name |
| `spv_name` | Supervisor name |
| `spv_email` | Supervisor email |
| `justify` | Request justification |
| `start_date` | Requested start datetime |
| `end_date` | Requested end datetime |
| `extra_details` | JSON field for resource-specific details |
| `process_type` | `Automate` for GPU server and big data requests; otherwise `Manual` |
| `status` | Current request state |
| `approver_uid` | Reviewing approver, references `User.uid` |
| `reviewed_at` | Review timestamp |
| `created_at` | Created timestamp |
| `updated_at` | Automatically updated timestamp |

### Draft

Stores one in-progress draft per student. Submitting a real request deletes that
student's draft. Deleting a user also deletes their draft (`ON DELETE CASCADE`).

| Column | Notes |
|--------|-------|
| `student_uid` | Primary key and student owner, references `User.uid` |
| `resource_type` | Requested resource category |
| `por` | Purpose of request |
| `proj_name` | Project name |
| `spv_name` | Supervisor name |
| `spv_email` | Supervisor email |
| `justify` | Request justification |
| `start_date` | Requested start datetime |
| `end_date` | Requested end datetime |
| `extra_details` | JSON field for resource-specific details |
| `updated_at` | Automatically updated timestamp |

### Request Event

The append-only audit log (FR-4.2, FR-5.5, FR-9.1): one row for every request creation, student
edit and status change, in the same transaction as the change. It is never updated or deleted:
the app user only has `SELECT` and `INSERT` on it, and triggers refuse `UPDATE` and `DELETE` for
everyone, root included. A request or user with events can't be deleted (foreign keys without
cascade), so the log stays complete.

| Column | Notes |
|--------|-------|
| `eid` | Unsigned auto-increment primary key; orders the events of a request |
| `rid` | The request, references `Request.rid` |
| `action` | `CREATED`, `EDITED`, `APPROVED`, `REJECTED`, `ACTIVATED`, `COMPLETED`; from provisioning: `PROVISIONED`, `PROVISION_FAILED`, `REVOKED`, `REVOKE_FAILED` (system), `RETRIED` (approver); from the scheduler: `REMINDED` (end-date reminder sent), `EXPIRED` (the end date passed); extensions (FR-8.3): `EXTENSION_REQUESTED` (student), `EXTENSION_APPROVED`, `EXTENSION_REJECTED` (approver), `EXTENDED`, `EXTEND_FAILED` (system) |
| `from_status` | Status before the event; `NULL` when the request is created |
| `to_status` | Status after the event (the same as `from_status` for an edit) |
| `actor_uid` | Who acted, references `User.uid`; `NULL` for the system (provisioning results, scheduler) |
| `comment` | The approver's comment on a decision |
| `details` | JSON: `{"fields": [...]}` names (not values) of the fields an edit changed; `{"confirmed_overlaps": [...]}` when an approver approved despite overlapping requests (D28); `job_id`, `gpu_node` and the VPN state for provisioning |
| `created_at` | When it happened |

The request detail shows this history: students see who acted by role only, approvers also by name.

### Provision Job

The outbox for acc-prov-vm (plan §2.1). Approving a GPU request writes a `CREATE` job, and
completing it a `REVOKE` job, in the same transaction as the decision. The backend's dispatcher
publishes queued jobs (signed and encrypted, D22) and applies acc-prov-vm's results, so a broker
or site outage loses nothing. A retry is a new row with a new `job_id`, because acc-prov-vm
answers a `job_id` it has already handled with its stored result. The app user may select,
insert and update jobs, but not delete them.

| Column | Notes |
|--------|-------|
| `job_id` | UUID primary key; also the message `jti` |
| `rid` | The request, references `Request.rid` (no cascade) |
| `action` | `CREATE`, `REVOKE` or `EXTEND` (a later end date, FR-8.3) |
| `status` | `Queued` → `Sent` → `Succeeded` or `Failed`. A send that fails stays `Queued` and is retried with backoff. The scheduler fails a `Sent` job that was dead-lettered or got no answer before it expired |
| `payload` | The job as sent (username, name, email, node, period, links); never a password |
| `attempts` | Publish attempts |
| `last_error` | The last publish error, or the error acc-prov-vm reported |
| `result` | acc-prov-vm's result: non-secret details only (username, node, VPN state) |
| `next_attempt_at` | When a queued job may be sent (backoff after a failed send) |
| `sent_at`, `completed_at`, `created_at`, `updated_at` | Timestamps |

The node a GPU request was given is also kept in `request.extra_details.gpu_node`, so the
`REVOKE` goes to the same node.

### Scheduler Lease

The backend's scheduler (FR-8.4) runs in every backend task; a pass runs only in the task that
holds the lease, so two tasks never send the same reminder or REVOKE. The holder renews it on
every pass, and another task takes over once it lapses. The app user may select and update it.

| Column | Notes |
|--------|-------|
| `name` | `scheduler` (one row, created with the table) |
| `owner` | The backend task holding the lease |
| `lease_until` | When the lease lapses |

## Enum Values

### Resource Types

```text
GPU_SERVER
BIG_DATA
VM
LAB_EQUIPMENT
AWS_LAB
AWS_SKILL
```

### Request Statuses

```text
Pending
Approved
Rejected
On Use
Completed
```

### Process Types

```text
Manual
Automate
```

`add_request` sets `process_type` to `Automate` for `GPU_SERVER` and `BIG_DATA`.
All other resource types use `Manual`.

## Stored Procedures

### Student Procedures

#### `add_student`

Creates a student user.

```sql
CALL add_student(
  'Student Name',
  'student@example.siit.tu.ac.th',
  '0812345678',
  '6422770000',
  'Undergraduate',
  'CPE'
);
```

#### `edit_student`

Updates a student by `siitemail`.

```sql
CALL edit_student(
  'Student Name',
  'student@example.siit.tu.ac.th',
  '0812345678',
  '6422770000',
  'Master',
  'ICT'
);
```

#### `get_student_by_email`

Returns one student profile by SIIT email.

```sql
CALL get_student_by_email('student@example.siit.tu.ac.th');
```

#### `get_student_by_uid`

Returns one student profile by `uid`.

```sql
CALL get_student_by_uid(1);
```

### Approver Procedures

#### `get_approver_by_email`

Returns one approver profile by SIIT email.

```sql
CALL get_approver_by_email('approver@example.siit.tu.ac.th');
```

#### `get_approver_by_uid`

Returns one approver profile by `uid`.

```sql
CALL get_approver_by_uid(2);
```

### Request Procedures

#### `add_request`

Creates a request for a student, logs its `CREATED` event and removes that student's saved
draft.

```sql
CALL add_request(
  1,
  'GPU_SERVER',
  'Senior Project',
  'Computer Vision Model Training',
  'Dr. Example',
  'supervisor@example.siit.tu.ac.th',
  'GPU acceleration is required for model training.',
  '2026-09-10 09:00:00',
  '2026-12-15 17:00:00',
  JSON_OBJECT('gpu_count', 1, 'storage_gb', 100)
);
```

#### `get_student_request`

Returns all requests for a student, newest first.

```sql
CALL get_student_request(1);
```

#### `get_request_by_status`

Returns all requests with a given status, including student and reviewer details.

```sql
CALL get_request_by_status('Pending');
```

#### `update_request_status`

Updates a request status, records the reviewing approver and logs the status change in
`request_event`. The procedure checks that the request exists and that the reviewer is an
approver. It doesn't check the transition; the backend does (Pending → Approved or Rejected,
Approved → On Use → Completed).

```sql
CALL update_request_status(10, 2, 'Approved');
```

### Draft Procedures

#### `save_draft`

Creates or updates the current student's draft.

```sql
CALL save_draft(
  1,
  'VM',
  'Thesis',
  'Simulation Environment',
  'Dr. Example',
  'supervisor@example.siit.tu.ac.th',
  'A VM is needed for repeatable experiments.',
  '2026-09-10 09:00:00',
  '2026-11-30 17:00:00',
  JSON_OBJECT('cpu', 4, 'memory_gb', 16)
);
```

#### `get_draft`

Returns the current draft for a student.

```sql
CALL get_draft(1);
```

#### `delete_draft`

Deletes the current draft for a student.

```sql
CALL delete_draft(1);
```

## Local Initialization

Start the database through Docker Compose:

```bash
docker-compose up mysql
```

If the `mysql_data` Docker volume already exists, MySQL will not rerun
`init.sql`. To rebuild the schema from scratch, remove the volume and start the
database again:

```bash
docker-compose down -v
docker-compose up mysql
```

## Backend compatibility

The backend uses the current lowercase `user`, `request`, `draft` and `request_event` tables.
Its own bookkeeping tables are:
- `provision_job`: the acc-prov-vm outbox;
- `scheduler_lease`: which backend task runs the scheduler;
- `log_cursor`: the last `request_event` copied into the logs as an `audit.event` line. On AWS those lines reach the S3 logs bucket.

The app user may read and update these tables but not delete from them.
It preserves the frontend API field names and enum values through
`backend/src/utils/db-mapping.js`. No database reset or data migration is needed
when these tables already exist. Regenerate the Prisma client after schema edits:

```bash
cd backend
npm run prisma:generate
npm test
npm run test:db
```

`test:db` exercises the real services against the configured database (`DB_*` keys) inside
one transaction, then rolls back all test records. Run it as the app user: it also checks that
this user can't update or delete `request_event`.

Google sign-in finds users by their verified email. New sign-ins create a
`Student` row; completing the profile updates that same row. Reviewer access
requires an existing `Approver` role in the database.

Frontend names map to the database as follows:

| Frontend | Database |
|----------|----------|
| `HPC_GPU` | `GPU_SERVER` |
| `AWS_SKILL_BUILDER` | `AWS_SKILL` |
| `AWS_LEARNER_LAB` | `AWS_LAB` |
| `ACTIVE` | `On Use` (Prisma `On_Use`) |
| `DOCTORAL` | `PhD` |

The full project description, impact score, supervisor confirmation, and review
comment are stored in `request.extra_details`. Existing resource-specific JSON
is retained during edits and reviews. `proj_name` uses the first 255 characters
of the description unless a separate `project_name` is supplied. Supervisor email
is stored when supplied through the API; the current form has no email input and
therefore saves an empty string.

The profile's primary advisor is stored in `user.advisor_name`. The supervisor of
an individual request is stored separately in `request.spv_name`.

## Schema changes

`init.sql` and `privileges.sh` run only when the `mysql_data` volume is created, and there are
no migration scripts: after a schema change, delete the volume and let MySQL create a new one.
This deletes all local data.

```bash
docker compose rm -sf mysql backend
docker volume rm siit-ict-server-management_mysql_data
docker compose up -d --build
```

The volume name is `<compose project>_mysql_data` (`docker volume ls`). On AWS, a new data stack
starts from the same `init.sql`.

## Assign reviewer access by email

The approver home page is `/admin`; requests are reviewed there and on
`/history`. The current schema has two roles: `Student` and `Approver`.
`Approver` grants reviewer access; there is no separate admin role. After
Google sign-in, `/dashboard` sends approvers to `/admin`.

The person must sign in with Google once to create their account. Then run this
command in the backend container, which has the same database settings as the application:

```bash
docker compose exec backend npm run user:role -- person@siit.tu.ac.th Approver
```

To remove reviewer access:

```bash
npm run user:role -- person@siit.tu.ac.th Student
```

The command normalizes the email and updates only the existing user's role.
It never creates an account or changes request ownership. Access changes take
effect on the next API request because the backend reads the database role for
each authenticated request. A student needs a completed profile to use student
request pages after being demoted.

Role assignment is a server command with database credentials; no public API
accepts role changes, and users cannot choose their own role during sign-in.
