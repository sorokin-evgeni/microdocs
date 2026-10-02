import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageId, Tree } from '../types';
import type { PageStore } from './pageStore';
import { createOutbox } from './outbox';
import {
  BaseUnavailableError,
  createSyncingStore,
  type SyncState,
  type SyncTiming,
} from './syncingStore';

function memoryStore() {
  let tree: Tree | null = null;
  const bodies = new Map<PageId, string>();
  const state = { offline: false };

  const guard = () => {
    if (state.offline) throw new Error('нет сети');
  };

  const store: PageStore = {
    async loadTree() {
      guard();
      return tree;
    },
    async saveTree(next) {
      guard();
      tree = next;
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
      ids.forEach((id) => bodies.delete(id));
    },
  };

  return { store, state, peek: () => ({ tree, bodies }) };
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
    const store = createSyncingStore(
      local.store,
      remote.store,
      outbox,
      (s) => states.push(s),
      timing,
    );
    return { local, remote, outbox, states, store, baseId };
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
    const original = remote.store.saveBody;
    remote.store.saveBody = (id, body) => {
      remote.store.saveBody = original;
      return new Promise<void>((resolve) => {
        release = () => void original(id, body).then(resolve);
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
    const saveBody = vi.spyOn(remote.store, 'saveBody');
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
      const saveBody = vi.spyOn(remote.store, 'saveBody');
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
      const saveBody = vi.spyOn(remote.store, 'saveBody');
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
      const saveBody = vi.spyOn(remote.store, 'saveBody');
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
});
