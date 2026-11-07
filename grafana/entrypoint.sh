#!/bin/sh
# Fills the project name (SIIT_PROJECT, the stacks' Project; default siit) into the dashboards:
# their log groups (/<project>/...) and metric namespace (<project>/logs). Then Grafana's own start.
set -eu
project=${SIIT_PROJECT:-siit}
case $project in
  *[!a-z0-9-]* | '') echo "SIIT_PROJECT must be lowercase letters, digits and hyphens" >&2; exit 1 ;;
esac
mkdir -p /var/lib/grafana/dashboards
for f in /usr/share/siit/dashboards/*.json; do
  sed "s/__PROJECT__/$project/g" "$f" > "/var/lib/grafana/dashboards/${f##*/}"
done
exec /run.sh "$@"
