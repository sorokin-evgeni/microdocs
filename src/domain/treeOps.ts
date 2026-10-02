import type { PageId, Tree, TreeNode } from '../types';
import {
  archiveNode,
  canMove,
  findNode,
  insertNode,
  moveNode,
  placeNode,
  removeArchived,
  removeNode,
  renameNode,
  restoreNode,
  setNodeIcon,
  shiftNode,
  type DropPosition,
} from './tree';

/**
 * Правка дерева как данные, а не как готовое дерево. Неотправленные операции
 * можно применить заново поверх дерева, которое тем временем поменяли
 * на другом устройстве, — так чужие правки не затираются.
 */
export type TreeOp =
  | { type: 'create'; parentId: PageId | null; node: TreeNode }
  | { type: 'rename'; id: PageId; title: string }
  | { type: 'setIcon'; id: PageId; icon: string | null }
  | { type: 'remove'; id: PageId }
  | { type: 'archive'; id: PageId }
  | { type: 'restore'; id: PageId }
  | { type: 'removeArchived'; id: PageId }
  | { type: 'move'; id: PageId; parentId: PageId | null }
  | { type: 'place'; id: PageId; targetId: PageId; position: DropPosition }
  | { type: 'shift'; id: PageId; delta: -1 | 1 };

/**
 * Применить операцию. Дерево могли поменять на другом устройстве, поэтому
 * операция не падает, а делает, что ещё имеет смысл:
 *   - страницы, к которой она относится, больше нет — ничего не делает;
 *   - новая страница, чьего родителя больше нет, — встаёт на верхний уровень,
 *     иначе её текст остался бы без места в дереве;
 *   - перенос, который теперь создал бы цикл или ведёт к исчезнувшей
 *     странице, — не делается, страница остаётся где была;
 *   - переименование и иконка доходят и до веток в архиве.
 */
export function applyOp(tree: Tree, op: TreeOp): Tree {
  switch (op.type) {
    case 'create': {
      if (findNode(tree, op.node.id)) return tree;
      const parent = op.parentId !== null && findNode(tree, op.parentId) ? op.parentId : null;
      return insertNode(tree, parent, op.node);
    }
    case 'rename':
      return inArchiveToo(tree, (t) => renameNode(t, op.id, op.title));
    case 'setIcon':
      return inArchiveToo(tree, (t) => setNodeIcon(t, op.id, op.icon));
    case 'remove':
      return removeNode(tree, op.id).tree;
    case 'archive':
      return archiveNode(tree, op.id);
    case 'restore':
      return restoreNode(tree, op.id);
    case 'removeArchived':
      return removeArchived(tree, op.id).tree;
    case 'move':
      return canMove(tree, op.id, op.parentId) ? moveNode(tree, op.id, op.parentId) : tree;
    case 'place':
      return canMove(tree, op.id, op.targetId) ? placeNode(tree, op.id, op.targetId, op.position) : tree;
    case 'shift':
      return shiftNode(tree, op.id, op.delta);
  }
}

export function applyOps(tree: Tree, ops: TreeOp[]): Tree {
  return ops.reduce(applyOp, tree);
}

/** Правка узла и в живом дереве, и в архивных ветках. */
function inArchiveToo(tree: Tree, edit: (tree: Tree) => Tree): Tree {
  const next = edit(tree);
  if (!tree.archive?.length) return next;
  return {
    ...next,
    archive: tree.archive.map((entry) => {
      const branch = edit({ roots: [entry.node] }).roots[0]!;
      return branch === entry.node ? entry : { ...entry, node: branch };
    }),
  };
}
