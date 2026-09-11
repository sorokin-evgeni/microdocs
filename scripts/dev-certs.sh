#!/usr/bin/env bash
# Выпускает самоподписанный набор сертификатов для локальной проверки mTLS:
#   ca.pem / ca.key        — свой удостоверяющий центр
#   server.pem / server.key — сертификат сервера на localhost
#   client.p12              — клиентский сертификат для браузера (пароль: microdocs)
#
# Боевые сертификаты выпускаются иначе: серверный — через Let's Encrypt,
# клиентские — этим же центром, но храните ca.key в надёжном месте.
set -euo pipefail

DIR="${1:-.secrets/certs}"
CN="${MICRODOCS_CLIENT_CN:-evgeny}"
mkdir -p "$DIR"
cd "$DIR"

echo "== удостоверяющий центр =="
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout ca.key -out ca.pem -subj "/CN=microdocs-ca"

echo "== сертификат сервера =="
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr \
  -subj "/CN=localhost"
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial \
  -out server.pem -days 825 \
  -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1")

echo "== клиентский сертификат (CN=$CN) =="
openssl req -newkey rsa:2048 -nodes -keyout client.key -out client.csr \
  -subj "/CN=$CN"
openssl x509 -req -in client.csr -CA ca.pem -CAkey ca.key -CAcreateserial \
  -out client.pem -days 825
openssl pkcs12 -export -out client.p12 -inkey client.key -in client.pem \
  -certfile ca.pem -passout pass:microdocs

rm -f server.csr client.csr
echo
echo "Готово: $(pwd)"
echo "client.p12 установить в систему, пароль microdocs"
