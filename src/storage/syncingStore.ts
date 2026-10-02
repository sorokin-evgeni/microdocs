import type { PageId, Tree } from '../types';
import { merge3 } from '../domain/merge';
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
  /** Сверить страницу с сервером: вдруг её правили на другом устройстве. */
  refreshPage: (id: PageId) => Promise<void>;
  /** Страница поменялась не из редактора: пришла с сервера или слилась. */
  subscribe: (listener: (change: PageChange) => void) => () => void;
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
 * Дерево пока пишется как раньше, last-wins (FR-34).
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
      const tree = await local.loadTree();
      if (tree) await remote.saveTree(tree);
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
}
