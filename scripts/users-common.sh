# Общее для registerUser.sh и revokeUser.sh: где лежат секреты, как ходить
# на сервер, отпечаток сертификата. Подключается через source.

HOST="${HOST:-microdocs@notes.e40in.ru}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/mws_vm}"
URL="${URL:-https://notes.e40in.ru}"
SECRETS="${SECRETS:-.secrets}"

CA_DIR="$SECRETS/users-ca"
CLIENTS_DIR="$SECRETS/clients"

REMOTE_ENV=/etc/microdocs/env
REMOTE_CA=/etc/microdocs/client-ca.pem
REMOTE_REVOKED=/etc/microdocs/revoked.txt

SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$HOST")

die() {
  echo "Ошибка: $*" >&2
  exit 1
}

# Имя так, как его увидит сервер (server/identity.ts → toSafeSegment).
safe_name() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-100
}

# SHA-256 отпечаток сертификата: 64 hex-знака в нижнем регистре, без двоеточий.
fingerprint() {
  openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/.*=//; s/://g' | tr '[:upper:]' '[:lower:]'
}

# Записать stdin в файл на сервере: владелец microdocs, права 0640.
remote_write() {
  "${SSH[@]}" "sudo tee '$1' >/dev/null && sudo chown microdocs:microdocs '$1' && sudo chmod 0640 '$1'"
}

# Сервер перечитывает сертификаты и список отзыва по SIGHUP — без перезапуска.
remote_reload() {
  "${SSH[@]}" 'sudo systemctl reload microdocs'
  sleep 1
}
