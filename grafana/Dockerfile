# Grafana for the operations dashboards (D34): the official image with the CloudWatch data source
# and the SIIT dashboards built in, so the dashboards are code and the task keeps no state of its
# own (accounts come back from Google sign-in; nothing to back up).
FROM grafana/grafana:13.2.4

COPY provisioning /etc/grafana/provisioning
COPY dashboards /var/lib/grafana/dashboards
