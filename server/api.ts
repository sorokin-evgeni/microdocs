import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  deleteObject,
  getObject,
  pageKey,
  putObject,
  treeKey,
} from './s3';

/**
 * Обработчик API поверх S3. Намеренно не зависит от Vite: в разработке его
 * подключает dev-сервер, позже тем же модулем поднимется обычный сервер.
 *
 * Маршруты:
 *   GET|PUT    /api/:baseId/tree
 *   GET|PUT|DELETE /api/:baseId/pages/:id
 */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return false;

  const baseId = parts[1];
  if (!baseId || !isSafeSegment(baseId)) {
    send(res, 400, { error: 'Недопустимый идентификатор базы' });
    return true;
  }

  try {
    if (parts[2] === 'tree' && parts.length === 3) {
      await handleTree(req, res, baseId);
      return true;
    }

    if (parts[2] === 'pages' && parts.length === 4) {
      const id = parts[3];
      if (!id || !isSafeSegment(id)) {
        send(res, 400, { error: 'Недопустимый идентификатор страницы' });
        return true;
      }
      await handlePage(req, res, baseId, id);
      return true;
    }

    send(res, 404, { error: 'Нет такого маршрута' });
  } catch (error) {
    send(res, 502, { error: String((error as Error)?.message ?? error) });
  }
  return true;
}

async function handleTree(
  req: IncomingMessage,
  res: ServerResponse,
  baseId: string,
) {
  const key = treeKey(baseId);

  if (req.method === 'GET') {
    const text = await getObject(key);
    if (text === null) {
      send(res, 404, { error: 'Дерево ещё не создано' });
      return;
    }
    sendRaw(res, 200, text, 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'PUT') {
    const body = await readBody(req);
    await putObject(key, body, 'application/json; charset=utf-8');
    send(res, 200, { ok: true });
    return;
  }

  send(res, 405, { error: 'Метод не поддерживается' });
}

async function handlePage(
  req: IncomingMessage,
  res: ServerResponse,
  baseId: string,
  id: string,
) {
  const key = pageKey(baseId, id);

  if (req.method === 'GET') {
    const text = await getObject(key);
    if (text === null) {
      send(res, 404, { error: 'Страницы нет' });
      return;
    }
    sendRaw(res, 200, text, 'text/markdown; charset=utf-8');
    return;
  }

  if (req.method === 'PUT') {
    const body = await readBody(req);
    await putObject(key, body, 'text/markdown; charset=utf-8');
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'DELETE') {
    await deleteObject(key);
    send(res, 200, { ok: true });
    return;
  }

  send(res, 405, { error: 'Метод не поддерживается' });
}

/** Идентификаторы уезжают в ключ объекта — не пускаем ни слэш, ни `..`. */
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
