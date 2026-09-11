#!/usr/bin/env bash
# Сборка и выкатка на виртуальную машину.
#
#   HOST=microdocs@notes.e40in.ru ./deploy/deploy.sh
#
# Предполагается, что машина уже настроена: есть пользователь microdocs,
# каталог /opt/microdocs, юнит systemd и файлы в /etc/microdocs.
set -euo pipefail

HOST="${HOST:-microdocs@notes.e40in.ru}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/mws_vm}"
REMOTE=/opt/microdocs

SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new)
RSYNC_SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

echo "== сборка =="
npm run build

echo "== выкладка на $HOST =="
rsync -az --delete -e "$RSYNC_SSH" dist/ "$HOST:$REMOTE/dist/"
rsync -az --delete -e "$RSYNC_SSH" dist-server/ "$HOST:$REMOTE/dist-server/"
rsync -az -e "$RSYNC_SSH" package.json package-lock.json "$HOST:$REMOTE/"

echo "== зависимости и перезапуск =="
"${SSH[@]}" "$HOST" bash -se <<'REMOTE_SCRIPT'
set -euo pipefail
cd /opt/microdocs
npm ci --omit=dev
sudo systemctl restart microdocs
sleep 2
systemctl is-active microdocs
REMOTE_SCRIPT

echo "Готово."
