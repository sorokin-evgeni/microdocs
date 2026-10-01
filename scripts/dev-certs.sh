#!/usr/bin/env bash
# Выпускает набор для проверки mTLS на своей машине, в .secrets/dev-certs/:
#   ca.pem / ca.key         — учебный центр «microdocs dev CA»
#   server.pem / server.key — сертификат сервера на localhost
#   client.p12              — клиентский сертификат для браузера (пароль: microdocs)
#
# К боевому серверу этот набор отношения не имеет: там серверный сертификат
# от Let's Encrypt и свой центр для клиентских (docs/DEPLOY.md).
set -euo pipefail

DIR="${1:-.secrets/dev-certs}"
CN="${MICRODOCS_CLIENT_CN:-evgeny}"
mkdir -p "$DIR"
cd "$DIR"

echo "== удостоверяющий центр =="
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout ca.key -out ca.pem -subj "/CN=microdocs dev CA"

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
# -legacy и старые алгоритмы обязательны: PKCS#12 по умолчанию OpenSSL 3
# не импортируется в связку ключей macOS («MAC verification failed»).
openssl pkcs12 -export -legacy -out client.p12 -inkey client.key -in client.pem \
  -certfile ca.pem -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -passout pass:microdocs

rm -f server.csr client.csr ca.srl
echo
echo "Готово: $(pwd)"
echo "client.p12 установить в систему, пароль microdocs"
