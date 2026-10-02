import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PageChange } from '../storage/syncingStore';
import { REFRESHING_AFTER, usePageBody } from './usePageBody';

function fakeStore(initial: string, { cached = true } = {}) {
  const listeners = new Set<(change: PageChange) => void>();
  return {
    openPage: vi.fn(() => Promise.resolve({ body: initial, revalidate: cached })),
    saveBody: vi.fn(() => Promise.resolve()),
    refreshPage: vi.fn(() => Promise.resolve()),
    prefetchPages: vi.fn((_ids: string[]) => Promise.resolve()),
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

describe('открытие из копии на устройстве', () => {
  afterEach(() => vi.useRealTimers());

  it('копия показывается сразу, сверка с сервером идёт следом', async () => {
    const store = fakeStore(было);
    const page = await open(store);
    expect(page.current.body).toBe(было);
    expect(store.refreshPage).toHaveBeenCalledWith('p1');
  });

  it('быстрая сверка индикатор не показывает', async () => {
    const store = fakeStore(было);
    const page = await open(store);
    expect(page.current.refreshing).toBe(false);
  });

  it('медленная сверка показывает «Обновляется…», пока не закончится', async () => {
    vi.useFakeTimers();
    const store = fakeStore(было);
    let done!: () => void;
    store.refreshPage.mockImplementation(() => new Promise<void>((resolve) => (done = resolve)));
    const hook = renderHook(() => usePageBody(store, 'p1'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(hook.result.current.body).toBe(было);
    expect(hook.result.current.refreshing).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(REFRESHING_AFTER));
    expect(hook.result.current.refreshing).toBe(true);

    await act(async () => done());
    expect(hook.result.current.refreshing).toBe(false);
  });

  it('копии нет — сверять нечего, страница уже с сервера', async () => {
    const store = fakeStore(было, { cached: false });
    await open(store);
    expect(store.refreshPage).not.toHaveBeenCalled();
  });
});

describe('фоновая закачка страниц по ссылкам', () => {
  it('после сверки качаются страницы, на которые ссылается открытая', async () => {
    const текст = 'См. [план](microdocs:page/aaa) и [итоги](microdocs:page/bbb), ещё раз [план](microdocs:page/aaa).';
    const store = fakeStore(текст);
    renderHook(() => usePageBody(store, 'p1'));
    await waitFor(() => expect(store.prefetchPages).toHaveBeenCalledWith(['aaa', 'bbb']));
    expect(store.refreshPage.mock.invocationCallOrder[0]).toBeLessThan(
      store.prefetchPages.mock.invocationCallOrder[0]!,
    );
  });

  it('новые ссылки в тексте, пришедшем извне, тоже качаются', async () => {
    const store = fakeStore(было);
    await open(store);
    store.prefetchPages.mockClear();
    act(() =>
      store.emit({ id: 'p1', before: было, after: `${было}\n\n[новая](microdocs:page/ccc)`, conflict: false }),
    );
    expect(store.prefetchPages).toHaveBeenCalledWith(['ccc']);
  });

  it('вложенные страницы качаются вместе со ссылками, без повторов', async () => {
    const store = fakeStore('[план](microdocs:page/aaa)');
    renderHook(() => usePageBody(store, 'p1', ['kid1', 'aaa', 'kid2']));
    await waitFor(() => expect(store.prefetchPages).toHaveBeenCalledWith(['aaa', 'kid1', 'kid2']));
  });
});
