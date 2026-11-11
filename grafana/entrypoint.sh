#!/bin/sh
# Fills the project name (SIIT_PROJECT, the stacks' Project; default siit) into the dashboards:
# their log groups (/<project>/...), metric namespace (<project>/logs) and the filter that keeps
# other projects' metrics out. SIIT_ALB (the load balancer's full name) limits the ALB panels to
# this deployment's load balancer. Then Grafana's own start.
set -eu
project=${SIIT_PROJECT:-siit}
case $project in
  *[!a-z0-9-]* | '') echo "SIIT_PROJECT must be lowercase letters, digits and hyphens" >&2; exit 1 ;;
esac
alb=${SIIT_ALB:-}
case $alb in
  *[!A-Za-z0-9/-]*) echo "SIIT_ALB must be the load balancer's full name (app/<name>/<id>)" >&2; exit 1 ;;
esac
mkdir -p /var/lib/grafana/dashboards
for f in /usr/share/siit/dashboards/*.json; do
  sed -e "s/__PROJECT__/$project/g" -e "s#__ALB__#$alb#g" "$f" > "/var/lib/grafana/dashboards/${f##*/}"
done
exec /run.sh "$@"
