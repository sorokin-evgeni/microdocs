import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Tree } from '../shared/types';
import type { BaseStorage } from './storage/port';
import { resolveBaseId } from './identity';

/**
 * HTTP-контракт. Не знает ни где лежат данные, ни кому они принадлежат:
 * хранилище приходит через порт, владелец — через resolveBaseId.
 *
 *   GET|PUT        /api/tree
 *   GET|PUT|DELETE /api/pages/:id
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
