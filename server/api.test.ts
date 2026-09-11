import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PageId, Tree } from '../shared/types';
import type { BaseStorage } from './storage/port';
import { createApi } from './api';

/** Хранилище в памяти: доказывает, что API не привязан к S3. */
function memoryStorage(): BaseStorage & { dump: () => unknown } {
  const trees = new Map<string, Tree>();
  const pages = new Map<string, string>();
  const key = (baseId: string, pageId: PageId) => `${baseId}/${pageId}`;

  return {
    async readTree(baseId) {
      return trees.get(baseId) ?? null;
    },
    async writeTree(baseId, tree) {
      trees.set(baseId, tree);
    },
    async readPage(baseId, pageId) {
      return pages.get(key(baseId, pageId)) ?? null;
    },
    async writePage(baseId, pageId, markdown) {
      pages.set(key(baseId, pageId), markdown);
    },
    async deletePage(baseId, pageId) {
      pages.delete(key(baseId, pageId));
    },
    dump: () => ({ trees: [...trees], pages: [...pages] }),
  };
}

function makeRequest(method: string, url: string, body = ''): IncomingMessage {
  const req = Readable.from([Buffer.from(body, 'utf8')]) as IncomingMessage;
  req.method = method;
  req.url = url;
  return req;
}

function makeResponse() {
  const captured = { status: 0, contentType: '', body: '' };
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      if (name.toLowerCase() === 'content-type') captured.contentType = value;
    },
    end(body: string) {
      captured.body = body ?? '';
      captured.status = (res as unknown as ServerResponse).statusCode;
    },
  };
  return { res: res as unknown as ServerResponse, captured };
}

async function call(
  storage: BaseStorage,
  method: string,
  url: string,
  body = '',
  owner: string | null = 'владелец',
) {
  const handle = createApi(storage, () => owner);
  const { res, captured } = makeResponse();
  const handled = await handle(makeRequest(method, url, body), res);
  return { handled, ...captured };
}

const дерево: Tree = { roots: [{ id: 'p1', title: 'Первая', children: [] }] };

describe('HTTP API', () => {
  it('чужие маршруты не трогает', async () => {
    expect((await call(memoryStorage(), 'GET', '/assets/main.js')).handled).toBe(
      false,
    );
  });

  it('без опознанного владельца — 401', async () => {
    const result = await call(
      memoryStorage(),
      'GET',
      '/api/tree',
      '',
      null,
    );
    expect(result.status).toBe(401);
  });

  describe('дерево', () => {
    it('пока не создано — 404', async () => {
      expect((await call(memoryStorage(), 'GET', '/api/tree')).status).toBe(404);
    });

    it('записывается и читается обратно', async () => {
      const storage = memoryStorage();
      const put = await call(
        storage,
        'PUT',
        '/api/tree',
        JSON.stringify(дерево),
      );
      expect(put.status).toBe(200);

      const get = await call(storage, 'GET', '/api/tree');
      expect(JSON.parse(get.body)).toEqual(дерево);
    });

    it('неразбираемое тело — 400', async () => {
      expect(
        (await call(memoryStorage(), 'PUT', '/api/tree', 'не json')).status,
      ).toBe(400);
    });

    it('тело без roots — 400', async () => {
      expect(
        (await call(memoryStorage(), 'PUT', '/api/tree', '{"что-то":1}')).status,
      ).toBe(400);
    });
  });

  describe('страницы', () => {
    it('записывается, читается и удаляется', async () => {
      const storage = memoryStorage();

      expect((await call(storage, 'GET', '/api/pages/p1')).status).toBe(404);

      expect(
        (await call(storage, 'PUT', '/api/pages/p1', '## Текст')).status,
      ).toBe(200);

      const get = await call(storage, 'GET', '/api/pages/p1');
      expect(get.body).toBe('## Текст');
      expect(get.contentType).toContain('text/markdown');

      expect((await call(storage, 'DELETE', '/api/pages/p1')).status).toBe(200);
      expect((await call(storage, 'GET', '/api/pages/p1')).status).toBe(404);
    });
  });

  describe('изоляция владельцев (FR-39)', () => {
    it('каждый видит только свою базу', async () => {
      const storage = memoryStorage();
      await call(storage, 'PUT', '/api/pages/p1', 'от первого', 'первый');
      await call(storage, 'PUT', '/api/pages/p1', 'от второго', 'второй');

      expect(
        (await call(storage, 'GET', '/api/pages/p1', '', 'первый')).body,
      ).toBe('от первого');
      expect(
        (await call(storage, 'GET', '/api/pages/p1', '', 'второй')).body,
      ).toBe('от второго');
    });

    it('чужую базу нельзя запросить через адрес', async () => {
      const storage = memoryStorage();
      await call(storage, 'PUT', '/api/pages/p1', 'моё', 'первый');

      // Попытка адресовать другую базу: лишний сегмент — просто нет маршрута.
      expect(
        (await call(storage, 'GET', '/api/первый/pages/p1', '', 'второй'))
          .status,
      ).toBe(404);
    });
  });

  describe('проверка входа', () => {
    it('обход пути отвергается', async () => {
      const storage = memoryStorage();
      const result = await call(storage, 'GET', '/api/pages/..%2Fsecret');
      expect(result.status).toBe(400);
      expect(storage.dump()).toEqual({ trees: [], pages: [] });
    });

    it('неизвестный маршрут — 404', async () => {
      expect((await call(memoryStorage(), 'GET', '/api/нет')).status).toBe(404);
    });

    it('неподдерживаемый метод — 405', async () => {
      expect((await call(memoryStorage(), 'PATCH', '/api/tree')).status).toBe(
        405,
      );
    });

    it('ошибка хранилища превращается в 502, а не в падение', async () => {
      const broken: BaseStorage = {
        ...memoryStorage(),
        readTree: async () => {
          throw new Error('хранилище недоступно');
        },
      };
      expect((await call(broken, 'GET', '/api/tree')).status).toBe(502);
    });
  });
});
