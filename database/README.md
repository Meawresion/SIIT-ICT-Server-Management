# Database Usage

## Database Structure

```text
┌──────────────────────────────┐
│            users             │
├──────────────────────────────┤
│ id                           │  ← UserID
│ google_sub                   │  [ADDED]
│ student_id*                  │
│ first_name*                  │
│ last_name*                   │
│ primary_email*               │
│ degree                       │
│ program                      │
│ other_program_name           │  [ADDED for OTHER]
│ phone_number*                │
│ advisor_name*                │
│ role                         │  [ADDED]
│ active                       │  [ADDED]
│ created_at                   │  [ADDED]
│ updated_at                   │  [ADDED]
└──────────────┬───────────────┘
               │
               │ 1:N
               ▼
┌──────────────────────────────┐
│      resource_requests       │
├──────────────────────────────┤
│ id                           │  [ADDED]
│ user_id                      │  [ADDED] FK → users.id
│ purpose                      │
│ project_description          │
│ project_supervisor_name      │
│ resource_type*               │
│ justification                │
│ estimated_start_date*        │
│ estimated_end_date*          │
│ impact_score                 │
│ supervisor_confirmation      │
│ status                       │  [ADDED]
│ reviewed_by                  │  [ADDED]
│ reviewed_at                  │  [ADDED]
│ review_comment               │  [ADDED]
│ created_at                   │  [ADDED]
│ updated_at                   │  [ADDED]
└──────────────────────────────┘
```

`*` means the field was explicitly marked as required in the original requirement.

---

# Users

## Get User by Google ID

```sql
SELECT *
FROM users
WHERE google_sub = ?;
```

## Get User by Student ID

```sql
SELECT *
FROM users
WHERE student_id = ?;
```

## Get User by Email

```sql
SELECT *
FROM users
WHERE primary_email = ?;
```

## Create User

```sql
INSERT INTO users (
    google_sub,
    student_id,
    first_name,
    last_name,
    primary_email,
    degree,
    program,
    other_program_name,
    phone_number,
    advisor_name
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
```

Example program values:

```text
CPE
DE
OTHER
```

Example degree values:

```text
UNDERGRADUATE
MASTER
DOCTORAL
```

If `program = 'OTHER'`, use `other_program_name`.

Example:

```text
program = OTHER
other_program_name = Chemical Engineering
```

The backend should obtain `google_sub` from verified Google authentication.

Do not trust `google_sub` sent directly from the frontend.

---

## Update User

```sql
UPDATE users
SET
    first_name = ?,
    last_name = ?,
    degree = ?,
    program = ?,
    other_program_name = ?,
    phone_number = ?,
    advisor_name = ?
WHERE id = ?;
```

The `id` should come from the authenticated backend session.

---

# Resource Requests

## Create Request

```sql
INSERT INTO resource_requests (
    user_id,
    purpose,
    project_description,
    project_supervisor_name,
    resource_type,
    justification,
    estimated_start_date,
    estimated_end_date,
    impact_score,
    supervisor_confirmation
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
```

The backend must obtain `user_id` from the authenticated user/session.

Do not allow the frontend to choose another user's `user_id`.

Example resource type values:

```text
HPC_GPU
BIG_DATA
VM
LAB_EQUIPMENT
AWS_SKILL_BUILDER
AWS_LEARNER_LAB
```

Example request:

```json
{
  "purpose": "Senior Project",
  "project_description": "Training a computer vision model for autonomous robot navigation.",
  "project_supervisor_name": "Dr. Example",
  "resource_type": "HPC_GPU",
  "justification": "GPU acceleration is required for model training.",
  "estimated_start_date": "2026-09-10",
  "estimated_end_date": "2026-12-15",
  "impact_score": 9,
  "supervisor_confirmation": "CONFIRMED"
}
```

---

## Get One Request

```sql
SELECT *
FROM resource_requests
WHERE id = ?
AND user_id = ?;
```

The backend should use:

```text
request_id
current_user_id
```

This prevents users from reading another user's request.

---

## Get All Requests From Current User

```sql
SELECT *
FROM resource_requests
WHERE user_id = ?
ORDER BY created_at DESC;
```

---

## Get All Requests

Admin only:

```sql
SELECT *
FROM resource_requests
ORDER BY created_at DESC;
```

---

## Get Pending Requests

Admin only:

```sql
SELECT *
FROM resource_requests
WHERE status = 'PENDING'
ORDER BY created_at ASC;
```

---

## Get Requests by Status

```sql
SELECT *
FROM resource_requests
WHERE status = ?
ORDER BY created_at DESC;
```

Available status values:

```text
DRAFT
PENDING
ON_HOLD
APPROVED
REJECTED
ACTIVE
COMPLETED
CANCELLED
```

---

## Get Requests by Resource Type

```sql
SELECT *
FROM resource_requests
WHERE resource_type = ?
ORDER BY created_at DESC;
```

Example:

```text
HPC_GPU
```

---

# Update Request

Only allow the owner to modify the request.

```sql
UPDATE resource_requests
SET
    purpose = ?,
    project_description = ?,
    project_supervisor_name = ?,
    resource_type = ?,
    justification = ?,
    estimated_start_date = ?,
    estimated_end_date = ?,
    impact_score = ?,
    supervisor_confirmation = ?
WHERE id = ?
AND user_id = ?
AND status IN (
    'DRAFT',
    'PENDING',
    'ON_HOLD'
);
```

Recommended edit rules:

```text
DRAFT       → editable
PENDING     → editable
ON_HOLD     → editable

APPROVED    → locked
REJECTED    → locked
ACTIVE      → locked
COMPLETED   → locked
CANCELLED   → locked
```

---

# Cancel Request

Prefer cancellation instead of permanently deleting the row.

```sql
UPDATE resource_requests
SET status = 'CANCELLED'
WHERE id = ?
AND user_id = ?
AND status IN (
    'DRAFT',
    'PENDING',
    'ON_HOLD'
);
```

This preserves request history.

---

# Admin Operations

## Approve Request

```sql
UPDATE resource_requests
SET
    status = 'APPROVED',
    reviewed_by = ?,
    reviewed_at = CURRENT_TIMESTAMP,
    review_comment = ?
WHERE id = ?
AND status IN (
    'PENDING',
    'ON_HOLD'
);
```

Parameters:

```text
admin_user_id
review_comment
request_id
```

The backend must check:

```text
role = ADMIN
```

before performing this operation.

---

## Reject Request

```sql
UPDATE resource_requests
SET
    status = 'REJECTED',
    reviewed_by = ?,
    reviewed_at = CURRENT_TIMESTAMP,
    review_comment = ?
WHERE id = ?
AND status IN (
    'PENDING',
    'ON_HOLD'
);
```

---

## Put Request On Hold

```sql
UPDATE resource_requests
SET
    status = 'ON_HOLD',
    reviewed_by = ?,
    reviewed_at = CURRENT_TIMESTAMP,
    review_comment = ?
WHERE id = ?
AND status = 'PENDING';
```

---

## Mark Approved Request as Active

```sql
UPDATE resource_requests
SET status = 'ACTIVE'
WHERE id = ?
AND status = 'APPROVED';
```

---

## Mark Active Request as Completed

```sql
UPDATE resource_requests
SET status = 'COMPLETED'
WHERE id = ?
AND status = 'ACTIVE';
```

---

# Useful Admin Query

Get request information together with student information:

```sql
SELECT
    rr.id AS request_id,
    rr.status,
    rr.resource_type,
    rr.purpose,
    rr.project_description,
    rr.project_supervisor_name,
    rr.justification,
    rr.estimated_start_date,
    rr.estimated_end_date,
    rr.impact_score,
    rr.supervisor_confirmation,

    u.student_id,
    u.first_name,
    u.last_name,
    u.primary_email,
    u.degree,
    u.program,
    u.other_program_name,
    u.phone_number,
    u.advisor_name

FROM resource_requests rr

JOIN users u
    ON rr.user_id = u.id

ORDER BY rr.created_at DESC;
```

---

# Common API → Database Mapping

```text
POST /api/requests
    → INSERT resource_requests


GET /api/requests/me
    → SELECT requests
      WHERE user_id = current authenticated user


GET /api/requests/:id
    → SELECT request
      WHERE id = request_id
      AND user_id = current authenticated user


PATCH /api/requests/:id
    → UPDATE request
      WHERE id = request_id
      AND user_id = current authenticated user


DELETE /api/requests/:id
    → UPDATE status = CANCELLED


GET /api/admin/requests
    → SELECT all requests


GET /api/admin/requests?status=PENDING
    → SELECT requests
      WHERE status = PENDING


PATCH /api/admin/requests/:id/approve
    → UPDATE status = APPROVED


PATCH /api/admin/requests/:id/reject
    → UPDATE status = REJECTED


PATCH /api/admin/requests/:id/hold
    → UPDATE status = ON_HOLD
```

---

# Important Security Rules

The frontend must never directly execute SQL.

Use:

```text
Frontend
   ↓
HTTP API
   ↓
Backend
   ↓
MySQL
```

The backend must determine these values from trusted authentication/session information:

```text
user_id
google_sub
role
reviewed_by
```

Do not trust frontend values such as:

```json
{
  "user_id": 5,
  "role": "ADMIN",
  "status": "APPROVED",
  "reviewed_by": 1
}
```

For normal user operations:

```text
Authenticated Google user
        ↓
Backend identifies users.id
        ↓
Database query uses that users.id
```

For admin operations:

```text
Authenticated user
        ↓
Backend checks role == ADMIN
        ↓
Admin database operation
```

Always use parameterized queries with `?` placeholders instead of constructing SQL using string concatenation.
