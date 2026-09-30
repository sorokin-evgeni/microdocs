#!/usr/bin/env bash
# Сборка microdocs.app и DMG для Mac на Apple Silicon.
#
#   scripts/build-mac.sh
#
# Результат: dist-native/mac/microdocs-<версия>-arm64.dmg
#
# Нужны macOS и Node 22. Подписи Apple нет — приложение подписывается ad-hoc:
# собранное на этом маке открывается сразу, скачанное из интернета — после
#   xattr -dr com.apple.quarantine /Applications/microdocs.app
#
# Переменные: MICRODOCS_VERSION (по умолчанию из desktop/package.json),
# MICRODOCS_URL (адрес сервера, по умолчанию microdocsUrl оттуда же).
set -euo pipefail
cd "$(dirname "$0")/../desktop"

if [[ "$(uname)" != Darwin ]]; then
  echo "DMG собирается только на macOS." >&2
  exit 1
fi

VERSION="${MICRODOCS_VERSION:-$(node -p "require('./package.json').version")}"
ARGS=(--mac dmg --arm64 --publish never -c.extraMetadata.version="$VERSION")
[[ -n "${MICRODOCS_URL:-}" ]] && ARGS+=(-c.extraMetadata.microdocsUrl="$MICRODOCS_URL")

echo "== зависимости =="
npm ci

echo "== сборка $VERSION =="
# Не искать сертификаты разработчика в связке: подпись ad-hoc (identity "-" в package.json).
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder "${ARGS[@]}"

echo "Готово: $(ls ../dist-native/mac/*.dmg)"
