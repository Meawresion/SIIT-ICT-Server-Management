# AWS infrastructure (CloudFormation)

The portal on AWS: CloudFront in front of a private S3 bucket (the React build) and an ALB
(`/api/*`), the backend on ECS Fargate, and for now MySQL as an ECS task with its data on EFS.

```
Browser ─HTTPS─▶ CloudFront  APP_HOST.ZONE_NAME
                  ├─ default ─▶ S3 (React build, private, OAC)
                  └─ /api/*  ─▶ ALB  ORIGIN_HOST.ZONE_NAME (only CloudFront: prefix list + secret header)
                                 └─▶ ECS Fargate backend (public subnets, public IP, no NAT)
                                        └─▶ internal NLB ─▶ ECS Fargate mysql (EFS)
```

Without CloudFront (`ENTRY_MODE=direct`, e.g. Learner Lab) the ALB is the public entry and the
frontend is its own ECS service (nginx with the React build), built and deployed apart from the
backend:

```
Browser ─▶ ALB  APP_HOST.ZONE_NAME (HTTPS), or its AWS name (HTTP, smoke tests)
            ├─ /api/*, /health ─▶ ECS Fargate backend ─▶ internal NLB ─▶ ECS Fargate mysql (EFS)
            └─ everything else ─▶ ECS Fargate frontend (web stack)
```

With `PROVISIONING=true` the backend also sets up GPU requests through acc-prov-vm at the SIIT
site (plan §2): it sends signed and encrypted jobs to SQS and reads the results.

```
ECS backend ──job──▶ SQS provision-requests (+DLQ) ──▶ acc-prov-vm (SIIT site)
            ◀─result─ SQS provision-results  (+DLQ) ◀──┘
```

The backend's scheduler (every `SCHEDULER_INTERVAL_SEC`, in one task at a time) reads both
dead-letter queues and fails the jobs it finds there, so the approvers are told (FR-6.7). It also
sends the end-date reminders and removes access when a request ends (FR-8.2, FR-8.4).

## Stacks (`cloudformation/`)

| Stack | Template | Contents |
|---|---|---|
| `<project>-dns` | `dns.yaml` | Route 53 hosted zone for the delegated subdomain. Keep it, also between test runs: a new zone has new name servers. |
| `<project>-cert` | `cert.yaml` | ACM certificate for the zone and `*.zone`, validated through DNS (us-east-1, used by CloudFront and the ALB). |
| `<project>-network` | `network.yaml` | VPC, 2 public subnets (ALB, tasks), 2 private subnets (EFS, RDS later). No NAT gateway. |
| `<project>-platform` | `platform.yaml` | ECR repositories for backend, mysql and frontend (emptied on delete), ECS cluster, backend security group. |
| `<project>-data` | `data-ecs.yaml` | MySQL 8.4 task + EFS + internal NLB (stable DB name) + generated DB passwords. Later replaced by an RDS stack with the same outputs. |
| `<project>-secrets` | `secrets.yaml` | The secrets you provide: the Google OAuth client and the SMTP settings, created with placeholders (no sign-in, emails off); `set-secrets.sh` puts your values. |
| `<project>-queues` | `queues.yaml` | With `PROVISIONING=true`: the SQS request and result queues, each with a dead-letter queue (14 days, TLS only, encrypted at rest), and the backend's message keys. A small Lambda generates the key pair straight into Secrets Manager; the public half is the `BackendPublicKey` output. |
| `<project>-app` | `app.yaml` | ALB, backend service, generated `JWT_SECRET` and origin header; the queues and keys when provisioning is on. |
| `<project>-edge` | `edge.yaml` | CloudFront mode: S3 bucket, CloudFront (SPA rewrite function), DNS records for the portal. |
| `<project>-web` | `web.yaml` | Direct mode: the frontend service (nginx, `frontend/Dockerfile` `prod` stage) and its ALB rule for every path the backend doesn't take. |

On AWS Learner Lab, IAM roles can't be created, so every task uses `LabRole` (`ROLE_NAME`).

## AWS Learner Lab limits (checked 2026-10-27)

| Service | Learner Lab | What we do |
|---|---|---|
| CloudFront | Denied (list and create) | `ENTRY_MODE=direct`: the ALB is the public entry; the `web` stack serves the frontend instead of `edge`. |
| Cloud Map (create namespace) | Denied | MySQL is reached through an internal Network Load Balancer. |
| IAM (create roles) | Denied | Every role is `LabRole`. |
| ECS, ECR, ELB, EFS, Secrets Manager, Route 53, ACM, SQS, Lambda, Logs | Allowed | |

With `USE_DOMAIN=false` there are no `dns`/`cert` stacks and the ALB answers over HTTP on its AWS
name. That is enough for smoke tests, but not for signing in: the sign-in cookie needs HTTPS.

## Smoke test (deploy, check, delete)

`infra/scripts/smoke-test.sh` deploys network, platform, the images, data, secrets (left
with its placeholders: your real secrets are never used), queues, app and web (direct mode, no
domain, provisioning on with a throwaway site key), and checks:
- the frontend answers through the ALB, also on client-side routes;
- the backend answers through the ALB;
- it reaches MySQL as the app user;
- every SMTP setting reaches the backend from the secrets stack;
- it refuses unsigned and cross-site requests;
- Google sign-in uses this deploy's callback URL;
- `check-db.js` passes in a one-off task;
- provisioning through the real queues: a one-off task (`check-provisioning.js`) approves a GPU
  request, the backend service sends the job, `fake-site.mjs` plays acc-prov-vm and answers, the
  request becomes On Use; then the same for the removal;
- the service's scheduler (every 30 s here, `check-scheduler.js`): a GPU request that ended gets
  its removal and is completed, a VM request gets its reminder and then the approvers' notice, and
  a job put into the request dead-letter queue is failed.

Then it deletes the test stacks (`web`, `app`, `queues`, `data`, `secrets`), even after a
failure or Ctrl+C, and lists anything left behind (stacks, ECS services and tasks, load
balancers, EFS, SQS, Lambda, log groups, secrets). The teardown is fast: every ECS task is
stopped at once, then the stacks go in dependency order, independent ones in parallel.

**Kept between runs** (user's OK, 2026-10-28): `network` and `platform` (the ECR images) run
nothing and cost cents a month (ECR storage, at most 5 images per repository), so the next run
only uploads the images whose code changed. The smoke test creates them when they are missing
(first run, or after a Learner Lab reset) and never deletes them. The `dns` stack stays too.

| Command | What it does |
|---|---|
| `smoke-test.sh` | Deploy, check, delete the test stacks; keep network, platform, dns |
| `smoke-test.sh --keep` | Leave the test stacks running |
| `smoke-test.sh --teardown` | Only delete the test stacks and check (e.g. after a run was killed hard) |
| `teardown-all.sh` | Delete everything, including network and platform (asks first); `--dns` also deletes the zone |

## Settings and secrets

- `config.env` (copy `config.example.env`, git-ignored): profile, region, names, sign-in rules,
  and at the end the secrets you provide: the Google OAuth client and the SMTP settings.
- `scripts/set-secrets.sh [google] [mail]` copies those secrets into the secrets stack's
  Secrets Manager secrets and restarts the backend. The values pass through one node process
  and a private temporary file only: never a command line, log or stack parameter. The other
  scripts keep them as shell variables and don't pass them on to the programs they run.
- Generated by CloudFormation (Secrets Manager): MySQL root and app passwords, `JWT_SECRET`, the
  CloudFront origin header.
- Generated by the queues stack: the backend's message key pair (the private half only in Secrets
  Manager). Give the `BackendPublicKey` output to acc-prov-vm (`MSG_PEER_PUBLIC_KEYS` in its
  `.env`), and put acc-prov-vm's public bundle into `SITE_PUBLIC_KEYS` in `config.env`. Both are
  public. A new key pair: raise `MESSAGE_KEY_GENERATION` and redeploy queues and app.
- Scheduler: `SCHEDULER_INTERVAL_SEC`, `EXPIRY_REMINDER_DAYS` and `SITE_TIME_ZONE` in `config.env`.
- The backend gets plain values from the task definition and secret ones from Secrets Manager;
  ECS reads them when a task starts.

## First deploy

The scripts are bash (Git Bash on Windows, or Linux/WSL) and need the AWS CLI v2, Node.js and Docker.

1. `cp infra/config.example.env infra/config.env` and fill it in.
2. AWS credentials for `AWS_PROFILE` (Learner Lab: "AWS Details" → paste into `~/.aws/credentials`
   under `[siit-lab]`; they expire after a few hours).
3. `infra/scripts/probe.sh`: checks that the account allows every service used here.
4. `infra/scripts/deploy.sh dns`, then add the printed name servers as `NS` records for the
   subdomain at the parent domain's DNS provider (e.g. Cloudflare: 4 NS records named after the
   subdomain label, DNS only). Check with `nslookup -type=NS <zone>`.
5. `infra/scripts/deploy.sh cert network platform`
6. `infra/scripts/push-images.sh`
7. `infra/scripts/deploy.sh secrets`, then `infra/scripts/set-secrets.sh` (after filling the
   secrets at the end of `config.env`)
8. `infra/scripts/deploy.sh data app edge` (direct mode: `data app web`; skip step 9). With
   `PROVISIONING=true`: `data queues app ...`, after setting `SITE_PUBLIC_KEYS`, `GPU_NODES` and
   the two links in `config.env`.
9. `infra/scripts/publish-frontend.sh`
10. Google Cloud Console → the OAuth client: add the redirect URI
    `https://APP_HOST.ZONE_NAME/api/auth/google/callback` and the JavaScript origin
    `https://APP_HOST.ZONE_NAME`.
11. Sign in once, then grant approver access:
    `infra/scripts/run-task.sh node scripts/set-user-role.js person@siit.tu.ac.th Approver`

## Day to day

| Task | Command |
|---|---|
| New backend version | commit, `push-images.sh backend`, `deploy.sh app` |
| New frontend version | `publish-frontend.sh` (direct mode: commit, `push-images.sh frontend`, `deploy.sh web`) |
| Check the database from inside AWS | `run-task.sh node scripts/check-db.js` |
| Stop the tasks between test sessions | `pause.sh` (the ALB still costs ~$0.6/day) |
| Start them again | `resume.sh` |
| Long break | `destroy.sh edge web app` (keeps the zone, certificate, images and data) |
| Remove everything (end of the course) | `teardown-all.sh` (and `--dns` for the zone) |

Image tags follow the last commit that changed `backend/` (`frontend/` for the frontend,
`database/init.sql` and `database/Dockerfile` for MySQL), so a deploy only restarts what changed. Uncommitted changes
produce a `-dirty` tag.

Logs: CloudWatch log groups `/<project>/backend`, `/<project>/frontend` and `/<project>/mysql`.
