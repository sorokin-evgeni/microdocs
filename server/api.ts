import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, extname } from 'node:path';
import type { Tree } from '../shared/types';
import type { BaseStorage } from './storage/port';
import { resolveBaseId } from './identity';

/**
 * HTTP-контракт. Не знает ни где лежат данные, ни кому они принадлежат:
 * хранилище приходит через порт, владелец — через resolveBaseId.
 *
 *   GET|PUT        /api/tree
 *   GET|PUT|DELETE /api/pages/:id
 *   GET|HEAD       /api/assets/<путь>
 *
 * База в адресе не упоминается намеренно: её определяет сертификат клиента,
 * иначе можно было бы попросить чужую.
 *
 * Возвращает true, если запрос его; false — пусть обрабатывает кто-то другой.
 */
export function createApi(
  storage: BaseStorage,
  identify: (req: IncomingMessage) => string | null = resolveBaseId,
) {
  return async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api') return false;

    const baseId = identify(req);
    if (!baseId) {
      send(res, 401, { error: 'Не удалось определить владельца' });
      return true;
    }

    try {
      if (parts[1] === 'tree' && parts.length === 2) {
        await handleTree(req, res, storage, baseId);
        return true;
      }

      if (parts[1] === 'pages' && parts.length === 3) {
        const id = parts[2];
        if (!id || !isSafeSegment(id)) {
          send(res, 400, { error: 'Недопустимый идентификатор страницы' });
          return true;
        }
        await handlePage(req, res, storage, baseId, id);
        return true;
      }

      if (parts[1] === 'assets' && parts.length > 2) {
        const path = assetPath(parts.slice(2));
        if (!path) {
          send(res, 400, { error: 'Недопустимый путь вложения' });
          return true;
        }
        await handleAsset(req, res, storage, baseId, path);
        return true;
      }

      send(res, 404, { error: 'Нет такого маршрута' });
    } catch (error) {
      send(res, 502, { error: String((error as Error)?.message ?? error) });
    }
    return true;
  };
}

async function handleTree(
  req: IncomingMessage,
  res: ServerResponse,
  storage: BaseStorage,
  baseId: string,
) {
  if (req.method === 'GET') {
    const tree = await storage.readTree(baseId);
    if (tree === null) {
      send(res, 404, { error: 'Дерево ещё не создано' });
      return;
    }
    send(res, 200, tree);
    return;
  }

  if (req.method === 'PUT') {
    let tree: Tree;
    try {
      tree = JSON.parse(await readBody(req)) as Tree;
    } catch {
      send(res, 400, { error: 'Тело запроса не разобралось как JSON' });
      return;
    }
    if (!Array.isArray(tree?.roots)) {
      send(res, 400, { error: 'Ожидалось дерево с полем roots' });
      return;
    }
    await storage.writeTree(baseId, tree);
    send(res, 200, { ok: true });
    return;
  }

  send(res, 405, { error: 'Метод не поддерживается' });
}

async function handlePage(
  req: IncomingMessage,
  res: ServerResponse,
  storage: BaseStorage,
  baseId: string,
  id: string,
) {
  if (req.method === 'GET') {
    const markdown = await storage.readPage(baseId, id);
    if (markdown === null) {
      send(res, 404, { error: 'Страницы нет' });
      return;
    }
    sendRaw(res, 200, markdown, 'text/markdown; charset=utf-8');
    return;
  }

  if (req.method === 'PUT') {
    await storage.writePage(baseId, id, await readBody(req));
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'DELETE') {
    await storage.deletePage(baseId, id);
    send(res, 200, { ok: true });
    return;
  }

  send(res, 405, { error: 'Метод не поддерживается' });
}

const ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
};

/**
 * Открываются в браузере только картинки и PDF. Остальное — скачиванием:
 * HTML или SVG, открытые с нашего адреса, исполнили бы свои скрипты
 * с доступом к API. В <img> SVG при этом показывается — там скрипты не работают.
 */
const INLINE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico', '.pdf']);

async function handleAsset(
  req: IncomingMessage,
  res: ServerResponse,
  storage: BaseStorage,
  baseId: string,
  path: string,
) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { error: 'Метод не поддерживается' });
    return;
  }

  const asset = await storage.readAsset(baseId, path);
  if (!asset) {
    send(res, 404, { error: 'Вложения нет' });
    return;
  }

  const ext = extname(path).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', ASSET_TYPES[ext] ?? asset.contentType ?? 'application/octet-stream');
  res.setHeader('Content-Length', String(asset.body.byteLength));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Вложения личные: хранить копию может только браузер владельца.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader(
    'Content-Disposition',
    `${INLINE.has(ext) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeRfc5987(basename(path))}`,
  );
  res.end(req.method === 'HEAD' ? undefined : asset.body);
}

/**
 * Путь вложения из адреса. Каждая часть раскодируется отдельно, и после этого
 * в ней не должно оказаться ни слэша, ни `..`, ни управляющих символов:
 * путь уходит в ключ хранилища. Имена файлов бывают кириллическими, с пробелами
 * и плюсами — поэтому здесь не isSafeSegment.
 */
function assetPath(segments: string[]): string | null {
  const decoded: string[] = [];
  for (const raw of segments) {
    let part: string;
    try {
      part = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!part || part === '.' || part === '..' || part.length > 255) return null;
    if (/[/\\\u0000-\u001f\u007f]/.test(part)) return null;
    decoded.push(part);
  }
  return decoded.join('/');
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Идентификаторы попадают в адресацию хранилища — ни слэша, ни `..`. */
function isSafeSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,200}$/.test(value) && value !== '.' && value !== '..';
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown) {
  sendRaw(
    res,
    status,
    JSON.stringify(payload),
    'application/json; charset=utf-8',
  );
}

function sendRaw(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
) {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.end(body);
}
