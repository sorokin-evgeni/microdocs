import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageId, Tree } from '../types';
import type { SyncingStore } from '../storage/syncingStore';
import { seedBase } from '../domain/seed';
import { applyOp, applyOps, type TreeOp } from '../domain/treeOps';
import { useAutosave } from './useAutosave';
import {
  ancestorIds,
  findNode,
  makeNode,
  removeArchived,
  removeNode,
  type DropPosition,
} from '../domain/tree';

type TreeStore = Pick<
  SyncingStore,
  | 'loadTree'
  | 'saveTree'
  | 'saveBody'
  | 'deleteBodies'
  | 'updateTree'
  | 'refreshTree'
  | 'subscribeTree'
>;

/** Через сколько повторить загрузку, если база не загрузилась. */
export const RETRY_DELAY = 5000;

/**
 * Состояние базы: дерево, выбранная страница и операции над ними.
 * Кнопки «Сохранить» нет (FR-16).
 *
 * Каждое изменение — операция (TreeOp): сразу применяется к дереву на экране
 * и уходит в хранилище. Набор заголовка копится и уходит с задержкой,
 * подряд идущие переименования одной страницы схлопываются в одно;
 * структурные операции дописывают накопленное немедленно — порядок сохраняется.
 *
 * Дерево может прийти и извне — с сервера, где его правили на другом
 * устройстве. Тогда поверх него применяется то, что здесь ещё не ушло.
 */
export function useBase(
  store: TreeStore,
  pickInitial: (tree: Tree) => PageId | null = (tree) => tree.roots[0]?.id ?? null,
) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [selectedId, setSelectedId] = useState<PageId | null>(null);
  /** База не загрузилась: нет связи и нет копии на устройстве. */
  const [unavailable, setUnavailable] = useState(false);

  /** Операции, применённые на экране, но ещё не отданные хранилищу. */
  const unsent = useRef<TreeOp[]>([]);
  const send = useCallback(
    (_key: string, ops: TreeOp[]) => {
      unsent.current = unsent.current.slice(ops.length);
      void store.updateTree(ops);
    },
    [store],
  );
  const { schedule, flush } = useAutosave<TreeOp[]>(send);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      let loaded: Tree | null;
      try {
        loaded = await store.loadTree();
      } catch {
        // Есть ли база, неизвестно — создавать новую нельзя, затрём настоящую.
        // Ждём связи и пробуем снова.
        if (cancelled) return;
        setUnavailable(true);
        retry = setTimeout(() => void load(), RETRY_DELAY);
        return;
      }
      if (cancelled) return;
      setUnavailable(false);
      if (loaded) {
        setTree(loaded);
        setSelectedId(pickInitial(loaded));
        return;
      }

      const { tree: fresh, bodies } = seedBase();
      await store.saveTree(fresh);
      await Promise.all(
        Object.entries(bodies).map(([id, body]) => store.saveBody(id, body)),
      );
      if (cancelled) return;
      setTree(fresh);
      setSelectedId(pickInitial(fresh));
    };

    void load();
    return () => {
      cancelled = true;
      if (retry !== null) clearTimeout(retry);
    };
  }, [store]);

  // Дерево пришло извне: поверх — то, что здесь ещё не ушло в хранилище.
  useEffect(
    () =>
      store.subscribeTree((incoming) => {
        const next = applyOps(incoming, unsent.current);
        setTree(next);
        setSelectedId((id) => (id && !findNode(next, id) ? (next.roots[0]?.id ?? null) : id));
      }),
    [store],
  );

  // Вернулись на вкладку или появилась связь — вдруг дерево правили в другом месте.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void store.refreshTree();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [store]);

  const apply = useCallback(
    (op: TreeOp, { immediate }: { immediate: boolean }): Tree | null => {
      if (!tree) return null;
      const next = applyOp(tree, op);
      setTree(next);

      const last = unsent.current.at(-1);
      if (op.type === 'rename' && last?.type === 'rename' && last.id === op.id) {
        unsent.current = [...unsent.current.slice(0, -1), op];
      } else {
        unsent.current = [...unsent.current, op];
      }
      schedule('tree', unsent.current);
      if (immediate) flush();
      return next;
    },
    [tree, schedule, flush],
  );

  const createPage = useCallback(
    (parentId: PageId | null) => {
      const node = makeNode('Новая страница');
      if (apply({ type: 'create', parentId, node }, { immediate: true })) setSelectedId(node.id);
    },
    [apply],
  );

  /** Набор заголовка — запись откладывается, состояние меняется сразу. */
  const renamePage = useCallback(
    (id: PageId, title: string) => void apply({ type: 'rename', id, title }, { immediate: false }),
    [apply],
  );

  const setPageIcon = useCallback(
    (id: PageId, icon: string | null) => void apply({ type: 'setIcon', id, icon }, { immediate: true }),
    [apply],
  );

  const deletePage = useCallback(
    (id: PageId) => {
      if (!tree) return;
      const { removed } = removeNode(tree, id);
      const next = apply({ type: 'remove', id }, { immediate: true });
      void store.deleteBodies(removed);
      if (next && selectedId && removed.includes(selectedId)) {
        setSelectedId(next.roots[0]?.id ?? null);
      }
    },
    [tree, apply, store, selectedId],
  );

  const archivePage = useCallback(
    (id: PageId) => {
      if (!tree) return;
      const next = apply({ type: 'archive', id }, { immediate: true });
      // Открытая страница ушла в архив — переходим к родителю ветки,
      // а у верхнего уровня родителя нет — к первой странице.
      if (next && selectedId && !findNode(next, selectedId)) {
        setSelectedId(ancestorIds(tree, id).at(-1) ?? next.roots[0]?.id ?? null);
      }
    },
    [tree, apply, selectedId],
  );

  const restorePage = useCallback(
    (id: PageId) => void apply({ type: 'restore', id }, { immediate: true }),
    [apply],
  );

  const deleteArchivedPage = useCallback(
    (id: PageId) => {
      if (!tree) return;
      const { removed } = removeArchived(tree, id);
      apply({ type: 'removeArchived', id }, { immediate: true });
      void store.deleteBodies(removed);
    },
    [tree, apply, store],
  );

  const movePage = useCallback(
    (id: PageId, newParentId: PageId | null) =>
      void apply({ type: 'move', id, parentId: newParentId }, { immediate: true }),
    [apply],
  );

  const placePage = useCallback(
    (id: PageId, targetId: PageId, position: DropPosition) =>
      void apply({ type: 'place', id, targetId, position }, { immediate: true }),
    [apply],
  );

  const shiftPage = useCallback(
    (id: PageId, delta: -1 | 1) => void apply({ type: 'shift', id, delta }, { immediate: true }),
    [apply],
  );

  return {
    tree,
    unavailable,
    selectedId,
    select: setSelectedId,
    createPage,
    renamePage,
    setPageIcon,
    deletePage,
    archivePage,
    restorePage,
    deleteArchivedPage,
    movePage,
    placePage,
    shiftPage,
  };
}
