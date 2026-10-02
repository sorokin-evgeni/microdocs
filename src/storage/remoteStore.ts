import type { PageId, Tree } from '../types';
import type { FetchedPage, PutResult, RemoteStore } from './pageStore';
import { deviceId } from './device';

/**
 * Хранилище на сервере. Ключ к S3 остаётся там, в браузер не попадает (NFR-17).
 *
 * База в адресах не указывается: сервер определяет её по клиентскому
 * сертификату, поэтому попросить чужую невозможно.
 */
export function createRemoteStore(): RemoteStore {
  const base = '/api';

  return {
    async loadTree() {
      const res = await fetch(`${base}/tree`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Дерево не прочиталось: ${res.status}`);
      return (await res.json()) as Tree;
    },

    async saveTree(tree) {
      const res = await fetch(`${base}/tree`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId() },
        body: JSON.stringify(tree),
      });
      if (!res.ok) throw new Error(`Дерево не записалось: ${res.status}`);
    },

    async loadBody(id: PageId) {
      const res = await fetch(`${base}/pages/${encodeURIComponent(id)}`);
      if (res.status === 404) return '';
      if (!res.ok) throw new Error(`Страница не прочиталась: ${res.status}`);
      return await res.text();
    },

    async saveBody(id, body) {
      const res = await fetch(`${base}/pages/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'X-Device-Id': deviceId() },
        body,
      });
      if (!res.ok) throw new Error(`Страница не записалась: ${res.status}`);
    },

    async deleteBodies(ids) {
      for (const id of ids) {
        const res = await fetch(`${base}/pages/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 404) {
          throw new Error(`Страница не удалилась: ${res.status}`);
        }
      }
    },

    async fetchPage(id, knownRev): Promise<FetchedPage> {
      const res = await fetch(`${base}/pages/${encodeURIComponent(id)}`, {
        // Сверяемся сами, по номеру версии: кеш браузера тут только мешает.
        cache: 'no-store',
        headers: knownRev === null ? {} : { 'If-None-Match': `"${knownRev}"` },
      });
      if (res.status === 304) return { kind: 'unchanged' };
      if (res.status === 404) return { kind: 'missing' };
      if (!res.ok) throw new Error(`Страница не прочиталась: ${res.status}`);
      return { kind: 'found', body: await res.text(), rev: revOf(res) };
    },

    async putPage(id, body, condition): Promise<PutResult> {
      const res = await fetch(`${base}/pages/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'X-Device-Id': deviceId(),
          ...(condition === 'absent'
            ? { 'If-None-Match': '*' }
            : { 'If-Match': `"${condition.rev}"` }),
        },
        body,
      });
      if (res.ok) return { kind: 'saved', rev: revOf(res) };
      if (res.status === 412) {
        // Без ETag — страницы на сервере нет; с ним — в теле то, что там сейчас.
        return res.headers.has('ETag')
          ? { kind: 'conflict', current: { body: await res.text(), rev: revOf(res) } }
          : { kind: 'conflict', current: null };
      }
      throw new Error(`Страница не записалась: ${res.status}`);
    },
  };
}

function revOf(res: Response): number {
  const rev = Number(res.headers.get('ETag')?.replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isFinite(rev)) throw new Error('Сервер не сообщил версию');
  return rev;
}
