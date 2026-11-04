# Least privilege (FR-9.1, D34). The schema (tables, procedures) belongs to root; every app user
# gets data rights on the tables it uses only, and request_event is append-only for all of them.
#
# - MYSQL_USER (docker compose, SERVICE_ROLE=all): one process does everything, so it gets the
#   union. The MySQL image creates it with every right on MYSQL_DATABASE; this narrows it.
# - One user per service on AWS (D34), each made only when its password is set:
#     IDENTITY_DB_USER      sign-in, profiles: user
#     REQUESTS_DB_USER      requests, review: reads user; request, draft, adds events and jobs
#     PROVISIONING_DB_USER  site jobs, results, scheduler, audit shipping: reads user, moves
#                           request status, adds events, jobs, the scheduler lease and log cursor
#
# The image's entrypoint sources this after init.sql on the first start (alphabetical order), so
# it must not call exit or set. On an existing database, run it once as root:
#   docker compose exec -T mysql sh /docker-entrypoint-initdb.d/privileges.sh
siit_db=$MYSQL_DATABASE

# (siit_ names: the entrypoint sources this file into its own shell.)
# The SQL that creates (when $2 is set) and grants one user: $1 name, $2 password, then the grants
# as "table:PRIVILEGES" words.
grants_for() {
  siit_user=$1 siit_password=$2
  shift 2
  if [ -n "$siit_password" ]; then
    echo "CREATE USER IF NOT EXISTS '$siit_user'@'%' IDENTIFIED BY '$siit_password';"
    echo "ALTER USER '$siit_user'@'%' IDENTIFIED BY '$siit_password';"
  fi
  echo "REVOKE ALL PRIVILEGES, GRANT OPTION FROM '$siit_user'@'%';"
  for siit_grant in "$@"; do
    echo "GRANT ${siit_grant#*:} ON \`$siit_db\`.\`${siit_grant%%:*}\` TO '$siit_user'@'%';"
  done
}

privileges_sql() {
  if [ -n "$MYSQL_USER" ]; then
    grants_for "$MYSQL_USER" '' \
      'user:SELECT, INSERT, UPDATE, DELETE' 'request:SELECT, INSERT, UPDATE, DELETE' \
      'draft:SELECT, INSERT, UPDATE, DELETE' 'request_event:SELECT, INSERT' \
      'provision_job:SELECT, INSERT, UPDATE' 'scheduler_lease:SELECT, UPDATE' 'log_cursor:SELECT, UPDATE'
  fi
  if [ -n "$IDENTITY_DB_PASSWORD" ]; then
    grants_for "${IDENTITY_DB_USER:-siit_identity}" "$IDENTITY_DB_PASSWORD" \
      'user:SELECT, INSERT, UPDATE'
  fi
  # UPDATE on request also covers the locking reads (SELECT ... FOR UPDATE) of the GPU node choice
  # and an extension.
  if [ -n "$REQUESTS_DB_PASSWORD" ]; then
    grants_for "${REQUESTS_DB_USER:-siit_requests}" "$REQUESTS_DB_PASSWORD" \
      'user:SELECT' 'request:SELECT, INSERT, UPDATE' 'draft:SELECT, INSERT, UPDATE, DELETE' \
      'request_event:SELECT, INSERT' 'provision_job:SELECT, INSERT'
  fi
  if [ -n "$PROVISIONING_DB_PASSWORD" ]; then
    grants_for "${PROVISIONING_DB_USER:-siit_provisioning}" "$PROVISIONING_DB_PASSWORD" \
      'user:SELECT' 'request:SELECT, UPDATE' 'request_event:SELECT, INSERT' \
      'provision_job:SELECT, INSERT, UPDATE' 'scheduler_lease:SELECT, UPDATE' 'log_cursor:SELECT, UPDATE'
  fi
}

privileges_sql | MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot "$siit_db"
echo "privileges.sh: least privilege set for${MYSQL_USER:+ $MYSQL_USER}${IDENTITY_DB_PASSWORD:+ ${IDENTITY_DB_USER:-siit_identity}}${REQUESTS_DB_PASSWORD:+ ${REQUESTS_DB_USER:-siit_requests}}${PROVISIONING_DB_PASSWORD:+ ${PROVISIONING_DB_USER:-siit_provisioning}}; request_event is append-only for all"
