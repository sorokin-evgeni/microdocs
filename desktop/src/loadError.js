// @ts-check
/**
 * Почему не открылась страница — по коду сетевой ошибки Chromium
 * (net/base/net_error_list.h). Если service worker уже закешировал интерфейс,
 * сюда без сети не попадаем: ошибка значит, что открыть нечего.
 *
 * @typedef {'offline' | 'cert' | 'keychain' | 'other'} LoadErrorKind
 */

const OFFLINE = new Set([
  -21, // NETWORK_CHANGED
  -100, // CONNECTION_CLOSED
  -101, // CONNECTION_RESET
  -102, // CONNECTION_REFUSED
  -105, // NAME_NOT_RESOLVED
  -106, // INTERNET_DISCONNECTED
  -109, // ADDRESS_UNREACHABLE
  -118, // CONNECTION_TIMED_OUT
  -130, // PROXY_CONNECTION_FAILED
  -137, // NAME_RESOLUTION_FAILED
]);

const CERT = new Set([
  -110, // SSL_CLIENT_AUTH_CERT_NEEDED
  -117, // BAD_SSL_CLIENT_AUTH_CERT — сервер отверг сертификат или его нет
  -135, // SSL_CLIENT_AUTH_CERT_NO_PRIVATE_KEY
  -141, // SSL_CLIENT_AUTH_SIGNATURE_FAILED
  -151, // SSL_CLIENT_AUTH_CERT_BAD_FORMAT
  -177, // SSL_CLIENT_AUTH_NO_COMMON_ALGORITHMS
]);

/** Связка ключей не дала подписать: в окне macOS нажали «Запретить». */
const KEYCHAIN = -136; // SSL_CLIENT_AUTH_PRIVATE_KEY_ACCESS_DENIED

/**
 * @param {number} code
 * @returns {LoadErrorKind}
 */
export function classifyLoadError(code) {
  if (code === KEYCHAIN) return 'keychain';
  if (CERT.has(code)) return 'cert';
  if (OFFLINE.has(code)) return 'offline';
  return 'other';
}
