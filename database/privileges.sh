# Least privilege for the app user (FR-9.1). The MySQL image gives MYSQL_USER every right on
# MYSQL_DATABASE; this replaces that with data rights on the app's tables and only SELECT and
# INSERT on the append-only request_event log. The schema (tables, procedures) belongs to root.
#
# The image's entrypoint sources this after init.sql on the first start (alphabetical order), so
# it must not call exit or set. On an existing database, run it once as root:
#   docker compose exec -T mysql sh /docker-entrypoint-initdb.d/privileges.sh
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot "$MYSQL_DATABASE" <<SQL
REVOKE ALL PRIVILEGES, GRANT OPTION FROM '$MYSQL_USER'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`$MYSQL_DATABASE\`.\`user\` TO '$MYSQL_USER'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`$MYSQL_DATABASE\`.\`request\` TO '$MYSQL_USER'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`$MYSQL_DATABASE\`.\`draft\` TO '$MYSQL_USER'@'%';
GRANT SELECT, INSERT ON \`$MYSQL_DATABASE\`.\`request_event\` TO '$MYSQL_USER'@'%';
GRANT SELECT, INSERT, UPDATE ON \`$MYSQL_DATABASE\`.\`provision_job\` TO '$MYSQL_USER'@'%';
GRANT SELECT, UPDATE ON \`$MYSQL_DATABASE\`.\`scheduler_lease\` TO '$MYSQL_USER'@'%';
SQL
echo "privileges.sh: $MYSQL_USER may only SELECT and INSERT on request_event, and not DELETE on provision_job or scheduler_lease"
