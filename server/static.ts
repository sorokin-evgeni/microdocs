import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Раздача собранного клиента. Любой неизвестный путь отдаёт index.html —
 * приложение одностраничное.
 */
export function createStaticHandler(rootDir: string) {
  const root = resolve(rootDir);

  return async function serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const file = (await resolveFile(root, pathname)) ?? join(root, 'index.html');

    try {
      const info = await stat(file);
      if (!info.isFile()) return false;

      res.statusCode = 200;
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      // Файлы сборки именованы с хешем, index.html — нет.
      res.setHeader(
        'Cache-Control',
        file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      );

      if (req.method === 'HEAD') {
        res.end();
        return true;
      }
      createReadStream(file).pipe(res);
      return true;
    } catch {
      return false;
    }
  };
}

/** Возвращает путь к файлу внутри корня либо null, если его там нет. */
async function resolveFile(root: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const candidate = resolve(root, `.${decoded}`);
  // Выход за пределы корня недопустим, как бы путь ни был закодирован.
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;

  try {
    return (await stat(candidate)).isFile() ? candidate : null;
  } catch {
    return null;
  }
}
