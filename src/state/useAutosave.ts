import { useCallback, useEffect, useRef } from 'react';

export interface Autosave<T> {
  /** Отложить запись. Смена ключа немедленно дописывает предыдущий. */
  schedule: (key: string, value: T) => void;
  /** Записать отложенное прямо сейчас. */
  flush: () => void;
}

/**
 * Откладывает запись, пока правки идут подряд (FR-16: кнопки «Сохранить» нет).
 *
 * Тонкость, ради которой это отдельный хук: если пользователь переключил страницу,
 * недописанный текст должен уйти в **прежнюю** страницу, а не в новую.
 */
export function useAutosave<T>(
  save: (key: string, value: T) => void,
  delay = 600,
): Autosave<T> {
  const pending = useRef<{ key: string; value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
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
    },
    [flush, delay],
  );

  // Не терять правку при закрытии страницы или уходе со вкладки.
  useEffect(() => flush, [flush]);

  return { schedule, flush };
}
