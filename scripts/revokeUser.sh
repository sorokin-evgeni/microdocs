#!/usr/bin/env bash
# Отозвать доступ:
#
#   npm run revokeUser -- anna                 все сертификаты человека
#   npm run revokeUser -- anna <файл.pem>      один (например, потерянный телефон)
#
# Отпечатки уходят в /etc/microdocs/revoked.txt, сервер перечитывает список
# без перезапуска и с этими сертификатами больше ничего не отдаёт — ни
# страниц, ни самого приложения. База человека остаётся в хранилище как была.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/users-common.sh

NAME="${1:-}"
[ -n "$NAME" ] || die "укажите имя: npm run revokeUser -- <имя> [сертификат.pem]"

if [ -n "${2:-}" ]; then
  CERTS=("$2")
else
  CERTS=()
  for cert in "$CLIENTS_DIR/$NAME"/*.pem; do
    [ -f "$cert" ] && CERTS+=("$cert")
  done
fi
[ "${#CERTS[@]}" -gt 0 ] || die "нет сертификатов $NAME в $CLIENTS_DIR/$NAME"

"${SSH[@]}" "sudo test -f $REMOTE_REVOKED" ||
  die "на сервере нет $REMOTE_REVOKED — сервер ещё не готовили через registerUser"
ALREADY="$("${SSH[@]}" "sudo cat $REMOTE_REVOKED")"

ADDED=0
for cert in "${CERTS[@]}"; do
  cn="$(openssl x509 -in "$cert" -noout -subject | sed -E 's/.*CN ?= ?//; s/[,/].*//')"
  [ "$cn" = "$NAME" ] || die "$cert выпущен на «$cn», а не на $NAME"
  fp="$(fingerprint "$cert")"
  if printf '%s\n' "$ALREADY" | grep -q "^$fp"; then
    echo "уже отозван: $(basename "$cert")"
    continue
  fi
  echo "$fp $NAME $(date +%F) $(basename "$cert")" | "${SSH[@]}" "sudo tee -a $REMOTE_REVOKED >/dev/null"
  echo "отозван: $(basename "$cert")"
  ADDED=$((ADDED + 1))
done

if [ "$ADDED" -gt 0 ]; then
  remote_reload
  echo "Сервер перечитал список."
fi
