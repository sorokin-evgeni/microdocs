#!/usr/bin/env bash
# Выдать доступ человеку одной командой:
#
#   npm run registerUser -- anna            новый человек со своей базой
#   npm run registerUser -- anna --device   ещё один сертификат тому же человеку
#                                           (или себе — перевести на новый центр)
#
# Что делает:
#   1. Центр для клиентских сертификатов в .secrets/users-ca/ — создаёт при
#      первом запуске, дальше берёт готовый. Ключ центра — только здесь.
#   2. Сертификат с CN=<имя> и файл .p12 с паролем для iPhone, iPad, Android
#      и Mac в .secrets/clients/<имя>/.
#   3. Сервер: добавляет центр в /etc/microdocs/client-ca.pem рядом с прежним
#      (старые сертификаты продолжают работать), включает список отзыва,
#      перечитывает сертификаты без перезапуска.
#   4. Проверяет вход новым сертификатом. Новому человеку база должна быть
#      пустой: если под этим именем уже что-то лежит, сертификат сразу
#      отзывается — чужую базу так не открыть.
#
# Переменные: HOST, SSH_KEY, URL, SECRETS — как в deploy/deploy.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/users-common.sh

NAME="${1:-}"
DEVICE=false
[ "${2:-}" = "--device" ] && DEVICE=true
[ -n "$NAME" ] || die "укажите имя: npm run registerUser -- <имя> [--device]"

# Имя — это и CN, и папка базы в хранилище. Принимаем только то, что сервер
# не переиначит: иначе «Anna» и «anna» оказались бы одной базой.
[ "$(safe_name "$NAME")" = "$NAME" ] ||
  die "имя «$NAME» сервер прочитает как «$(safe_name "$NAME")» — возьмите латиницу в нижнем регистре, цифры и дефис"

USER_DIR="$CLIENTS_DIR/$NAME"
if [ -d "$USER_DIR" ] && ! $DEVICE; then
  die "$NAME уже зарегистрирован ($USER_DIR). Ещё одно устройство: npm run registerUser -- $NAME --device"
fi

# PKCS#12 со старыми алгоритмами: новый по умолчанию OpenSSL 3 не открывают
# ни iOS, ни связка ключей macOS. У LibreSSL (openssl на маке) флага -legacy нет,
# старые алгоритмы там и так по умолчанию.
P12_LEGACY=""
openssl version | grep -q '^OpenSSL 3' && P12_LEGACY="-legacy" 

echo "== центр сертификатов =="
mkdir -p "$CA_DIR"
chmod 700 "$SECRETS" "$CA_DIR"
if [ ! -f "$CA_DIR/ca.key" ]; then
  # Расширения — через конфиг, а не -addext: его нет в старом LibreSSL на маке.
  openssl req -x509 -newkey rsa:4096 -nodes -days 7300 \
    -keyout "$CA_DIR/ca.key" -out "$CA_DIR/ca.pem" \
    -subj "/CN=microdocs users CA" -extensions ca \
    -config <(printf '%s\n' '[req]' 'distinguished_name=dn' '[dn]' '[ca]' \
      'basicConstraints=critical,CA:TRUE' 'keyUsage=critical,keyCertSign,cRLSign' \
      'subjectKeyIdentifier=hash') 2>/dev/null
  chmod 600 "$CA_DIR/ca.key"
  echo "создан $CA_DIR/ca.pem (на 20 лет); ключ ca.key не терять и никому не отдавать"
else
  echo "есть: $CA_DIR/ca.pem"
fi

echo "== сертификат $NAME =="
mkdir -p "$USER_DIR"
chmod 700 "$CLIENTS_DIR" "$USER_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
BASE="$USER_DIR/$NAME-$STAMP"
PASSWORD="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)"

openssl req -newkey rsa:2048 -nodes -keyout "$BASE.key" -out "$BASE.csr" -subj "/CN=$NAME" 2>/dev/null
openssl x509 -req -in "$BASE.csr" -CA "$CA_DIR/ca.pem" -CAkey "$CA_DIR/ca.key" \
  -set_serial "0x$(openssl rand -hex 16)" -days 1825 -out "$BASE.pem" \
  -extfile <(printf '%s\n' \
    'basicConstraints=critical,CA:FALSE' \
    'keyUsage=critical,digitalSignature,keyEncipherment' \
    'extendedKeyUsage=clientAuth') 2>/dev/null
# shellcheck disable=SC2086 # пустой — без аргумента
openssl pkcs12 -export $P12_LEGACY -out "$BASE.p12" -inkey "$BASE.key" -in "$BASE.pem" \
  -certfile "$CA_DIR/ca.pem" -name "microdocs $NAME" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -passout "pass:$PASSWORD"
printf '%s\n' "$PASSWORD" > "$BASE.password.txt"
rm -f "$BASE.csr"
chmod 600 "$BASE".*
echo "выпущен на 5 лет, отпечаток $(fingerprint "$BASE.pem")"

echo "== сервер $HOST =="
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Центр — в связку рядом с прежними, если его там ещё нет.
"${SSH[@]}" "sudo cat $REMOTE_CA" > "$TMP/bundle.pem"
grep -q 'BEGIN CERTIFICATE' "$TMP/bundle.pem" || die "на сервере пустой $REMOTE_CA — не трогаю"
if grep -qF "$(sed -n 2p "$CA_DIR/ca.pem")" "$TMP/bundle.pem"; then
  echo "центр уже в $REMOTE_CA"
else
  { cat "$TMP/bundle.pem"; echo; cat "$CA_DIR/ca.pem"; } | grep -v '^$' > "$TMP/new.pem"
  remote_write "$REMOTE_CA" < "$TMP/new.pem"
  echo "центр добавлен в $REMOTE_CA"
fi

# Список отзыва: файл и строка в env. Новая переменная окружения подхватывается
# только перезапуском, дальше хватает reload.
RESTART=false
if ! "${SSH[@]}" "sudo grep -q '^MICRODOCS_REVOKED=' $REMOTE_ENV"; then
  "${SSH[@]}" "echo 'MICRODOCS_REVOKED=$REMOTE_REVOKED' | sudo tee -a $REMOTE_ENV >/dev/null"
  RESTART=true
fi
"${SSH[@]}" "sudo test -f $REMOTE_REVOKED" ||
  printf '# Отозванные клиентские сертификаты: отпечаток SHA-256, имя, дата. Пишет scripts/revokeUser.sh.\n' |
  remote_write "$REMOTE_REVOKED"

if $RESTART; then
  echo "включён список отзыва — перезапуск"
  "${SSH[@]}" 'sudo systemctl restart microdocs && sleep 2 && systemctl is-active microdocs'
else
  remote_reload
fi

echo "== проверка входа =="
STATUS="$(curl -s -o "$TMP/tree.json" -w '%{http_code}' --cert "$BASE.pem" --key "$BASE.key" "$URL/api/tree" || true)"
case "$STATUS" in
  404)
    $DEVICE && echo "вход есть, база $NAME пока пустая" || echo "вход есть, база $NAME пустая — создастся при первом открытии"
    ;;
  200)
    if $DEVICE; then
      echo "вход есть, открывается база $NAME"
    else
      # Под этим именем уже есть база — чужая. Сертификат к ней не пускаем.
      echo "$(fingerprint "$BASE.pem") $NAME $(date +%F) имя-занято" |
        "${SSH[@]}" "sudo tee -a $REMOTE_REVOKED >/dev/null"
      remote_reload
      AFTER="$(curl -s -o /dev/null -w '%{http_code}' --cert "$BASE.pem" --key "$BASE.key" "$URL/api/tree" || true)"
      [ "$AFTER" = "403" ] ||
        die "под именем «$NAME» уже есть база, а отзыв не сработал (ответ $AFTER) — на сервере старая версия? Выкатите deploy.sh и повторите revokeUser для $BASE.pem; файл никому не отдавайте"
      die "под именем «$NAME» на сервере уже есть база. Выпущенный сертификат отозван; возьмите другое имя (папку $USER_DIR можно удалить)"
    fi
    ;;
  000)
    die "сервер не ответил на сертификат — рукопожатие не прошло. Проверьте $REMOTE_CA и journalctl -u microdocs"
    ;;
  *)
    die "неожиданный ответ $STATUS: $(head -c 300 "$TMP/tree.json")"
    ;;
esac

echo
echo "Готово."
echo "  файл:   $BASE.p12"
echo "  пароль: $PASSWORD   (лежит рядом, в $(basename "$BASE").password.txt)"
echo
echo "Файл и пароль передайте разными каналами. Дальше на iPhone и iPad:"
echo "  1. открыть .p12 (AirDrop или «Файлы») → «Профиль загружен»;"
echo "  2. Настройки → Основные → VPN и управление устройством → профиль → Установить, ввести пароль;"
echo "  3. Safari → $URL, выбрать сертификат;"
echo "  4. «Поделиться» → «На экран Домой»."
echo "Android и Mac — docs/APPS.md."
