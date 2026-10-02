import { useCallback, useEffect, useRef } from 'react';

export interface Autosave<T> {
  /** Отложить запись. Смена ключа немедленно дописывает предыдущий. */
  schedule: (key: string, value: T) => void;
  /** Записать отложенное прямо сейчас. */
  flush: () => void;
  /** Отложенное и ещё не записанное значение ключа; undefined — ничего не ждёт. */
  pending: (key: string) => T | undefined;
  /** Забыть отложенное, не записывая: его место заняло что-то новее. */
  discard: () => void;
}

/** Сколько ждать тишины перед записью на устройство. */
export const LOCAL_SAVE_DELAY = 300;
/** Дольше этого правка без записи не висит, даже если набор не прерывается. */
export const LOCAL_SAVE_MAX_WAIT = 1000;

/**
 * Откладывает запись, пока правки идут подряд (FR-16: кнопки «Сохранить» нет).
 * Пишет на устройство, а на сервер отправляет уже хранилище, своим темпом.
 *
 * Тонкость, ради которой это отдельный хук: если пользователь переключил страницу,
 * недописанный текст должен уйти в **прежнюю** страницу, а не в новую.
 */
export function useAutosave<T>(
  save: (key: string, value: T) => void,
  delay = LOCAL_SAVE_DELAY,
  maxWait = LOCAL_SAVE_MAX_WAIT,
): Autosave<T> {
  const pending = useRef<{ key: string; value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (maxTimer.current !== null) clearTimeout(maxTimer.current);
    timer.current = null;
    maxTimer.current = null;
    const entry = pending.current;
    pending.current = null;
    if (entry) saveRef.current(entry.key, entry.value);
  }, []);

  const schedule = useCallback(
    (key: string, value: T) => {
      if (pending.current && pending.current.key !== key) flush();
      pending.current = { key, value };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
      // Предел отсчитывается от первой неписаной правки и не сдвигается.
      maxTimer.current ??= setTimeout(flush, maxWait);
    },
    [flush, delay, maxWait],
  );

  // Не терять правку при уходе со вкладки, сворачивании приложения и закрытии:
  // после этого страницу могут выгрузить, не дождавшись таймера.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
      // Размонтирование — тоже уход.
      flush();
    };
  }, [flush]);

  const pending_ = useCallback(
    (key: string) => (pending.current?.key === key ? pending.current.value : undefined),
    [],
  );

  const discard = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (maxTimer.current !== null) clearTimeout(maxTimer.current);
    timer.current = null;
    maxTimer.current = null;
    pending.current = null;
  }, []);

  return { schedule, flush, pending: pending_, discard };
}
