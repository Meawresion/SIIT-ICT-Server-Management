# MySQL for ECS (budget mode, D31): the schema is baked in, because ECS can't bind-mount
# init.sql the way docker compose does. It runs only on the first start with an empty data dir.
# ECR Public mirrors the Docker Official Image without Docker Hub's pull limits.
FROM public.ecr.aws/docker/library/mysql:8.4

COPY init.sql /docker-entrypoint-initdb.d/init.sql
# Runs after init.sql: each service user gets rights on its own tables only, and the audit log
# is append-only for all (FR-9.1, D34).
COPY privileges.sh /docker-entrypoint-initdb.d/privileges.sh
