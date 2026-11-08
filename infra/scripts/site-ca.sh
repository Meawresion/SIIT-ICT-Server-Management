#!/usr/bin/env bash
# The project's own CA for IAM Roles Anywhere (no AWS Private CA fee). Usage:
#   site-ca.sh init           root CA (10 years): ca.key stays here, ca.pem goes to the site stack
#   site-ca.sh issue [days]   the site's key and certificate (CN <project>-site, default 365 days)
#                             for acc-prov-vm; copy site.key and site.pem to the site over SSH
#   site-ca.sh show           the certificates' subjects and dates
# Files go to SITE_CA_DIR (default ~/.siit-site-ca/<project>), outside the repository. Keep ca.key
# private: whoever has it can make a site certificate. A new certificate needs no AWS change.
. "$(dirname "$0")/lib.sh"

dir=${SITE_CA_DIR:-$HOME/.siit-site-ca/$PROJECT}
# Git Bash with Windows OpenSSL: give it C:/... paths, not /c/...
command -v cygpath >/dev/null && dir=$(cygpath -m "$dir")
cn="$PROJECT-site"
# Git Bash: keep /CN=... from being turned into a Windows path.
export MSYS_NO_PATHCONV=1

case ${1:-} in
  init)
    if [ -f "$dir/ca.key" ]; then echo "$dir/ca.key exists already; not replacing it." >&2; exit 1; fi
    mkdir -p "$dir"
    chmod 700 "$dir"
    (umask 077 && openssl ecparam -name prime256v1 -genkey -noout -out "$dir/ca.key")
    openssl req -new -x509 -sha256 -days 3650 -key "$dir/ca.key" -out "$dir/ca.pem" \
      -subj "/O=SIIT ICT/CN=$PROJECT site CA" \
      -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
      -addext "keyUsage=critical,keyCertSign,cRLSign" \
      -addext "subjectKeyIdentifier=hash"
    echo "CA in $dir (ca.key: keep private). Next: deploy.sh site, then site-ca.sh issue."
    ;;
  issue)
    days=${2:-365}
    [ -f "$dir/ca.key" ] || { echo "No CA in $dir: run site-ca.sh init first." >&2; exit 1; }
    ext="$dir/site.ext"
    trap 'rm -f "$ext" "$dir/site.csr"' EXIT
    printf '%s\n' "basicConstraints=critical,CA:FALSE" "keyUsage=critical,digitalSignature" \
      "extendedKeyUsage=clientAuth" "subjectKeyIdentifier=hash" "authorityKeyIdentifier=keyid" > "$ext"
    (umask 077 && openssl ecparam -name prime256v1 -genkey -noout -out "$dir/site.key")
    openssl req -new -sha256 -key "$dir/site.key" -subj "/O=SIIT ICT/CN=$cn" -out "$dir/site.csr"
    openssl x509 -req -sha256 -days "$days" -in "$dir/site.csr" -CA "$dir/ca.pem" -CAkey "$dir/ca.key" \
      -CAcreateserial -extfile "$ext" -out "$dir/site.pem"
    openssl verify -CAfile "$dir/ca.pem" "$dir/site.pem"
    echo "Site key and certificate: $dir/site.key, $dir/site.pem (CN $cn, $days days)."
    echo "Copy both to the site's /etc/acc-prov-vm/site/ (acc-prov-vm/README.md, Roles Anywhere)."
    ;;
  show)
    for f in ca.pem site.pem; do
      if [ -f "$dir/$f" ]; then echo "== $f"; openssl x509 -in "$dir/$f" -noout -subject -issuer -dates; fi
    done
    ;;
  *)
    echo "Usage: $0 init | issue [days] | show" >&2
    exit 1
    ;;
esac
