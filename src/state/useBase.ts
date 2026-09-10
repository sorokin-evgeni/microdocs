import { useCallback, useEffect, useState } from 'react';
import type { PageId, Tree } from '../types';
import type { PageStore } from '../storage/pageStore';
import { seedBase } from '../domain/seed';
import {
  insertNode,
  makeNode,
  moveNode,
  removeNode,
  renameNode,
  shiftNode,
} from '../domain/tree';

/**
 * Состояние базы: дерево, выбранная страница и операции над ними.
 * Каждая операция сразу пишется в хранилище — отдельной кнопки «Сохранить» нет (FR-16).
 */
export function useBase(store: PageStore) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [selectedId, setSelectedId] = useState<PageId | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const loaded = await store.loadTree();
      if (cancelled) return;

      if (loaded) {
        setTree(loaded);
        setSelectedId(loaded.roots[0]?.id ?? null);
        return;
      }

      const { tree: fresh, bodies } = seedBase();
      await store.saveTree(fresh);
      await Promise.all(
        Object.entries(bodies).map(([id, body]) => store.saveBody(id, body)),
      );
      if (cancelled) return;
      setTree(fresh);
      setSelectedId(fresh.roots[0]?.id ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [store]);

  const persist = useCallback(
    async (next: Tree) => {
      setTree(next);
      await store.saveTree(next);
    },
    [store],
  );

  const createPage = useCallback(
    async (parentId: PageId | null) => {
      if (!tree) return;
      const node = makeNode('Новая страница');
      await persist(insertNode(tree, parentId, node));
      setSelectedId(node.id);
    },
    [tree, persist],
  );

  const renamePage = useCallback(
    async (id: PageId, title: string) => {
      if (!tree) return;
      await persist(renameNode(tree, id, title));
    },
    [tree, persist],
  );

  const deletePage = useCallback(
    async (id: PageId) => {
      if (!tree) return;
      const { tree: next, removed } = removeNode(tree, id);
      await persist(next);
      await store.deleteBodies(removed);
      if (selectedId && removed.includes(selectedId)) {
        setSelectedId(next.roots[0]?.id ?? null);
      }
    },
    [tree, persist, store, selectedId],
  );

  const movePage = useCallback(
    async (id: PageId, newParentId: PageId | null) => {
      if (!tree) return;
      await persist(moveNode(tree, id, newParentId));
    },
    [tree, persist],
  );

  const shiftPage = useCallback(
    async (id: PageId, delta: -1 | 1) => {
      if (!tree) return;
      await persist(shiftNode(tree, id, delta));
    },
    [tree, persist],
  );

  return {
    tree,
    selectedId,
    select: setSelectedId,
    createPage,
    renamePage,
    deletePage,
    movePage,
    shiftPage,
  };
}
