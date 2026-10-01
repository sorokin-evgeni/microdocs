#!/usr/bin/env bash
# Создаёт ключ подписи APK — один раз на всю жизнь приложения.
#
#   scripts/android-keystore.sh
#
# Ключ ложится в .secrets/android/ (вне гита). Если стоит gh и есть вход в GitHub,
# скрипт сам кладёт его в секреты репозитория для сборки релизов; иначе печатает,
# что туда вставить.
#
# Потерять ключ — значит больше не выпустить обновление: только удалить приложение
# и поставить заново. Сохраните .secrets/android/ в надёжное место.
set -euo pipefail
cd "$(dirname "$0")/.."

# На маке /usr/bin/keytool — заглушка, без JDK она только ругается.
if ! keytool -help >/dev/null 2>&1; then
  echo "Нужен JDK (из него keytool). На маке: brew install --cask temurin" >&2
  exit 1
fi

DIR=.secrets/android
if [[ -f $DIR/release.p12 ]]; then
  echo "Ключ уже есть: $DIR/release.p12 — второй не нужен." >&2
  exit 1
fi
mkdir -p "$DIR"
chmod 700 "$DIR"

PASSWORD=$(openssl rand -hex 24)
keytool -genkeypair -keystore "$DIR/release.p12" -storetype PKCS12 \
  -storepass "$PASSWORD" -keypass "$PASSWORD" -alias microdocs \
  -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=microdocs"
printf '%s' "$PASSWORD" >"$DIR/password"
chmod 600 "$DIR/release.p12" "$DIR/password"
echo "Ключ создан: $DIR/release.p12"

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  base64 <"$DIR/release.p12" | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64
  gh secret set ANDROID_KEYSTORE_PASSWORD <"$DIR/password"
  echo "Секреты ANDROID_KEYSTORE_BASE64 и ANDROID_KEYSTORE_PASSWORD записаны в GitHub."
else
  echo
  echo "gh не найден или нет входа — добавьте секреты вручную:"
  echo "GitHub → Settings → Secrets and variables → Actions → New repository secret"
  echo "  ANDROID_KEYSTORE_BASE64   = вывод: base64 < $DIR/release.p12 | tr -d '\\n'"
  echo "  ANDROID_KEYSTORE_PASSWORD = содержимое $DIR/password"
fi
