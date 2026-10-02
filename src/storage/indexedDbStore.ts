import { openDB, type IDBPDatabase } from 'idb';
import type { PageId, Tree } from '../types';
import type { LocalStore, PageBase } from './pageStore';

const DB_NAME = 'microdocs';
const DB_VERSION = 2;
const TREES = 'trees';
const BODIES = 'bodies';
/** От какой серверной версии каждая страница (с версии 2). */
const BASES = 'bases';
/** Сколько ждать открытия базы, прежде чем считать, что её держит другая вкладка. */
const BLOCKED_AFTER = 1500;

export interface IndexedDbEvents {
  /**
   * Переход базы на новую версию ждёт, пока закроется другая вкладка или окно
   * со старой версией приложения; true — ждём, false — дождались.
   */
  onBlockedChange?: (blocked: boolean) => void;
  /** Другая вкладка с новой версией ждёт, пока эта отпустит базу. */
  onBlocking?: () => void;
}

function openDatabase({ onBlockedChange, onBlocking }: IndexedDbEvents): Promise<IDBPDatabase> {
  let blocked = false;
  const db = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(TREES)) db.createObjectStore(TREES);
      if (!db.objectStoreNames.contains(BODIES)) db.createObjectStore(BODIES);
      if (!db.objectStoreNames.contains(BASES)) db.createObjectStore(BASES);
    },
    blocked() {
      blocked = true;
      onBlockedChange?.(true);
    },
    blocking() {
      onBlocking?.();
    },
  });
  // Замороженная фоновая вкладка со старой версией не получает просьбу
  // уступить, и `blocked` в Chrome тогда не приходит вовсе. Обычно база
  // открывается за миллисекунды — долгое ожидание и есть блокировка.
  const slow = setTimeout(() => {
    blocked = true;
    onBlockedChange?.(true);
  }, BLOCKED_AFTER);
  void db.then(() => {
    clearTimeout(slow);
    if (blocked) onBlockedChange?.(false);
  });
  return db;
}

/**
 * Реализация хранилища на IndexedDB. Ключи повторяют пути в S3, поэтому база
 * изолирована по `baseId` уже сейчас, до появления настоящих пользователей (NFR-26).
 */
export function createIndexedDbStore(baseId: string, events: IndexedDbEvents = {}): LocalStore {
  const db = openDatabase(events);
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
      const tx = database.transaction([BODIES, BASES], 'readwrite');
      await Promise.all([
        ...ids.map((id) => tx.objectStore(BODIES).delete(bodyKey(id))),
        ...ids.map((id) => tx.objectStore(BASES).delete(bodyKey(id))),
        tx.done,
      ]);
    },

    async loadBase(id) {
      const base = await (await db).get(BASES, bodyKey(id));
      return (base as PageBase | undefined) ?? null;
    },

    async saveBase(id, base) {
      await (await db).put(BASES, base, bodyKey(id));
    },
  };
}
