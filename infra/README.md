# AWS infrastructure (CloudFormation)

The portal on AWS: CloudFront in front of a private S3 bucket (the React build) and an ALB
(`/api/*`), the services on ECS Fargate, and RDS MySQL Multi-AZ (`DATA_MODE=rds`). MySQL as an ECS
task with its data on EFS (`DATA_MODE=ecs`) is still there as a budget mode.

**Where it runs now:** the course account, CLI profile `des424`, region us-east-1, portal
`https://app.siitrrapp.arbw.dev`. Every resource name starts with `des424-126-g01`, the `<project>`
in this file. **The scripts take that prefix from the settings file:** without
`CONFIG=infra/config.des424.env` they read `infra/config.env`, and if that says `PROJECT=siit` they
work on `siit-*` stacks. See [Next session](#next-session-the-usual-way-in).

```
Browser ─HTTPS─▶ CloudFront  APP_HOST.ZONE_NAME
                  ├─ default ─▶ S3 (React build, private, OAC)
                  └─ /api/*  ─▶ ALB  ORIGIN_HOST.ZONE_NAME (only CloudFront: prefix list + secret header)
                                 └─▶ ECS Fargate backend (public subnets, public IP, no NAT)
                                        └─▶ internal NLB ─▶ ECS Fargate mysql (EFS)
                                         or ─▶ RDS MySQL Multi-AZ (private subnets, TLS checked)
```

Without CloudFront (`ENTRY_MODE=direct`, for accounts that can't use CloudFront) the ALB is the public entry and the
frontend is its own ECS service (nginx with the React build), built and deployed apart from the
backend:

```
Browser ─▶ ALB  APP_HOST.ZONE_NAME (HTTPS; HTTP only redirects), or its AWS name (HTTP, smoke tests)
            ├─ /api/*, /health ─▶ ECS Fargate backend ─▶ internal NLB ─▶ ECS Fargate mysql (EFS)
            └─ everything else ─▶ ECS Fargate frontend (web stack)
```

**Two Availability Zones.** The request and identity services run 2 tasks each
(`BACKEND_DESIRED_COUNT`, `IDENTITY_DESIRED_COUNT`), which ECS places one per AZ; the ALB checks
them and takes a bad one out. They keep no state in memory (the sign-in session and the OAuth state
are cookies), so any task can answer. Provisioning and Grafana run 1 task, which ECS restarts in
either AZ, and RDS has its standby in the other AZ.

**Services.** The backend runs as separate services that never call each other: they share
the database (each change and its outbox row in one transaction) and talk through queues and an
event bus. Each can be deployed, scaled or deleted on its own (`destroy.sh provisioning` stops
provisioning; the portal keeps working and the jobs wait in the outbox).

| Service | Stack | Runs | Holds |
|---|---|---|---|
| frontend | `web` | nginx + the React build (ECS) | nothing secret |
| identity | `identity` | `/api/auth/*`, `/api/users` behind the ALB (ECS, `SERVICE_ROLE=identity`): Google sign-in, the sign-in token, profiles | the Google client, `JWT_SECRET`, DB user |
| requests (`backend`) | `app` | `/api/requests`, `/api/reviewer`, `/health` behind the ALB (ECS, `SERVICE_ROLE=requests`): requests, review, extensions, export; queues jobs in the outbox | `JWT_SECRET` (checks the token only), DB user |
| provisioning | `provisioning` | `node src/worker.js` (ECS, no load balancer): sends the outbox's jobs, applies the results, scheduler, audit shipping | the backend message key, the site queues, DB user |
| notification | `events` | a Lambda (container image) fed by the event bus through its own SQS queue | the SMTP settings (mail secret) |
| grafana | `grafana` | Grafana at `/grafana/` behind the ALB (ECS): the operations dashboards, CloudWatch as its data source | the Google client (staff sign-in), its admin password |
| acc-prov-vm | on-site | creates the accounts at SIIT and emails the student their credentials | the site key and certificate, pfSense and SSH access, its own SMTP settings |

```
requests ──outbox (DB)──▶ provisioning ──job──▶ SQS provision-requests (+DLQ) ──▶ acc-prov-vm (SIIT site)
                                 ◀─result─ SQS provision-results  (+DLQ) ◀──┘
requests, provisioning ──"Email requested"──▶ EventBridge bus ──rule──▶ SQS notifications (+DLQ) ──▶ notification Lambda ──SMTP──▶ student / approvers
acc-prov-vm ──SMTP (from the site, never through AWS)──▶ student (instructions, then the password as an image)
acc-prov-vm ──site certificate──▶ IAM Roles Anywhere ──▶ short-lived credentials of the site role
```

**Two senders, one relay.** The notification Lambda sends the status emails with the mail secret;
acc-prov-vm sends the credential emails with `SMTP_*` in its own settings file at the site. Both
use the same relay (for now a Gmail sender with an App Password), so credentials never reach AWS.
The outbound SMTP port must be open at the site (465 for Gmail).

Locally (`docker compose`) one backend process does both (`SERVICE_ROLE=all`) and sends the emails
itself.

**Logs** (`logs` stack, kept between runs): every container writes one JSON line per event to
stdout, and ECS sends it to the service's CloudWatch Logs group (`/<project>/backend`, `/identity`,
`/provisioning`, `/grafana`, `/notification`, `/frontend`, `/mysql`, kept `APP_LOG_DAYS`, default 90). The backend copies the audit trail
(`request_event`) into `/<project>/audit` (kept `AUDIT_LOG_DAYS`, default 400, NFR-7.1), so the
trail outlives the database. The groups belong to the logs stack, so deleting the app stacks
keeps the logs. The ALB writes its access logs to the stack's S3 bucket (`alb/`, every 5 minutes,
kept `ALB_LOG_DAYS`), including the 502/503 pages it makes itself: an ALB can only log to S3.
In CloudFront mode, CloudFront sends its access logs (one JSON line per request, without cookies or
query strings) to `/<project>/frontend`, so page loads can be searched with Logs Insights too; the
ECS frontend writes there instead when there is no CloudFront.
Error pages show only a reference (the request ID); `find-in-logs.sh <reference>` runs a Logs
Insights query and prints the full error. Saved queries (CloudWatch > Logs Insights): find a
reference, backend errors, one request's audit trail, provisioning failures, slow requests, and
the frontend requests (CloudFront mode).

**Alerts:** the stacks' alarms (error lines per service, ALB 5xx, unhealthy targets, messages in a
dead-letter queue, the site's health, RDS storage and CPU; 13 on the course account) and an EventBridge rule for tasks that crash or fail to start
publish to the logs stack's SNS topic, which mails `ALERT_EMAIL` (AWS sends a confirmation link
first). The alarms are deleted with the app, so they cost ($0.10 each a month) only while it runs.

```
ECS tasks ─stdout─▶ CloudWatch Logs /<project>/backend|frontend|mysql ─metric filters─▶ alarms ─▶ SNS ─▶ email
backend audit shipper ─PutLogEvents─▶ /<project>/audit (400 days)
ALB ─access logs─▶ S3 alb/AWSLogs/…        ECS "task stopped" ─EventBridge─▶ SNS
```

**Dashboards** (`grafana` stack, NFR-8.3): Grafana at `<portal>/grafana/`. The addresses
in `GRAFANA_ALLOWED_EMAILS` (exact addresses only, no whole domains) sign in with Google and get the
Viewer role; any other account is refused, whatever its portal role. Empty: Google sign-in is off
and only the admin account (password in Secrets Manager) gets in. The
image (`grafana/`) has the CloudWatch data source (task role) and the `SIIT portal overview`
dashboard built in: ALB traffic, 5xx and p95 response time, healthy tasks, CPU and memory per
service, queue depth and age (dead-letter queues included), the notification Lambda, error lines
per service and the latest error lines (Logs Insights). Dashboards are code: change
`grafana/dashboards/*.json`, commit, `push-images.sh grafana`, `deploy.sh grafana`. Grafana keeps
no state of its own, so the stack can be deleted and recreated at any time. The admin password
(break-glass) is in the stack's `AdminSecretArn` secret. Container Insights (per-task metrics,
billed) stays off; set `CONTAINER_INSIGHTS=enabled` and run `deploy.sh platform` for a demo day,
then turn it off the same way.

The provisioning service's scheduler (every `SCHEDULER_INTERVAL_SEC`, in one task at a time) reads both
dead-letter queues and fails the jobs it finds there, so the approvers are told (FR-6.7). It also
sends the end-date reminders and removes access when a request ends (FR-8.2, FR-8.4).

## Stacks (`cloudformation/`)

| Stack | Template | Contents |
|---|---|---|
| `<project>-dns` | `dns.yaml` | Route 53 hosted zone for the delegated subdomain. Keep it, also between test runs: a new zone has new name servers. |
| `<project>-cert` | `cert.yaml` | ACM certificate for the zone and `*.zone`, validated through DNS (us-east-1, used by CloudFront and the ALB). |
| `<project>-logs` | `logs.yaml` | The CloudWatch Logs groups of every service and the audit group, error metric filters, saved Logs Insights queries, the alert SNS topic (with `ALERT_EMAIL`), and the S3 bucket for the ALB access logs (SSE-S3, TLS only, no public access). Kept between runs; deleting it deletes the logs. |
| `<project>-network` | `network.yaml` | VPC, 2 public subnets (ALB, tasks), 2 private subnets (EFS, RDS). No NAT gateway. |
| `<project>-platform` | `platform.yaml` | ECR repositories for backend, mysql, frontend, notification and grafana (emptied on delete), ECS cluster (Container Insights off unless `CONTAINER_INSIGHTS=enabled`), backend security group. |
| `<project>-data` | `data-ecs.yaml` | `DATA_MODE=ecs`: MySQL 8.4 task + EFS + internal NLB (stable DB name) + generated DB passwords. The services connect over TLS (`DB_TLS=encrypt`: MySQL's self-signed certificate, not checked). |
| `<project>-rds` | `data-rds.yaml` | `DATA_MODE=rds`: RDS MySQL 8.4, Multi-AZ (`DB_MULTI_AZ`), private subnets, only the backend security group on 3306, TLS required (`DB_TLS=verify`: certificate and host name checked against the RDS CA bundle in the image), encrypted gp3 storage that grows by itself, automated backups (`DB_BACKUP_DAYS`, point-in-time restore while it exists), a final snapshot when the stack is deleted (the next create restores the newest one: `DB_RESTORE`), storage and CPU alarms, generated passwords (one user per service; the admin's is managed by RDS). The `rds-init.sh` task (mysql image) adds the schema while the database is empty and sets the service users; `deploy.sh data` runs it after each deploy. Same outputs as the data stack. |
| `<project>-secrets` | `secrets.yaml` | The secrets you provide: the Google OAuth client and the SMTP settings, created with placeholders (no sign-in, emails off); `set-secrets.sh` puts your values. |
| `<project>-queues` | `queues.yaml` | With `PROVISIONING=true`: the SQS request and result queues, each with a dead-letter queue (14 days, TLS only, encrypted at rest), and the backend's message keys. A small Lambda generates the key pair straight into Secrets Manager; the public half goes to the SSM parameter `/<project>/backend-public-key`, which acc-prov-vm reads at start. |
| `<project>-site` | `site.yaml` | With `PROVISIONING=true`: acc-prov-vm's AWS access through IAM Roles Anywhere. The trust anchor is the project's own CA (`site-ca.sh`, OpenSSL, no AWS Private CA fee); only a certificate with CN `<project>-site` gets the site role, which may only take jobs, send results and read the backend's public key. The site's public key is the SSM parameter `/<project>/site-public-keys`, written by `set-site-key.sh` only. Kept between runs. |
| `<project>-events` | `events.yaml` | The event bus, the notification queue (+ dead-letter queue, alarm) and the notification Lambda, the only reader of the mail secret. |
| `<project>-app` | `app.yaml` | ALB (with a certificate in direct mode: HTTPS on 443, and 80 only redirects to HTTPS), the API service, generated `JWT_SECRET` and origin header, ALB access logs, alarms, the task-stopped rule. |
| `<project>-identity` | `identity.yaml` | The identity service, its target group and the ALB rule for `/api/auth/*` and `/api/users` (priority 2, before the app stack's `/api/*`), its unhealthy alarm. The only reader of the Google secret. |
| `<project>-provisioning` | `provisioning.yaml` | The provisioning service (no load balancer): the site queues and the backend message key when provisioning is on, the scheduler, audit shipping; its error and dead-letter alarms, and the site's health: no heartbeat from acc-prov-vm for `SITE_HEARTBEAT_MINUTES` (it sends a signed one every 5 minutes; also catches expired keys), the site reporting pfSense or a node it can't reach, and jobs waiting `SITE_QUEUE_WAIT_MINUTES` with none taken. |
| `<project>-grafana` | `grafana.yaml` | Grafana: its service (1 task, own security group: only the ALB reaches it), target group and the ALB rule for `/grafana` and `/grafana/*` (priority 3), the generated admin password. |
| `<project>-edge` | `edge.yaml` | CloudFront mode: S3 bucket, CloudFront (SPA rewrite function; `/api/*` and `/grafana*` go to the ALB), its access logs to `/<project>/frontend`, DNS records for the portal. |
| `<project>-web` | `web.yaml` | Direct mode: the frontend service (nginx, `frontend/Dockerfile` `prod` stage) and its ALB rule for every path the backend doesn't take. |

**IAM (least privilege).** Each stack creates the roles of what it runs, named `<project>-<service>-exec` (ECS pulls that one image, writes that one log group, reads only that service's secrets) and `<project>-<service>-task` (what the running code calls: the backend only puts events on the bus; provisioning only its queues, the audit log group and the bus; Grafana reads CloudWatch and only the project's log groups). Identity, the database tasks and nginx call no AWS API and have no task role. The Lambdas have `<project>-notification-fn` and `<project>-message-keys-fn`, the site `<project>-site`. Deploys need `CAPABILITY_NAMED_IAM`, and every stack is tagged `Project=<project>`.

**A shared account** (the course account, every group in one account): set `PROJECT` to the group's prefix. Every name starts with it, and the scripts only list, check or delete resources with that prefix. A second settings file can reuse `config.env` and change a few values: `CONFIG=infra/config.<name>.env infra/scripts/<script>.sh` (git-ignored; it starts with `. "$INFRA_DIR/config.env"`, and a relative `CONFIG` is read from the folder you run in, so run from the repository root). `infra/config.des424.env` does this for the course account:

```bash
. "$INFRA_DIR/config.env"
AWS_PROFILE=des424
AWS_REGION=us-east-1
PROJECT=des424-126-g01
ENTRY_MODE=cloudfront
USE_DOMAIN=true
DATA_MODE=rds
DB_INSTANCE_CLASS=db.t3.micro
DB_MULTI_AZ=true
DB_BACKUP_DAYS=1
DB_RESTORE=latest
CONTAINER_INSIGHTS=disabled
```

The account must allow creating IAM roles; `infra/scripts/probe.sh` checks every service used here.
With `USE_DOMAIN=false` there are no `dns`/`cert` stacks and the ALB answers over HTTP on its AWS
name. That is enough for smoke tests, but not for signing in: the sign-in cookie needs HTTPS.

## Smoke test (deploy, check, delete)

`infra/scripts/smoke-test.sh` deploys network, platform, the images, data, secrets (left
with its placeholders: your real secrets are never used), queues, logs, events, app, identity, provisioning, grafana and web (direct mode, no
domain, provisioning on with a throwaway site key), and checks:
- the frontend answers through the ALB, also on client-side routes;
- the backend answers through the ALB;
- it reaches MySQL as the request service's own database user, over TLS (`check-db-tls.js`:
  `encrypt` on the ECS MySQL, `verify` on RDS);
- the request service has the event bus and token secret but no Google client, SMTP setting, site key or queue;
- the ALB sends `/api/users` to the identity service and `/api/requests` to the request service (each answers 401, not 404), and the identity service logs into its own group;
- it refuses unsigned and cross-site requests;
- an unknown API path is a JSON 404 with its reference (the `X-Request-Id`) and no framework header;
- Google sign-in uses this deploy's callback URL;
- each service's database user has exactly its rights: `check-identity.js` in an identity task
  (it also adds the check accounts), `check-db.js` in a request service task, `check-grants.js`
  in a provisioning task (which also sees its scheduler take the lease);
- provisioning through the real queues: a one-off task (`check-provisioning.js`) approves a GPU
  request, the provisioning service sends the job, `fake-site.mjs` plays acc-prov-vm and answers, the
  request becomes On Use; then the same for the removal;
- the provisioning service's scheduler (every 30 s here; `check-scheduler.js` sets up its requests in a request service task; the smoke test itself puts the dead letter in the queue, since no service role may write there): a GPU request that ended gets
  its removal and is completed, a VM request gets its reminder and then the approvers' notice, and
  a job put into the request dead-letter queue is failed;
- the logs: that 404's access log line is found in CloudWatch Logs (`find-in-logs.sh`, Logs
  Insights), the audit events reach `/<project>/audit`, the ALB access logs reach S3;
- Grafana answers at `/grafana/`, refuses its API without sign-in, its CloudWatch data source works
  with the task role, and the SIIT dashboard is provisioned;
- the status emails of these checks reach the notification Lambda through the event bus (it reads
  the mail secret and sends them, or only logs them with the placeholders; a failed send fails the
  check), the provisioning service logs its start, and the alarms exist (9, plus 1 in direct mode and 2 on RDS; the two site heartbeat alarms are off in a smoke run).

Then it deletes the test stacks (`edge`, `web`, `grafana`, `identity`, `provisioning`, `app`, `events`, `rds`, `data`, `secrets`), even after a
failure or Ctrl+C, and lists anything left behind (stacks, ECS services and tasks, load
balancers, EFS, SQS, Lambda, log groups, secrets). The teardown is fast: every ECS task is
stopped at once, then the stacks go in dependency order, independent ones in parallel.

**Kept between runs:**
- `network` and `platform` (the ECR images): they run nothing and cost cents a month (ECR storage, at most 5 images per repository), so the next run only uploads the images whose code changed.
- `queues`: idle queues cost nothing, since SQS bills per request; the backend key secret costs $0.40/month. Keeping it keeps the backend public key and queue URLs that acc-prov-vm is set up with.
- `logs`: the log groups, the audit trail and the alert topic. Log storage costs cents; metric filters, saved queries and an idle topic cost nothing.
- `site`: the Roles Anywhere access and the site's public key, so nothing changes at the site between sessions.

The smoke test creates them when they are missing (first run) and never deletes them. The `dns` and `cert` stacks stay too.

**Don't run the smoke test while the real acc-prov-vm is connected to the queues.** It would take the test jobs, which are sealed for the throwaway site key, and dead-letter them.

| Command | What it does |
|---|---|
| `smoke-test.sh` | Deploy, check, delete the test stacks; keep network, platform, queues, logs, dns, cert |
| `smoke-test.sh --cloudfront` | The same through CloudFront and S3 (edge stack, `publish-frontend.sh`) instead of the web stack; needs the dns and cert stacks |
| `smoke-test.sh --keep` | Leave the test stacks running |
| `smoke-test.sh --teardown` | Only delete the test stacks and check (after a run was killed hard, or at the end of a session: it is the list of paid stacks). RDS leaves a final snapshot |
| `teardown-all.sh` | Delete everything, including network, platform, queues and logs with its log groups and S3 bucket (asks first); `--dns` also deletes the zone |

## Settings and secrets

- `config.env` (copy `config.example.env`, git-ignored): profile, region, names, sign-in rules,
  and at the end the secrets you provide: the Google OAuth client and the SMTP settings.
- `scripts/set-secrets.sh [google] [mail]` copies those secrets into the secrets stack's
  Secrets Manager secrets and restarts the backend. The values pass through one node process
  and a private temporary file only: never a command line, log or stack parameter. The other
  scripts keep them as shell variables and don't pass them on to the programs they run.
- Generated by CloudFormation (Secrets Manager): MySQL root (RDS: admin) and the service users'
  passwords, `JWT_SECRET`, the CloudFront origin header.
- Generated by the queues stack: the backend's message key pair (the private half only in Secrets
  Manager, the public half in SSM, which acc-prov-vm reads with `MSG_PEER_PUBLIC_KEYS_PARAM`).
  acc-prov-vm's public bundle goes into SSM with `set-site-key.sh <bundle>` (it restarts the
  provisioning service); `SITE_PUBLIC_KEYS` in `config.env` stays empty (the smoke test sets
  its own). Both are public. A new backend key pair: raise `MESSAGE_KEY_GENERATION` and
  `deploy.sh queues`, then restart acc-prov-vm.
- The site's AWS access: `site-ca.sh init` (once: the CA, kept on your laptop), `deploy.sh site`,
  `site-ca.sh issue` (the site's certificate, 1 year); then acc-prov-vm's README, "Roles Anywhere".
- Scheduler: `SCHEDULER_INTERVAL_SEC`, `EXPIRY_REMINDER_DAYS` and `SITE_TIME_ZONE` in `config.env`.
- The backend gets plain values from the task definition and secret ones from Secrets Manager;
  ECS reads them when a task starts.

## Next session (the usual way in)

The base stacks (`dns`, `cert`, `network`, `platform`, `logs`, `queues`, `site`) stay between
sessions, so a session is these commands, from the repository root in Git Bash (about 20-30 minutes,
mostly RDS and CloudFront):

```bash
export CONFIG=infra/config.des424.env     # every script below then uses the des424-126-g01 prefix
infra/scripts/push-images.sh              # builds and uploads what changed
infra/scripts/deploy.sh secrets
infra/scripts/set-secrets.sh              # Google and SMTP values from config.env
infra/scripts/deploy.sh all               # RDS restores the newest final snapshot (DB_RESTORE)
infra/scripts/publish-frontend.sh
```

Then start acc-prov-vm at the site and check that its heartbeat arrives (it sends one every 5
minutes; Logs Insights takes a little longer):

```bash
infra/scripts/find-in-logs.sh '"event":"site.heartbeat"' --since "30 minutes ago" --group provisioning
```

The paid stacks cost about USD 0.18 an hour (estimate). At the end of the session:

```bash
infra/scripts/smoke-test.sh --teardown    # deletes the paid stacks, keeps the base stacks; RDS leaves a final snapshot
```

The final snapshots stay until you delete them, so the next session starts with the same data.

## First deploy

From an empty account, once. The scripts are bash (Git Bash on Windows, or Linux/WSL) and need the
AWS CLI v2, Node.js and Docker.

1. `cp infra/config.example.env infra/config.env` and fill it in (the example already has the course
   account's profile and prefix), or keep your `config.env` and add a settings file as under "A shared
   account" above. In that case, `export CONFIG=infra/config.<name>.env` before the steps below.
2. AWS credentials for `AWS_PROFILE` (`aws configure --profile des424`).
3. `infra/scripts/probe.sh`: checks that the account allows every service used here.
4. `infra/scripts/deploy.sh dns`, then add the printed name servers as `NS` records for the
   subdomain at the parent domain's DNS provider (e.g. Cloudflare: 4 NS records named after the
   subdomain label, DNS only). Check with `nslookup -type=NS <zone>`.
5. `infra/scripts/deploy.sh cert network platform`
6. `infra/scripts/push-images.sh`
7. `infra/scripts/deploy.sh secrets`, then `infra/scripts/set-secrets.sh` (after filling the
   secrets at the end of `config.env`)
8. `infra/scripts/deploy.sh data events app identity edge` (direct mode: `... web`; skip step 9).
   With `PROVISIONING=true`: first `deploy.sh queues`, `site-ca.sh init`, `deploy.sh site`,
   `set-site-key.sh <acc-prov-vm public key>`, and `GPU_NODES` and the links in `config.env`; then
   `... provisioning` too.
9. `infra/scripts/publish-frontend.sh`
10. Google Cloud Console → the OAuth client: add the redirect URIs
    `https://APP_HOST.ZONE_NAME/api/auth/google/callback` and (Grafana)
    `https://APP_HOST.ZONE_NAME/grafana/login/google`, and the JavaScript origin
    `https://APP_HOST.ZONE_NAME`. Then `deploy.sh grafana` for the dashboards.
11. Approvers: put their exact addresses in `APPROVER_EMAILS` (`config.env`), then
    `deploy.sh app identity provisioning`. Being on the list is the only way to be an approver (checked
    on every request, so removing an address takes effect at once); staff not on it sign in as
    requesters with a staff profile (their GPU and Big Data requests are set up by hand). With the list
    empty, grant access by hand after their first sign-in:
    `infra/scripts/run-task.sh --identity node scripts/set-user-role.js person@siit.tu.ac.th Approver`
    (accounts belong to the identity service; the request service's database user may only read them)

## Day to day

| Task | Command |
|---|---|
| New backend version | commit, `push-images.sh backend`, `deploy.sh app identity provisioning` |
| New notification version | commit, `push-images.sh notification`, `deploy.sh events` |
| New dashboard or Grafana version | change `grafana/`, commit, `push-images.sh grafana`, `deploy.sh grafana` |
| Change the approvers | edit `APPROVER_EMAILS` in `config.env`, `deploy.sh app identity provisioning` |
| Swap roles in a demo | empty `APPROVER_EMAILS`, `deploy.sh app identity provisioning`; then `set-role.sh <email> Approver` or `Student` (about a minute each); afterwards the list back and deploy again |
| Container Insights for a demo day | `CONTAINER_INSIGHTS=enabled` in `config.env`, `deploy.sh platform`; afterwards `disabled` and again `deploy.sh platform` |
| Check a service's database rights | `run-task.sh [--identity|--provisioning] node scripts/check-grants.js` |
| New frontend version | `publish-frontend.sh` (direct mode: commit, `push-images.sh frontend`, `deploy.sh web`) |
| Check the database from inside AWS (adds 4 check accounts: throwaway data only) | `run-task.sh --identity node scripts/check-identity.js <marker>`, then `run-task.sh node scripts/check-db.js <marker>` |
| Find an incident from its reference | `find-in-logs.sh <reference>` (last 2 days; `--since "2026-11-01"` for older ones, `--group audit` for one group) |
| Search the ALB access logs | `find-in-logs.sh <text> --alb` (`--date YYYY-MM-DD` for other days) |
| Is the site connected? | `find-in-logs.sh '"event":"site.heartbeat"' --since "30 minutes ago" --group provisioning` |
| Stop the tasks between test sessions | `pause.sh` (the ALB still costs ~$0.6/day; on RDS it stops the instance too, storage still billed, and AWS starts it again after 7 days) |
| Start them again | `resume.sh` |
| Move the database to RDS with its data | `DATA_MODE=rds` in `config.env`, then `switch-to-rds.sh` (RDS is created while the portal runs; then about 5 minutes down for the copy and the restart). Check the portal, then delete the old `<project>-data` stack |
| Test on RDS | `DATA_MODE=rds smoke-test.sh --domain --keep` (RDS adds 15-25 minutes) |
| Rotate the site key | `npm run keygen` at the site, `set-site-key.sh <new>,<old>`, switch the site to the new private key, then `set-site-key.sh <new>` |
| Renew the site certificate (yearly) | `site-ca.sh issue`, copy `site.key` and `site.pem` to the site, restart acc-prov-vm (no AWS change) |
| End of a session | `smoke-test.sh --teardown` (see [Next session](#next-session-the-usual-way-in)) |
| Remove everything (end of the course) | `teardown-all.sh` (and `--dns` for the zone) |

Image tags follow the last commit that changed `backend/` (`frontend/` for the frontend,
`database/` for MySQL and the RDS init task), so a deploy only restarts what changed. Uncommitted changes
produce a `-dirty` tag.

All commands above assume `export CONFIG=infra/config.des424.env` in the shell, from the repository root.

Logs: CloudWatch log groups `/<project>/<service>` and `/<project>/audit` (logs stack).
