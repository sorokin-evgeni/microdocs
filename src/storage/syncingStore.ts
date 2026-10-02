import type { PageId, Tree } from '../types';
import type { PageStore } from './pageStore';
import type { OutboxEntry, createOutbox } from './outbox';

export type SyncState = 'синхронизировано' | 'ожидает отправки' | 'нет связи';

export interface SyncingStore extends PageStore {
  /** Отправить всё накопившееся. Безопасно звать повторно. */
  drain: () => Promise<void>;
  /**
   * Страница ушла в фон или закрывается: отправлять сразу, не откладывая, —
   * таймер может уже не сработать.
   */
  setBackground: (background: boolean) => void;
}

export interface SyncTiming {
  /** Сколько ждать тишины перед отправкой. */
  pushDelay: number;
  /**
   * Отправки — не чаще этого. И не реже: правка не ждёт отправки дольше,
   * даже если правки не прекращаются.
   */
  pushInterval: number;
}

export const DEFAULT_SYNC_TIMING: SyncTiming = { pushDelay: 600, pushInterval: 2000 };

type Outbox = ReturnType<typeof createOutbox>;

/** Сервер недоступен, а на этом устройстве базы ещё нет: есть ли она — неизвестно. */
export class BaseUnavailableError extends Error {
  constructor() {
    super('База недоступна: нет связи, а на устройстве копии нет');
    this.name = 'BaseUnavailableError';
  }
}

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
  timing: SyncTiming = DEFAULT_SYNC_TIMING,
): SyncingStore {
  const report = (state: SyncState) => onState(state);

  async function push(entry: OutboxEntry): Promise<void> {
    // Поколение — до чтения значения: правка, сделанная пока идёт запрос,
    // его сменит, и запись останется в очереди до следующего прохода.
    const generation = outbox.generation(entry);
    if (generation === undefined) return;

    if (entry === 'tree') {
      const tree = await local.loadTree();
      if (tree) await remote.saveTree(tree);
    } else if (entry.startsWith('page:')) {
      const id = entry.slice('page:'.length);
      await remote.saveBody(id, await local.loadBody(id));
    } else {
      await remote.deleteBodies([entry.slice('del:'.length)]);
    }
    outbox.remove(entry, generation);
  }

  /** Один проход по очереди; false — связь оборвалась. */
  async function drainOnce(): Promise<boolean> {
    if (outbox.isEmpty()) {
      report('синхронизировано');
      return true;
    }

    report('ожидает отправки');
    for (const entry of outbox.list()) {
      try {
        await push(entry);
      } catch {
        report('нет связи');
        return false;
      }
    }
    report(outbox.isEmpty() ? 'синхронизировано' : 'ожидает отправки');
    return true;
  }

  // Проходы идут по одному: иначе каждая правка запускала бы свой
  // и одно и то же уезжало бы на сервер несколько раз.
  let running: Promise<void> | null = null;
  let again = false;

  function drain(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        let ok: boolean;
        do {
          again = false;
          ok = await drainOnce();
        } while (ok && again);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  // Отправка откладывается, пока правки идут подряд, но не дольше pushInterval,
  // и уходит не чаще раза в pushInterval. Срок считается от времени, а не от
  // числа записей: как часто пишет редактор, от темпа набора не зависит.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstPendingAt: number | null = null;
  let lastPushAt = -Infinity;
  let background = false;

  function drainNow() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    firstPendingAt = null;
    lastPushAt = Date.now();
    void drain();
  }

  function scheduleDrain() {
    if (background) {
      drainNow();
      return;
    }
    const now = Date.now();
    firstPendingAt ??= now;
    const at = Math.max(
      Math.min(now + timing.pushDelay, firstPendingAt + timing.pushInterval),
      lastPushAt + timing.pushInterval,
    );
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(drainNow, at - now);
  }

  /** Запись не должна ждать сеть: сначала локально, отправка следом (FR-38). */
  function enqueue(entry: OutboxEntry) {
    outbox.add(entry);
    report('ожидает отправки');
    scheduleDrain();
  }

  return {
    async loadTree() {
      // Есть неотправленное — локальное свежее, с сервера тянуть нельзя.
      // Но если локально дерева нет, сервер — единственный источник.
      if (!outbox.isEmpty()) {
        const tree = await local.loadTree();
        if (tree) {
          void drain();
          return tree;
        }
      }

      let tree: Tree | null;
      try {
        tree = await remote.loadTree();
      } catch {
        report('нет связи');
        // null здесь значил бы «базы нет», и её создали бы заново поверх
        // настоящей. Не знаем — так и говорим.
        const cached = await local.loadTree();
        if (!cached) throw new BaseUnavailableError();
        return cached;
      }
      if (tree) await local.saveTree(tree);
      report('синхронизировано');
      return tree ?? (await local.loadTree());
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
    setBackground(value) {
      background = value;
      if (value && !outbox.isEmpty()) drainNow();
    },
  };
}
