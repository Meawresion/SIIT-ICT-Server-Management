# MySQL for ECS (budget mode): the schema is baked in, because ECS can't bind-mount
# init.sql the way docker compose does. It runs only on the first start with an empty data dir.
# ECR Public mirrors the Docker Official Image without Docker Hub's pull limits.
FROM public.ecr.aws/docker/library/mysql:8.4

COPY init.sql /docker-entrypoint-initdb.d/init.sql
# Runs after init.sql: each service user gets rights on its own tables only, and the audit log
# is append-only for all (FR-9.1).
COPY privileges.sh /docker-entrypoint-initdb.d/privileges.sh
# RDS mode (data-rds stack): the same image runs rds-init.sh once per deploy as a one-off
# task (schema, service users, the copy from the ECS MySQL), over TLS checked against the RDS CA.
COPY rds-init.sh /usr/local/bin/rds-init.sh
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds/global-bundle.pem
RUN chmod 644 /etc/ssl/rds/global-bundle.pem
