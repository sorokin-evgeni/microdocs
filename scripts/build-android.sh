#!/usr/bin/env bash
# Сборка microdocs.apk для Android.
#
#   scripts/build-android.sh              # подписать своим ключом из .secrets/android/
#   scripts/build-android.sh --debug-key  # без своего ключа, отладочным (только для проверки)
#
# Результат: dist-native/android/microdocs-<версия>.apk
#
# Нужны JDK 17+ и Android SDK. На маке их ставит Homebrew:
#   brew install --cask temurin android-commandlinetools
# Недостающие части SDK скрипт доставит сам.
#
# Переменные: MICRODOCS_VERSION (по умолчанию 0.1.0), MICRODOCS_URL (адрес сервера),
# MICRODOCS_KEYSTORE и MICRODOCS_KEYSTORE_PASSWORD (ключ не из .secrets/android/).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

DEBUG_KEY=0
for arg in "$@"; do
  case "$arg" in
    --debug-key) DEBUG_KEY=1 ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 2 ;;
  esac
done

# --- JDK ---
if [[ -z "${JAVA_HOME:-}" && "$(uname)" == Darwin ]]; then
  JAVA_HOME=$(/usr/libexec/java_home -v 17+ 2>/dev/null || true)
  export JAVA_HOME
fi
if ! "${JAVA_HOME:+$JAVA_HOME/bin/}java" -version >/dev/null 2>&1; then
  echo "Нет JDK 17+. На маке: brew install --cask temurin" >&2
  exit 1
fi

# --- Android SDK ---
if [[ -z "${ANDROID_HOME:-}" ]]; then
  for dir in "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk" \
    /opt/homebrew/share/android-commandlinetools "$HOME/Android/Sdk"; do
    if [[ -n "$dir" && -d "$dir" ]]; then ANDROID_HOME=$dir; break; fi
  done
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
  echo "Нет Android SDK. На маке: brew install --cask android-commandlinetools" >&2
  exit 1
fi
export ANDROID_HOME

SDKMANAGER=$(command -v sdkmanager || true)
for candidate in "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "$ANDROID_HOME/tools/bin/sdkmanager"; do
  [[ -z "$SDKMANAGER" && -x "$candidate" ]] && SDKMANAGER=$candidate
done
if [[ ! -d "$ANDROID_HOME/platforms/android-35" || ! -d "$ANDROID_HOME/build-tools/34.0.0" ]]; then
  [[ -n "$SDKMANAGER" ]] || { echo "Не нашёл sdkmanager в $ANDROID_HOME" >&2; exit 1; }
  echo "== доустанавливаю Android SDK =="
  yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
  "$SDKMANAGER" --sdk_root="$ANDROID_HOME" "platforms;android-35" "build-tools;34.0.0"
fi

# --- ключ подписи ---
if [[ -z "${MICRODOCS_KEYSTORE:-}" && -f .secrets/android/release.p12 ]]; then
  export MICRODOCS_KEYSTORE="$ROOT/.secrets/android/release.p12"
  MICRODOCS_KEYSTORE_PASSWORD=$(cat .secrets/android/password)
  export MICRODOCS_KEYSTORE_PASSWORD
fi
SUFFIX=""
if [[ -z "${MICRODOCS_KEYSTORE:-}" ]]; then
  if [[ $DEBUG_KEY == 1 ]]; then
    SUFFIX="-debugkey"
    echo "!! Подпись отладочным ключом: такой APK не встанет поверх подписанного своим."
  else
    echo "Нет ключа подписи. Создать: scripts/android-keystore.sh" >&2
    echo "Или собрать для проверки: scripts/build-android.sh --debug-key" >&2
    exit 1
  fi
fi

# --- сборка ---
VERSION="${MICRODOCS_VERSION:-0.1.0}"
# Номер сборки должен расти, иначе Android не даст обновиться: берём число коммитов.
BUILD_NUMBER=$(git rev-list --count HEAD)
GRADLE_ARGS=(-PversionName="$VERSION" -PversionCode="$BUILD_NUMBER")
[[ -n "${MICRODOCS_URL:-}" ]] && GRADLE_ARGS+=(-PappUrl="$MICRODOCS_URL")

echo "== сборка $VERSION ($BUILD_NUMBER) =="
(cd android && ./gradlew --no-daemon assembleRelease "${GRADLE_ARGS[@]}")

mkdir -p dist-native/android
OUT="dist-native/android/microdocs-$VERSION$SUFFIX.apk"
cp android/build/outputs/apk/release/*-release.apk "$OUT"
echo "Готово: $OUT"
