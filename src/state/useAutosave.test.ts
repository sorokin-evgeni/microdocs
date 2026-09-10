import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

describe('отложенное сохранение', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('не пишет, пока правки идут подряд', () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave<string>(save, 600));

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
});
