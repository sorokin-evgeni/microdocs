import { useCallback, useEffect, useState } from 'react';
import type { PageId, Tree } from '../types';
import type { PageStore } from '../storage/pageStore';
import { seedBase } from '../domain/seed';
import { useAutosave } from './useAutosave';
import {
  ancestorIds,
  archiveNode,
  findNode,
  insertNode,
  makeNode,
  moveNode,
  placeNode,
  removeArchived,
  removeNode,
  renameNode,
  restoreNode,
  setNodeIcon,
  shiftNode,
  type DropPosition,
} from '../domain/tree';

/**
 * Состояние базы: дерево, выбранная страница и операции над ними.
 * Кнопки «Сохранить» нет (FR-16).
 *
 * Все изменения дерева идут через одну отложенную запись: иначе набор заголовка
 * успел бы отложить старое дерево и затереть им результат следующей структурной
 * операции. Структурные операции дописывают запись немедленно.
 */
/** Через сколько повторить загрузку, если база не загрузилась. */
export const RETRY_DELAY = 5000;

export function useBase(
  store: PageStore,
  pickInitial: (tree: Tree) => PageId | null = (tree) => tree.roots[0]?.id ?? null,
) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [selectedId, setSelectedId] = useState<PageId | null>(null);
  /** База не загрузилась: нет связи и нет копии на устройстве. */
  const [unavailable, setUnavailable] = useState(false);

  const saveTree = useCallback(
    (_key: string, value: Tree) => void store.saveTree(value),
    [store],
  );
  const { schedule, flush } = useAutosave<Tree>(saveTree);

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

  const apply = useCallback(
    (next: Tree, { immediate }: { immediate: boolean }) => {
      setTree(next);
      schedule('tree', next);
      if (immediate) flush();
    },
    [schedule, flush],
  );

  const createPage = useCallback(
    (parentId: PageId | null) => {
      if (!tree) return;
      const node = makeNode('Новая страница');
      apply(insertNode(tree, parentId, node), { immediate: true });
      setSelectedId(node.id);
    },
    [tree, apply],
  );

  /** Набор заголовка — запись откладывается, состояние меняется сразу. */
  const renamePage = useCallback(
    (id: PageId, title: string) => {
      if (!tree) return;
      apply(renameNode(tree, id, title), { immediate: false });
    },
    [tree, apply],
  );

  const setPageIcon = useCallback(
    (id: PageId, icon: string | null) => {
      if (!tree) return;
      apply(setNodeIcon(tree, id, icon), { immediate: true });
    },
    [tree, apply],
  );

  const deletePage = useCallback(
    (id: PageId) => {
      if (!tree) return;
      const { tree: next, removed } = removeNode(tree, id);
      apply(next, { immediate: true });
      void store.deleteBodies(removed);
      if (selectedId && removed.includes(selectedId)) {
        setSelectedId(next.roots[0]?.id ?? null);
      }
    },
    [tree, apply, store, selectedId],
  );

  const archivePage = useCallback(
    (id: PageId) => {
      if (!tree) return;
      const next = archiveNode(tree, id);
      apply(next, { immediate: true });
      // Открытая страница ушла в архив — переходим к родителю ветки,
      // а у верхнего уровня родителя нет — к первой странице.
      if (selectedId && !findNode(next, selectedId)) {
        setSelectedId(ancestorIds(tree, id).at(-1) ?? next.roots[0]?.id ?? null);
      }
    },
    [tree, apply, selectedId],
  );

  const restorePage = useCallback(
    (id: PageId) => {
      if (!tree) return;
      apply(restoreNode(tree, id), { immediate: true });
    },
    [tree, apply],
  );

  const deleteArchivedPage = useCallback(
    (id: PageId) => {
      if (!tree) return;
      const { tree: next, removed } = removeArchived(tree, id);
      apply(next, { immediate: true });
      void store.deleteBodies(removed);
    },
    [tree, apply, store],
  );

  const movePage = useCallback(
    (id: PageId, newParentId: PageId | null) => {
      if (!tree) return;
      apply(moveNode(tree, id, newParentId), { immediate: true });
    },
    [tree, apply],
  );

  const placePage = useCallback(
    (id: PageId, targetId: PageId, position: DropPosition) => {
      if (!tree) return;
      apply(placeNode(tree, id, targetId, position), { immediate: true });
    },
    [tree, apply],
  );

  const shiftPage = useCallback(
    (id: PageId, delta: -1 | 1) => {
      if (!tree) return;
      apply(shiftNode(tree, id, delta), { immediate: true });
    },
    [tree, apply],
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
