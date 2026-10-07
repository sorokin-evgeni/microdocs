import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import type { TLSSocket } from 'node:tls';
import { createApi } from './api';
import { createStorage } from './storage';
import { createStaticHandler } from './static';
import { loadRevoked, normalizeFingerprint } from './revocation';

/**
 * Боевой сервер. Делает три вещи и больше ничего:
 *   1. терминирует TLS;
 *   2. пускает только тех, чей клиентский сертификат подписан нашим центром
 *      и не отозван;
 *   3. раздаёт собранного клиента и обслуживает API.
 *
 * Nginx спереди не нужен, но при желании ставится без переделок.
 */
const PORT = Number(process.env.PORT ?? 8443);
const STATIC_DIR = process.env.MICRODOCS_STATIC ?? 'dist';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

function secureContext() {
  return {
    key: readFileSync(required('MICRODOCS_TLS_KEY')),
    cert: readFileSync(required('MICRODOCS_TLS_CERT')),
    // Центр, которым подписаны клиентские сертификаты.
    ca: readFileSync(required('MICRODOCS_CLIENT_CA')),
  };
}

// Запись — только с версией, от которой правили (If-Match): без неё
// правка с одного устройства молча затёрла бы правку с другого.
// Отозванные сертификаты (scripts/revokeUser.sh). Перечитываются по SIGHUP.
const REVOKED_FILE = process.env.MICRODOCS_REVOKED;
let revoked = loadRevoked(REVOKED_FILE);

function isRevoked(socket: TLSSocket): boolean {
  if (revoked.size === 0) return false;
  const fingerprint = normalizeFingerprint(socket.getPeerCertificate()?.fingerprint256 ?? '');
  return fingerprint !== null && revoked.has(fingerprint);
}

const handleApi = createApi(createStorage(), undefined, { requirePrecondition: true });
const serveStatic = createStaticHandler(STATIC_DIR);

const server = createServer(
  {
    ...secureContext(),
    requestCert: true,
    // Без валидного клиентского сертификата соединение не состоится.
    rejectUnauthorized: true,
  },
  (req, res) => {
    void (async () => {
      try {
        // Рукопожатие отозванный сертификат проходит — центр его подписал, —
        // поэтому отказ здесь, до любой статики и API.
        if (isRevoked(req.socket as TLSSocket)) {
          res.statusCode = 403;
          res.end('Сертификат отозван');
          return;
        }
        if (await handleApi(req, res)) return;
        if (await serveStatic(req, res)) return;
        res.statusCode = 404;
        res.end('Не найдено');
      } catch (error) {
        res.statusCode = 500;
        res.end('Внутренняя ошибка');
        console.error('Необработанная ошибка запроса:', error);
      }
    })();
  },
);

// Продление серверного сертификата, новый центр клиентов или отзыв:
// перечитать файлы без перезапуска.
process.on('SIGHUP', () => {
  try {
    server.setSecureContext(secureContext());
    revoked = loadRevoked(REVOKED_FILE);
    console.log(`Сертификаты перечитаны, отозванных: ${revoked.size}`);
  } catch (error) {
    console.error('Не удалось перечитать сертификаты:', error);
  }
});

server.listen(PORT, () => {
  console.log(`microdocs слушает https://0.0.0.0:${PORT}`);
  console.log(`статика из ${STATIC_DIR}`);
});
