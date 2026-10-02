import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageId, Tree } from '../types';
import type { LocalStore, PageBase, RemoteStore, TreeSync } from './pageStore';
import { createRescues } from './rescues';
import { createOutbox } from './outbox';
import {
  BaseUnavailableError,
  createSyncingStore,
  PREFETCH_LIMIT,
  type PageChange,
  type SyncState,
  type SyncTiming,
} from './syncingStore';

/**
 * Хранилище в памяти: годится и как локальное (помнит базовые версии),
 * и как сервер (ведёт номера версий и пишет с условием, как настоящий).
 */
function memoryStore() {
  let tree: Tree | null = null;
  let treeRev = 0;
  let treeSync: TreeSync = { rev: null, ops: [] };
  const bodies = new Map<PageId, string>();
  const revs = new Map<PageId, number>();
  const bases = new Map<PageId, PageBase>();
  const state = { offline: false };

  const guard = () => {
    if (state.offline) throw new Error('нет сети');
  };
  const current = (id: PageId) =>
    bodies.has(id) ? { body: bodies.get(id)!, rev: revs.get(id) ?? 0 } : null;

  const store: LocalStore & RemoteStore = {
    async loadTree() {
      guard();
      return tree;
    },
    async saveTree(next) {
      guard();
      tree = next;
    },
    async loadTreeSync() {
      return treeSync;
    },
    async saveTreeSync(sync) {
      treeSync = sync;
    },
    async fetchTree(knownRev) {
      guard();
      if (!tree) return { kind: 'missing' };
      if (treeRev === knownRev) return { kind: 'unchanged' };
      return { kind: 'found', tree, rev: treeRev };
    },
    async putTree(next, condition) {
      guard();
      const ok = condition === 'absent' ? !tree : tree !== null && treeRev === condition.rev;
      if (!ok) return { kind: 'conflict', current: tree ? { tree, rev: treeRev } : null };
      tree = next;
      treeRev += 1;
      return { kind: 'saved', rev: treeRev };
    },
    async loadBody(id) {
      guard();
      return bodies.get(id) ?? '';
    },
    async saveBody(id, body) {
      guard();
      bodies.set(id, body);
    },
    async deleteBodies(ids) {
      guard();
      ids.forEach((id) => {
        bodies.delete(id);
        revs.delete(id);
        bases.delete(id);
      });
    },
    async loadBase(id) {
      return bases.get(id) ?? null;
    },
    async saveBase(id, base) {
      bases.set(id, base);
    },
    async fetchPage(id, knownRev) {
      guard();
      const page = current(id);
      if (!page) return { kind: 'missing' };
      if (page.rev === knownRev) return { kind: 'unchanged' };
      return { kind: 'found', ...page };
    },
    async putPage(id, body, condition) {
      guard();
      const page = current(id);
      const ok = condition === 'absent' ? !page : page !== null && page.rev === condition.rev;
      if (!ok) return { kind: 'conflict', current: page };
      const rev = (page?.rev ?? 0) + 1;
      bodies.set(id, body);
      revs.set(id, rev);
      return { kind: 'saved', rev };
    },
  };

  /** Запись с другого устройства — прямо на «сервер», мимо нашей очереди. */
  const writeFromElsewhere = (id: PageId, body: string) => {
    bodies.set(id, body);
    revs.set(id, (revs.get(id) ?? 0) + 1);
  };

  /** Дерево с другого устройства — прямо на «сервер». */
  const writeTreeFromElsewhere = (next: Tree) => {
    tree = next;
    treeRev += 1;
  };

  return {
    store,
    state,
    writeFromElsewhere,
    writeTreeFromElsewhere,
    peek: () => ({ tree, treeRev, treeSync, bodies, revs, bases }),
  };
}

const дерево = (title: string): Tree => ({
  roots: [{ id: 'p1', title, children: [] }],
});

let seq = 0;

describe('синхронизация с сервером', () => {
  beforeEach(() => localStorage.clear());

  function setup(timing: SyncTiming = { pushDelay: 0, pushInterval: 0 }) {
    const local = memoryStore();
    const remote = memoryStore();
    // У каждого теста своя очередь: отложенная отправка прошлого теста
    // иначе забрала бы записи из очереди текущего.
    const baseId = `база-${++seq}`;
    const outbox = createOutbox(baseId);
    const states: SyncState[] = [];
    const rescues = createRescues(baseId);
    const store = createSyncingStore({
      local: local.store,
      remote: remote.store,
      outbox,
      rescues,
      onState: (s) => states.push(s),
      timing,
    });
    const changes: PageChange[] = [];
    store.subscribe((change) => changes.push(change));
    return { local, remote, outbox, states, store, baseId, rescues, changes };
  }

  it('запись попадает и локально, и на сервер', async () => {
    const { local, remote, store, outbox } = setup();

    await store.saveTree(дерево('Первая'));
    await store.drain();

    expect(local.peek().tree).toEqual(дерево('Первая'));
    expect(remote.peek().tree).toEqual(дерево('Первая'));
    expect(outbox.isEmpty()).toBe(true);
  });

  it('без сети правка сохраняется локально и ждёт в очереди', async () => {
    const { local, remote, store, outbox, states } = setup();
    remote.state.offline = true;

    await store.saveTree(дерево('Офлайн'));
    await store.drain();

    expect(local.peek().tree).toEqual(дерево('Офлайн'));
    expect(remote.peek().tree).toBeNull();
    expect(outbox.isEmpty()).toBe(false);
    expect(states).toContain('нет связи');
  });

  it('когда связь вернулась, накопленное уезжает', async () => {
    const { remote, store, outbox } = setup();
    remote.state.offline = true;

    await store.saveTree(дерево('Офлайн'));
    await store.saveBody('p1', '# текст');
    await store.drain();
    expect(outbox.isEmpty()).toBe(false);

    remote.state.offline = false;
    await store.drain();

    expect(remote.peek().tree).toEqual(дерево('Офлайн'));
    expect(remote.peek().bodies.get('p1')).toBe('# текст');
    expect(outbox.isEmpty()).toBe(true);
  });

  it('при непустой очереди читаем локальное, а не серверное', async () => {
    const { local, remote, store } = setup();

    await local.store.saveTree(дерево('Локальная'));
    await remote.store.saveTree(дерево('Серверная'));
    remote.state.offline = true;
    await store.saveTree(дерево('Локальная'));

    remote.state.offline = false;
    expect(await store.loadTree()).toEqual(дерево('Локальная'));
  });

  it('при пустой очереди дерево берётся с сервера и зеркалится локально', async () => {
    const { local, remote, store } = setup();
    await remote.store.saveTree(дерево('Серверная'));

    expect(await store.loadTree()).toEqual(дерево('Серверная'));
    expect(local.peek().tree).toEqual(дерево('Серверная'));
  });

  it('очередь переживает пересоздание хранилища', async () => {
    const { remote, store, baseId } = setup();
    remote.state.offline = true;
    await store.saveTree(дерево('Офлайн'));

    // Новая вкладка: очередь читается из localStorage.
    expect(createOutbox(baseId).isEmpty()).toBe(false);
  });

  it('удаление и правка одной страницы не копятся вместе', async () => {
    const { remote, store, outbox } = setup();
    remote.state.offline = true;

    await store.saveBody('p1', 'текст');
    await store.deleteBodies(['p1']);

    expect(outbox.list()).toEqual(['del:p1']);
  });

  it('правка, сделанная пока шла отправка, не перетирается запоздалым ответом', async () => {
    const { local, remote, store, outbox } = setup();
    // Первая запись страницы «висит» в сети, пока её не отпустят.
    let release!: () => void;
    const original = remote.store.putPage;
    remote.store.putPage = (id, body, condition) => {
      remote.store.putPage = original;
      return new Promise((resolve) => {
        release = () => void original(id, body, condition).then(resolve);
      });
    };

    await store.saveBody('p1', 'v1');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await store.saveBody('p1', 'v2');
    // Ответ на первый запрос приходит последним.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await store.drain();

    expect(remote.peek().bodies.get('p1')).toBe('v2');
    expect(outbox.isEmpty()).toBe(true);
    // И следующее чтение не затирает локальное серверным.
    expect(await store.loadBody('p1')).toBe('v2');
    expect(local.peek().bodies.get('p1')).toBe('v2');
  });

  it('отправки идут по одному, без дублей', async () => {
    const { remote, store } = setup();
    const saveBody = vi.spyOn(remote.store, 'putPage');
    await store.saveBody('p1', 'a');
    await store.saveBody('p2', 'b');
    await store.saveBody('p3', 'c');
    await store.drain();
    expect(saveBody.mock.calls.map(([id]) => id).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('нет связи и нет копии — ошибка, а не «базы нет»', async () => {
    const { remote, store } = setup();
    remote.state.offline = true;
    await expect(store.loadTree()).rejects.toBeInstanceOf(BaseUnavailableError);
  });

  it('очередь не пуста, а локального дерева нет — берём серверное', async () => {
    const { remote, store, outbox } = setup();
    await remote.store.saveTree(дерево('Серверная'));
    outbox.add('page:p1');
    expect(await store.loadTree()).toEqual(дерево('Серверная'));
  });

  it('очередь в прежнем формате читается', () => {
    localStorage.setItem('microdocs:outbox:база', JSON.stringify(['tree', 'page:p1']));
    const outbox = createOutbox('база');
    expect(outbox.list()).toEqual(['tree', 'page:p1']);
    outbox.remove('tree', outbox.generation('tree')!);
    expect(outbox.list()).toEqual(['page:p1']);
  });

  describe('темп отправки', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const timing = { pushDelay: 600, pushInterval: 2000 };

    it('ждёт паузы в правках', async () => {
      const { remote, store } = setup(timing);
      const saveBody = vi.spyOn(remote.store, 'putPage');
      await store.saveBody('p1', 'a');
      await vi.advanceTimersByTimeAsync(400);
      await store.saveBody('p1', 'ab');
      await vi.advanceTimersByTimeAsync(400);
      expect(saveBody).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(saveBody).toHaveBeenCalledTimes(1);
      expect(remote.peek().bodies.get('p1')).toBe('ab');
    });

    it('при непрерывных правках отправляет не реже pushInterval', async () => {
      const { remote, store } = setup(timing);
      const saveBody = vi.spyOn(remote.store, 'putPage');
      for (let i = 1; i <= 10; i++) {
        await store.saveBody('p1', `v${i}`);
        await vi.advanceTimersByTimeAsync(300);
      }
      // 3 секунды правок без паузы: отправка была на второй секунде.
      expect(saveBody).toHaveBeenCalledTimes(1);
      expect(saveBody.mock.calls[0]![1]).toBe('v7');
    });

    it('отправляет не чаще pushInterval, как бы часто ни писал редактор', async () => {
      const { remote, store } = setup(timing);
      const saveBody = vi.spyOn(remote.store, 'putPage');
      // Редактор пишет то чаще, то реже задержки отправки — темп не важен.
      const gaps = [700, 200, 700, 200, 700, 200, 700, 200, 700, 200];
      for (const [i, gap] of gaps.entries()) {
        await store.saveBody('p1', `v${i}`);
        await vi.advanceTimersByTimeAsync(gap);
      }
      await vi.advanceTimersByTimeAsync(3000);

      const times = saveBody.mock.invocationCallOrder.length;
      expect(times).toBeGreaterThan(1);
      expect(remote.peek().bodies.get('p1')).toBe('v9');
      // Всего 4,5 секунды правок плюс хвост — при отправке раз в 2 секунды это 3 запроса.
      expect(times).toBeLessThanOrEqual(3);
    });

    it('в фоне отправляет сразу', async () => {
      const { remote, store } = setup(timing);
      store.setBackground(true);
      await store.saveBody('p1', 'ушёл в фон');
      await vi.advanceTimersByTimeAsync(0);
      expect(remote.peek().bodies.get('p1')).toBe('ушёл в фон');
    });

    it('уход в фон досылает уже отложенное', async () => {
      const { remote, store } = setup(timing);
      await store.saveBody('p1', 'отложено');
      store.setBackground(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(remote.peek().bodies.get('p1')).toBe('отложено');
    });
  });

  describe('версии страниц', () => {
    const текст = ['# Поездка', '', 'Билеты до пятницы.', '', 'Отель забронирован.'].join('\n');

    /** Страница уже на сервере и пришла на устройство: у копии есть базовая версия. */
    async function opened() {
      const ctx = setup();
      ctx.remote.writeFromElsewhere('p1', текст);
      expect(await ctx.store.loadBody('p1')).toBe(текст);
      return ctx;
    }

    it('новая страница создаётся, дальше пишется от своей версии', async () => {
      const { remote, local, store } = setup();
      await store.saveBody('p1', 'раз');
      await store.drain();
      expect(remote.peek().revs.get('p1')).toBe(1);
      expect(local.peek().bases.get('p1')).toEqual({ rev: 1, text: 'раз' });

      await store.saveBody('p1', 'два');
      await store.drain();
      expect(remote.peek().bodies.get('p1')).toBe('два');
      expect(remote.peek().revs.get('p1')).toBe(2);
    });

    it('правки в разных местах с двух устройств сливаются без шума', async () => {
      const { remote, local, store, changes, rescues } = await opened();
      remote.writeFromElsewhere('p1', текст.replace('# Поездка', '# Поездка в Казань'));

      await store.saveBody('p1', текст.replace('до пятницы', 'до четверга'));
      await store.drain();

      const ожидаемое = текст.replace('# Поездка', '# Поездка в Казань').replace('до пятницы', 'до четверга');
      expect(remote.peek().bodies.get('p1')).toBe(ожидаемое);
      expect(local.peek().bodies.get('p1')).toBe(ожидаемое);
      expect(changes).toEqual([
        { id: 'p1', before: текст.replace('до пятницы', 'до четверга'), after: ожидаемое, conflict: false },
      ]);
      expect(rescues.list()).toEqual([]);
    });

    it('одно место правили по-разному — остаётся чужое, своё спасено', async () => {
      const { remote, local, store, changes, rescues, outbox } = await opened();
      const чужое = текст.replace('до пятницы', 'до субботы');
      const моё = текст.replace('до пятницы', 'до четверга');
      remote.writeFromElsewhere('p1', чужое);

      await store.saveBody('p1', моё);
      await store.drain();

      expect(remote.peek().bodies.get('p1')).toBe(чужое);
      expect(local.peek().bodies.get('p1')).toBe(чужое);
      expect(changes).toEqual([{ id: 'p1', before: моё, after: чужое, conflict: true }]);
      expect(rescues.list().map((r) => [r.id, r.text])).toEqual([['p1', моё]]);
      expect(outbox.isEmpty()).toBe(true);
    });

    it('спасённую версию можно вернуть — она ложится поверх', async () => {
      const { remote, store, rescues } = await opened();
      remote.writeFromElsewhere('p1', текст.replace('до пятницы', 'до субботы'));
      const моё = текст.replace('до пятницы', 'до четверга');
      await store.saveBody('p1', моё);
      await store.drain();

      await store.restoreRescue('p1');
      await store.drain();
      expect(remote.peek().bodies.get('p1')).toBe(моё);
      expect(rescues.list()).toEqual([]);
    });

    it('спасённую версию можно забыть', async () => {
      const { remote, store, rescues } = await opened();
      remote.writeFromElsewhere('p1', текст.replace('до пятницы', 'до субботы'));
      await store.saveBody('p1', текст.replace('до пятницы', 'до четверга'));
      await store.drain();

      store.dismissRescue('p1');
      expect(rescues.list()).toEqual([]);
    });

    it('страница, записанная до появления версий, пишется поверх, как раньше', async () => {
      const { remote, local, store } = setup();
      remote.peek().bodies.set('p1', 'старое'); // версия 0, на устройстве базы нет
      await local.store.saveBody('p1', 'правка до обновления');

      await store.saveBody('p1', 'правка до обновления');
      await store.drain();
      expect(remote.peek().bodies.get('p1')).toBe('правка до обновления');
      expect(remote.peek().revs.get('p1')).toBe(1);
    });

    it('удалённую на другом устройстве страницу правка создаёт заново', async () => {
      const { remote, store } = await opened();
      await remote.store.deleteBodies(['p1']);
      await store.saveBody('p1', 'не потерять');
      await store.drain();
      expect(remote.peek().bodies.get('p1')).toBe('не потерять');
    });

    it('открытие неизменённой страницы не тянет её заново', async () => {
      const { remote, store } = await opened();
      const fetch = vi.spyOn(remote.store, 'fetchPage');
      expect(await store.loadBody('p1')).toBe(текст);
      expect(await fetch.mock.results[0]!.value).toEqual({ kind: 'unchanged' });
    });

    it('нет на сервере — локальный текст не затирается пустым', async () => {
      const { local, store } = setup();
      await local.store.saveBody('p1', 'только здесь');
      expect(await store.loadBody('p1')).toBe('только здесь');
      expect(local.peek().bodies.get('p1')).toBe('только здесь');
    });

    it('сверка подтягивает правку с другого устройства', async () => {
      const { remote, local, store, changes } = await opened();
      const чужое = текст.replace('Отель', 'Хостел');
      remote.writeFromElsewhere('p1', чужое);

      await store.refreshPage('p1');
      expect(local.peek().bodies.get('p1')).toBe(чужое);
      expect(changes).toEqual([{ id: 'p1', before: текст, after: чужое, conflict: false }]);

      await store.refreshPage('p1');
      expect(changes).toHaveLength(1); // не изменилась — тихо
    });

    it('сверка не трогает неотправленную правку — её сверит отправка', async () => {
      const { remote, local, store, changes } = await opened();
      remote.state.offline = true;
      await store.saveBody('p1', 'моё, ещё не ушло');
      remote.state.offline = false;
      remote.writeFromElsewhere('p1', текст.replace('Отель', 'Хостел'));

      const fetch = vi.spyOn(remote.store, 'fetchPage');
      await store.refreshPage('p1');
      expect(fetch).not.toHaveBeenCalled();
      expect(changes.filter((c) => c.id === 'p1' && c.after === 'моё, ещё не ушло')).toEqual([]);
      expect(local.peek().bodies.get('p1')).not.toBe(текст.replace('Отель', 'Хостел'));
    });
  });

  describe('версии дерева', () => {
    const исходное: Tree = {
      roots: [
        { id: 'a', title: 'A', children: [] },
        { id: 'c', title: 'C', children: [] },
      ],
    };
    const titles = (t: Tree | null) => t?.roots.map((n) => n.title);

    /** Дерево уже на сервере и пришло на устройство. */
    async function loaded() {
      const ctx = setup();
      ctx.remote.writeTreeFromElsewhere(исходное);
      expect(await ctx.store.loadTree()).toEqual(исходное);
      const trees: Tree[] = [];
      ctx.store.subscribeTree((t) => trees.push(t));
      return { ...ctx, trees };
    }

    it('правки уходят с версией и снимаются с устройства после записи', async () => {
      const { remote, local, store } = await loaded();
      await store.updateTree([{ type: 'rename', id: 'a', title: 'A2' }]);
      await store.drain();
      expect(titles(remote.peek().tree)).toEqual(['A2', 'C']);
      expect(remote.peek().treeRev).toBe(2);
      expect(local.peek().treeSync).toEqual({ rev: 2, ops: [] });
    });

    it('сервер ушёл вперёд — свои правки ложатся поверх его дерева', async () => {
      const { remote, local, store, trees } = await loaded();
      remote.writeTreeFromElsewhere({
        roots: [...исходное.roots, { id: 'e', title: 'С другого', children: [] }],
      });

      await store.updateTree([{ type: 'rename', id: 'c', title: 'C отсюда' }]);
      await store.drain();

      expect(titles(remote.peek().tree)).toEqual(['A', 'C отсюда', 'С другого']);
      expect(titles(local.peek().tree)).toEqual(['A', 'C отсюда', 'С другого']);
      expect(trees.map(titles)).toEqual([['A', 'C отсюда', 'С другого']]);
      expect(local.peek().treeSync.ops).toEqual([]);
    });

    it('правка, сделанная пока дерево отправлялось, не выпадает из журнала', async () => {
      const { remote, local, store } = await loaded();
      // Отправка, получив ответ, снимает с журнала отправленное. Придержим
      // эту запись, пока вклинивается новая правка: без очереди к состоянию
      // дерева отправка записала бы журнал по старому чтению и правку потеряла.
      let ackStarted = false;
      let releaseAck!: () => void;
      const ackGate = new Promise<void>((resolve) => (releaseAck = resolve));
      const { saveTreeSync } = local.store;
      local.store.saveTreeSync = async (sync) => {
        if (sync.rev === 2 && !ackStarted) {
          ackStarted = true;
          await ackGate;
        }
        await saveTreeSync(sync);
      };

      await store.updateTree([{ type: 'rename', id: 'a', title: 'A2' }]);
      await vi.waitFor(() => expect(ackStarted).toBe(true));
      const edit = store.updateTree([{ type: 'rename', id: 'c', title: 'C2' }]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      releaseAck();
      await edit;

      // Пока C2 не ушла, дерево правят на другом устройстве: при расхождении
      // C2 должна лечь поверх, а для этого она должна быть в журнале.
      remote.writeTreeFromElsewhere({
        roots: [
          { id: 'a', title: 'A с другого', children: [] },
          { id: 'c', title: 'C', children: [] },
        ],
      });
      await store.drain();
      expect(titles(remote.peek().tree)).toEqual(['A с другого', 'C2']);
    });

    it('сверка подтягивает дерево с другого устройства', async () => {
      const { remote, store, trees } = await loaded();
      remote.writeTreeFromElsewhere({ roots: [исходное.roots[1]!] });
      await store.refreshTree();
      expect(trees.map(titles)).toEqual([['C']]);

      await store.refreshTree();
      expect(trees).toHaveLength(1); // не изменилось — тихо
    });

    it('дерево, записанное до появления версий, пишется поверх, как раньше', async () => {
      const { remote, local, store, outbox } = setup();
      await remote.store.saveTree(исходное); // на сервере — версия 0
      // На устройстве — правка, сделанная до обновления: дерево целиком, версии нет.
      await local.store.saveTree({ roots: [{ id: 'a', title: 'A до обновления', children: [] }] });
      outbox.add('tree');

      await store.drain();
      expect(titles(remote.peek().tree)).toEqual(['A до обновления']);
      expect(remote.peek().treeRev).toBe(1);
    });
  });

  describe('открытие из копии на устройстве', () => {
    it('страница с копией открывается без сети, сверка — отдельно', async () => {
      const { remote, store } = setup();
      remote.writeFromElsewhere('p1', 'было');
      await store.loadBody('p1'); // первое открытие — копия появилась
      remote.state.offline = true;

      expect(await store.openPage('p1')).toEqual({ body: 'было', revalidate: true });
    });

    it('страницы на устройстве нет — ждём сервер', async () => {
      const { remote, store } = setup();
      remote.writeFromElsewhere('p1', 'с сервера');
      const fetch = vi.spyOn(remote.store, 'fetchPage');
      expect(await store.openPage('p1')).toEqual({ body: 'с сервера', revalidate: false });
      expect(fetch).toHaveBeenCalled();
    });

    it('неотправленная правка открывается как есть, без сверки', async () => {
      const { remote, store } = setup();
      remote.state.offline = true;
      await store.saveBody('p1', 'моё');
      expect(await store.openPage('p1')).toEqual({ body: 'моё', revalidate: false });
    });

    it('дерево с копией отдаётся сразу, а новое приходит следом', async () => {
      const { remote, store } = setup();
      remote.writeTreeFromElsewhere(дерево('Было'));
      await store.loadTree(); // первый запуск — копия появилась
      remote.writeTreeFromElsewhere(дерево('Стало'));
      const trees: Tree[] = [];
      store.subscribeTree((t) => trees.push(t));

      expect(await store.loadTree()).toEqual(дерево('Было'));
      await vi.waitFor(() => expect(trees).toEqual([дерево('Стало')]));
    });
  });

  describe('фоновая закачка', () => {
    it('качает только то, чего на устройстве нет', async () => {
      const { remote, local, store } = setup();
      remote.writeFromElsewhere('есть', 'уже скачана');
      remote.writeFromElsewhere('нет', 'с сервера');
      await store.loadBody('есть');
      const fetch = vi.spyOn(remote.store, 'fetchPage');

      await store.prefetchPages(['есть', 'нет', 'пропала']);
      expect(fetch.mock.calls.map(([id]) => id)).toEqual(['нет', 'пропала']);
      expect(local.peek().bodies.get('нет')).toBe('с сервера');
      expect(local.peek().bases.get('нет')).toEqual({ rev: 1, text: 'с сервера' });
      // Скачанная открывается без сети.
      remote.state.offline = true;
      expect(await store.openPage('нет')).toEqual({ body: 'с сервера', revalidate: true });
    });

    it('неотправленную правку не трогает', async () => {
      const { remote, local, store } = setup();
      remote.writeFromElsewhere('p1', 'с сервера');
      remote.state.offline = true;
      await store.saveBody('p1', 'моё');
      remote.state.offline = false;
      const fetch = vi.spyOn(remote.store, 'fetchPage');
      await store.prefetchPages(['p1']);
      expect(fetch).not.toHaveBeenCalled();
      expect(local.peek().bodies.get('p1')).toBe('моё');
    });

    it('без сети прекращает молча', async () => {
      const { remote, store, states } = setup();
      remote.state.offline = true;
      const fetch = vi.spyOn(remote.store, 'fetchPage');
      await store.prefetchPages(['a', 'b', 'c']);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(states).not.toContain('нет связи');
    });

    it('за раз не больше PREFETCH_LIMIT', async () => {
      const { remote, store } = setup();
      const fetch = vi.spyOn(remote.store, 'fetchPage');
      await store.prefetchPages(Array.from({ length: PREFETCH_LIMIT + 10 }, (_, i) => `p${i}`));
      expect(fetch).toHaveBeenCalledTimes(PREFETCH_LIMIT);
    });
  });
});
