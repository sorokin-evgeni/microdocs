# Выкатка microdocs

Инфраструктура — MWS Cloud, проект `microdocs` (орг `ip-sorokin`).
CLI-профиль: `mws ... --profile microdocs`.

## Что создано

| Ресурс | Идентификатор | Примечание |
|---|---|---|
| Сеть | `vpc/projects/microdocs/networks/main` | с выходом в интернет |
| Подсеть | `.../networks/main/subnets/main` | `10.10.0.0/24` |
| Внешний адрес | `vpc/projects/microdocs/externalAddresses/notes` | **2.59.80.193** |
| Образ | `compute/projects/microdocs/images/ubuntu-2404` | Ubuntu 24.04 LTS |
| ВМ | `compute/projects/microdocs/virtualMachines/notes` | `base-2-4`, зона `ru-central1-a` |
| Бакет данных | `microdocs-data` | версионирование включено, публичного доступа нет |

Домен: **notes.e40in.ru**, A-запись на `2.59.80.193`. Зона `e40in.ru` живёт
в Яндекс Облаке, запись добавляется там.

## Грабли MWS, на которые уже наступили

- **Образов в проекте нет,** а импорт по URL работает только с хостов из белого
  списка: `cloud-images.ubuntu.com` отклоняется, `storage.mwsapis.ru` проходит.
  Поэтому образ Ubuntu был скачан, залит во временный бакет `microdocs-images`
  с анонимным чтением, импортирован и бакет удалён.
- `--zone` принимает короткое имя (`ru-central1-a`), а не полный путь ресурса.
- `mws vpc external-address create <name>` без дополнительных полей отправляет
  пустое тело и падает с 415 — помогает любой флаг, например `--display-name`.
- Привязка ролей к сервисным аккаунтам в CLI отсутствует, делается в консоли.

## Настройка машины

Первичная настройка приезжает через cloud-init (`deploy/cloud-init.yaml`):
пользователь `microdocs`, ключ SSH, Node 22, каталоги, файрвол (22, 80, 443).

Вручную после первого запуска нужно положить два файла:

```
/etc/microdocs/s3-credentials   профиль microdocs с ключом к бакету
/etc/microdocs/client-ca.pem    сертификат центра, которым подписаны клиенты
```

Оба — с правами `0640` и владельцем `microdocs`.

Серверный сертификат выпускается Let's Encrypt по HTTP-01, поэтому порт 80
должен быть открыт:

```bash
sudo certbot certonly --standalone -d notes.e40in.ru
```

Продление не требует перезапуска: `systemctl reload microdocs` шлёт `SIGHUP`,
по которому сервер перечитывает сертификаты.

## Клиентские сертификаты

Доступ закрыт взаимным TLS: без сертификата, подписанного нашим центром,
соединение обрывается на рукопожатии. **CN сертификата — это имя владельца
и одновременно имя его базы в хранилище.**

Набор для локальной проверки выпускает `npm run certs:dev`. Для боевого доступа
тем же способом выпускается свой центр; `ca.key` хранить вне репозитория и вне
машины, на ней нужен только `ca.pem`.

## Выкатка

```bash
HOST=microdocs@notes.e40in.ru ./deploy/deploy.sh
```

Скрипт собирает клиент и сервер, копирует `dist/` и `dist-server/`, ставит
production-зависимости и перезапускает юнит.

## Юнит systemd

`deploy/microdocs.service` — порт 443 без root через `CAP_NET_BIND_SERVICE`,
переменные из `/etc/microdocs/env`, автоперезапуск.
