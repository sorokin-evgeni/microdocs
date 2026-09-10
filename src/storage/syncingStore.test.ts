import { beforeEach, describe, expect, it } from 'vitest';
import type { PageId, Tree } from '../types';
import type { PageStore } from './pageStore';
import { createOutbox } from './outbox';
import { createSyncingStore, type SyncState } from './syncingStore';

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

describe('синхронизация с сервером', () => {
  beforeEach(() => localStorage.clear());

  function setup() {
    const local = memoryStore();
    const remote = memoryStore();
    const outbox = createOutbox('база');
    const states: SyncState[] = [];
    const store = createSyncingStore(
      local.store,
      remote.store,
      outbox,
      (s) => states.push(s),
    );
    return { local, remote, outbox, states, store };
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
    const { remote, store } = setup();
    remote.state.offline = true;
    await store.saveTree(дерево('Офлайн'));

    // Новая вкладка: очередь читается из localStorage.
    expect(createOutbox('база').isEmpty()).toBe(false);
  });

  it('удаление и правка одной страницы не копятся вместе', async () => {
    const { remote, store, outbox } = setup();
    remote.state.offline = true;

    await store.saveBody('p1', 'текст');
    await store.deleteBodies(['p1']);

    expect(outbox.list()).toEqual(['del:p1']);
  });
});
