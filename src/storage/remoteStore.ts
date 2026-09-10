import type { PageId, Tree } from '../types';
import type { PageStore } from './pageStore';

/** Хранилище на сервере. Ключ к S3 остаётся там, в браузер не попадает (NFR-17). */
export function createRemoteStore(baseId: string): PageStore {
  const base = `/api/${encodeURIComponent(baseId)}`;

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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
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
  };
}
