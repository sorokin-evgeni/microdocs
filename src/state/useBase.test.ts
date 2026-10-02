import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { TreeOp } from '../domain/treeOps';
import type { PageId, Tree } from '../types';
import { RETRY_DELAY, useBase } from './useBase';

/**
 * Первая страница — не родитель архивируемой ветки, иначе переход
 * к родителю не отличить от перехода к первой.
 *
 *  d
 *  a
 *  └─ b
 *     └─ c
 */
const tree: Tree = {
  roots: [
    { id: 'd', title: 'D', children: [] },
    {
      id: 'a',
      title: 'A',
      children: [{ id: 'b', title: 'B', children: [{ id: 'c', title: 'C', children: [] }] }],
    },
  ],
};

type Store = Parameters<typeof useBase>[0];

function makeStore() {
  const treeListeners = new Set<(tree: Tree) => void>();
  return {
    loadTree: () => Promise.resolve(tree),
    saveTree: vi.fn(() => Promise.resolve()),
    saveBody: vi.fn(() => Promise.resolve()),
    deleteBodies: vi.fn(() => Promise.resolve()),
    updateTree: vi.fn((_ops: TreeOp[]) => Promise.resolve()),
    refreshTree: vi.fn(() => Promise.resolve()),
    subscribeTree: (listener: (tree: Tree) => void) => {
      treeListeners.add(listener);
      return () => void treeListeners.delete(listener);
    },
    pushTree: (next: Tree) => treeListeners.forEach((l) => l(next)),
  } satisfies Store & { pushTree: unknown };
}

const store = makeStore();

async function open(selected: PageId) {
  const hook = renderHook(() => useBase(store, () => selected));
  await waitFor(() => expect(hook.result.current.tree).not.toBeNull());
  return hook.result;
}

describe('архивирование открытой страницы', () => {
  it('переходит к родителю', async () => {
    const base = await open('b');
    act(() => base.current.archivePage('b'));
    expect(base.current.selectedId).toBe('a');
  });

  it('открыта вложенная в архивируемую — тоже к родителю архивируемой', async () => {
    const base = await open('c');
    act(() => base.current.archivePage('b'));
    expect(base.current.selectedId).toBe('a');
  });

  it('у верхнего уровня родителя нет — к первой странице', async () => {
    const base = await open('a');
    act(() => base.current.archivePage('a'));
    expect(base.current.selectedId).toBe('d');
  });

  it('архивирование другой страницы открытую не меняет', async () => {
    const base = await open('c');
    act(() => base.current.archivePage('d'));
    expect(base.current.selectedId).toBe('c');
  });
});

describe('загрузка без сети', () => {
  afterEach(() => vi.useRealTimers());

  it('не создаёт новую базу, а ждёт связи', async () => {
    vi.useFakeTimers();
    let online = false;
    const saveTree = vi.fn(() => Promise.resolve());
    const flaky: Store = {
      ...store,
      saveTree,
      loadTree: () => (online ? Promise.resolve(tree) : Promise.reject(new Error('нет сети'))),
    };

    const { result } = renderHook(() => useBase(flaky, () => 'd'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.unavailable).toBe(true);
    expect(result.current.tree).toBeNull();

    online = true;
    await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAY));
    expect(result.current.unavailable).toBe(false);
    expect(result.current.tree).toEqual(tree);
    expect(saveTree).not.toHaveBeenCalled();
  });
});

describe('правки дерева как операции', () => {
  afterEach(() => vi.useRealTimers());

  it('набор заголовка уходит одной операцией переименования', async () => {
    const own = makeStore();
    const hook = renderHook(() => useBase(own, () => 'd'));
    await waitFor(() => expect(hook.result.current.tree).not.toBeNull());
    vi.useFakeTimers();

    for (const title of ['Н', 'Но', 'Нов', 'Новое']) {
      act(() => hook.result.current.renamePage('d', title));
    }
    act(() => void vi.advanceTimersByTime(1000));

    expect(own.updateTree).toHaveBeenCalledTimes(1);
    expect(own.updateTree).toHaveBeenCalledWith([{ type: 'rename', id: 'd', title: 'Новое' }]);
  });

  it('структурная операция уходит сразу и после накопленного набора', async () => {
    const own = makeStore();
    const hook = renderHook(() => useBase(own, () => 'd'));
    await waitFor(() => expect(hook.result.current.tree).not.toBeNull());

    act(() => hook.result.current.renamePage('d', 'Новое'));
    act(() => hook.result.current.shiftPage('d', 1));

    expect(own.updateTree).toHaveBeenCalledTimes(1);
    expect(own.updateTree).toHaveBeenCalledWith([
      { type: 'rename', id: 'd', title: 'Новое' },
      { type: 'shift', id: 'd', delta: 1 },
    ]);
  });

  it('дерево с сервера принимается, а неотправленный набор ложится поверх', async () => {
    const own = makeStore();
    const hook = renderHook(() => useBase(own, () => 'd'));
    await waitFor(() => expect(hook.result.current.tree).not.toBeNull());

    act(() => hook.result.current.renamePage('d', 'Набираю'));
    const elsewhere: Tree = {
      roots: [...tree.roots, { id: 'e', title: 'С другого устройства', children: [] }],
    };
    act(() => own.pushTree(elsewhere));

    const titles = hook.result.current.tree!.roots.map((n) => n.title);
    expect(titles).toEqual(['Набираю', 'A', 'С другого устройства']);
  });

  it('открытая страница исчезла в дереве с сервера — открывается первая', async () => {
    const own = makeStore();
    const hook = renderHook(() => useBase(own, () => 'c'));
    await waitFor(() => expect(hook.result.current.tree).not.toBeNull());

    act(() => own.pushTree({ roots: [{ id: 'd', title: 'D', children: [] }] }));
    expect(hook.result.current.selectedId).toBe('d');
  });
});
