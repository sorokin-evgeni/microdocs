#!/usr/bin/env bash
# Выпускает клиентский сертификат для устройства — по нему сервер пускает.
#
#   scripts/client-cert.sh phone            # .secrets/clients/evgeny-phone.p12
#   scripts/client-cert.sh mac
#   scripts/client-cert.sh laptop anna      # владелец anna — у неё своя база
#
# Подписывает своим центром из .secrets/client-ca/; при первом запуске создаёт его.
# Сервер должен знать этот центр: deploy/client-ca.sh.
#
# CN сертификата — имя владельца, оно же имя его базы на сервере. Поэтому
# у всех устройств одного человека CN одинаковый, различаются они именем файла
# и подписью при установке.
set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE="${1:?Укажите устройство: scripts/client-cert.sh phone}"
OWNER="${2:-evgeny}"
NAME="$OWNER-$DEVICE"

CA=.secrets/client-ca
OUT=.secrets/clients
mkdir -p "$CA" "$OUT"
chmod 700 "$CA" "$OUT"

if [[ -f "$OUT/$NAME.p12" ]]; then
  echo "Уже есть: $OUT/$NAME.p12" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Свой конфиг: системный у LibreSSL на маке и OpenSSL в Linux разный.
cat >"$TMP/openssl.cnf" <<'EOF'
[req]
distinguished_name = dn
[dn]
[ca_ext]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[client_ext]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EOF

if [[ ! -f "$CA/ca.key" ]]; then
  echo "== новый центр: $CA =="
  openssl req -x509 -new -newkey rsa:2048 -nodes -days 7300 \
    -config "$TMP/openssl.cnf" -extensions ca_ext -subj "/CN=microdocs client CA" \
    -keyout "$CA/ca.key" -out "$CA/ca.pem"
  chmod 600 "$CA/ca.key"
  echo "Сохраните $CA/ca.key в надёжное место: им выпускаются все сертификаты."
  echo "Серверу нужен только ca.pem: deploy/client-ca.sh"
  echo
fi

echo "== сертификат $NAME (CN=$OWNER) =="
openssl req -new -newkey rsa:2048 -nodes -config "$TMP/openssl.cnf" \
  -subj "/CN=$OWNER/OU=$DEVICE" -keyout "$TMP/key" -out "$TMP/csr"
openssl x509 -req -in "$TMP/csr" -CA "$CA/ca.pem" -CAkey "$CA/ca.key" \
  -set_serial "0x$(openssl rand -hex 16)" -days 3650 \
  -extfile "$TMP/openssl.cnf" -extensions client_ext -out "$TMP/cert"

# 3DES и SHA1 — иначе связка ключей macOS не примет файл («MAC verification failed»).
PASSWORD=$(openssl rand -hex 6)
openssl pkcs12 -export -inkey "$TMP/key" -in "$TMP/cert" -certfile "$CA/ca.pem" \
  -name "microdocs $NAME" -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -passout "pass:$PASSWORD" -out "$OUT/$NAME.p12"
printf '%s\n' "$PASSWORD" >"$OUT/$NAME.password"
chmod 600 "$OUT/$NAME.p12" "$OUT/$NAME.password"

echo "Готово: $OUT/$NAME.p12"
echo "Пароль: $PASSWORD (лежит рядом в $NAME.password)"
