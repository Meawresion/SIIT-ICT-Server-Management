#!/usr/bin/env bash
# Prepares the RDS database (data-rds stack, D31). deploy.sh data runs it as a one-off ECS task after
# every deploy of that stack, so it must be safe to run again. It connects as the RDS admin user
# over TLS, with the server certificate and host name checked against the RDS CA bundle.
#  1. waits until RDS answers;
#  2. runs init.sql (tables, triggers, procedures) while the database has no tables;
#  3. with SOURCE_DB_HOST (switch-to-rds.sh): copies the data of the ECS MySQL, in one transaction
#     and only into a database without accounts, then compares the row counts;
#  4. creates the service users with their passwords and rights (privileges.sh).
# Settings: DB_HOST, DB_PORT, MYSQL_DATABASE, DB_ADMIN_USER, DB_ADMIN_PASSWORD, the *_DB_USER and
# *_DB_PASSWORD of privileges.sh; to copy also SOURCE_DB_HOST, SOURCE_DB_PORT, SOURCE_DB_PASSWORD
# (root of the ECS MySQL, whose certificate is self-signed: encrypted but not checked).
set -eo pipefail
siit_db=$MYSQL_DATABASE
ca=${DB_TLS_CA:-/etc/ssl/rds/global-bundle.pem}

rds() {
  MYSQL_PWD="$DB_ADMIN_PASSWORD" mysql --host="$DB_HOST" --port="${DB_PORT:-3306}" --user="$DB_ADMIN_USER" \
    --ssl-mode=VERIFY_IDENTITY --ssl-ca="$ca" "$@"
}
source_db() {
  MYSQL_PWD="$SOURCE_DB_PASSWORD" "$1" --host="$SOURCE_DB_HOST" --port="${SOURCE_DB_PORT:-3306}" --user=root \
    --ssl-mode=REQUIRED "${@:2}"
}

for attempt in $(seq 1 30); do
  rds -e 'SELECT 1' >/dev/null 2>&1 && break
  if [ "$attempt" = 30 ]; then echo "rds-init: RDS doesn't answer at $DB_HOST:" >&2; rds -e 'SELECT 1'; exit 1; fi
  sleep 10
done
echo "rds-init: connected to $DB_HOST over TLS ($(rds -N -e "SHOW SESSION STATUS LIKE 'Ssl_version'" | cut -f2), certificate checked)"

tables=$(rds -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$siit_db'")
if [ "$tables" = 0 ]; then
  echo "rds-init: empty database: running init.sql"
  rds "$siit_db" < /docker-entrypoint-initdb.d/init.sql
else
  echo "rds-init: the schema exists ($tables tables): init.sql skipped"
fi

if [ -n "${SOURCE_DB_HOST:-}" ]; then
  accounts=$(rds -N -e "SELECT COUNT(*) FROM \`$siit_db\`.\`user\`")
  if [ "$accounts" != 0 ]; then
    echo "rds-init: RDS already holds $accounts accounts, so nothing is copied (it only copies into a new database)." >&2
    exit 1
  fi
  echo "rds-init: copying the data from $SOURCE_DB_HOST"
  # Data only: init.sql made the tables and triggers. --replace: the rows init.sql adds (scheduler
  # lease, log cursor) take the source's values. No LOCK TABLES or ALTER TABLE in the dump: both
  # would commit, and the load must be one transaction (a failed load leaves RDS empty).
  source_db mysqldump --single-transaction --no-create-info --skip-triggers --replace --complete-insert \
    --skip-add-locks --skip-disable-keys --set-gtid-purged=OFF --no-tablespaces --hex-blob \
    "$siit_db" > /tmp/data.sql
  { echo 'SET autocommit = 0;'; cat /tmp/data.sql; echo 'COMMIT;'; } | rds "$siit_db"
  rm -f /tmp/data.sql
  mismatch=0
  for table in $(rds -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema = '$siit_db' ORDER BY table_name"); do
    from=$(source_db mysql -N -e "SELECT COUNT(*) FROM \`$siit_db\`.\`$table\`")
    to=$(rds -N -e "SELECT COUNT(*) FROM \`$siit_db\`.\`$table\`")
    echo "rds-init:   $table: $from -> $to rows"
    [ "$from" = "$to" ] || mismatch=1
  done
  if [ "$mismatch" = 1 ]; then echo "rds-init: the row counts differ (above)." >&2; exit 1; fi
  echo "rds-init: copy complete"
fi

siit_admin_mysql() { rds "$siit_db"; }
# shellcheck source=privileges.sh
. /docker-entrypoint-initdb.d/privileges.sh
