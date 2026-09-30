import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PageStore } from '../storage/pageStore';
import type { PageId, Tree } from '../types';
import { useBase } from './useBase';

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

const store: PageStore = {
  loadTree: () => Promise.resolve(tree),
  saveTree: vi.fn(() => Promise.resolve()),
  loadBody: () => Promise.resolve(''),
  saveBody: vi.fn(() => Promise.resolve()),
  deleteBodies: vi.fn(() => Promise.resolve()),
};

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
