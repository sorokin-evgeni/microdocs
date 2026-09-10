import { openDB, type IDBPDatabase } from 'idb';
import type { PageId, Tree } from '../types';
import type { PageStore } from './pageStore';

const DB_NAME = 'microdocs';
const DB_VERSION = 1;
const TREES = 'trees';
const BODIES = 'bodies';

function openDatabase(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(TREES)) db.createObjectStore(TREES);
      if (!db.objectStoreNames.contains(BODIES)) db.createObjectStore(BODIES);
    },
  });
}

/**
 * Реализация хранилища на IndexedDB. Ключи повторяют пути в S3, поэтому база
 * изолирована по `baseId` уже сейчас, до появления настоящих пользователей (NFR-26).
 */
export function createIndexedDbStore(baseId: string): PageStore {
  const db = openDatabase();
  const bodyKey = (id: PageId) => `${baseId}/pages/${id}.md`;

  return {
    async loadTree() {
      const tree = await (await db).get(TREES, baseId);
      return (tree as Tree | undefined) ?? null;
    },

    async saveTree(tree) {
      await (await db).put(TREES, tree, baseId);
    },

    async loadBody(id) {
      const body = await (await db).get(BODIES, bodyKey(id));
      return (body as string | undefined) ?? '';
    },

    async saveBody(id, body) {
      await (await db).put(BODIES, body, bodyKey(id));
    },

    async deleteBodies(ids) {
      const database = await db;
      const tx = database.transaction(BODIES, 'readwrite');
      await Promise.all([
        ...ids.map((id) => tx.store.delete(bodyKey(id))),
        tx.done,
      ]);
    },
  };
}
