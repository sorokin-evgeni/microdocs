import { useCallback, useEffect, useState } from 'react';
import type { PageId } from '../types';
import type { PageStore } from '../storage/pageStore';
import { useAutosave } from './useAutosave';

/**
 * Тело выбранной страницы. Пока грузится — `null`.
 * Правки пишутся с задержкой; при переходе на другую страницу недописанный
 * текст уходит в прежнюю (см. useAutosave).
 */
export function usePageBody(store: PageStore, pageId: PageId | null) {
  const [body, setBody] = useState<string | null>(null);

  const saveBody = useCallback(
    (id: string, value: string) => void store.saveBody(id, value),
    [store],
  );
  const { schedule, flush } = useAutosave<string>(saveBody);

  useEffect(() => {
    flush();

    if (!pageId) {
      setBody(null);
      return;
    }

    let cancelled = false;
    setBody(null);
    void store.loadBody(pageId).then((text) => {
      if (!cancelled) setBody(text);
    });

    return () => {
      cancelled = true;
    };
  }, [store, pageId, flush]);

  const change = useCallback(
    (markdown: string) => {
      if (pageId) schedule(pageId, markdown);
    },
    [pageId, schedule],
  );

  return { body, change };
}
