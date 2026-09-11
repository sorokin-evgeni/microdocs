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
) {
  const handle = createApi(storage);
  const { res, captured } = makeResponse();
  const handled = await handle(makeRequest(method, url, body), res);
  return { handled, ...captured };
}

const дерево: Tree = { roots: [{ id: 'p1', title: 'Первая', children: [] }] };

describe('HTTP API', () => {
  it('чужие маршруты не трогает', async () => {
    const result = await call(memoryStorage(), 'GET', '/assets/main.js');
    expect(result.handled).toBe(false);
  });

  describe('дерево', () => {
    it('пока не создано — 404', async () => {
      const result = await call(memoryStorage(), 'GET', '/api/default/tree');
      expect(result.status).toBe(404);
    });

    it('записывается и читается обратно', async () => {
      const storage = memoryStorage();
      const put = await call(
        storage,
        'PUT',
        '/api/default/tree',
        JSON.stringify(дерево),
      );
      expect(put.status).toBe(200);

      const get = await call(storage, 'GET', '/api/default/tree');
      expect(get.status).toBe(200);
      expect(JSON.parse(get.body)).toEqual(дерево);
    });

    it('неразбираемое тело — 400', async () => {
      const result = await call(
        memoryStorage(),
        'PUT',
        '/api/default/tree',
        'не json',
      );
      expect(result.status).toBe(400);
    });

    it('тело без roots — 400', async () => {
      const result = await call(
        memoryStorage(),
        'PUT',
        '/api/default/tree',
        '{"что-то":1}',
      );
      expect(result.status).toBe(400);
    });
  });

  describe('страницы', () => {
    it('записывается, читается и удаляется', async () => {
      const storage = memoryStorage();

      expect((await call(storage, 'GET', '/api/default/pages/p1')).status).toBe(
        404,
      );

      const put = await call(
        storage,
        'PUT',
        '/api/default/pages/p1',
        '## Текст',
      );
      expect(put.status).toBe(200);

      const get = await call(storage, 'GET', '/api/default/pages/p1');
      expect(get.body).toBe('## Текст');
      expect(get.contentType).toContain('text/markdown');

      expect(
        (await call(storage, 'DELETE', '/api/default/pages/p1')).status,
      ).toBe(200);
      expect((await call(storage, 'GET', '/api/default/pages/p1')).status).toBe(
        404,
      );
    });

    it('базы изолированы друг от друга (NFR-26)', async () => {
      const storage = memoryStorage();
      await call(storage, 'PUT', '/api/base-a/pages/p1', 'из первой');
      await call(storage, 'PUT', '/api/base-b/pages/p1', 'из второй');

      expect((await call(storage, 'GET', '/api/base-a/pages/p1')).body).toBe(
        'из первой',
      );
      expect((await call(storage, 'GET', '/api/base-b/pages/p1')).body).toBe(
        'из второй',
      );
    });
  });

  describe('проверка входа', () => {
    it('обход пути отвергается', async () => {
      const storage = memoryStorage();
      const result = await call(storage, 'GET', '/api/default/pages/..%2Fsecret');
      expect(result.status).toBe(400);
      expect(storage.dump()).toEqual({ trees: [], pages: [] });
    });

    it('неизвестный маршрут — 404', async () => {
      expect((await call(memoryStorage(), 'GET', '/api/default/нет')).status).toBe(
        404,
      );
    });

    it('неподдерживаемый метод — 405', async () => {
      expect((await call(memoryStorage(), 'PATCH', '/api/default/tree')).status).toBe(
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
      const result = await call(broken, 'GET', '/api/default/tree');
      expect(result.status).toBe(502);
    });
  });
});
