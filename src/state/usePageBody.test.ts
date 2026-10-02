import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PageChange } from '../storage/syncingStore';
import { usePageBody } from './usePageBody';

function fakeStore(initial: string) {
  const listeners = new Set<(change: PageChange) => void>();
  return {
    loadBody: vi.fn(() => Promise.resolve(initial)),
    saveBody: vi.fn(() => Promise.resolve()),
    refreshPage: vi.fn(() => Promise.resolve()),
    subscribe: (listener: (change: PageChange) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit: (change: PageChange) => listeners.forEach((l) => l(change)),
  };
}

const было = 'Первая строка.\n\nВторая строка.';

async function open(store: ReturnType<typeof fakeStore>) {
  const hook = renderHook(() => usePageBody(store, 'p1'));
  await waitFor(() => expect(hook.result.current.body).toBe(было));
  return hook.result;
}

describe('страница поменялась не из редактора', () => {
  afterEach(() => vi.useRealTimers());

  it('новое содержимое показывается, редактор получает сигнал подменить', async () => {
    const store = fakeStore(было);
    const page = await open(store);
    const стало = было.replace('Вторая', 'Другая');

    act(() => store.emit({ id: 'p1', before: было, after: стало, conflict: false }));
    expect(page.current.body).toBe(стало);
    expect(page.current.revision).toBe(1);
  });

  it('набранное, но ещё не записанное, сливается с новым и не теряется', async () => {
    const store = fakeStore(было);
    const page = await open(store);
    vi.useFakeTimers();

    act(() => page.current.change(было.replace('Первая', 'Самая первая')));
    act(() =>
      store.emit({ id: 'p1', before: было, after: было.replace('Вторая', 'Другая'), conflict: false }),
    );

    const слитое = 'Самая первая строка.\n\nДругая строка.';
    expect(page.current.body).toBe(слитое);
    act(() => void vi.advanceTimersByTime(1000));
    expect(store.saveBody).toHaveBeenCalledTimes(1);
    expect(store.saveBody).toHaveBeenCalledWith('p1', слитое);
  });

  it('изменения других страниц не трогают открытую', async () => {
    const store = fakeStore(было);
    const page = await open(store);
    act(() => store.emit({ id: 'p2', before: 'x', after: 'y', conflict: false }));
    expect(page.current.body).toBe(было);
    expect(page.current.revision).toBe(0);
  });

  it('возврат на вкладку сверяет открытую страницу с сервером', async () => {
    const store = fakeStore(было);
    await open(store);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.refreshPage).toHaveBeenCalledWith('p1');
  });
});
