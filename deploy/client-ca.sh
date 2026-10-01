#!/usr/bin/env bash
# Ставит на сервер центр, которым подписаны клиентские сертификаты
# (.secrets/client-ca/ca.pem), и перечитывает его без перезапуска.
#
#   HOST=microdocs@notes.e40in.ru ./deploy/client-ca.sh
#
# Сертификаты другого центра после этого не пройдут — сначала поставьте
# новые на свои устройства (scripts/client-cert.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${HOST:-microdocs@notes.e40in.ru}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/mws_vm}"

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$HOST" '
  sudo tee /etc/microdocs/client-ca.pem >/dev/null
  sudo chown microdocs:microdocs /etc/microdocs/client-ca.pem
  sudo chmod 640 /etc/microdocs/client-ca.pem
  sudo systemctl reload microdocs
' <.secrets/client-ca/ca.pem

echo "Сервер принимает сертификаты центра: $(openssl x509 -in .secrets/client-ca/ca.pem -noout -subject)"
