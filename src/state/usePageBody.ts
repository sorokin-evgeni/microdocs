import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageId } from '../types';
import type { SyncingStore } from '../storage/syncingStore';
import { merge3 } from '../domain/merge';
import { linkedPageIds } from '../domain/links';
import { useAutosave } from './useAutosave';

type BodyStore = Pick<
  SyncingStore,
  'openPage' | 'saveBody' | 'subscribe' | 'refreshPage' | 'prefetchPages'
>;

/**
 * Сверка с сервером обычно укладывается в доли секунды; индикатор
 * показывается, только если затянулась, — иначе мигал бы на каждом открытии.
 */
export const REFRESHING_AFTER = 400;

/**
 * Тело выбранной страницы. Пока грузится — `null`.
 * Правки пишутся с задержкой; при переходе на другую страницу недописанный
 * текст уходит в прежнюю (см. useAutosave).
 *
 * Открывается мгновенно: если копия на устройстве есть, она показывается
 * сразу, а сверка с сервером идёт следом. Пока сверка тянется дольше
 * REFRESHING_AFTER, `refreshing` — повод показать «Обновляется…».
 * Следом в фоне скачиваются страницы, на которые открытая ссылается,
 * и вложенные в неё (`children`): туда переходят чаще всего.
 *
 * Страница может поменяться и не из редактора: пришла новее с сервера или
 * слилась с чужой правкой. Тогда растёт `revision` — редактор по нему
 * подменяет содержимое. При возврате на вкладку и появлении связи
 * страница сверяется с сервером.
 */
export function usePageBody(
  store: BodyStore,
  pageId: PageId | null,
  children: PageId[] = [],
) {
  // Список вложенных пересоздаётся на каждой отрисовке — держим последний
  // в ref, чтобы не перезапускать из-за него открытие страницы.
  const childrenRef = useRef(children);
  childrenRef.current = children;
  const prefetchFor = useCallback(
    (text: string) =>
      store.prefetchPages([...new Set([...linkedPageIds(text), ...childrenRef.current])]),
    [store],
  );

  const [body, setBody] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  /** Сверить с сервером; индикатор — только если сверка затянулась. */
  const revalidate = useCallback(
    (id: PageId, isCurrent: () => boolean) => {
      const slow = setTimeout(() => {
        if (isCurrent()) setRefreshing(true);
      }, REFRESHING_AFTER);
      return store.refreshPage(id).finally(() => {
        clearTimeout(slow);
        if (isCurrent()) setRefreshing(false);
      });
    },
    [store],
  );

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
    setRefreshing(false);
    // Копии на устройстве нет — ждём сервер; если долго, пусть будет видно.
    const slow = setTimeout(() => {
      if (!cancelled) setRefreshing(true);
    }, REFRESHING_AFTER);
    void store.openPage(pageId).then(({ body: text, revalidate: stale }) => {
      clearTimeout(slow);
      if (cancelled) return;
      setRefreshing(false);
      setBody(text);
      // Сначала — сверка открытой страницы, потом в фоне те, на которые она
      // ссылается: по ссылке перейдут скорее всего, пусть откроются сразу.
      const checked = stale ? revalidate(pageId, () => !cancelled) : Promise.resolve();
      void checked
        .then(() => store.openPage(pageId))
        .then(({ body: current }) => prefetchFor(current));
    });

    return () => {
      cancelled = true;
      clearTimeout(slow);
    };
  }, [store, pageId, flush, revalidate, prefetchFor]);

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
      // В пришедшем тексте могли появиться новые ссылки.
      void prefetchFor(next);
    });
  }, [store, pageId, pending, discard, schedule, prefetchFor]);

  // Вернулись на вкладку или появилась связь — вдруг страницу правили в другом месте.
  useEffect(() => {
    if (!pageId) return;
    let current = true;
    const refresh = () => {
      if (document.visibilityState === 'visible') void revalidate(pageId, () => current);
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      current = false;
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [pageId, revalidate]);

  const change = useCallback(
    (markdown: string) => {
      if (pageId) schedule(pageId, markdown);
    },
    [pageId, schedule],
  );

  return { body, revision, refreshing, change };
}
