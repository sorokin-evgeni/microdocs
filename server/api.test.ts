import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PageId, Tree } from '../shared/types';
import type { Asset, BaseStorage, DocRef, WriteMeta } from './storage/port';
import { createApi, type ApiOptions } from './api';
import { BURST_WINDOW } from './versioning';

interface MemoryVersion {
  versionId: string;
  body: string | null; // null — маркер удаления
  meta: WriteMeta;
}

/** Хранилище в памяти с историей версий, как у S3: доказывает, что API не привязан к S3. */
function memoryStorage(): BaseStorage & {
  dump: () => unknown;
  history: (baseId: string, ref: DocRef) => { body: string | null; meta: WriteMeta }[];
  putLegacy: (baseId: string, ref: DocRef, body: string) => void;
  putAsset: (baseId: string, path: string, body: string, contentType?: string) => void;
  askedAssets: string[];
  failVersionDelete: boolean;
} {
  const docs = new Map<string, MemoryVersion[]>();
  const assets = new Map<string, Asset>();
  const askedAssets: string[] = [];
  let seq = 0;
  const key = (baseId: string, ref: DocRef) =>
    ref.kind === 'tree' ? `${baseId}/tree` : `${baseId}/pages/${ref.id}`;
  const current = (baseId: string, ref: DocRef) => {
    const last = docs.get(key(baseId, ref))?.at(-1);
    return last && last.body !== null ? last : null;
  };
  const push = (baseId: string, ref: DocRef, body: string | null, meta: WriteMeta) => {
    const versionId = `v${++seq}`;
    const list = docs.get(key(baseId, ref)) ?? [];
    list.push({ versionId, body, meta });
    docs.set(key(baseId, ref), list);
    return versionId;
  };

  const storage = {
    failVersionDelete: false,
    async readDoc(baseId: string, ref: DocRef) {
      const v = current(baseId, ref);
      return v ? { body: v.body!, meta: { ...v.meta, versionId: v.versionId } } : null;
    },
    async headDoc(baseId: string, ref: DocRef) {
      const v = current(baseId, ref);
      return v ? { ...v.meta, versionId: v.versionId } : null;
    },
    async writeDoc(baseId: string, ref: DocRef, body: string, meta: WriteMeta) {
      return push(baseId, ref, body, meta);
    },
    async deleteDocVersion(baseId: string, ref: DocRef, versionId: string) {
      if (storage.failVersionDelete) throw new Error('нет прав');
      const list = docs.get(key(baseId, ref)) ?? [];
      docs.set(key(baseId, ref), list.filter((v) => v.versionId !== versionId));
    },
    async deletePage(baseId: string, pageId: PageId) {
      push(baseId, { kind: 'page', id: pageId }, null, { rev: 0, device: null, burstStart: null });
    },
    async readAsset(baseId: string, path: string) {
      askedAssets.push(`${baseId}/${path}`);
      return assets.get(`${baseId}/${path}`) ?? null;
    },
    history: (baseId: string, ref: DocRef) =>
      (docs.get(key(baseId, ref)) ?? []).map(({ body, meta }) => ({ body, meta })),
    /** Объект, записанный до появления версий: без метаданных. */
    putLegacy(baseId: string, ref: DocRef, body: string) {
      push(baseId, ref, body, { rev: 0, device: null, burstStart: null });
    },
    putAsset(baseId: string, path: string, body: string, contentType?: string) {
      assets.set(`${baseId}/${path}`, { body: Buffer.from(body, 'utf8'), contentType: contentType ?? null });
    },
    askedAssets,
    dump: () => [...docs.keys()],
  };
  return storage;
}

function makeRequest(
  method: string,
  url: string,
  body = '',
  headers: Record<string, string> = {},
): IncomingMessage {
  const req = Readable.from([Buffer.from(body, 'utf8')]) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
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

interface CallOptions {
  headers?: Record<string, string>;
  api?: ApiOptions;
  handle?: ReturnType<typeof createApi>;
}

async function call(
  storage: BaseStorage,
  method: string,
  url: string,
  body = '',
  owner: string | null = 'владелец',
  { headers, api, handle }: CallOptions = {},
) {
  const handler = handle ?? createApi(storage, () => owner, api);
  const { res, captured } = makeResponse();
  const handled = await handler(makeRequest(method, url, body, headers), res);
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
      expect(get.contentType).toContain('application/json');
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
      expect(storage.dump()).toEqual([]);
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
        readDoc: async () => {
          throw new Error('хранилище недоступно');
        },
      };
      expect((await call(broken, 'GET', '/api/tree')).status).toBe(502);
    });
  });

  describe('версии', () => {
    const page: DocRef = { kind: 'page', id: 'p1' };
    const put = (storage: BaseStorage, body: string, headers: Record<string, string> = {}, api?: ApiOptions) =>
      call(storage, 'PUT', '/api/pages/p1', body, 'владелец', { headers, api });

    it('каждая запись — следующая версия, GET отдаёт её ETag', async () => {
      const storage = memoryStorage();
      expect((await put(storage, 'раз')).headers.etag).toBe('"1"');
      expect((await put(storage, 'два')).headers.etag).toBe('"2"');

      const get = await call(storage, 'GET', '/api/pages/p1');
      expect(get.headers.etag).toBe('"2"');
      expect(get.headers['cache-control']).toContain('no-cache');
    });

    it('If-None-Match с текущей версией — 304 без тела', async () => {
      const storage = memoryStorage();
      await put(storage, 'текст');
      const same = await call(storage, 'GET', '/api/pages/p1', '', 'владелец', {
        headers: { 'If-None-Match': '"1"' },
      });
      expect(same.status).toBe(304);
      expect(same.body).toBe('');

      const stale = await call(storage, 'GET', '/api/pages/p1', '', 'владелец', {
        headers: { 'If-None-Match': '"0"' },
      });
      expect(stale.status).toBe(200);
      expect(stale.body).toBe('текст');
    });

    it('If-Match с текущей версией — запись проходит', async () => {
      const storage = memoryStorage();
      await put(storage, 'раз');
      const res = await put(storage, 'два', { 'If-Match': '"1"' });
      expect(res.status).toBe(200);
      expect(res.headers.etag).toBe('"2"');
    });

    it('If-Match с устаревшей версией — 412 и то, что лежит сейчас', async () => {
      const storage = memoryStorage();
      await put(storage, 'раз');
      await put(storage, 'с другого устройства', { 'If-Match': '"1"' });

      const res = await put(storage, 'моё', { 'If-Match': '"1"' });
      expect(res.status).toBe(412);
      expect(res.body).toBe('с другого устройства');
      expect(res.headers.etag).toBe('"2"');
      expect(res.contentType).toContain('text/markdown');
      expect((await call(storage, 'GET', '/api/pages/p1')).body).toBe('с другого устройства');
    });

    it('If-Match к несуществующему — 412 без ETag', async () => {
      const res = await put(memoryStorage(), 'моё', { 'If-Match': '"3"' });
      expect(res.status).toBe(412);
      expect(res.headers.etag).toBeUndefined();
    });

    it('If-None-Match: * — только создание', async () => {
      const storage = memoryStorage();
      expect((await put(storage, 'новая', { 'If-None-Match': '*' })).status).toBe(200);
      const again = await put(storage, 'ещё раз', { 'If-None-Match': '*' });
      expect(again.status).toBe(412);
      expect(again.body).toBe('новая');
    });

    it('записанное до появления версий — версия 0', async () => {
      const storage = memoryStorage();
      storage.putLegacy('владелец', page, 'старое');
      expect((await call(storage, 'GET', '/api/pages/p1')).headers.etag).toBe('"0"');
      const res = await put(storage, 'новое', { 'If-Match': '"0"' });
      expect(res.status).toBe(200);
      expect(res.headers.etag).toBe('"1"');
    });

    it('мусор в If-Match — 400', async () => {
      expect((await put(memoryStorage(), 'x', { 'If-Match': 'abc' })).status).toBe(400);
      expect((await put(memoryStorage(), 'x', { 'If-None-Match': '"1"' })).status).toBe(400);
    });

    it('запись без условия: пока принимается, а в строгом режиме — 428', async () => {
      expect((await put(memoryStorage(), 'x')).status).toBe(200);
      const strict = await put(memoryStorage(), 'x', {}, { requirePrecondition: true });
      expect(strict.status).toBe(428);
    });

    it('дерево версионируется так же', async () => {
      const storage = memoryStorage();
      const body = JSON.stringify(дерево);
      expect((await call(storage, 'PUT', '/api/tree', body)).headers.etag).toBe('"1"');
      const stale = await call(storage, 'PUT', '/api/tree', body, 'владелец', {
        headers: { 'If-Match': '"0"' },
      });
      expect(stale.status).toBe(412);
      expect(JSON.parse(stale.body)).toEqual(дерево);
      expect(stale.contentType).toContain('application/json');
    });

    it('одновременные записи от одной версии: проходит ровно одна', async () => {
      const storage = memoryStorage();
      await put(storage, 'раз');
      const handle = createApi(storage, () => 'владелец');
      const results = await Promise.all(
        ['первое', 'второе', 'третье'].map((body) =>
          call(storage, 'PUT', '/api/pages/p1', body, 'владелец', {
            handle,
            headers: { 'If-Match': '"1"' },
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 412, 412]);
    });
  });

  describe('группировка правок', () => {
    const page: DocRef = { kind: 'page', id: 'p1' };
    const minute = 60_000;

    function at(storage: ReturnType<typeof memoryStorage>) {
      let clock = 0;
      return {
        put: (body: string, device: string | null, afterMs: number) => {
          clock += afterMs;
          const headers: Record<string, string> = {};
          if (device) headers['X-Device-Id'] = device;
          return call(storage, 'PUT', '/api/pages/p1', body, 'владелец', {
            headers,
            api: { now: () => clock },
          });
        },
        bodies: () => storage.history('владелец', page).map((v) => v.body),
      };
    }

    it('правки одного устройства в пределах 5 минут — одна версия', async () => {
      const storage = memoryStorage();
      const t = at(storage);
      await t.put('раз', 'mac', 0);
      await t.put('два', 'mac', 2_000);
      await t.put('три', 'mac', 2_000);
      expect(t.bodies()).toEqual(['три']);
    });

    it('серия дольше 5 минут — по версии на каждые 5 минут', async () => {
      const storage = memoryStorage();
      const t = at(storage);
      // Правка каждую минуту в течение 11 минут.
      for (let i = 0; i <= 11; i++) await t.put(`м${i}`, 'mac', i === 0 ? 0 : minute);
      // Серии: 0–4, 5–9, 10–11. От каждой остаётся последняя версия.
      expect(t.bodies()).toEqual(['м4', 'м9', 'м11']);
      expect(BURST_WINDOW).toBe(5 * minute);
    });

    it('правка с другого устройства не схлопывает чужую версию', async () => {
      const storage = memoryStorage();
      const t = at(storage);
      await t.put('с мака', 'mac', 0);
      await t.put('с телефона', 'phone', 1_000);
      await t.put('с телефона ещё', 'phone', 1_000);
      await t.put('снова мак', 'mac', 1_000);
      expect(t.bodies()).toEqual(['с мака', 'с телефона ещё', 'снова мак']);
    });

    it('без X-Device-Id не схлопывает', async () => {
      const storage = memoryStorage();
      const t = at(storage);
      await t.put('раз', null, 0);
      await t.put('два', null, 1_000);
      expect(t.bodies()).toEqual(['раз', 'два']);
    });

    it('версию, записанную до появления версий, не трогает', async () => {
      const storage = memoryStorage();
      storage.putLegacy('владелец', page, 'старое');
      const t = at(storage);
      await t.put('новое', 'mac', 0);
      await t.put('новее', 'mac', 1_000);
      expect(t.bodies()).toEqual(['старое', 'новее']);
    });

    it('после удаления страницы история до удаления не трогается', async () => {
      const storage = memoryStorage();
      const t = at(storage);
      await t.put('была', 'mac', 0);
      await call(storage, 'DELETE', '/api/pages/p1');
      await t.put('снова', 'mac', 1_000);
      await t.put('снова ещё', 'mac', 1_000);
      expect(t.bodies()).toEqual(['была', null, 'снова ещё']);
    });

    it('не удалось убрать промежуточную версию — запись всё равно успешна', async () => {
      const storage = memoryStorage();
      storage.failVersionDelete = true;
      const t = at(storage);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      await t.put('раз', 'mac', 0);
      const res = await t.put('два', 'mac', 1_000);
      expect(res.status).toBe(200);
      expect(t.bodies()).toEqual(['раз', 'два']);
      expect(errors).toHaveBeenCalled();
      errors.mockRestore();
    });

    it('мусор в X-Device-Id игнорируется', async () => {
      const storage = memoryStorage();
      await call(storage, 'PUT', '/api/pages/p1', 'x', 'владелец', {
        headers: { 'X-Device-Id': '../../etc' },
      });
      expect(storage.history('владелец', page)[0]!.meta.device).toBeNull();
    });
  });
});
