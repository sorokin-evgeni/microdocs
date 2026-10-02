import { useCallback, useEffect, useState } from 'react';
import type { PageId } from '../types';
import type { SyncingStore } from '../storage/syncingStore';
import { merge3 } from '../domain/merge';
import { useAutosave } from './useAutosave';

type BodyStore = Pick<SyncingStore, 'loadBody' | 'saveBody' | 'subscribe' | 'refreshPage'>;

/**
 * Тело выбранной страницы. Пока грузится — `null`.
 * Правки пишутся с задержкой; при переходе на другую страницу недописанный
 * текст уходит в прежнюю (см. useAutosave).
 *
 * Страница может поменяться и не из редактора: пришла новее с сервера или
 * слилась с чужой правкой. Тогда растёт `revision` — редактор по нему
 * подменяет содержимое. При возврате на вкладку и появлении связи
 * страница сверяется с сервером.
 */
export function usePageBody(store: BodyStore, pageId: PageId | null) {
  const [body, setBody] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const saveBody = useCallback(
    (id: string, value: string) => void store.saveBody(id, value),
    [store],
  );
  const { schedule, flush, pending, discard } = useAutosave<string>(saveBody);

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

  // Страница поменялась не из редактора.
  useEffect(() => {
    if (!pageId) return;
    return store.subscribe((change) => {
      if (change.id !== pageId) return;
      // Набранное за последние доли секунды ещё не записано и не учтено —
      // сливаем его с новым содержимым так же, как сливает отправка.
      const typed = pending(pageId);
      let next = change.after;
      if (typed !== undefined && typed !== change.before) {
        const merged = merge3(change.before, typed, change.after);
        if (merged.clean) next = merged.text;
      }
      discard();
      setBody(next);
      setRevision((r) => r + 1);
      if (next !== change.after) schedule(pageId, next);
    });
  }, [store, pageId, pending, discard, schedule]);

  // Вернулись на вкладку или появилась связь — вдруг страницу правили в другом месте.
  useEffect(() => {
    if (!pageId) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void store.refreshPage(pageId);
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [store, pageId]);

  const change = useCallback(
    (markdown: string) => {
      if (pageId) schedule(pageId, markdown);
    },
    [pageId, schedule],
  );

  return { body, revision, change };
}
