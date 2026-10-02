import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, extname } from 'node:path';
import type { Tree } from '../shared/types';
import type { BaseStorage, DocRef } from './storage/port';
import { resolveBaseId } from './identity';
import {
  createLocks,
  etag,
  parseEtag,
  parsePrecondition,
  writeVersioned,
  type WriteResult,
} from './versioning';

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
 * Дерево и страницы версионируются (см. versioning.ts):
 *   - GET отдаёт `ETag: "<rev>"`; с `If-None-Match` того же значения — 304;
 *   - PUT с `If-Match: "<rev>"` пишет, только если версия не сменилась,
 *     иначе 412 с тем, что лежит сейчас, и его ETag;
 *   - PUT с `If-None-Match: *` пишет, только если документа ещё нет;
 *   - `X-Device-Id` — от какого устройства запись, для группировки правок.
 *
 * Возвращает true, если запрос его; false — пусть обрабатывает кто-то другой.
 */
export interface ApiOptions {
  /** Текущее время, мс. В тестах подменяется. */
  now?: () => number;
  /**
   * Отказывать в записи без `If-Match` / `If-None-Match` (428). Пока клиенты
   * на старой версии, запись без условия принимается и затирает как раньше.
   */
  requirePrecondition?: boolean;
}

export function createApi(
  storage: BaseStorage,
  identify: (req: IncomingMessage) => string | null = resolveBaseId,
  { now = Date.now, requirePrecondition = false }: ApiOptions = {},
) {
  const withLock = createLocks();
  const docs: Docs = { storage, withLock, now, requirePrecondition };

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
        await handleTree(req, res, docs, baseId);
        return true;
      }

      if (parts[1] === 'pages' && parts.length === 3) {
        const id = parts[2];
        if (!id || !isSafeSegment(id)) {
          send(res, 400, { error: 'Недопустимый идентификатор страницы' });
          return true;
        }
        await handlePage(req, res, docs, baseId, id);
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

interface Docs {
  storage: BaseStorage;
  withLock: ReturnType<typeof createLocks>;
  now: () => number;
  requirePrecondition: boolean;
}

const TREE: DocRef = { kind: 'tree' };
const JSON_TYPE = 'application/json; charset=utf-8';
const MARKDOWN_TYPE = 'text/markdown; charset=utf-8';

async function handleTree(
  req: IncomingMessage,
  res: ServerResponse,
  docs: Docs,
  baseId: string,
) {
  if (req.method === 'GET') {
    await getDoc(req, res, docs, baseId, TREE, JSON_TYPE, 'Дерево ещё не создано');
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
    await putDoc(req, res, docs, baseId, TREE, JSON.stringify(tree, null, 2), JSON_TYPE);
    return;
  }

  send(res, 405, { error: 'Метод не поддерживается' });
}

async function handlePage(
  req: IncomingMessage,
  res: ServerResponse,
  docs: Docs,
  baseId: string,
  id: string,
) {
  const ref: DocRef = { kind: 'page', id };

  if (req.method === 'GET') {
    await getDoc(req, res, docs, baseId, ref, MARKDOWN_TYPE, 'Страницы нет');
    return;
  }

  if (req.method === 'PUT') {
    await putDoc(req, res, docs, baseId, ref, await readBody(req), MARKDOWN_TYPE);
    return;
  }

  // Удаление безусловное: страницу убирают из дерева, а прежние версии хранит история.
  if (req.method === 'DELETE') {
    await docs.storage.deletePage(baseId, id);
    send(res, 200, { ok: true });
    return;
  }

  send(res, 405, { error: 'Метод не поддерживается' });
}

async function getDoc(
  req: IncomingMessage,
  res: ServerResponse,
  docs: Docs,
  baseId: string,
  ref: DocRef,
  contentType: string,
  missing: string,
) {
  const doc = await docs.storage.readDoc(baseId, ref);
  if (doc === null) {
    send(res, 404, { error: missing });
    return;
  }
  res.setHeader('ETag', etag(doc.meta.rev));
  // Копию держит только браузер владельца, и прежде чем ею пользоваться — сверяется.
  res.setHeader('Cache-Control', 'private, no-cache');

  const known = header(req, 'if-none-match');
  if (known !== undefined && parseEtag(known) === doc.meta.rev) {
    res.statusCode = 304;
    res.end();
    return;
  }
  sendRaw(res, 200, doc.body, contentType);
}

async function putDoc(
  req: IncomingMessage,
  res: ServerResponse,
  docs: Docs,
  baseId: string,
  ref: DocRef,
  body: string,
  contentType: string,
) {
  const precondition = parsePrecondition(header(req, 'if-match'), header(req, 'if-none-match'));
  if (precondition === null) {
    send(res, 400, { error: 'Не разобрался заголовок If-Match или If-None-Match' });
    return;
  }
  if (precondition.kind === 'none' && docs.requirePrecondition) {
    send(res, 428, { error: 'Нужен If-Match с версией, от которой правили' });
    return;
  }

  const key = `${baseId}/${ref.kind === 'tree' ? 'tree' : `pages/${ref.id}`}`;
  const result: WriteResult = await docs.withLock(key, () =>
    writeVersioned(docs.storage, baseId, ref, body, {
      precondition,
      device: deviceId(req),
      now: docs.now(),
    }),
  );

  if (result.ok) {
    res.setHeader('ETag', etag(result.rev));
    send(res, 200, { ok: true });
    return;
  }

  // Версия сменилась: отдаём то, что лежит сейчас, — клиенту не нужен лишний GET.
  if (result.current) {
    res.setHeader('ETag', etag(result.current.meta.rev));
    sendRaw(res, 412, result.current.body, contentType);
  } else {
    send(res, 412, { error: 'Документа нет' });
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Устройство, от которого запись. Только для группировки правок: личность
 * определяет сертификат, а не этот заголовок. Уходит в метаданные хранилища,
 * поэтому — только безопасные символы.
 */
function deviceId(req: IncomingMessage): string | null {
  const value = header(req, 'x-device-id');
  return value && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : null;
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
