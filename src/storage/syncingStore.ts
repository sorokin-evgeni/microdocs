import type { PageId, Tree } from '../types';
import { merge3 } from '../domain/merge';
import { applyOps, type TreeOp } from '../domain/treeOps';
import type { LocalStore, PageStore, RemoteStore } from './pageStore';
import type { OutboxEntry, createOutbox } from './outbox';
import type { Rescues } from './rescues';

export type SyncState = 'синхронизировано' | 'ожидает отправки' | 'нет связи';

export interface SyncingStore extends PageStore {
  /** Отправить всё накопившееся. Безопасно звать повторно. */
  drain: () => Promise<void>;
  /**
   * Страница ушла в фон или закрывается: отправлять сразу, не откладывая, —
   * таймер может уже не сработать.
   */
  setBackground: (background: boolean) => void;
  /**
   * Открыть страницу без ожидания сети: если на устройстве есть копия,
   * она отдаётся сразу, а `revalidate` говорит, что её стоит сверить
   * с сервером (refreshPage). Копии нет — ждём сервер, как раньше.
   */
  openPage: (id: PageId) => Promise<{ body: string; revalidate: boolean }>;
  /** Сверить страницу с сервером: вдруг её правили на другом устройстве. */
  refreshPage: (id: PageId) => Promise<void>;
  /** Страница поменялась не из редактора: пришла с сервера или слилась. */
  subscribe: (listener: (change: PageChange) => void) => () => void;
  /**
   * Правки дерева: применяются к локальному дереву и копятся до отправки.
   * Если сервер тем временем ушёл вперёд, применяются заново поверх его дерева.
   */
  updateTree: (ops: TreeOp[]) => Promise<void>;
  /** Сверить дерево с сервером. */
  refreshTree: () => Promise<void>;
  /** Дерево поменялось не отсюда: пришло с сервера или пересобрано поверх него. */
  subscribeTree: (listener: (tree: Tree) => void) => () => void;
  /** Вернуть свою версию, проигравшую конфликт. */
  restoreRescue: (id: PageId) => Promise<void>;
  /** Забыть свою версию, проигравшую конфликт. */
  dismissRescue: (id: PageId) => void;
}

export interface PageChange {
  id: PageId;
  /** Что было в локальной копии, от которой шли правки редактора. */
  before: string;
  after: string;
  /**
   * Своя правка проиграла: на сервере то же место правили по-другому.
   * Своя версия лежит в спасённых (rescues), пока её не вернут или не забудут.
   */
  conflict: boolean;
}

export interface SyncDeps {
  local: LocalStore;
  remote: RemoteStore;
  outbox: Outbox;
  rescues: Rescues;
  onState: (state: SyncState) => void;
  timing?: SyncTiming;
  now?: () => number;
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

/** Сколько раз подряд пробовать отправить страницу, если сервер её обгоняет. */
const PUSH_ATTEMPTS = 3;

/**
 * Локальное хранилище — основное: чтение и правка работают без сети (FR-31).
 * Записи уходят на сервер следом; неотправленное копится в очереди и уезжает,
 * когда связь появится (FR-32).
 *
 * Страницы пишутся с версией (`If-Match`): правка с другого устройства не
 * затирается молча. Если сервер успел уйти вперёд, правки сливаются (merge3);
 * если обе стороны правили одно место — остаётся серверная версия, а своя
 * откладывается в спасённые, и интерфейс предлагает её вернуть.
 *
 * Дерево тоже пишется с версией, но не сливается текстом: на устройстве
 * копятся сами правки (TreeOp), и при расхождении они применяются заново
 * поверх дерева с сервера.
 */
export function createSyncingStore({
  local,
  remote,
  outbox,
  rescues,
  onState,
  timing = DEFAULT_SYNC_TIMING,
  now = Date.now,
}: SyncDeps): SyncingStore {
  const report = (state: SyncState) => onState(state);

  const listeners = new Set<(change: PageChange) => void>();
  const emit = (change: PageChange) => listeners.forEach((listener) => listener(change));

  const treeListeners = new Set<(tree: Tree) => void>();
  const emitTree = (tree: Tree) => treeListeners.forEach((listener) => listener(tree));

  // Состояние дерева (само дерево, версия, неотправленные правки) меняют
  // и правки, и отправка, и сверка. Каждое изменение — чтение и запись,
  // и без очереди одно затирало бы другое: например, отправка, снимая
  // отправленные правки, потеряла бы ту, что добавили, пока шёл запрос.
  let treeTail: Promise<unknown> = Promise.resolve();
  function withTree<T>(fn: () => Promise<T>): Promise<T> {
    const run = treeTail.then(fn, fn);
    treeTail = run.catch(() => {});
    return run;
  }

  /** Отправить дерево с версией, от которой оно происходит. */
  async function pushTree(entry: OutboxEntry): Promise<void> {
    for (let attempt = 0; attempt < PUSH_ATTEMPTS; attempt++) {
      const generation = outbox.generation(entry);
      if (generation === undefined) return;

      const { tree, sync } = await withTree(async () => ({
        tree: await local.loadTree(),
        sync: await local.loadTreeSync(),
      }));
      if (!tree) {
        outbox.remove(entry, generation);
        return;
      }
      const sent = sync.ops.length;

      // Без версии — дерево с сервера ещё не приходило: обычно база новая,
      // тогда создаём. Если на сервере версия 0 — записано до появления
      // версий и с тех пор не правлено, — пишем поверх, как раньше.
      let result = await remote.putTree(tree, sync.rev === null ? 'absent' : { rev: sync.rev });
      if (sync.rev === null && result.kind === 'conflict' && result.current?.rev === 0) {
        result = await remote.putTree(tree, { rev: 0 });
      }
      if (sync.rev !== null && result.kind === 'conflict' && result.current === null) {
        result = await remote.putTree(tree, 'absent');
      }

      if (result.kind === 'saved') {
        const rev = result.rev;
        await withTree(async () => {
          const now = await local.loadTreeSync();
          await local.saveTreeSync({ rev, ops: now.ops.slice(sent) });
        });
        outbox.remove(entry, generation);
        return;
      }
      const current = result.current;
      if (current === null) continue;

      // Сервер ушёл вперёд: его дерево плюс наши неотправленные правки.
      const ours = await withTree(async () => {
        const now = await local.loadTreeSync();
        const rebased = applyOps(current.tree, now.ops);
        await local.saveTree(rebased);
        await local.saveTreeSync({ rev: current.rev, ops: now.ops });
        emitTree(rebased);
        return now.ops.length;
      });
      if (ours === 0) {
        // Своих правок нет — серверное дерево и есть итог.
        outbox.remove(entry, generation);
        return;
      }
    }
  }

  /** Отправить страницу с версией, от которой она происходит. */
  async function pushPage(entry: OutboxEntry, id: PageId): Promise<void> {
    for (let attempt = 0; attempt < PUSH_ATTEMPTS; attempt++) {
      const generation = outbox.generation(entry);
      if (generation === undefined) return;

      const mine = await local.loadBody(id);
      const base = await local.loadBase(id);
      // Без базы — страница с сервера ещё не приходила: обычно новая, тогда
      // создаём. Если же она лежит там с версией 0 — записана до появления
      // версий и с тех пор никем не правлена, — пишем поверх, как раньше.
      let result = await remote.putPage(id, mine, base ? { rev: base.rev } : 'absent');
      if (!base && result.kind === 'conflict' && result.current?.rev === 0) {
        result = await remote.putPage(id, mine, { rev: 0 });
      }
      // Была, а теперь нет — удалили на другом устройстве. Текст не теряем: создаём заново.
      if (base && result.kind === 'conflict' && result.current === null) {
        result = await remote.putPage(id, mine, 'absent');
      }

      if (result.kind === 'saved') {
        await local.saveBase(id, { rev: result.rev, text: mine });
        outbox.remove(entry, generation);
        return;
      }
      if (result.current === null) continue; // Создали, пока мы пробовали, — ещё круг.

      const theirs = result.current;
      // Пока шёл запрос, могли напечатать ещё: сливаем с самым свежим.
      const latest = await local.loadBody(id);
      const merged = merge3(base?.text ?? null, latest, theirs.body);
      await local.saveBase(id, { rev: theirs.rev, text: theirs.body });

      if (merged.clean) {
        await local.saveBody(id, merged.text);
        if (merged.text !== latest) emit({ id, before: latest, after: merged.text, conflict: false });
        if (merged.text === theirs.body) {
          outbox.remove(entry, generation);
          return;
        }
        continue; // Слитое — следующим кругом, уже от серверной версии.
      }

      rescues.add({ id, text: latest, at: now() });
      await local.saveBody(id, theirs.body);
      outbox.remove(entry, generation);
      emit({ id, before: latest, after: theirs.body, conflict: true });
      return;
    }
  }

  async function push(entry: OutboxEntry): Promise<void> {
    // Поколение — до чтения значения: правка, сделанная пока идёт запрос,
    // его сменит, и запись останется в очереди до следующего прохода.
    const generation = outbox.generation(entry);
    if (generation === undefined) return;

    if (entry === 'tree') {
      await pushTree(entry);
      return;
    } else if (entry.startsWith('page:')) {
      await pushPage(entry, entry.slice('page:'.length));
      return;
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

  const store: SyncingStore = {
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

      const cached = await local.loadTree();
      const sync = await local.loadTreeSync();
      // Есть копия, и известно, от какой она версии, — показываем сразу,
      // а сверку с сервером отправляем следом: новое придёт через subscribeTree.
      if (cached && sync.rev !== null) {
        void store.refreshTree();
        return cached;
      }
      let fetched;
      try {
        // Версию называем, только если есть и само дерево: иначе «не изменилось»
        // оставило бы нас ни с чем.
        fetched = await remote.fetchTree(cached ? sync.rev : null);
      } catch {
        report('нет связи');
        // null здесь значил бы «базы нет», и её создали бы заново поверх
        // настоящей. Не знаем — так и говорим.
        if (!cached) throw new BaseUnavailableError();
        return cached;
      }
      report('синхронизировано');
      if (fetched.kind !== 'found') return cached;

      const { tree, rev } = fetched;
      return withTree(async () => {
        // Пока ходили на сервер, могли успеть поправить — тогда поверх.
        const now = await local.loadTreeSync();
        const result = applyOps(tree, now.ops);
        await local.saveTree(result);
        await local.saveTreeSync({ rev, ops: now.ops });
        return result;
      });
    },

    async saveTree(tree: Tree) {
      // Дерево целиком — только для новой базы: правок, которые надо
      // сохранить поверх, у неё нет.
      await withTree(async () => {
        await local.saveTree(tree);
        const sync = await local.loadTreeSync();
        await local.saveTreeSync({ rev: sync.rev, ops: [] });
      });
      enqueue('tree');
    },

    async updateTree(ops) {
      if (ops.length === 0) return;
      await withTree(async () => {
        const tree = await local.loadTree();
        const sync = await local.loadTreeSync();
        if (tree) await local.saveTree(applyOps(tree, ops));
        await local.saveTreeSync({ rev: sync.rev, ops: [...sync.ops, ...ops] });
      });
      enqueue('tree');
    },

    async refreshTree() {
      if (outbox.list().includes('tree')) {
        void drain();
        return;
      }
      const sync = await local.loadTreeSync();
      let fetched;
      try {
        fetched = await remote.fetchTree(sync.rev);
      } catch {
        report('нет связи');
        return;
      }
      if (fetched.kind !== 'found') return;
      const { tree, rev } = fetched;
      const result = await withTree(async () => {
        const now = await local.loadTreeSync();
        const next = applyOps(tree, now.ops);
        await local.saveTree(next);
        await local.saveTreeSync({ rev, ops: now.ops });
        return next;
      });
      emitTree(result);
    },

    subscribeTree(listener) {
      treeListeners.add(listener);
      return () => treeListeners.delete(listener);
    },

    async loadBody(id: PageId) {
      if (outbox.list().includes(`page:${id}`)) return local.loadBody(id);
      const base = await local.loadBase(id);
      try {
        const fetched = await remote.fetchPage(id, base?.rev ?? null);
        if (fetched.kind === 'found') {
          await local.saveBody(id, fetched.body);
          await local.saveBase(id, { rev: fetched.rev, text: fetched.body });
          return fetched.body;
        }
        // Не изменилась — локальная копия верна. Нет на сервере — не затираем
        // то, что есть на устройстве: пустая страница не повод терять текст.
        return local.loadBody(id);
      } catch {
        report('нет связи');
        return local.loadBody(id);
      }
    },

    async openPage(id) {
      if (outbox.list().includes(`page:${id}`)) {
        return { body: await local.loadBody(id), revalidate: false };
      }
      const base = await local.loadBase(id);
      const body = await local.loadBody(id);
      // Копия с сервера уже была (или осталась от версии без номеров) — её и показываем.
      if (base || body) return { body, revalidate: true };
      return { body: await store.loadBody(id), revalidate: false };
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

    async refreshPage(id) {
      // Есть неотправленное — сверка случится при отправке, со слиянием.
      if (outbox.list().includes(`page:${id}`)) {
        void drain();
        return;
      }
      const base = await local.loadBase(id);
      let fetched;
      try {
        fetched = await remote.fetchPage(id, base?.rev ?? null);
      } catch {
        report('нет связи');
        return;
      }
      if (fetched.kind !== 'found') return;

      const before = await local.loadBody(id);
      // Пока ходили на сервер, могли начать править — тогда сверит отправка.
      if (outbox.list().includes(`page:${id}`) || (await local.loadBody(id)) !== before) return;
      await local.saveBody(id, fetched.body);
      await local.saveBase(id, { rev: fetched.rev, text: fetched.body });
      if (fetched.body !== before) emit({ id, before, after: fetched.body, conflict: false });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async restoreRescue(id) {
      const rescue = rescues.get(id);
      if (!rescue) return;
      const before = await local.loadBody(id);
      await local.saveBody(id, rescue.text);
      rescues.remove(id);
      // База — серверная версия, что победила: своя ляжет поверх неё осознанно.
      enqueue(`page:${id}`);
      emit({ id, before, after: rescue.text, conflict: false });
    },

    dismissRescue(id) {
      rescues.remove(id);
    },
  };
  return store;
}
