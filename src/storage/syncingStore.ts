import type { PageId, Tree } from '../types';
import type { PageStore } from './pageStore';
import type { OutboxEntry, createOutbox } from './outbox';

export type SyncState = 'синхронизировано' | 'ожидает отправки' | 'нет связи';

export interface SyncingStore extends PageStore {
  /** Отправить всё накопившееся. Безопасно звать повторно. */
  drain: () => Promise<void>;
}

type Outbox = ReturnType<typeof createOutbox>;

/**
 * Локальное хранилище — основное: чтение и правка работают без сети (FR-31).
 * Записи уходят на сервер следом; неотправленное копится в очереди и уезжает,
 * когда связь появится (FR-32).
 *
 * Разрешение расхождений — last-wins (FR-34): при отправке берётся текущее
 * локальное значение, никакого слияния текста нет.
 */
export function createSyncingStore(
  local: PageStore,
  remote: PageStore,
  outbox: Outbox,
  onState: (state: SyncState) => void,
): SyncingStore {
  const report = (state: SyncState) => onState(state);

  async function push(entry: OutboxEntry): Promise<void> {
    if (entry === 'tree') {
      const tree = await local.loadTree();
      if (tree) await remote.saveTree(tree);
    } else if (entry.startsWith('page:')) {
      const id = entry.slice('page:'.length);
      await remote.saveBody(id, await local.loadBody(id));
    } else {
      await remote.deleteBodies([entry.slice('del:'.length)]);
    }
    outbox.remove(entry);
  }

  async function drain(): Promise<void> {
    if (outbox.isEmpty()) {
      report('синхронизировано');
      return;
    }
    report('ожидает отправки');
    for (const entry of outbox.list()) {
      try {
        await push(entry);
      } catch {
        report('нет связи');
        return;
      }
    }
    report(outbox.isEmpty() ? 'синхронизировано' : 'ожидает отправки');
  }

  /** Запись не должна ждать сеть: сначала локально, отправка следом (FR-38). */
  function enqueue(entry: OutboxEntry) {
    outbox.add(entry);
    report('ожидает отправки');
    void drain();
  }

  return {
    async loadTree() {
      // Есть неотправленное — локальное свежее, с сервера тянуть нельзя.
      if (!outbox.isEmpty()) {
        void drain();
        return local.loadTree();
      }
      try {
        const tree = await remote.loadTree();
        if (tree) await local.saveTree(tree);
        report('синхронизировано');
        return tree ?? (await local.loadTree());
      } catch {
        report('нет связи');
        return local.loadTree();
      }
    },

    async saveTree(tree: Tree) {
      await local.saveTree(tree);
      enqueue('tree');
    },

    async loadBody(id: PageId) {
      if (outbox.list().includes(`page:${id}`)) return local.loadBody(id);
      try {
        const body = await remote.loadBody(id);
        await local.saveBody(id, body);
        return body;
      } catch {
        report('нет связи');
        return local.loadBody(id);
      }
    },

    async saveBody(id, body) {
      await local.saveBody(id, body);
      enqueue(`page:${id}`);
    },

    async deleteBodies(ids) {
      await local.deleteBodies(ids);
      for (const id of ids) enqueue(`del:${id}`);
    },

    drain,
  };
}
