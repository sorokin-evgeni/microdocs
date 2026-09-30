import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PageId, Tree } from '../shared/types';
import type { Asset, BaseStorage } from './storage/port';
import { createApi } from './api';

/** Хранилище в памяти: доказывает, что API не привязан к S3. */
function memoryStorage(): BaseStorage & {
  dump: () => unknown;
  putAsset: (baseId: string, path: string, body: string, contentType?: string) => void;
  askedAssets: string[];
} {
  const trees = new Map<string, Tree>();
  const pages = new Map<string, string>();
  const assets = new Map<string, Asset>();
  const askedAssets: string[] = [];
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
    async readAsset(baseId, path) {
      askedAssets.push(`${baseId}/${path}`);
      return assets.get(`${baseId}/${path}`) ?? null;
    },
    putAsset(baseId, path, body, contentType) {
      assets.set(`${baseId}/${path}`, { body: Buffer.from(body, 'utf8'), contentType: contentType ?? null });
    },
    askedAssets,
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
  const captured = { status: 0, contentType: '', body: '', headers: {} as Record<string, string> };
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      if (name.toLowerCase() === 'content-type') captured.contentType = value;
    },
    end(body?: string | Uint8Array) {
      captured.body = typeof body === 'string' ? body : body ? Buffer.from(body).toString('utf8') : '';
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

  describe('вложения', () => {
    it('картинка отдаётся с типом и открывается в браузере', async () => {
      const storage = memoryStorage();
      storage.putAsset('владелец', 'buildin/5f54/image.png', 'PNG-байты');

      const get = await call(storage, 'GET', '/api/assets/buildin/5f54/image.png');
      expect(get.status).toBe(200);
      expect(get.body).toBe('PNG-байты');
      expect(get.contentType).toBe('image/png');
      expect(get.headers['content-disposition']).toMatch(/^inline;/);
      expect(get.headers['x-content-type-options']).toBe('nosniff');
      expect(get.headers['cache-control']).toContain('private');
    });

    it('кириллица, пробелы и плюсы в имени раскодируются в ключ', async () => {
      const storage = memoryStorage();
      storage.putAsset('владелец', 'Root_1/Отчёт за год+1.pdf', 'PDF');

      const get = await call(
        storage,
        'GET',
        `/api/assets/Root_1/${encodeURIComponent('Отчёт за год+1.pdf')}`,
      );
      expect(get.status).toBe(200);
      expect(get.contentType).toBe('application/pdf');
      expect(get.headers['content-disposition']).toContain(
        `filename*=UTF-8''${encodeURIComponent('Отчёт за год+1.pdf')}`,
      );
    });

    it('HTML и SVG не открываются на нашем адресе, а скачиваются', async () => {
      const storage = memoryStorage();
      storage.putAsset('владелец', 'a/page.html', '<script>alert(1)</script>', 'text/html');
      storage.putAsset('владелец', 'a/pic.svg', '<svg/>');

      for (const name of ['page.html', 'pic.svg']) {
        const get = await call(storage, 'GET', `/api/assets/a/${name}`);
        expect(get.status).toBe(200);
        expect(get.headers['content-disposition']).toMatch(/^attachment;/);
      }
    });

    it('неизвестное расширение — тип, с которым файл записали', async () => {
      const storage = memoryStorage();
      storage.putAsset('владелец', 'a/data.bin', 'x', 'application/x-custom');
      const get = await call(storage, 'GET', '/api/assets/a/data.bin');
      expect(get.contentType).toBe('application/x-custom');
    });

    it('HEAD отдаёт заголовки без тела', async () => {
      const storage = memoryStorage();
      storage.putAsset('владелец', 'a/image.png', 'PNG');
      const head = await call(storage, 'HEAD', '/api/assets/a/image.png');
      expect(head.status).toBe(200);
      expect(head.headers['content-length']).toBe('3');
      expect(head.body).toBe('');
    });

    it('нет такого — 404', async () => {
      expect((await call(memoryStorage(), 'GET', '/api/assets/a/нет.png')).status).toBe(404);
    });

    it('записывать через API нельзя — 405', async () => {
      expect((await call(memoryStorage(), 'PUT', '/api/assets/a/x.png', 'x')).status).toBe(405);
    });

    it('обход пути и мусор в адресе отвергаются, до хранилища не доходя', async () => {
      const storage = memoryStorage();
      for (const url of [
        '/api/assets/a%2F..%2F..%2Fдругой%2Ftree.json',
        '/api/assets/%2E%2E%2Fpages%2Fp1.md',
        '/api/assets/a/..%5Csecret',
        '/api/assets/a/%00.png',
        '/api/assets/a/%E0%A4%A.png',
      ]) {
        expect((await call(storage, 'GET', url)).status, url).toBe(400);
      }
      expect(storage.askedAssets).toEqual([]);
    });

    it('чужие вложения не видны', async () => {
      const storage = memoryStorage();
      storage.putAsset('первый', 'a/image.png', 'моё');
      expect((await call(storage, 'GET', '/api/assets/a/image.png', '', 'второй')).status).toBe(404);
      expect(storage.askedAssets).toEqual(['второй/a/image.png']);
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
