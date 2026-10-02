import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { PULL_THRESHOLD, usePullToRefresh } from './usePullToRefresh';

function touch(type: string, y: number, target: EventTarget = document.body) {
  const event = new Event(type, { bubbles: true }) as Event & { touches: { clientY: number }[] };
  Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientY: y }] });
  Object.defineProperty(event, 'target', { value: target });
  act(() => void window.dispatchEvent(event));
}

/** Палец от y=100 вниз на `distance` пикселей и отпустить. */
function pullDown(distance: number, { release = 'touchend', target }: { release?: string; target?: EventTarget } = {}) {
  touch('touchstart', 100, target);
  touch('touchmove', 100 + distance / 2, target);
  touch('touchmove', 100 + distance, target);
  touch(release, 100 + distance, target);
}

describe('потяни, чтобы обновить', () => {
  afterEach(() => Object.defineProperty(window, 'scrollY', { value: 0, configurable: true }));

  it('потянули достаточно в самом верху — обновляет, пока не закончит — крутится', async () => {
    let done!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => (done = resolve)));
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    pullDown(PULL_THRESHOLD * 2 + 10);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(result.current.refreshing).toBe(true);

    await act(async () => done());
    await waitFor(() => expect(result.current).toEqual({ pull: 0, refreshing: false }));
  });

  it('индикатор едет за пальцем, туже, чем палец', () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn(() => Promise.resolve())));
    touch('touchstart', 100);
    touch('touchmove', 140);
    expect(result.current.pull).toBe(20);
  });

  it('потянули мало — отпустили, ничего не происходит', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePullToRefresh(onRefresh));
    pullDown(PULL_THRESHOLD); // индикатор проехал только половину порога
    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.pull).toBe(0);
  });

  it('страница не в самом верху — это прокрутка, не жест', () => {
    Object.defineProperty(window, 'scrollY', { value: 200, configurable: true });
    const onRefresh = vi.fn(() => Promise.resolve());
    renderHook(() => usePullToRefresh(onRefresh));
    pullDown(400);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('палец вверх — прокрутка, не жест', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    renderHook(() => usePullToRefresh(onRefresh));
    touch('touchstart', 300);
    touch('touchmove', 100);
    touch('touchend', 100);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('система прервала касание — не обновляет', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    renderHook(() => usePullToRefresh(onRefresh));
    pullDown(400, { release: 'touchcancel' });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('жест в исключённой области (список страниц) не считается', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const nav = document.createElement('nav');
    renderHook(() => usePullToRefresh(onRefresh, (t) => t === nav));
    pullDown(400, { target: nav });
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
