import type { IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';

/**
 * Кто пришёл. В production личность берётся из клиентского сертификата:
 * до обработчика доходят только те, чей сертификат подписан нашим центром,
 * поэтому CN можно доверять как имени владельца.
 *
 * Клиент своей базы не выбирает и в запросе её не называет — иначе он мог бы
 * попросить чужую (FR-39).
 */
export function resolveBaseId(req: IncomingMessage): string | null {
  const socket = req.socket as Partial<TLSSocket>;

  if (typeof socket.getPeerCertificate !== 'function') {
    // Разработка без TLS: одна база, имя задаётся переменной.
    return process.env.MICRODOCS_DEV_BASE ?? 'default';
  }

  // CN в сертификате может оказаться массивом — берём первый.
  const cn = socket.getPeerCertificate()?.subject?.CN;
  const name = Array.isArray(cn) ? cn[0] : cn;
  if (!name) return null;

  return toSafeSegment(name) || null;
}

/**
 * CN придумывает человек, а значение уезжает в адресацию хранилища.
 * Оставляем только буквы и цифры, всё прочее — в дефис: так не остаётся
 * ни точек, ни слэшей, а значит и краевых случаев вроде `..`.
 */
function toSafeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 100)
    .replace(/^-+|-+$/g, '');
}
