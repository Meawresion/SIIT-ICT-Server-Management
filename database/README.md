# Database Usage

This directory contains the MySQL initialization script for the SIIT ICT Resource
Request System.

- `init.sql` creates the application tables.
- `init.sql` also creates stored procedures used by the application for student,
  approver, request, and draft workflows.
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

Creates a request for a student and removes that student's saved draft.

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

Updates a request status and records the reviewing approver. The procedure checks
that the request exists and that the reviewer is an approver.

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
