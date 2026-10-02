import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

describe('отложенное сохранение', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('не пишет, пока правки идут подряд', () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave<string>(save, 600, 5000));

    act(() => {
      result.current.schedule('a', 'раз');
      vi.advanceTimersByTime(300);
      result.current.schedule('a', 'раз-два');
      vi.advanceTimersByTime(300);
    });
    expect(save).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(300));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('a', 'раз-два');
  });

  it('при смене страницы дописывает предыдущую, а не новую', () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave<string>(save, 600));

    act(() => {
      result.current.schedule('первая', 'текст первой');
      result.current.schedule('вторая', 'текст второй');
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('первая', 'текст первой');

    act(() => void vi.advanceTimersByTime(600));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('вторая', 'текст второй');
  });

  it('flush пишет немедленно', () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave<string>(save, 600));

    act(() => {
      result.current.schedule('a', 'текст');
      result.current.flush();
    });

    expect(save).toHaveBeenCalledWith('a', 'текст');
    act(() => void vi.advanceTimersByTime(600));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('размонтирование не теряет несохранённое', () => {
    const save = vi.fn();
    const { result, unmount } = renderHook(() => useAutosave<string>(save, 600));

    act(() => void result.current.schedule('a', 'недописанное'));
    expect(save).not.toHaveBeenCalled();

    unmount();
    expect(save).toHaveBeenCalledWith('a', 'недописанное');
  });

  it('при непрерывных правках пишет не реже maxWait', () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave<string>(save, 300, 1000));

    act(() => {
      for (let i = 1; i <= 6; i++) {
        result.current.schedule('a', `v${i}`);
        vi.advanceTimersByTime(200);
      }
    });
    // Правка каждые 200 мс — тишины в 300 мс не было, а секунда прошла.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('a', 'v5');
  });

  it('уход со вкладки пишет сразу', () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave<string>(save, 600));
    act(() => void result.current.schedule('a', 'недописанное'));

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockRestore();

    expect(save).toHaveBeenCalledWith('a', 'недописанное');
  });

  it('закрытие страницы пишет сразу', () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave<string>(save, 600));
    act(() => void result.current.schedule('a', 'недописанное'));

    window.dispatchEvent(new Event('pagehide'));

    expect(save).toHaveBeenCalledWith('a', 'недописанное');
  });

  it('возврат на вкладку ничего не пишет', () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave<string>(save, 600));
    act(() => void result.current.schedule('a', 'текст'));

    document.dispatchEvent(new Event('visibilitychange'));

    expect(save).not.toHaveBeenCalled();
  });
});
