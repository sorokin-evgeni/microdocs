import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PageId, Tree } from '../types';
import { pageFromLocation, usePageUrl } from './usePageUrl';

const tree: Tree = {
  roots: [
    { id: 'a', title: 'Первая', children: [{ id: 'b', title: 'Вторая', children: [] }] },
  ],
};

function render(initial: { tree: Tree; selectedId: PageId | null }) {
  const select = vi.fn();
  const hook = renderHook(
    ({ tree, selectedId }) => usePageUrl(tree, selectedId, select),
    { initialProps: initial },
  );
  return { ...hook, select };
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pageFromLocation', () => {
  it('страница из адреса, а если её нет — первая', () => {
    window.history.replaceState(null, '', '/p/vtoraya-b');
    expect(pageFromLocation(tree)).toBe('b');
    window.history.replaceState(null, '', '/p/udalena-zzz');
    expect(pageFromLocation(tree)).toBe('a');
  });
});

describe('usePageUrl', () => {
  it('корень заменяется адресом открытой страницы без новой записи в истории', () => {
    const length = window.history.length;
    render({ tree, selectedId: 'a' });
    act(() => vi.runAllTimers());
    expect(window.location.pathname).toBe('/p/pervaya-a');
    expect(window.history.length).toBe(length);
  });

  it('переход на другую страницу — новая запись в истории', () => {
    window.history.replaceState(null, '', '/p/pervaya-a');
    const length = window.history.length;
    const { rerender } = render({ tree, selectedId: 'a' });
    rerender({ tree, selectedId: 'b' });
    expect(window.location.pathname).toBe('/p/vtoraya-b');
    expect(window.history.length).toBe(length + 1);
  });

  it('переименование правит адрес на месте', () => {
    window.history.replaceState(null, '', '/p/pervaya-a');
    const length = window.history.length;
    const { rerender } = render({ tree, selectedId: 'a' });
    const renamed: Tree = { roots: [{ ...tree.roots[0]!, title: 'Новое имя' }] };
    rerender({ tree: renamed, selectedId: 'a' });
    act(() => vi.runAllTimers());
    expect(window.location.pathname).toBe('/p/novoe-imya-a');
    expect(window.history.length).toBe(length);
  });

  it('«Назад» открывает страницу из адреса', () => {
    const { select } = render({ tree, selectedId: 'a' });
    window.history.replaceState(null, '', '/p/vtoraya-b');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(select).toHaveBeenCalledWith('b');
  });
});
