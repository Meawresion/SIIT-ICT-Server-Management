# SIIT ICT Server Management

A web portal where SIIT students and staff request ICT resources (GPU server, big data platform,
virtual machines, lab equipment, AWS Learner Lab, AWS Skill Builder) and resource approvers review
them. When a GPU or big data request is approved, the accounts are created automatically at the SIIT
site (Linux, HDFS and the OpenVPN user on pfSense), and the student gets the login details by email.
The approver's decision is the only manual step.

```
Browser ─▶ CloudFront ─▶ S3 (React app)
                     └─▶ ALB ─▶ ECS Fargate: identity, requests ─▶ RDS MySQL (Multi-AZ)
                                 provisioning ──SQS (signed + encrypted jobs)──▶ acc-prov-vm at SIIT
                                 EventBridge ─▶ notification Lambda ─▶ status emails
acc-prov-vm ─SSH─▶ GPU and Hadoop nodes, ─webGUI─▶ pfSense, ─SMTP─▶ the student's credentials
```

## Technology

| Part | Stack |
|---|---|
| Frontend | React 19, React Router, Vite |
| Backend | Node.js 22, Express, Prisma (MySQL client), Zod validation |
| Database | MySQL 8 (local container, or Amazon RDS for MySQL Multi-AZ on AWS) |
| Sign-in | Google OAuth 2.0 / OpenID Connect, limited to SIIT student and staff accounts |
| Site worker | Node.js, Playwright (pfSense webGUI), SSH |
| AWS | CloudFront, S3, ALB, ECS Fargate, RDS, SQS, EventBridge, Lambda, Secrets Manager, CloudWatch, IAM Roles Anywhere, all defined in CloudFormation |
| Monitoring | CloudWatch Logs and alarms, Grafana dashboards as code |

## Repository layout

```
.
├── backend/            Express API and background worker (one image, run as several services)
│   ├── prisma/         Prisma schema (mirrors database/init.sql)
│   ├── scripts/        Database and deployment checks, set-user-role.js
│   └── src/            routes, controllers, services, auth, messaging, config
├── frontend/           React app (Vite)
├── database/           init.sql (the schema), privileges.sh, rds-init.sh, ER diagram
├── notification/       Lambda that sends the status emails
├── grafana/            Grafana image with the dashboards and CloudWatch data source
├── acc-prov-vm/        Account provisioning worker that runs at the SIIT site
├── infra/              CloudFormation templates and deploy scripts
├── tests/              End-to-end tests (Playwright) and the read-only live check
├── docker-compose.yml  Local stack: mysql, backend, frontend, activemq
└── .env.example        Template for the local .env
```

Each folder has its own README with the details: [backend data model](database/README.md),
[frontend](frontend/README.md), [AWS](infra/README.md), [site worker](acc-prov-vm/README.md),
[tests](tests/README.md).

## Run it locally

**You need:** Docker with Docker Compose, and a Google OAuth client (Google Cloud Console →
APIs & Services → Credentials → OAuth client ID, type "Web application") with:
- authorized redirect URI `http://localhost:3000/api/auth/google/callback`;
- authorized JavaScript origin `http://localhost:5173`.

1. Create the settings file and fill it in:
   ```bash
   cp .env.example .env
   ```
   Set at least the `CHANGE_ME` passwords, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`
   and the ActiveMQ login. `docker-compose.yml` passes each container only its own keys.
2. Start the stack:
   ```bash
   docker compose up --build
   ```
   - Portal: http://localhost:5173
   - API: http://localhost:3000 (`/health`, `/health/ready`)
   - MySQL: `127.0.0.1:3306`, from this machine only. `database/init.sql` and
     `database/privileges.sh` run on the first start of an empty volume.
3. Sign in with an SIIT Google account. Only addresses that match `STUDENT_EMAIL_DOMAIN` (students)
   or `STAFF_EMAIL_DOMAINS` (staff) are accepted. The first sign-in asks for a profile.
4. Make an approver: put the address in `APPROVER_EMAILS` and restart the backend, or, with the
   list empty, after that person's first sign-in:
   ```bash
   docker compose exec backend npm run user:role -- person@siit.tu.ac.th Approver
   ```

Locally one backend process serves every route and runs the background work
(`SERVICE_ROLE=all`). Status emails are only logged while `SMTP_HOST` is empty, and automatic
provisioning is off while `MESSAGE_TRANSPORT` is empty: approvers then mark requests active by hand.
To try provisioning end to end, set `MESSAGE_TRANSPORT=amqp`, generate the message keys and run
acc-prov-vm against the local ActiveMQ broker ([acc-prov-vm/README.md](acc-prov-vm/README.md),
"Local message broker").

**After a schema change** (`database/init.sql`) recreate the database volume; there are no migration
scripts, and this deletes the local data:
```bash
docker compose down -v
docker compose up --build
```

### Without Docker for the app

Keep MySQL (and ActiveMQ, if used) in Docker and run the app on the host with Node.js 22:

```bash
docker compose up -d mysql

cd backend
npm ci
npx prisma generate
DB_HOST=127.0.0.1 node --env-file=../.env --watch src/server.js

cd ../frontend            # in a second terminal
npm ci
npm run dev               # reads the VITE_* keys from the root .env
```

The backend reads only environment variables. It stops at start with a clear message if a required
key is missing.

## Request lifecycle

```
Draft (saved on the server, up to 20) ─submit─▶ Pending ─approve─▶ Approved ─▶ On Use ─▶ Completed
                                                   └─reject─▶ Rejected
```

- A comment is required for every decision, and approving a request that overlaps the student's
  other requests needs a confirmation. The student can edit a request while it is Pending.
- **GPU server and big data:** approval queues a `CREATE` job. The request becomes On Use when the
  site reports success. At the end date (or when an approver completes it) a `REVOKE` job disables
  the accounts; they are never deleted. An approver can retry a failed job, and a student can ask
  for a later end date (extension).
- **Other resources:** the approver marks the request On Use and Completed by hand.
- Every change is a row in the append-only `request_event` audit log, also copied to CloudWatch Logs
  for 400 days on AWS.

## API

All routes are under `/api`. Sign-in sets an HttpOnly cookie; every other route needs it.

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/auth/google` | anyone | Start Google sign-in |
| GET | `/auth/google/callback` | Google | Sign-in callback |
| GET | `/auth/me` | signed in | The current user and role |
| POST | `/auth/logout` | signed in | Sign out |
| GET, POST, PATCH | `/users/me` | signed in | Read, create, update the profile |
| GET, POST | `/drafts` | requester | List drafts, save a new one |
| PUT, DELETE | `/drafts/:id` | requester | Update, delete a draft |
| POST | `/requests` | requester | Submit a request (optionally from a draft, which is then deleted) |
| GET | `/requests/me` | requester | My requests |
| GET, PATCH | `/requests/:id` | requester | One request with its history; edit while Pending |
| POST | `/requests/:id/extension` | requester | Ask for a later end date |
| GET | `/reviewer/requests` | approver | All requests, with filters and paging |
| GET | `/reviewer/requests/:id` | approver | One request with history, overlaps and setup state |
| PATCH | `/reviewer/requests/:id/approve`, `/reject` | approver | Decide (comment required) |
| PATCH | `/reviewer/requests/:id/activate`, `/complete` | approver | Mark On Use, Completed |
| POST | `/reviewer/requests/:id/provision/retry` | approver | Queue a new job after a failed one |
| PATCH | `/reviewer/requests/:id/extension/approve`, `/reject` | approver | Decide an extension |
| GET | `/reviewer/export` | approver | CSV of the requests in a date range, or of their status history |

## Tests

| Suite | Command |
|---|---|
| Backend unit tests | `cd backend && npm test` |
| Database integration (real MySQL, rolled back) | `cd backend && npm run test:db` (with the `DB_*` keys of a running database) |
| Frontend end-to-end (Playwright, mocked API) | see [tests/README.md](tests/README.md) |
| Live deployment check (read-only) | `bash tests/live-check.sh` |
| AWS smoke test (deploy, check, delete) | `infra/scripts/smoke-test.sh`, see [infra/README.md](infra/README.md) |

## Deploy

- **AWS:** [infra/README.md](infra/README.md), "First deploy" and "Next session". The scripts are
  bash (Git Bash on Windows, Linux or WSL) and need the AWS CLI v2, Node.js and Docker.
- **SIIT site worker:** [acc-prov-vm/README.md](acc-prov-vm/README.md), "Running at the site".

## Settings

Local settings live in the root `.env` (template `.env.example`, with a comment on every key). On
AWS the same keys come from `infra/config.env` and Secrets Manager.

| Group | Keys |
|---|---|
| MySQL | `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` |
| Sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `JWT_SECRET`, `SESSION_IDLE_MINUTES`, `SESSION_MAX_HOURS`, `FRONTEND_URL` |
| Who may sign in | `STUDENT_EMAIL_DOMAIN`, `STUDENT_ID_DIGITS`, `DEGREE_EMAIL_PREFIXES`, `STAFF_EMAIL_DOMAINS`, `APPROVER_EMAILS` |
| Provisioning (optional) | `MESSAGE_TRANSPORT`, `AMQP_*`, `MSG_PRIVATE_KEY`, `MSG_PEER_PUBLIC_KEYS`, `MSG_JOB_TTL_SEC`, `MSG_MAX_TTL_SEC`, `GPU_NODES`, `OVPN_PROFILE_URL`, `MANUAL_GPU_URL`, `MANUAL_BIGDATA_URL` |
| Status emails (optional) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `MAIL_FROM`, `MAIL_REPLY_TO` |
| Scheduler | `SCHEDULER_INTERVAL_SEC`, `EXPIRY_REMINDER_DAYS`, `SITE_TIME_ZONE` |
| Frontend | `VITE_API_URL`, `VITE_CONTACT_EMAIL` |
| ActiveMQ | `ARTEMIS_USER`, `ARTEMIS_PASSWORD` |

## Troubleshooting

- **The backend exits at start:** it names the missing or invalid key; fix it in `.env`.
- **Sign-in fails or returns to the landing page:** check the redirect URI and JavaScript origin of
  the Google client, and that the address matches the sign-in domains.
- **"Access denied" for MySQL after changing `MYSQL_USER` or `MYSQL_PASSWORD`:** the user is created
  only on the first start; recreate the volume (`docker compose down -v`).
- **The frontend can't reach the API:** check `VITE_API_URL` and that `FRONTEND_URL` matches the
  page's origin (CORS).
- **Look at the database:**
  `docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "SHOW TABLES;"'`
